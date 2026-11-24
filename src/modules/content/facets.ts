import type { Static } from "@sinclair/typebox";
import type { Pool, PoolClient } from "pg";
import type { Actor } from "../../../packages/contracts/src/access";
import type { ContentFacets, ContentFacetsQuery } from "../../../packages/contracts/src/content";
import { fail } from "../../shared/errors";
import {
  compileContentFilter,
  matchingNodes,
  type BatchMembership,
  type ContentScope,
  type ContentScopeResolver,
  type ContentVisibilityResolver,
} from "./search";

type Facets = Static<typeof ContentFacets>;
type FacetRow = {
  bucket: Date | null;
  grouping: number;
  platform: Facets["distributions"]["platforms"][number]["platform"] | null;
  kind: Facets["distributions"]["kinds"][number]["kind"] | null;
  count: string;
  matched: string;
};

function reduceFacetRows(rows: FacetRow[]): Facets {
  const timeline = new Map<string, Facets["timeline"][number]>();
  const distributions: Facets["distributions"] = { platforms: [], kinds: [] };
  let total = { count: 0, matchedContentCount: 0 };
  for (const row of rows) {
    const counts = { count: Number(row.count), matchedContentCount: Number(row.matched) };
    if (row.grouping === 7) total = counts;
    else if (row.grouping === 3 && row.bucket) {
      const bucket = row.bucket.toISOString();
      timeline.set(bucket, { bucket, byPlatform: [], ...counts });
    } else if (row.grouping === 1 && row.bucket && row.platform) {
      timeline.get(row.bucket.toISOString())?.byPlatform.push({ platform: row.platform, ...counts });
    } else if (row.grouping === 5 && row.platform) {
      distributions.platforms.push({ platform: row.platform, ...counts });
    } else if (row.grouping === 6 && row.kind) {
      distributions.kinds.push({ kind: row.kind, ...counts });
    }
  }
  return { ...total, timeline: [...timeline.values()], distributions, coverage: "stored_sample" };
}

export async function contentFacets(
  pool: Pool | PoolClient,
  actor: Actor,
  query: Static<typeof ContentFacetsQuery>,
  resolveProjectScope?: ContentScopeResolver,
  resolveContentVisibility?: ContentVisibilityResolver,
): Promise<Facets> {
  const { projectId, bucket = "day", ...filter } = query;
  const span = Date.parse(filter.to) - Date.parse(filter.from);
  if (!Number.isFinite(span) || span <= 0 || span > 90 * 86_400_000) {
    fail(422, "Content facets require a positive time range of at most 90 days");
  }
  const project = projectId
    ? await (resolveProjectScope ?? (() => fail(500, "Project scope resolver is unavailable")))(pool, actor, projectId)
    : undefined;
  const pullOnly = !project?.batchMembership && !filter.deliveryMode && !project?.include_push_in_trends;
  const compiled = compileContentFilter(
    actor,
    filter,
    project?.batchMembership ? undefined : project?.source_ids,
    project?.filter,
    pullOnly,
    project?.batchMembership ?? resolveContentVisibility?.(actor),
  );
  const threadAware = filter.threadAware ?? project?.thread_aware ?? false;
  const interval = compiled.values.push(bucket === "day" ? "1 day" : "6 hours");
  const { rows } = await pool.query<FacetRow>(
    `WITH matches AS (
      SELECT date_bin($${interval}::interval, created_at_source, TIMESTAMPTZ '2000-01-01 00:00:00+00') AS bucket,
        platform, kind, anchor_id
      FROM (${matchingNodes(compiled, threadAware)}) matched
    )
    SELECT bucket, platform, kind, GROUPING(bucket, platform, kind) AS grouping, ${threadAware ? "COUNT(DISTINCT anchor_id)" : "COUNT(*)"} AS count, COUNT(*) AS matched
    FROM matches
    GROUP BY GROUPING SETS ((), (bucket), (bucket, platform), (platform), (kind))
    ORDER BY grouping DESC, bucket, platform, kind`,
    compiled.values,
  );
  return reduceFacetRows(rows);
}

export async function summarizeScopedContent(
  pool: Pool | PoolClient,
  actor: Actor,
  project: ContentScope,
  visibility?: BatchMembership,
) {
  const compiled = compileContentFilter(
    actor,
    {},
    project.batchMembership ? undefined : project.source_ids,
    project.filter,
    !project.batchMembership && !project.include_push_in_trends,
    project.batchMembership ?? visibility,
  );
  const anchorCount = project.thread_aware ? "COUNT(DISTINCT c.anchor_id)" : "COUNT(*)";
  const [row] = (
    await pool.query<{
      facets: {
        day_group: number; platform_group: number; kind_group: number;
        day: string | null; platform: string | null; kind: string | null;
        count: number; matchedContentCount: number;
      }[];
      dayPlatformFacets: { day: string; platform: string; count: number; matchedContentCount: number }[];
      providers: string[];
    }>(
      `WITH matched AS (${matchingNodes(compiled, project.thread_aware)}), facets AS (
        SELECT GROUPING(date_trunc('day',c.created_at_source,'UTC')) AS day_group,
          GROUPING(c.platform) AS platform_group,GROUPING(c.kind) AS kind_group,
          date_trunc('day',c.created_at_source,'UTC') AS day,c.platform,c.kind,
          ${anchorCount} AS count,COUNT(*) AS "matchedContentCount"
        FROM matched c
        GROUP BY GROUPING SETS ((),(date_trunc('day',c.created_at_source,'UTC')),(c.platform),(c.kind),
          (date_trunc('day',c.created_at_source,'UTC'),c.platform))
      )
      SELECT (SELECT jsonb_agg(facets ORDER BY day_group DESC,day,platform,kind)
          FROM facets WHERE day_group=1 OR platform_group=1) AS facets,
        (SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'day',day,'platform',platform,'count',count,'matchedContentCount',"matchedContentCount"
        ) ORDER BY day,platform),'[]'::jsonb)
          FROM facets WHERE day_group=0 AND platform_group=0 AND day IS NOT NULL) AS "dayPlatformFacets",
        ARRAY(SELECT DISTINCT o.provider FROM matched c JOIN content_observation o ON o.content_id=c.id
          WHERE EXISTS (SELECT 1 FROM content_discovery d JOIN collection_source cs ON cs.id=d.collection_source_id
            WHERE ${compiled.discovery} AND d.collection_source_id=o.collection_source_id)
          ORDER BY o.provider) AS providers`,
      compiled.values,
    )
  ).rows;
  const totals = row.facets[0];
  return {
    contentCount: totals.count,
    matchedContentCount: totals.matchedContentCount,
    facets: row.facets,
    dayPlatformFacets: row.dayPlatformFacets,
    providers: row.providers,
    resolvedFilter: project.filter,
    coverage: "stored_sample" as const,
    threadAware: project.thread_aware,
  };
}
