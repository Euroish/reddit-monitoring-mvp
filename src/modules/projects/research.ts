import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { Actor } from "../../../packages/contracts/src/access";
import type { ContentPlatform } from "../../../packages/contracts/src/common";
import type {
  AnalysisBlock,
  AnalysisScopeRequest,
  L1KeywordRow,
  L1KindRow,
  L1OverviewResponse,
  L1PlatformEngagementSummary,
  L1PlatformRow,
  L1RepresentativeItem,
  L1ScaleData,
  L1SourceRankingItem,
  L1TrendPoint,
  NormalizedAnalysisScope,
} from "../../../packages/contracts/src/research";
import { transaction } from "../../storage/db";
import {
  interpretEngagement,
  interpretKeywords,
  interpretKinds,
  interpretPlatforms,
  interpretScale,
  interpretSources,
  interpretTrend,
  type InterpretLang,
} from "./research-interpret";
import { buildScopedSql, resolveResearchContext, type ResolvedResearchContext } from "./research-scope";

const METHOD_VERSION = "1.0.0";
const L1_CACHE_MAX = 64;
const L1_CACHE_TTL_MS = 60_000;
const l1Cache = new Map<string, { expiresAt: number; value: L1OverviewResponse }>();

function cacheKeyForL1(
  actor: Actor,
  projectId: string,
  dataVersion: string,
  scope: NormalizedAnalysisScope,
  lang: InterpretLang,
): string {
  const actorKey = `${actor.role}:${actor.userId ?? ""}:${(actor.allowedSourceIds ?? []).join(",")}`;
  return createHash("sha256")
    .update(JSON.stringify([actorKey, projectId, dataVersion, scope, lang]))
    .digest("hex");
}

function readL1Cache(key: string): L1OverviewResponse | undefined {
  const hit = l1Cache.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expiresAt) {
    l1Cache.delete(key);
    return undefined;
  }
  l1Cache.delete(key);
  l1Cache.set(key, hit);
  return hit.value;
}

function writeL1Cache(key: string, value: L1OverviewResponse): void {
  if (l1Cache.size >= L1_CACHE_MAX) {
    const oldest = l1Cache.keys().next().value;
    if (oldest !== undefined) l1Cache.delete(oldest);
  }
  l1Cache.set(key, { expiresAt: Date.now() + L1_CACHE_TTL_MS, value });
}

function buildEmptyL1Response(
  ctx: ResolvedResearchContext,
  lang: InterpretLang,
  generatedAt: string,
): L1OverviewResponse {
  const { project, dataVersion, scope } = ctx;
  const coverage = {
    model: (scope.emptySelection ? "empty_scope" : "stored_sample") as "empty_scope" | "stored_sample",
    label: scope.emptySelection
      ? (lang === "zh" ? "未选择研究范围" : "Empty selection")
      : (lang === "zh" ? "项目已采集样本" : "Project stored samples"),
    datedCount: 0,
    undatedCount: 0,
    isCompleteScope: !scope.emptySelection,
  };
  const mkBlock = <T>(
    analysisId: string,
    groupingBasis: AnalysisBlock["methodology"]["groupingBasis"],
    data: T,
    interp: { summaryText: string; summaryBullets: string[] },
    notes: string[] = [],
  ): AnalysisBlock<T> => ({
    analysisId,
    methodVersion: METHOD_VERSION,
    projectId: project.id,
    scope,
    dataVersion,
    sampleCount: 0,
    coverage,
    methodology: {
      dedupBasis: "canonical_content_id",
      groupingBasis,
      denominatorLabel: lang === "zh" ? "去重内容总量" : "Deduplicated content count",
      denominatorValue: 0,
      multiMembershipAllowed: groupingBasis === "collection_target",
      notes,
    },
    summaryText: interp.summaryText,
    summaryBullets: interp.summaryBullets,
    data,
    generatedAt,
    status: "empty",
  });

  const zeroScale: L1ScaleData = {
    deduplicatedContentCount: 0,
    threadAnchorCount: 0,
    postsCount: 0,
    commentsCount: 0,
    articlesCount: 0,
    sourcesCount: 0,
    communitiesCount: 0,
    authorsCount: 0,
    reportedPlatformCommentsSum: 0,
    undatedCount: 0,
    multiTargetOverlapCount: 0,
  };

  return {
    projectId: project.id,
    projectName: project.name,
    dataVersion,
    generatedAt,
    scope,
    analyses: {
      scale: mkBlock("L1-01", "none", zeroScale, interpretScale(zeroScale, scope.emptySelection, lang)),
      trend: mkBlock("L1-02", "time_bucket", { points: [], bucket: scope.bucket, undatedCount: 0 }, interpretTrend([], 0, scope.emptySelection, lang)),
      keywords: mkBlock("L1-03", "collection_target", { rows: [], deduplicatedTotal: 0, overlapTotal: 0 }, interpretKeywords([], 0, 0, lang)),
      platforms: mkBlock("L1-04", "platform", { rows: [], deduplicatedTotal: 0 }, interpretPlatforms([], 0, lang)),
      sources: mkBlock("L1-05", "community", { communities: [], collectionSources: [], deduplicatedTotal: 0 }, interpretSources([], [], 0, lang)),
      kinds: mkBlock("L1-06", "kind", { byPlatform: [], totals: { posts: 0, comments: 0, articles: 0, total: 0 } }, interpretKinds({ posts: 0, comments: 0, articles: 0, total: 0 }, [], lang)),
      engagement: mkBlock("L1-07", "engagement", { platforms: [], reportedVsCollected: { reportedPlatformComments: 0, collectedComments: 0 } }, interpretEngagement([], { reportedPlatformComments: 0, collectedComments: 0 }, lang)),
      topContent: mkBlock("L1-08", "none", { items: [], totalInScope: 0 }, {
        summaryText: scope.emptySelection
          ? (lang === "zh" ? "当前未选择研究对象，暂无代表内容。" : "No targets selected.")
          : (lang === "zh" ? "当前范围内暂无代表性热门讨论。" : "No representative items in current scope."),
        summaryBullets: [],
      }),
    },
  };
}

function engagementPrimaryLabel(platform: ContentPlatform, lang: InterpretLang): string {
  if (platform === "reddit") return lang === "zh" ? "Reddit 净赞 (Score)" : "Reddit Score";
  if (platform === "x" || platform === "bluesky") return lang === "zh" ? "点赞数 (Likes)" : "Likes";
  return lang === "zh" ? "综合热度" : "Engagement";
}

function evidencePatchFromScope(scope: NormalizedAnalysisScope, extra: Record<string, unknown> = {}) {
  return {
    ...(scope.selectedSourceIds.length ? { sourceIds: scope.selectedSourceIds } : {}),
    ...(scope.selectedBatchIds.length ? { batchIds: scope.selectedBatchIds } : {}),
    ...(scope.from ? { from: scope.from } : {}),
    ...(scope.to ? { to: scope.to } : {}),
    ...(scope.platforms.length === 1 ? { platform: scope.platforms[0] } : {}),
    ...(scope.kinds.length === 1 ? { kind: scope.kinds[0] } : {}),
    ...(scope.signal ? { signal: scope.signal } : {}),
    ...extra,
  };
}

async function queryL1OverviewData(
  client: PoolClient,
  actor: Actor,
  ctx: ResolvedResearchContext,
  lang: InterpretLang,
): Promise<L1OverviewResponse> {
  await client.query("SET LOCAL statement_timeout = '10000'");
  const { cteSql, values } = buildScopedSql(actor, ctx);
  const { project, dataVersion, scope } = ctx;
  const tsExpr = scope.timeBasis === "collected" ? "dc.first_seen_at" : "dc.created_at_source";
  const bucketStep =
    scope.bucket === "6h"
      ? `date_trunc('day', ${tsExpr} AT TIME ZONE 'UTC') + floor(extract(hour from (${tsExpr} AT TIME ZONE 'UTC'))::int / 6) * interval '6 hours'`
      : `date_trunc('day', ${tsExpr} AT TIME ZONE 'UTC')`;

  const [scaleRes, trendRes, kwRes, platRes, commRes, srcRes, kindRes, engRes, topRes] = await Promise.all([
    client.query<{
      total_count: number;
      anchor_count: number;
      posts_count: number;
      comments_count: number;
      articles_count: number;
      sources_count: number;
      communities_count: number;
      authors_count: number;
      reported_comments_sum: string;
      undated_count: number;
      overlap_count: number;
    }>(
      `${cteSql},
       anchors AS (
         SELECT COALESCE(root.id, dc.id) AS anchor_id
         FROM dedup_content dc
         LEFT JOIN LATERAL (
           SELECT value FROM jsonb_array_elements(dc.content_references) r(value)
           WHERE value->>'relation' = 'thread_root' LIMIT 1
         ) ref ON true
         LEFT JOIN dedup_content root
           ON root.platform_id = dc.platform_id
          AND root.kind = ref.value->>'kind'
          AND root.external_id = ref.value->>'externalId'
       ),
       target_counts AS (
         SELECT content_id, COUNT(DISTINCT target_key)::int AS target_cnt
         FROM scoped_memberships
         GROUP BY content_id
       )
       SELECT
         (SELECT COUNT(*)::int FROM dedup_content) AS total_count,
         (SELECT COUNT(DISTINCT anchor_id)::int FROM anchors) AS anchor_count,
         (SELECT COUNT(*) FILTER (WHERE kind = 'post')::int FROM dedup_content) AS posts_count,
         (SELECT COUNT(*) FILTER (WHERE kind = 'comment')::int FROM dedup_content) AS comments_count,
         (SELECT COUNT(*) FILTER (WHERE kind = 'article')::int FROM dedup_content) AS articles_count,
         (SELECT COUNT(DISTINCT source_id)::int FROM scoped_memberships) AS sources_count,
         (SELECT COUNT(DISTINCT community_name) FILTER (WHERE community_name IS NOT NULL)::int FROM dedup_content) AS communities_count,
         (SELECT COUNT(DISTINCT author_handle) FILTER (WHERE author_handle IS NOT NULL)::int FROM dedup_content) AS authors_count,
         (SELECT COALESCE(SUM(metric_comments) FILTER (WHERE kind <> 'comment'), 0)::text FROM dedup_content) AS reported_comments_sum,
         (SELECT COUNT(*) FILTER (WHERE ${tsExpr} IS NULL)::int FROM dedup_content dc) AS undated_count,
         (SELECT COUNT(*) FILTER (WHERE target_cnt > 1)::int FROM target_counts) AS overlap_count`,
      values,
    ),
    client.query<{
      bucket_utc: Date;
      platform: ContentPlatform;
      total_cnt: number;
      posts_cnt: number;
      comments_cnt: number;
      articles_cnt: number;
    }>(
      `${cteSql}
       SELECT
         ${bucketStep} AS bucket_utc,
         dc.platform,
         COUNT(*)::int AS total_cnt,
         COUNT(*) FILTER (WHERE dc.kind = 'post')::int AS posts_cnt,
         COUNT(*) FILTER (WHERE dc.kind = 'comment')::int AS comments_cnt,
         COUNT(*) FILTER (WHERE dc.kind = 'article')::int AS articles_cnt
       FROM dedup_content dc
       WHERE ${tsExpr} IS NOT NULL
       GROUP BY 1, 2
       ORDER BY 1 ASC, 2 ASC`,
      values,
    ),
    client.query<{
      target_key: string;
      target_label: string;
      target_type: string;
      platforms: ContentPlatform[];
      content_count: number;
      posts_count: number;
      comments_count: number;
      articles_count: number;
      exclusive_count: number;
    }>(
      `${cteSql},
       target_deg AS (
         SELECT content_id, COUNT(DISTINCT target_key)::int AS deg
         FROM scoped_memberships
         GROUP BY content_id
       ),
       per_target AS (
         SELECT DISTINCT sm.target_key, sm.target_label, sm.target_type, dc.id, dc.kind, dc.platform, td.deg
         FROM scoped_memberships sm
         JOIN dedup_content dc ON dc.id = sm.content_id
         JOIN target_deg td ON td.content_id = dc.id
       )
       SELECT
         target_key,
         MIN(target_label) AS target_label,
         MIN(target_type) AS target_type,
         ARRAY_AGG(DISTINCT platform ORDER BY platform) AS platforms,
         COUNT(DISTINCT id)::int AS content_count,
         COUNT(DISTINCT id) FILTER (WHERE kind = 'post')::int AS posts_count,
         COUNT(DISTINCT id) FILTER (WHERE kind = 'comment')::int AS comments_count,
         COUNT(DISTINCT id) FILTER (WHERE kind = 'article')::int AS articles_count,
         COUNT(DISTINCT id) FILTER (WHERE deg = 1)::int AS exclusive_count
       FROM per_target
       GROUP BY target_key
       ORDER BY content_count DESC, target_label ASC`,
      values,
    ),
    client.query<{
      platform: ContentPlatform;
      content_count: number;
      posts_count: number;
      comments_count: number;
      articles_count: number;
    }>(
      `${cteSql}
       SELECT
         platform,
         COUNT(*)::int AS content_count,
         COUNT(*) FILTER (WHERE kind = 'post')::int AS posts_count,
         COUNT(*) FILTER (WHERE kind = 'comment')::int AS comments_count,
         COUNT(*) FILTER (WHERE kind = 'article')::int AS articles_count
       FROM dedup_content
       GROUP BY platform
       ORDER BY content_count DESC, platform ASC`,
      values,
    ),
    client.query<{
      community_name: string;
      platform: ContentPlatform;
      content_count: number;
      posts_count: number;
      comments_count: number;
      avg_eng: number;
    }>(
      `${cteSql}
       SELECT
         community_name,
         MIN(platform) AS platform,
         COUNT(*)::int AS content_count,
         COUNT(*) FILTER (WHERE kind = 'post')::int AS posts_count,
         COUNT(*) FILTER (WHERE kind = 'comment')::int AS comments_count,
         COALESCE(AVG(engagement_score), 0)::float8 AS avg_eng
       FROM dedup_content
       WHERE community_name IS NOT NULL
       GROUP BY community_name
       ORDER BY content_count DESC, community_name ASC
       LIMIT 30`,
      values,
    ),
    client.query<{
      source_id: string;
      source_label: string;
      platform: ContentPlatform;
      content_count: number;
      posts_count: number;
      comments_count: number;
      avg_eng: number;
    }>(
      `${cteSql}
       SELECT
         cs.id AS source_id,
         cs.label AS source_label,
         MIN(dc.platform) AS platform,
         COUNT(DISTINCT dc.id)::int AS content_count,
         COUNT(DISTINCT dc.id) FILTER (WHERE dc.kind = 'post')::int AS posts_count,
         COUNT(DISTINCT dc.id) FILTER (WHERE dc.kind = 'comment')::int AS comments_count,
         COALESCE(AVG(dc.engagement_score), 0)::float8 AS avg_eng
       FROM scoped_memberships sm
       JOIN collection_source cs ON cs.id = sm.source_id
       JOIN dedup_content dc ON dc.id = sm.content_id
       GROUP BY cs.id, cs.label
       ORDER BY content_count DESC, cs.label ASC
       LIMIT 30`,
      values,
    ),
    client.query<{
      platform: ContentPlatform;
      posts_count: number;
      comments_count: number;
      articles_count: number;
      total_count: number;
    }>(
      `${cteSql}
       SELECT
         platform,
         COUNT(*) FILTER (WHERE kind = 'post')::int AS posts_count,
         COUNT(*) FILTER (WHERE kind = 'comment')::int AS comments_count,
         COUNT(*) FILTER (WHERE kind = 'article')::int AS articles_count,
         COUNT(*)::int AS total_count
       FROM dedup_content
       GROUP BY platform
       ORDER BY total_count DESC, platform ASC`,
      values,
    ),
    client.query<{
      platform: ContentPlatform;
      sample_count: number;
      post_count: number;
      sum_score: string;
      sum_likes: string;
      sum_comments: string;
      collected_comments: number;
      sum_views: string | null;
      sum_reposts: string | null;
      avg_eng: number;
      avg_disc: number;
    }>(
      `${cteSql}
       SELECT
         platform,
         COUNT(*)::int AS sample_count,
         COUNT(*) FILTER (WHERE kind <> 'comment')::int AS post_count,
         COALESCE(SUM(metric_score) FILTER (WHERE kind <> 'comment'), 0)::text AS sum_score,
         COALESCE(SUM(metric_likes) FILTER (WHERE kind <> 'comment'), 0)::text AS sum_likes,
         COALESCE(SUM(metric_comments) FILTER (WHERE kind <> 'comment'), 0)::text AS sum_comments,
         COUNT(*) FILTER (WHERE kind = 'comment')::int AS collected_comments,
         SUM(metric_views) FILTER (WHERE kind <> 'comment')::text AS sum_views,
         SUM(metric_reposts) FILTER (WHERE kind <> 'comment')::text AS sum_reposts,
         COALESCE(AVG(engagement_score) FILTER (WHERE kind <> 'comment'), 0)::float8 AS avg_eng,
         COALESCE(AVG(discussion_ratio) FILTER (WHERE kind <> 'comment'), 0)::float8 AS avg_disc
       FROM dedup_content
       GROUP BY platform
       ORDER BY sample_count DESC, platform ASC`,
      values,
    ),
    client.query<{
      id: string;
      platform: ContentPlatform;
      kind: "post" | "comment" | "article";
      external_id: string;
      title: string | null;
      clean_excerpt: string | null;
      url: string | null;
      author_handle: string | null;
      community_name: string | null;
      created_at_source: Date | null;
      metric_score: number | null;
      metric_likes: number | null;
      metric_comments: number | null;
      metric_views: string | null;
      metric_reposts: number | null;
      engagement_score: number;
      intent_tag: string | null;
      target_labels: string[];
    }>(
      `${cteSql},
       labels_agg AS (
         SELECT content_id, ARRAY_AGG(DISTINCT target_label ORDER BY target_label) AS target_labels
         FROM scoped_memberships
         GROUP BY content_id
       )
       SELECT
         dc.id, dc.platform, dc.kind, dc.external_id, dc.title, dc.clean_excerpt, dc.url,
         dc.author_handle, dc.community_name, dc.created_at_source,
         dc.metric_score, dc.metric_likes, dc.metric_comments, dc.metric_views::text, dc.metric_reposts,
         dc.engagement_score, dc.intent_tag,
         COALESCE(la.target_labels, ARRAY[]::text[]) AS target_labels
       FROM dedup_content dc
       LEFT JOIN labels_agg la ON la.content_id = dc.id
       ORDER BY (dc.kind <> 'comment') DESC, dc.engagement_score DESC, COALESCE(dc.created_at_source, dc.first_seen_at) DESC
       LIMIT 20`,
      values,
    ),
  ]);

  const sRow = scaleRes.rows[0];
  const dedupTotal = sRow?.total_count ?? 0;
  const undatedCount = sRow?.undated_count ?? 0;
  const datedCount = Math.max(0, dedupTotal - undatedCount);
  const generatedAt = new Date().toISOString();

  const isPartial =
    ctx.targetGroups.reduce((sum, g) => sum + g.batches.length, 0) > scope.selectedBatchIds.length &&
    ctx.useBatchMappings;

  const coverage = {
    model: (isPartial ? "partial_sample" : "stored_sample") as "partial_sample" | "stored_sample",
    label: isPartial
      ? (lang === "zh" ? "已选部分批次样本" : "Selected batch subset")
      : (lang === "zh" ? "项目已采集样本" : "Project stored samples"),
    datedCount,
    undatedCount,
    isCompleteScope: !isPartial && !scope.from && !scope.to && scope.platforms.length === 0 && scope.kinds.length === 0,
  };

  const scaleData: L1ScaleData = {
    deduplicatedContentCount: dedupTotal,
    threadAnchorCount: sRow?.anchor_count ?? dedupTotal,
    postsCount: sRow?.posts_count ?? 0,
    commentsCount: sRow?.comments_count ?? 0,
    articlesCount: sRow?.articles_count ?? 0,
    sourcesCount: sRow?.sources_count ?? 0,
    communitiesCount: sRow?.communities_count ?? 0,
    authorsCount: sRow?.authors_count ?? 0,
    reportedPlatformCommentsSum: Number(sRow?.reported_comments_sum ?? 0),
    undatedCount,
    multiTargetOverlapCount: sRow?.overlap_count ?? 0,
  };

  // Assemble trend points grouped by UTC bucket
  const trendMap = new Map<string, L1TrendPoint>();
  for (const r of trendRes.rows) {
    const bucketKey = r.bucket_utc.toISOString();
    let pt = trendMap.get(bucketKey);
    if (!pt) {
      pt = { bucket: bucketKey, totalCount: 0, postsCount: 0, commentsCount: 0, articlesCount: 0, byPlatform: [] };
      trendMap.set(bucketKey, pt);
    }
    pt.totalCount += r.total_cnt;
    pt.postsCount += r.posts_cnt;
    pt.commentsCount += r.comments_cnt;
    pt.articlesCount += r.articles_cnt;
    pt.byPlatform.push({ platform: r.platform, count: r.total_cnt });
  }
  const trendPoints = [...trendMap.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));

  const pct = (n: number, d: number) => (d > 0 ? Number(((n / d) * 100).toFixed(1)) : 0);

  const kwRows: L1KeywordRow[] = kwRes.rows.map((r) => ({
    targetKey: r.target_key,
    label: r.target_label,
    targetType: r.target_type,
    platforms: r.platforms,
    contentCount: r.content_count,
    postsCount: r.posts_count,
    commentsCount: r.comments_count,
    articlesCount: r.articles_count,
    sharePct: pct(r.content_count, dedupTotal),
    exclusiveCount: r.exclusive_count,
    overlapCount: Math.max(0, r.content_count - r.exclusive_count),
  }));

  const platRows: L1PlatformRow[] = platRes.rows.map((r) => ({
    platform: r.platform,
    contentCount: r.content_count,
    postsCount: r.posts_count,
    commentsCount: r.comments_count,
    articlesCount: r.articles_count,
    sharePct: pct(r.content_count, dedupTotal),
  }));

  const communities: L1SourceRankingItem[] = commRes.rows.map((r) => ({
    key: r.community_name,
    label: r.platform === "reddit" ? `r/${r.community_name}` : r.community_name,
    kind: "community",
    platform: r.platform,
    contentCount: r.content_count,
    postsCount: r.posts_count,
    commentsCount: r.comments_count,
    sharePct: pct(r.content_count, dedupTotal),
    avgEngagementScore: Number(r.avg_eng.toFixed(2)),
  }));

  const collectionSources: L1SourceRankingItem[] = srcRes.rows.map((r) => ({
    key: r.source_id,
    label: r.source_label,
    kind: "source",
    platform: r.platform,
    contentCount: r.content_count,
    postsCount: r.posts_count,
    commentsCount: r.comments_count,
    sharePct: pct(r.content_count, dedupTotal),
    avgEngagementScore: Number(r.avg_eng.toFixed(2)),
  }));

  const byPlatformKinds: L1KindRow[] = kindRes.rows.map((r) => ({
    platform: r.platform,
    postsCount: r.posts_count,
    commentsCount: r.comments_count,
    articlesCount: r.articles_count,
    totalCount: r.total_count,
  }));
  const kindTotals = {
    posts: scaleData.postsCount,
    comments: scaleData.commentsCount,
    articles: scaleData.articlesCount,
    total: dedupTotal,
  };

  const engagementPlatforms: L1PlatformEngagementSummary[] = engRes.rows.map((r) => {
    const totalPrimary =
      r.platform === "reddit"
        ? Number(r.sum_score)
        : r.platform === "x" || r.platform === "bluesky"
          ? Number(r.sum_likes)
          : Math.round(r.avg_eng * r.post_count);
    return {
      platform: r.platform,
      sampleCount: r.sample_count,
      postCount: r.post_count,
      primaryMetricLabel: engagementPrimaryLabel(r.platform, lang),
      totalPrimaryMetric: totalPrimary,
      avgPrimaryMetric: r.post_count > 0 ? Number((totalPrimary / r.post_count).toFixed(1)) : 0,
      reportedRepliesSum: Number(r.sum_comments),
      collectedCommentsCount: r.collected_comments,
      totalViews: r.sum_views !== null ? Number(r.sum_views) : null,
      totalReposts: r.sum_reposts !== null ? Number(r.sum_reposts) : null,
      avgEngagementScore: Number(r.avg_eng.toFixed(2)),
      avgDiscussionRatio: Number(r.avg_disc.toFixed(2)),
    };
  });

  const topItems: L1RepresentativeItem[] = topRes.rows.map((r) => ({
    id: r.id,
    platform: r.platform,
    kind: r.kind,
    externalId: r.external_id,
    title: r.title,
    cleanExcerpt: r.clean_excerpt,
    url: r.url,
    authorHandle: r.author_handle,
    communityName: r.community_name,
    publishedAt: r.created_at_source?.toISOString() ?? null,
    metricScore: r.metric_score,
    metricLikes: r.metric_likes,
    metricComments: r.metric_comments,
    metricViews: r.metric_views !== null ? Number(r.metric_views) : null,
    metricReposts: r.metric_reposts,
    engagementScore: Number(r.engagement_score.toFixed(2)),
    intentTag: r.intent_tag,
    targetLabels: r.target_labels,
  }));

  const mkBlock = <T>(
    analysisId: string,
    groupingBasis: AnalysisBlock["methodology"]["groupingBasis"],
    data: T,
    interp: { summaryText: string; summaryBullets: string[] },
    multiMembershipAllowed = false,
    notes: string[] = [],
    extraEvidence: Record<string, unknown> = {},
  ): AnalysisBlock<T> => ({
    analysisId,
    methodVersion: METHOD_VERSION,
    projectId: project.id,
    scope,
    dataVersion,
    sampleCount: dedupTotal,
    coverage,
    methodology: {
      dedupBasis: "canonical_content_id",
      groupingBasis,
      denominatorLabel: lang === "zh" ? "去重内容总量" : "Deduplicated content count",
      denominatorValue: dedupTotal,
      multiMembershipAllowed,
      notes,
    },
    summaryText: interp.summaryText,
    summaryBullets: interp.summaryBullets,
    data,
    evidence: {
      filterPatch: evidencePatchFromScope(scope, extraEvidence),
      label: lang === "zh" ? "在内容检索中查看对应样本" : "Inspect matching samples in Content Search",
    },
    generatedAt,
    status: dedupTotal === 0 ? "empty" : "ok",
  });

  return {
    projectId: project.id,
    projectName: project.name,
    dataVersion,
    generatedAt,
    scope,
    analyses: {
      scale: mkBlock(
        "L1-01",
        "none",
        scaleData,
        interpretScale(scaleData, false, lang),
        false,
        [
          lang === "zh"
            ? "总量按平台+内容类型+外部ID唯一去重；“已采集评论数”统计入库评论节点，“平台记录评论总量”为主帖字段累加。"
            : "Totals deduplicate by canonical content ID; collected comments count stored comment rows, separate from platform-reported post reply sums.",
        ],
      ),
      trend: mkBlock(
        "L1-02",
        "time_bucket",
        { points: trendPoints, bucket: scope.bucket, undatedCount },
        interpretTrend(trendPoints, undatedCount, false, lang),
        false,
        [
          lang === "zh"
            ? `时间轴按${scope.timeBasis === "collected" ? "采集入库时间" : "内容发布时间"} UTC 分桶，缺口日期不补零，缺失发布时间样本共 ${undatedCount} 条单独标注。`
            : `Buckets aggregate in UTC by ${scope.timeBasis} time; empty intervals are not zero-filled; ${undatedCount} undated items excluded.`,
        ],
      ),
      keywords: mkBlock(
        "L1-03",
        "collection_target",
        { rows: kwRows, deduplicatedTotal: dedupTotal, overlapTotal: scaleData.multiTargetOverlapCount },
        interpretKeywords(kwRows, dedupTotal, scaleData.multiTargetOverlapCount, lang),
        true,
        [
          lang === "zh"
            ? "按采集关键词/目标真实归属统计；同一内容命中多个关键词时在各组分别计数，占比分母为去重总量，因此各组占比之和可能大于 100%。"
            : "Grouped by collection target attribution; overlapping items count in each matching keyword while denominator remains deduplicated project total.",
        ],
      ),
      platforms: mkBlock(
        "L1-04",
        "platform",
        { rows: platRows, deduplicatedTotal: dedupTotal },
        interpretPlatforms(platRows, dedupTotal, lang),
        false,
        [
          lang === "zh"
            ? "各平台互不重叠，按内容唯一标识统计分布与占比。"
            : "Platforms are mutually exclusive; counts reflect canonical deduplicated items.",
        ],
      ),
      sources: mkBlock(
        "L1-05",
        "community",
        { communities, collectionSources, deduplicatedTotal: dedupTotal },
        interpretSources(communities, collectionSources, dedupTotal, lang),
        false,
        [
          lang === "zh"
            ? "社区排名仅统计带社区/版块字段的内容；采集来源排名反映各已选采集源覆盖量（同一内容可被多来源发现）。"
            : "Community ranking counts items with community metadata; collection source ranking reflects source coverage.",
        ],
      ),
      kinds: mkBlock(
        "L1-06",
        "kind",
        { byPlatform: byPlatformKinds, totals: kindTotals },
        interpretKinds(kindTotals, byPlatformKinds, lang),
      ),
      engagement: mkBlock(
        "L1-07",
        "engagement",
        {
          platforms: engagementPlatforms,
          reportedVsCollected: {
            reportedPlatformComments: scaleData.reportedPlatformCommentsSum,
            collectedComments: scaleData.commentsCount,
          },
        },
        interpretEngagement(
          engagementPlatforms,
          { reportedPlatformComments: scaleData.reportedPlatformCommentsSum, collectedComments: scaleData.commentsCount },
          lang,
        ),
        false,
        [
          lang === "zh"
            ? "Reddit score、X likes 与浏览量口径不同，按平台分别汇总，避免跨平台直接相加造成语义失真。"
            : "Platform engagement metrics differ semantically and are aggregated per platform rather than summed raw.",
        ],
      ),
      topContent: mkBlock(
        "L1-08",
        "none",
        { items: topItems, totalInScope: dedupTotal },
        {
          summaryText:
            topItems.length > 0
              ? (lang === "zh"
                  ? `已按综合互动热度筛选出前 ${topItems.length} 条代表性讨论（共 ${dedupTotal} 条范围样本），点击条目可查看正文与完整评论树。`
                  : `Showing top ${topItems.length} representative discussions by engagement score out of ${dedupTotal} items in scope.`)
              : (lang === "zh" ? "当前范围内暂无代表性讨论。" : "No representative discussions in scope."),
          summaryBullets: [],
        },
      ),
    },
  };
}

export async function runL1ResearchOverview(
  pool: Pool,
  actor: Actor,
  projectId: string,
  input: AnalysisScopeRequest = {},
): Promise<L1OverviewResponse> {
  const lang: InterpretLang = input.lang === "en" ? "en" : "zh";
  const ctx = await resolveResearchContext(pool, actor, projectId, input);
  if (ctx.scope.emptySelection) {
    return buildEmptyL1Response(ctx, lang, new Date().toISOString());
  }

  const key = cacheKeyForL1(actor, projectId, ctx.dataVersion, ctx.scope, lang);
  const cached = readL1Cache(key);
  if (cached) return cached;

  const result = await transaction(pool, async (client) => {
    await client.query("SET TRANSACTION READ ONLY");
    return queryL1OverviewData(client, actor, ctx, lang);
  });
  writeL1Cache(key, result);
  return result;
}
