import type { Static } from "@sinclair/typebox";
import type { Pool, PoolClient } from "pg";
import type { Actor, ContentFacets, ContentFacetsQuery } from "../../../packages/contracts/src/source-content";
import { fail } from "../../storage/db";
import { projectSources } from "../projects/index";
import { compileContentFilter, matchingNodes } from "./search";

type Facets = Static<typeof ContentFacets>;
type FacetRow = {
  bucket: Date | null;
  grouping: number;
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
  const batchProjectId = project?.dataset_mode === "batch" ? project.id : undefined;
  const pullOnly = batchProjectId ? false : !filter.deliveryMode && !project?.include_push_in_trends;
  const compiled = compileContentFilter(actor, filter, batchProjectId ? undefined : project?.source_ids, project?.filter, pullOnly, batchProjectId);
  const threadAware = filter.threadAware ?? project?.thread_aware ?? false;
  const interval = compiled.values.push(bucket === "day" ? "1 day" : "6 hours");
  const { rows } = await pool.query<FacetRow>(`
    WITH matches AS (
      SELECT date_bin($${interval}::interval, created_at_source, TIMESTAMPTZ '2000-01-01 00:00:00+00') AS bucket,
        platform, kind, anchor_id
      FROM (${matchingNodes(compiled, threadAware)}) matched
    )
    SELECT bucket, platform, kind, GROUPING(bucket, platform, kind) AS grouping, ${threadAware ? "COUNT(DISTINCT anchor_id)" : "COUNT(*)"} AS count, COUNT(*) AS matched
    FROM matches
    GROUP BY GROUPING SETS ((), (bucket), (bucket, platform), (platform), (kind))
    ORDER BY grouping DESC, bucket, platform, kind`, compiled.values);

  const timeline = new Map<string, Facets["timeline"][number]>();
  const distributions: Facets["distributions"] = { platforms: [], kinds: [] };
  let total = { count: 0, matchedContentCount: 0 };
  for (const row of rows) {
    const counts = { count: Number(row.count), matchedContentCount: Number(row.matched) };
    switch (row.grouping) {
      case 7: // Grand total.
        total = counts;
        break;
      case 3: // Bucket total.
        if (row.bucket) {
          const bucket = row.bucket.toISOString();
          timeline.set(bucket, { bucket, byPlatform: [], ...counts });
        }
        break;
      case 1: // Bucket and platform.
        if (row.bucket && row.platform)
          timeline.get(row.bucket.toISOString())?.byPlatform.push({ platform: row.platform, ...counts });
        break;
      case 5: // Platform total.
        if (row.platform) distributions.platforms.push({ platform: row.platform, ...counts });
        break;
      case 6: // Kind total.
        if (row.kind) distributions.kinds.push({ kind: row.kind, ...counts });
        break;
    }
  }
  return { ...total, timeline: [...timeline.values()], distributions, coverage: "stored_sample" };
}
