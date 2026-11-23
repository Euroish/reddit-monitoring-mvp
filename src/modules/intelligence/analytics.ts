import type { Static } from "@sinclair/typebox";
import type { Pool, QueryResultRow } from "pg";
import type { Actor } from "../../../packages/contracts/src/access";
import type {
  AuthorListQuery,
  CommunityListQuery,
  MonitorOverviewQuery,
  MonitorPostsQuery,
} from "../../../packages/contracts/src/intelligence";
import { fail } from "../../shared/errors";
import { listSourcesByIds } from "../collection/index";
import {
  queryAuthorDirectory,
  queryCommunityBreakdowns,
  queryCommunityMatrix,
  queryMonitorPosts,
  queryScopedBucketStats,
} from "../content/index";
import {
  computeEngagementRate,
  computePeriodDelta,
  computeShareOfVoice,
  mergeTopDomains,
} from "./metrics";
import { refreshMonitorRollups } from "./rollups";
import { loadMonitor } from "./sql";

interface AggregatedTotals {
  postCount: number;
  commentCount: number;
  sumScore: number;
  sumComments: number;
  sumViews: number;
  sumLikes: number;
  sumReposts: number;
  sumBookmarks: number;
  avgEr: number | null;
  intentCounts: Record<string, number>;
  topDomains: Array<{ domain: string; count: number; totalEngagement: number }>;
  topTerms: Array<{ term: string; count: number }>;
  timeline: Array<{
    bucketAt: string;
    platform: string;
    postCount: number;
    commentCount: number;
    sumScore: number;
    sumComments: number;
    sumViews: number;
    sumLikes: number;
  }>;
}

function summarizeBucketRows(rows: readonly QueryResultRow[]): AggregatedTotals {
  let postCount = 0, commentCount = 0, sumScore = 0, sumComments = 0, sumViews = 0, sumLikes = 0, sumReposts = 0, sumBookmarks = 0;
  let erWeighted = 0, erPosts = 0;
  const intents: Record<string, number> = {};
  const domainLists: Array<Array<{ domain: string; count: number; totalEngagement: number }>> = [];
  let topTerms: Array<{ term: string; count: number }> = [];
  const timeline: AggregatedTotals["timeline"] = [];

  for (const r of rows) {
    postCount += r.post_count;
    commentCount += r.comment_count;
    sumScore += Number(r.sum_score);
    sumComments += Number(r.sum_comments);
    sumViews += Number(r.sum_views);
    sumLikes += Number(r.sum_likes);
    sumReposts += Number(r.sum_reposts);
    sumBookmarks += Number(r.sum_bookmarks);
    if (r.avg_engagement_rate != null) {
      erWeighted += Number(r.avg_engagement_rate) * r.post_count;
      erPosts += r.post_count;
    }
    for (const [k, v] of Object.entries((r.intent_counts ?? {}) as Record<string, number>)) {
      intents[k] = (intents[k] ?? 0) + Number(v);
    }
    if (Array.isArray(r.top_domains)) domainLists.push(r.top_domains);
    if (!topTerms.length && Array.isArray(r.top_terms)) topTerms = r.top_terms;
    timeline.push({
      bucketAt: r.bucket_at.toISOString(),
      platform: r.platform,
      postCount: r.post_count,
      commentCount: r.comment_count,
      sumScore: Number(r.sum_score),
      sumComments: Number(r.sum_comments),
      sumViews: Number(r.sum_views),
      sumLikes: Number(r.sum_likes),
    });
  }
  return {
    postCount, commentCount, sumScore, sumComments, sumViews, sumLikes, sumReposts, sumBookmarks,
    avgEr: erPosts > 0 ? Number((erWeighted / erPosts).toFixed(4)) : null,
    intentCounts: intents,
    topDomains: mergeTopDomains(domainLists, 12),
    topTerms,
    timeline,
  };
}

async function computeMonitorSoV(
  pool: Pool,
  sourceIds: readonly string[],
  targets: ReadonlyArray<{ targetKind: string; targetValue: string }>,
  from: Date,
  to: Date,
) {
  const kwTargets = targets.filter((t) => t.targetKind === "keyword" || t.targetKind === "competitor_keyword");
  const seen = new Map<string, string>();
  for (const t of kwTargets) {
    if (!seen.has(t.targetValue)) seen.set(t.targetValue, t.targetKind === "competitor_keyword" ? "competitor" : "primary");
  }
  if (!seen.size) return [];
  const entries = await Promise.all(
    [...seen.entries()].slice(0, 10).map(async ([label, role]) => {
      const stats = await queryScopedBucketStats(pool, { sourceIds, from, to, bucketSize: "1d", keywordFilter: label });
      const mentions = stats.reduce((s, b) => s + b.postCount, 0);
      const engagement = stats.reduce((s, b) => s + b.sumScore + b.sumLikes + 2 * b.sumComments + 2 * b.sumReposts, 0);
      return { label, role, mentions, engagement };
    }),
  );
  return computeShareOfVoice(entries);
}

export async function getMonitorOverview(
  pool: Pool,
  actor: Actor,
  monitorId: string,
  query: Static<typeof MonitorOverviewQuery>,
) {
  const days = query.days ?? 14;
  const bucketSize = query.bucket ?? (days <= 3 ? "6h" : "1d");
  const { monitor, sourceIds, targets } = await loadMonitor(pool, actor, monitorId);
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const prevFrom = new Date(from.getTime() - days * 86_400_000);

  const countRes = await pool.query<{ cnt: number }>(
    "SELECT COUNT(*)::int AS cnt FROM intel_rollup_bucket WHERE scope_kind='monitor' AND scope_id=$1 AND bucket_size=$2 AND bucket_at >= $3",
    [monitorId, bucketSize, from.toISOString()],
  );
  if ((countRes.rows[0]?.cnt ?? 0) === 0 && sourceIds.length) {
    await refreshMonitorRollups(pool, monitorId, Math.max(days * 2, 14));
  }

  const [curBuckets, prevBuckets, sources, sov, topAuthors, communityMatrix] = await Promise.all([
    pool.query(
      "SELECT * FROM intel_rollup_bucket WHERE scope_kind='monitor' AND scope_id=$1 AND bucket_size=$2 AND bucket_at >= $3 AND bucket_at < $4 ORDER BY bucket_at ASC",
      [monitorId, bucketSize, from.toISOString(), to.toISOString()],
    ),
    pool.query(
      "SELECT * FROM intel_rollup_bucket WHERE scope_kind='monitor' AND scope_id=$1 AND bucket_size='1d' AND bucket_at >= $2 AND bucket_at < $3",
      [monitorId, prevFrom.toISOString(), from.toISOString()],
    ),
    listSourcesByIds(pool, sourceIds),
    monitor.kind === "keyword" ? computeMonitorSoV(pool, sourceIds, targets, from, to) : Promise.resolve([]),
    queryAuthorDirectory(pool, actor, { sourceIds, sort: "engagement", limit: 10 }),
    monitor.kind === "community_bundle" ? queryCommunityMatrix(pool, actor, { sourceIds, from, to, limit: 20 }) : Promise.resolve([]),
  ]);

  const cur = summarizeBucketRows(curBuckets.rows);
  const prev = summarizeBucketRows(prevBuckets.rows);
  const hasPriorCoverage = prev.postCount > 0 || sources.some((s) => Date.parse(s.createdAt) < from.getTime());
  const totalEngCur = cur.sumScore + cur.sumLikes + 2 * cur.sumComments + 2 * cur.sumReposts;
  const totalEngPrev = hasPriorCoverage ? prev.sumScore + prev.sumLikes + 2 * prev.sumComments + 2 * prev.sumReposts : null;

  return {
    monitor,
    window: { from: from.toISOString(), to: to.toISOString(), days, bucket: bucketSize },
    kpis: {
      posts: computePeriodDelta(cur.postCount, hasPriorCoverage ? prev.postCount : null),
      comments: computePeriodDelta(cur.sumComments, hasPriorCoverage ? prev.sumComments : null),
      totalEngagement: computePeriodDelta(totalEngCur, totalEngPrev),
      views: computePeriodDelta(cur.sumViews, hasPriorCoverage ? prev.sumViews : null),
      avgEngagementRate: cur.avgEr,
      discussionDepth: cur.postCount > 0 ? Number((cur.sumComments / cur.postCount).toFixed(2)) : 0,
    },
    timeline: cur.timeline,
    shareOfVoice: sov,
    intentDistribution: Object.entries(cur.intentCounts).map(([intent, count]) => ({ intent, count })),
    geoCitedDomains: cur.topDomains,
    cooccurringTerms: cur.topTerms,
    topAuthors,
    communities: communityMatrix,
    coverage: {
      model: "stored_sample" as const,
      sampleSize: cur.postCount,
      activeSources: sources.filter((s) => s.state === "active").length,
      totalSources: sources.length,
      failedSources: sources.filter((s) => s.health.lastStatus === "failed").length,
      lastSuccessAt: monitor.lastSuccessAt,
    },
  };
}

export async function listMonitorPosts(
  pool: Pool,
  actor: Actor,
  monitorId: string,
  query: Static<typeof MonitorPostsQuery>,
) {
  const { sourceIds } = await loadMonitor(pool, actor, monitorId);
  const days = query.days ?? 30;
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const limit = query.limit ?? 30;
  const offset = query.offset ?? 0;
  const result = await queryMonitorPosts(pool, actor, {
    sourceIds,
    from,
    to,
    platform: query.platform,
    intent: query.intent,
    community: query.community,
    author: query.author,
    domain: query.domain,
    sort: query.sort ?? "heat",
    limit,
    offset,
  });
  return {
    totalCount: result.totalCount,
    nextOffset: offset + result.items.length < result.totalCount ? offset + result.items.length : null,
    items: result.items.map((item) => ({
      ...item,
      engagementRate: computeEngagementRate({
        score: item.metricScore, likes: item.metricLikes, comments: item.metricComments,
        reposts: item.metricReposts, bookmarks: item.metricBookmarks, views: item.metricViews, followers: item.authorFollowers,
      }),
    })),
  };
}

export async function listTrackedAuthors(pool: Pool, actor: Actor, query: Static<typeof AuthorListQuery>) {
  let sourceIds: string[] | undefined;
  if (query.monitorId) {
    sourceIds = (await loadMonitor(pool, actor, query.monitorId)).sourceIds;
  }
  const items = await queryAuthorDirectory(pool, actor, {
    platform: query.platform,
    sourceIds,
    search: query.search,
    sort: query.sort ?? "followers",
    limit: query.limit ?? 40,
  });
  return { items };
}

export async function getTrackedAuthorProfile(
  pool: Pool,
  actor: Actor,
  platform: "reddit" | "x",
  handle: string,
  days = 30,
) {
  const cleanHandle = handle.replace(/^(?:@|u\/)/i, "").toLowerCase();
  const [profile] = await queryAuthorDirectory(pool, actor, { platform, handle: cleanHandle, limit: 1 });
  if (!profile) fail(404, "Author profile not found");
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const [timeline, posts] = await Promise.all([
    queryScopedBucketStats(pool, { allowedSourceIds: actor.allowedSourceIds, from, to, bucketSize: "1d", authorFilter: cleanHandle, platform }),
    queryMonitorPosts(pool, actor, { platform, author: cleanHandle, from, to, sort: "heat", limit: 30, offset: 0 }),
  ]);
  return {
    profile,
    er: computeEngagementRate({
      likes: profile.totalLikesOrScore,
      comments: profile.totalComments,
      reposts: profile.totalReposts,
      bookmarks: profile.totalBookmarks,
      views: profile.totalViews,
      followers: profile.followersCount,
    }),
    timeline,
    topPosts: posts.items,
  };
}

export async function listMonitoredCommunities(pool: Pool, actor: Actor, query: Static<typeof CommunityListQuery>) {
  let sourceIds: string[] | undefined;
  if (query.monitorId) {
    sourceIds = (await loadMonitor(pool, actor, query.monitorId)).sourceIds;
  }
  const to = new Date();
  const from = new Date(to.getTime() - (query.days ?? 14) * 86_400_000);
  const items = await queryCommunityMatrix(pool, actor, {
    sourceIds,
    from,
    to,
    sort: query.sort ?? "heat",
    limit: query.limit ?? 40,
  });
  return { items };
}

export async function getCommunityDeepDive(pool: Pool, actor: Actor, subreddit: string, days = 14) {
  const cleanSub = subreddit.replace(/^r\//i, "").toLowerCase();
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const [matrix, breakdowns, posts, authors, trend] = await Promise.all([
    queryCommunityMatrix(pool, actor, { from, to, limit: 50 }),
    queryCommunityBreakdowns(pool, actor, cleanSub, from, to),
    queryMonitorPosts(pool, actor, { platform: "reddit", community: cleanSub, from, to, sort: "heat", limit: 30, offset: 0 }),
    queryAuthorDirectory(pool, actor, { platform: "reddit", sort: "engagement", limit: 15 }),
    queryScopedBucketStats(pool, { allowedSourceIds: actor.allowedSourceIds, from, to, bucketSize: "1d", subredditFilter: cleanSub }),
  ]);
  const summary = matrix.find((m) => m.subreddit === cleanSub);
  if (!summary && posts.totalCount === 0) fail(404, "Subreddit sample not found");
  return {
    subreddit: cleanSub,
    summary: summary ?? {
      subreddit: cleanSub, subscribers: null, postCount: 0, uniqueAuthors: 0,
      avgScore: 0, avgComments: 0, avgDiscussionRatio: 0, p90Engagement: 0, totalScore: 0, totalComments: 0, latestPostAt: null,
    },
    trend,
    flairs: breakdowns.flairs,
    postingHeatmap: breakdowns.postingHeatmap,
    topAuthors: authors.filter((a) => a.topCommunities.includes(cleanSub)),
    topPosts: posts.items,
  };
}
