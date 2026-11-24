import type { Pool, PoolClient } from "pg";
import { contentVisibility, getUserRoleStatus } from "../collection/index";
import { queryScopedBucketStats, queryScopedTextSamples, type RawBucketStats } from "../content/index";
import { extractCooccurringTerms } from "./metrics";

interface UpsertBucketRow {
  bucketAt: string;
  bucketSize: "6h" | "1d";
  scopeKind: "monitor" | "keyword" | "author" | "subreddit";
  scopeId: string;
  platform: string;
  stats: RawBucketStats;
  topTerms: Array<{ term: string; count: number }>;
}

async function upsertRollupBuckets(db: Pool | PoolClient, rows: readonly UpsertBucketRow[]) {
  if (!rows.length) return;
  const payload = rows.map((r) =>
    JSON.stringify({
      bucketAt: r.bucketAt,
      bucketSize: r.bucketSize,
      scopeKind: r.scopeKind,
      scopeId: r.scopeId,
      platform: r.platform,
      postCount: r.stats.postCount,
      commentCount: r.stats.commentCount,
      uniqueAuthors: r.stats.uniqueAuthors,
      sumScore: r.stats.sumScore,
      sumComments: r.stats.sumComments,
      sumViews: r.stats.sumViews,
      sumLikes: r.stats.sumLikes,
      sumReposts: r.stats.sumReposts,
      sumBookmarks: r.stats.sumBookmarks,
      avgEngagementRate: r.stats.avgEngagementRate,
      p90Engagement: r.stats.p90Engagement,
      intentCounts: r.stats.intentCounts,
      topDomains: r.stats.topDomains,
      topTerms: r.topTerms,
    }),
  );
  await db.query(
    `INSERT INTO intel_rollup_bucket(
       bucket_at, bucket_size, scope_kind, scope_id, platform,
       post_count, comment_count, unique_authors,
       sum_score, sum_comments, sum_views, sum_likes, sum_reposts, sum_bookmarks,
       avg_engagement_rate, p90_engagement, intent_counts, top_domains, top_terms, updated_at
     )
     SELECT
       (v->>'bucketAt')::timestamptz, v->>'bucketSize', v->>'scopeKind', v->>'scopeId', v->>'platform',
       (v->>'postCount')::int, (v->>'commentCount')::int, (v->>'uniqueAuthors')::int,
       (v->>'sumScore')::bigint, (v->>'sumComments')::bigint, (v->>'sumViews')::bigint,
       (v->>'sumLikes')::bigint, (v->>'sumReposts')::bigint, (v->>'sumBookmarks')::bigint,
       (v->>'avgEngagementRate')::real, (v->>'p90Engagement')::real,
       v->'intentCounts', v->'topDomains', v->'topTerms', NOW()
     FROM UNNEST($1::jsonb[]) AS input(v)
     ON CONFLICT (bucket_at, bucket_size, scope_kind, scope_id, platform) DO UPDATE SET
       post_count = EXCLUDED.post_count,
       comment_count = EXCLUDED.comment_count,
       unique_authors = EXCLUDED.unique_authors,
       sum_score = EXCLUDED.sum_score,
       sum_comments = EXCLUDED.sum_comments,
       sum_views = EXCLUDED.sum_views,
       sum_likes = EXCLUDED.sum_likes,
       sum_reposts = EXCLUDED.sum_reposts,
       sum_bookmarks = EXCLUDED.sum_bookmarks,
       avg_engagement_rate = EXCLUDED.avg_engagement_rate,
       p90_engagement = EXCLUDED.p90_engagement,
       intent_counts = EXCLUDED.intent_counts,
       top_domains = EXCLUDED.top_domains,
       top_terms = EXCLUDED.top_terms,
       updated_at = NOW()`,
    [payload],
  );
}

export async function refreshMonitorRollups(
  pool: Pool,
  monitorId: string,
  lookbackDays = 30,
): Promise<number> {
  const [monRes, srcRes, tgtRes] = await Promise.all([
    pool.query<{ owner_user_id: string | null }>(
      "SELECT owner_user_id FROM intel_monitor WHERE id=$1",
      [monitorId],
    ),
    pool.query<{ collection_source_id: string }>(
      "SELECT collection_source_id FROM intel_monitor_source WHERE monitor_id=$1",
      [monitorId],
    ),
    pool.query<{ target_kind: string; target_value: string }>(
      "SELECT DISTINCT target_kind, target_value FROM intel_monitor_target WHERE monitor_id=$1",
      [monitorId],
    ),
  ]);
  const monitorRow = monRes.rows[0];
  if (!monitorRow) return 0;
  const sourceIds = srcRes.rows.map((r) => r.collection_source_id);
  if (!sourceIds.length) return 0;

  const owner = monitorRow.owner_user_id ? await getUserRoleStatus(pool, monitorRow.owner_user_id) : undefined;
  const ownerRole: "owner" | "admin" | "viewer" =
    owner?.role === "owner" || owner?.role === "admin" ? owner.role : "viewer";
  const visibility = monitorRow.owner_user_id
    ? contentVisibility({ role: ownerRole, userId: monitorRow.owner_user_id })
    : contentVisibility(undefined, { publicOnly: true });

  const to = new Date();
  const from = new Date(to.getTime() - lookbackDays * 86_400_000);
  const seedTerms = tgtRes.rows.map((t) => t.target_value);
  const [dailyBuckets, h6Buckets, samples] = await Promise.all([
    queryScopedBucketStats(pool, { sourceIds, from, to, bucketSize: "1d", visibility }),
    queryScopedBucketStats(pool, {
      sourceIds,
      from: new Date(to.getTime() - Math.min(lookbackDays, 14) * 86_400_000),
      to,
      bucketSize: "6h",
      visibility,
    }),
    queryScopedTextSamples(pool, sourceIds, from, to, 200, visibility),
  ]);
  const topTerms = extractCooccurringTerms(samples, seedTerms, 15);
  const rows: UpsertBucketRow[] = [
    ...dailyBuckets.map((stats) => ({
      bucketAt: stats.bucketAt,
      bucketSize: "1d" as const,
      scopeKind: "monitor" as const,
      scopeId: monitorId,
      platform: stats.platform,
      stats,
      topTerms,
    })),
    ...h6Buckets.map((stats) => ({
      bucketAt: stats.bucketAt,
      bucketSize: "6h" as const,
      scopeKind: "monitor" as const,
      scopeId: monitorId,
      platform: stats.platform,
      stats,
      topTerms: [],
    })),
  ];

  // Clear stale buckets inside this lookback window before upserting refreshed rollups.
  await pool.query(
    "DELETE FROM intel_rollup_bucket WHERE scope_kind='monitor' AND scope_id=$1 AND bucket_at >= $2",
    [monitorId, from.toISOString()],
  );
  await upsertRollupBuckets(pool, rows);
  return rows.length;
}

export async function refreshRollupsForSource(pool: Pool, sourceId: string): Promise<void> {
  const { rows } = await pool.query<{ monitor_id: string }>(
    "SELECT monitor_id FROM intel_monitor_source WHERE collection_source_id=$1",
    [sourceId],
  );
  for (const r of rows) {
    await refreshMonitorRollups(pool, r.monitor_id, 14);
  }
}
