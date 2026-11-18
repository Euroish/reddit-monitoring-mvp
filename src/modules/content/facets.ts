import type { Static } from "@sinclair/typebox";
import type { Pool, PoolClient } from "pg";
import type { Actor, ContentFacets, ContentFacetsQuery } from "../../../packages/contracts/src/source-content";
import { fail } from "../../storage/db";
import { projectSources } from "../projects/sql";
import { compileContentFilter, matchingNodes } from "./search";

type Facets = Static<typeof ContentFacets>;
type FacetRow = {
  bucket: Date | null;
  platform: Facets["distributions"]["platforms"][number]["platform"] | null;
  kind: Facets["distributions"]["kinds"][number]["kind"] | null;
  count: string;
  matched: string;
};

export async function contentFacets(pool: Pool | PoolClient, actor: Actor, query: Static<typeof ContentFacetsQuery>): Promise<Facets> {
  const { projectId, bucket = "day", ...filter } = query;
  const span = Date.parse(filter.to) - Date.parse(filter.from);
  if (!Number.isFinite(span) || span <= 0 || span > 90 * 86_400_000)
    fail(422, "Content facets require a positive time range of at most 90 days");

  const project = projectId ? await projectSources(pool, actor, projectId) : undefined;
  const pullOnly = !filter.deliveryMode && !project?.include_push_in_trends;
  const compiled = compileContentFilter(actor, filter, project?.source_ids, project?.filter, pullOnly);
  const threadAware = filter.threadAware ?? project?.thread_aware ?? false;
  const interval = compiled.values.push(bucket === "day" ? "1 day" : "6 hours");
  const { rows } = await pool.query<FacetRow>(`
    WITH matches AS (
      SELECT date_bin($${interval}::interval, created_at_source, TIMESTAMPTZ '2000-01-01 00:00:00+00') AS bucket,
        platform, kind, anchor_id
      FROM (${matchingNodes(compiled, threadAware)}) matched
    )
    SELECT bucket, platform, kind, ${threadAware ? "COUNT(DISTINCT anchor_id)" : "COUNT(*)"} AS count, COUNT(*) AS matched
    FROM matches
    GROUP BY GROUPING SETS ((), (bucket), (bucket, platform), (platform), (kind))
    ORDER BY bucket NULLS FIRST, platform NULLS FIRST, kind NULLS FIRST`, compiled.values);

  const [total, ...groups] = rows;
  const timeline: Facets["timeline"] = [];
  const distributions: Facets["distributions"] = { platforms: [], kinds: [] };
  for (const row of groups) {
    const counts = { count: Number(row.count), matchedContentCount: Number(row.matched) };
    if (row.bucket) {
      // The bucket total sorts before its platform rows.
      if (row.platform) timeline.at(-1)!.byPlatform.push({ platform: row.platform, ...counts });
      else timeline.push({ bucket: row.bucket.toISOString(), byPlatform: [], ...counts });
    } else if (row.platform) distributions.platforms.push({ platform: row.platform, ...counts });
    else if (row.kind) distributions.kinds.push({ kind: row.kind, ...counts });
  }
  return { count: Number(total.count), matchedContentCount: Number(total.matched), timeline, distributions, coverage: "stored_sample" };
}
