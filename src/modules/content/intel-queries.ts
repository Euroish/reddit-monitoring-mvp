import type { Pool, PoolClient } from "pg";
import type { Actor } from "../../../packages/contracts/src/access";
import type { ContentPlatform } from "../../../packages/contracts/src/common";

export interface RawBucketStats {
  bucketAt: string;
  platform: ContentPlatform;
  postCount: number;
  commentCount: number;
  uniqueAuthors: number;
  sumScore: number;
  sumComments: number;
  sumViews: number;
  sumLikes: number;
  sumReposts: number;
  sumBookmarks: number;
  avgEngagementRate: number | null;
  p90Engagement: number | null;
  intentCounts: Record<string, number>;
  topDomains: Array<{ domain: string; count: number; totalEngagement: number }>;
}

export interface MonitorPostRow {
  id: string;
  platform: ContentPlatform;
  kind: string;
  externalId: string;
  title: string | null;
  cleanExcerpt: string | null;
  url: string | null;
  publishedAt: string | null;
  authorHandle: string | null;
  authorDisplayName: string | null;
  authorAvatarUrl: string | null;
  authorVerified: boolean;
  authorFollowers: number | null;
  communityName: string | null;
  flair: string | null;
  externalDomain: string | null;
  intentTag: string | null;
  hashtags: string[];
  hasMedia: boolean;
  primaryMediaUrl: string | null;
  metricScore: number | null;
  metricComments: number | null;
  metricViews: number | null;
  metricLikes: number | null;
  metricReposts: number | null;
  metricBookmarks: number | null;
  upvoteRatio: number | null;
  engagementScore: number;
  discussionRatio: number;
  velocityScore: number;
}

export interface AuthorDirectoryRow {
  platform: ContentPlatform;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  location: string | null;
  verified: boolean;
  followersCount: number | null;
  followingCount: number | null;
  statusesCount: number | null;
  postCount: number;
  avgEngagement: number;
  avgComments: number;
  totalLikesOrScore: number;
  totalViews: number;
  topCommunities: string[];
  lastSeenAt: string;
}

export interface CommunityMatrixRow {
  subreddit: string;
  subscribers: number | null;
  postCount: number;
  uniqueAuthors: number;
  avgScore: number;
  avgComments: number;
  avgDiscussionRatio: number;
  p90Engagement: number;
  totalScore: number;
  totalComments: number;
  latestPostAt: string | null;
}

function escapeLike(term: string) {
  return term.replace(/[\\%_]/g, "\\$&");
}

function buildOrderSql(sort?: string): string {
  switch (sort) {
    case "score":
      return "COALESCE(c.metric_score, c.metric_likes, 0) DESC, c.engagement_score DESC";
    case "comments":
      return "COALESCE(c.metric_comments, 0) DESC, c.engagement_score DESC";
    case "views":
      return "COALESCE(c.metric_views, 0) DESC, c.engagement_score DESC";
    case "newest":
      return "COALESCE(c.created_at_source, c.first_seen_at) DESC";
    default:
      return "(c.engagement_score + 0.5 * c.velocity_score) DESC, COALESCE(c.created_at_source, c.first_seen_at) DESC";
  }
}

export async function queryScopedBucketStats(
  db: Pool | PoolClient,
  input: {
    sourceIds?: readonly string[];
    from: Date;
    to: Date;
    bucketSize: "6h" | "1d";
    keywordFilter?: string;
    authorFilter?: string;
    subredditFilter?: string;
  },
): Promise<RawBucketStats[]> {
  if (!input.sourceIds?.length) return [];
  const stepExpr = input.bucketSize === "6h"
    ? "date_trunc('day', ts) + floor(extract(hour from ts)::int / 6) * interval '6 hours'"
    : "date_trunc('day', ts)";
  const kwPattern = input.keywordFilter ? `%${escapeLike(input.keywordFilter.toLowerCase())}%` : null;

  const { rows } = await db.query<{
    bucket_at: Date;
    platform: ContentPlatform;
    post_count: number;
    comment_count: number;
    unique_authors: number;
    sum_score: string;
    sum_comments: string;
    sum_views: string;
    sum_likes: string;
    sum_reposts: string;
    sum_bookmarks: string;
    avg_er: number | null;
    p90_eng: number | null;
    intent_counts: Record<string, number> | null;
    top_domains: Array<{ domain: string; count: number; totalEngagement: number }> | null;
  }>(
    `WITH scoped AS (
       SELECT DISTINCT ON (c.id)
         c.id,
         c.kind,
         c.source_id AS platform_id,
         s.code AS platform,
         COALESCE(c.created_at_source, c.first_seen_at) AS ts,
         c.author_handle,
         c.community_name,
         c.external_domain,
         c.intent_tag,
         COALESCE(c.metric_score, 0) AS metric_score,
         COALESCE(c.metric_comments, 0) AS metric_comments,
         COALESCE(c.metric_views, 0) AS metric_views,
         COALESCE(c.metric_likes, 0) AS metric_likes,
         COALESCE(c.metric_reposts, 0) AS metric_reposts,
         COALESCE(c.metric_bookmarks, 0) AS metric_bookmarks,
         c.engagement_score,
         ap.followers_count
       FROM content c
       JOIN source s ON s.id = c.source_id
       JOIN content_discovery d ON d.content_id = c.id
       LEFT JOIN content_author_profile ap ON ap.platform_id = c.source_id AND ap.author_handle = c.author_handle
       WHERE d.collection_source_id = ANY($1::uuid[])
         AND c.availability = 'available'
         AND COALESCE(c.created_at_source, c.first_seen_at) >= $2
         AND COALESCE(c.created_at_source, c.first_seen_at) < $3
         AND ($4::text IS NULL OR LOWER(COALESCE(c.title, '') || ' ' || COALESCE(c.body_text, '')) LIKE $4 ESCAPE '\\')
         AND ($5::text IS NULL OR c.author_handle = $5)
         AND ($6::text IS NULL OR c.community_name = $6)
       ORDER BY c.id
     ),
     bucketed AS (
       SELECT ${stepExpr} AS bucket_at, * FROM scoped
     ),
     intents AS (
       SELECT bucket_at, platform, jsonb_object_agg(intent_tag, cnt) AS intent_counts
       FROM (
         SELECT bucket_at, platform, COALESCE(intent_tag, 'unknown') AS intent_tag, COUNT(*)::int AS cnt
         FROM bucketed
         WHERE kind <> 'comment'
         GROUP BY 1, 2, 3
       ) t
       GROUP BY 1, 2
     ),
     domains AS (
       SELECT bucket_at, platform, jsonb_agg(jsonb_build_object('domain', external_domain, 'count', cnt, 'totalEngagement', total_eng) ORDER BY total_eng DESC, cnt DESC) AS top_domains
       FROM (
         SELECT bucket_at, platform, external_domain, COUNT(*)::int AS cnt, ROUND(SUM(engagement_score)::numeric, 2)::float8 AS total_eng,
           ROW_NUMBER() OVER (PARTITION BY bucket_at, platform ORDER BY SUM(engagement_score) DESC, COUNT(*) DESC) AS rn
         FROM bucketed
         WHERE external_domain IS NOT NULL AND kind <> 'comment'
         GROUP BY 1, 2, 3
       ) d
       WHERE rn <= 10
       GROUP BY 1, 2
     )
     SELECT
       b.bucket_at,
       b.platform,
       COUNT(*) FILTER (WHERE b.kind <> 'comment')::int AS post_count,
       COUNT(*) FILTER (WHERE b.kind = 'comment')::int AS comment_count,
       COUNT(DISTINCT b.author_handle) FILTER (WHERE b.author_handle IS NOT NULL)::int AS unique_authors,
       COALESCE(SUM(b.metric_score) FILTER (WHERE b.kind <> 'comment'), 0)::text AS sum_score,
       COALESCE(SUM(b.metric_comments) FILTER (WHERE b.kind <> 'comment'), 0)::text AS sum_comments,
       COALESCE(SUM(b.metric_views) FILTER (WHERE b.kind <> 'comment'), 0)::text AS sum_views,
       COALESCE(SUM(b.metric_likes) FILTER (WHERE b.kind <> 'comment'), 0)::text AS sum_likes,
       COALESCE(SUM(b.metric_reposts) FILTER (WHERE b.kind <> 'comment'), 0)::text AS sum_reposts,
       COALESCE(SUM(b.metric_bookmarks) FILTER (WHERE b.kind <> 'comment'), 0)::text AS sum_bookmarks,
       AVG(
         CASE
           WHEN b.kind <> 'comment' AND COALESCE(NULLIF(b.metric_views, 0), NULLIF(b.followers_count, 0)) > 0
           THEN (b.metric_likes + b.metric_score + 2.0 * b.metric_comments + 2.0 * b.metric_reposts + 3.0 * b.metric_bookmarks)
                / COALESCE(NULLIF(b.metric_views, 0), NULLIF(b.followers_count, 0))::float8
         END
       )::float8 AS avg_er,
       PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY b.engagement_score) FILTER (WHERE b.kind <> 'comment')::float8 AS p90_eng,
       i.intent_counts,
       dm.top_domains
     FROM bucketed b
     LEFT JOIN intents i ON i.bucket_at = b.bucket_at AND i.platform = b.platform
     LEFT JOIN domains dm ON dm.bucket_at = b.bucket_at AND dm.platform = b.platform
     GROUP BY b.bucket_at, b.platform, i.intent_counts, dm.top_domains
     ORDER BY b.bucket_at ASC, b.platform ASC`,
    [
      input.sourceIds ?? null,
      input.from.toISOString(),
      input.to.toISOString(),
      kwPattern,
      input.authorFilter?.toLowerCase() ?? null,
      input.subredditFilter?.toLowerCase() ?? null,
    ],
  );

  return rows.map((r) => ({
    bucketAt: r.bucket_at.toISOString(),
    platform: r.platform,
    postCount: r.post_count,
    commentCount: r.comment_count,
    uniqueAuthors: r.unique_authors,
    sumScore: Number(r.sum_score),
    sumComments: Number(r.sum_comments),
    sumViews: Number(r.sum_views),
    sumLikes: Number(r.sum_likes),
    sumReposts: Number(r.sum_reposts),
    sumBookmarks: Number(r.sum_bookmarks),
    avgEngagementRate: r.avg_er,
    p90Engagement: r.p90_eng,
    intentCounts: r.intent_counts ?? {},
    topDomains: r.top_domains ?? [],
  }));
}

export async function queryScopedTextSamples(
  db: Pool | PoolClient,
  sourceIds: readonly string[],
  from: Date,
  to: Date,
  limit = 250,
): Promise<Array<{ title: string | null; excerpt: string | null; hashtags: string[] }>> {
  if (!sourceIds.length) return [];
  const { rows } = await db.query<{ title: string | null; clean_excerpt: string | null; hashtags: string[] }>(
    `SELECT DISTINCT ON (c.id) c.title, c.clean_excerpt, c.hashtags
     FROM content c
     JOIN content_discovery d ON d.content_id = c.id
     WHERE d.collection_source_id = ANY($1::uuid[])
       AND c.availability = 'available'
       AND c.kind <> 'comment'
       AND COALESCE(c.created_at_source, c.first_seen_at) >= $2
       AND COALESCE(c.created_at_source, c.first_seen_at) < $3
     ORDER BY c.id, c.engagement_score DESC
     LIMIT $4`,
    [sourceIds, from.toISOString(), to.toISOString(), limit],
  );
  return rows.map((r) => ({ title: r.title, excerpt: r.clean_excerpt, hashtags: r.hashtags ?? [] }));
}

function mapMonitorPostMetrics(r: import("pg").QueryResultRow) {
  return {
    metricScore: r.metric_score ?? null,
    metricComments: r.metric_comments ?? null,
    metricViews: optInt(r.metric_views),
    metricLikes: r.metric_likes ?? null,
    metricReposts: r.metric_reposts ?? null,
    metricBookmarks: r.metric_bookmarks ?? null,
    upvoteRatio: r.upvote_ratio ?? null,
    engagementScore: Number(r.engagement_score ?? 0),
    discussionRatio: Number(r.discussion_ratio ?? 0),
    velocityScore: Number(r.velocity_score ?? 0),
  };
}

function mapMonitorPostRow(r: import("pg").QueryResultRow): MonitorPostRow {
  return {
    id: r.id,
    platform: r.platform,
    kind: r.kind,
    externalId: r.external_id,
    title: r.title ?? null,
    cleanExcerpt: r.clean_excerpt ?? null,
    url: r.permalink ?? r.url ?? null,
    publishedAt: r.created_at_source instanceof Date ? r.created_at_source.toISOString() : null,
    authorHandle: r.author_handle ?? null,
    authorDisplayName: r.author_display_name ?? null,
    authorAvatarUrl: r.author_avatar_url ?? null,
    authorVerified: Boolean(r.author_verified),
    authorFollowers: optInt(r.author_followers_count),
    communityName: r.community_name ?? null,
    flair: r.platform_details?.flair ?? null,
    externalDomain: r.external_domain ?? null,
    intentTag: r.intent_tag ?? null,
    hashtags: Array.isArray(r.hashtags) ? r.hashtags : [],
    hasMedia: Boolean(r.has_media),
    primaryMediaUrl: r.primary_media_url ?? null,
    ...mapMonitorPostMetrics(r),
  };
}

export async function queryMonitorPosts(
  db: Pool | PoolClient,
  actor: Actor,
  input: {
    sourceIds?: readonly string[];
    from: Date;
    to: Date;
    platform?: ContentPlatform;
    intent?: string;
    community?: string;
    author?: string;
    domain?: string;
    sort?: string;
    limit: number;
    offset: number;
  },
): Promise<{ items: MonitorPostRow[]; totalCount: number }> {
  if (input.sourceIds && !input.sourceIds.length) return { items: [], totalCount: 0 };
  const orderSql = buildOrderSql(input.sort);
  const { rows } = await db.query(
    `WITH scoped AS (
       SELECT DISTINCT ON (c.id)
         c.*,
         s.code AS platform,
         ap.display_name AS author_display_name,
         ap.avatar_url AS author_avatar_url,
         COALESCE(ap.verified, FALSE) AS author_verified,
         ap.followers_count AS author_followers_count
       FROM content c
       JOIN source s ON s.id = c.source_id
       JOIN content_discovery d ON d.content_id = c.id
       LEFT JOIN content_author_profile ap ON ap.platform_id = c.source_id AND ap.author_handle = c.author_handle
       WHERE ($1::uuid[] IS NULL OR d.collection_source_id = ANY($1))
         AND ($2::uuid[] IS NULL OR d.collection_source_id = ANY($2))
         AND c.availability = 'available'
         AND c.kind <> 'comment'
         AND COALESCE(c.created_at_source, c.first_seen_at) >= $3
         AND COALESCE(c.created_at_source, c.first_seen_at) < $4
         AND ($5::text IS NULL OR s.code = $5)
         AND ($6::text IS NULL OR c.intent_tag = $6)
         AND ($7::text IS NULL OR c.community_name = $7)
         AND ($8::text IS NULL OR c.author_handle = $8)
         AND ($9::text IS NULL OR c.external_domain = $9)
       ORDER BY c.id
     )
     SELECT *, COUNT(*) OVER()::int AS full_count
     FROM scoped c
     ORDER BY ${orderSql}, c.id
     LIMIT $10 OFFSET $11`,
    [
      input.sourceIds ?? null,
      actor.allowedSourceIds,
      input.from.toISOString(),
      input.to.toISOString(),
      input.platform ?? null,
      input.intent ?? null,
      input.community?.toLowerCase() ?? null,
      input.author?.toLowerCase() ?? null,
      input.domain?.toLowerCase() ?? null,
      input.limit,
      input.offset,
    ],
  );
  const totalCount = Number(rows[0]?.full_count ?? 0);
  const items: MonitorPostRow[] = rows.map(mapMonitorPostRow);
  return { items, totalCount };
}

const optInt = (v: unknown): number | null => (v != null ? Number(v) : null);

function mapAuthorDirectoryRow(r: import("pg").QueryResultRow): AuthorDirectoryRow {
  return {
    platform: r.platform,
    handle: r.author_handle,
    displayName: r.display_name ?? null,
    avatarUrl: r.avatar_url ?? null,
    bio: r.bio ?? null,
    location: r.location ?? null,
    verified: Boolean(r.verified),
    followersCount: optInt(r.followers_count),
    followingCount: optInt(r.following_count),
    statusesCount: optInt(r.statuses_count),
    postCount: r.post_count,
    avgEngagement: Number(r.avg_eng ?? 0),
    avgComments: Number(r.avg_comments ?? 0),
    totalLikesOrScore: Number(r.total_primary ?? 0),
    totalViews: Number(r.total_views ?? 0),
    topCommunities: Array.isArray(r.communities) ? r.communities.slice(0, 8) : [],
    lastSeenAt: r.last_seen_at.toISOString(),
  };
}

export async function queryAuthorDirectory(
  db: Pool | PoolClient,
  actor: Actor,
  input: {
    platform?: "reddit" | "x";
    sourceIds?: readonly string[];
    search?: string;
    sort?: "followers" | "engagement" | "posts";
    limit: number;
  },
): Promise<AuthorDirectoryRow[]> {
  if (input.sourceIds && !input.sourceIds.length) return [];
  const searchPattern = input.search ? `%${escapeLike(input.search.toLowerCase())}%` : null;
  const orderSql = input.sort === "posts"
    ? "post_count DESC, avg_eng DESC"
    : input.sort === "engagement"
      ? "avg_eng DESC, ap.followers_count DESC NULLS LAST"
      : "ap.followers_count DESC NULLS LAST, avg_eng DESC";

  const { rows } = await db.query(
    `WITH visible_posts AS (
       SELECT DISTINCT ON (c.id)
         c.source_id AS platform_id,
         c.author_handle,
         c.community_name,
         c.engagement_score,
         COALESCE(c.metric_comments, 0) AS metric_comments,
         COALESCE(c.metric_score, c.metric_likes, 0) AS primary_metric,
         COALESCE(c.metric_views, 0) AS metric_views
       FROM content c
       JOIN content_discovery d ON d.content_id = c.id
       WHERE c.availability = 'available'
         AND c.kind <> 'comment'
         AND c.author_handle IS NOT NULL
         AND ($1::uuid[] IS NULL OR d.collection_source_id = ANY($1))
         AND ($2::uuid[] IS NULL OR d.collection_source_id = ANY($2))
       ORDER BY c.id
     ),
     agg AS (
       SELECT
         platform_id,
         author_handle,
         COUNT(*)::int AS post_count,
         ROUND(AVG(engagement_score)::numeric, 2)::float8 AS avg_eng,
         ROUND(AVG(metric_comments)::numeric, 2)::float8 AS avg_comments,
         SUM(primary_metric)::bigint AS total_primary,
         SUM(metric_views)::bigint AS total_views,
         ARRAY_REMOVE(ARRAY_AGG(DISTINCT community_name), NULL) AS communities
       FROM visible_posts
       GROUP BY 1, 2
     )
     SELECT
       s.code AS platform,
       ap.author_handle,
       ap.display_name,
       ap.avatar_url,
       ap.bio,
       ap.location,
       ap.verified,
       ap.followers_count,
       ap.following_count,
       ap.statuses_count,
       ap.last_seen_at,
       agg.post_count,
       agg.avg_eng,
       agg.avg_comments,
       agg.total_primary,
       agg.total_views,
       agg.communities
     FROM content_author_profile ap
     JOIN source s ON s.id = ap.platform_id
     JOIN agg ON agg.platform_id = ap.platform_id AND agg.author_handle = ap.author_handle
     WHERE ($3::text IS NULL OR s.code = $3)
       AND ($4::text IS NULL OR ap.author_handle LIKE $4 ESCAPE '\\' OR LOWER(COALESCE(ap.display_name, '')) LIKE $4 ESCAPE '\\')
     ORDER BY ${orderSql}, ap.author_handle ASC
     LIMIT $5`,
    [
      actor.allowedSourceIds,
      input.sourceIds ?? null,
      input.platform ?? null,
      searchPattern,
      input.limit,
    ],
  );

  return rows.map(mapAuthorDirectoryRow);
}

export async function queryCommunityMatrix(
  db: Pool | PoolClient,
  actor: Actor,
  input: {
    sourceIds?: readonly string[];
    from: Date;
    to: Date;
    sort?: "heat" | "posts" | "comments";
    limit: number;
  },
): Promise<CommunityMatrixRow[]> {
  if (input.sourceIds && !input.sourceIds.length) return [];
  const orderSql = input.sort === "posts"
    ? "post_count DESC, avg_score DESC"
    : input.sort === "comments"
      ? "total_comments DESC, p90_eng DESC"
      : "p90_eng DESC, total_comments DESC";

  const { rows } = await db.query(
    `WITH scoped AS (
       SELECT DISTINCT ON (c.id)
         c.community_name,
         c.author_handle,
         COALESCE(c.metric_score, 0) AS metric_score,
         COALESCE(c.metric_comments, 0) AS metric_comments,
         c.engagement_score,
         c.discussion_ratio,
         NULLIF(c.platform_details->>'subredditSubscribers', '')::bigint AS subscribers,
         COALESCE(c.created_at_source, c.first_seen_at) AS ts
       FROM content c
       JOIN source s ON s.id = c.source_id
       JOIN content_discovery d ON d.content_id = c.id
       WHERE s.code = 'reddit'
         AND c.availability = 'available'
         AND c.kind = 'post'
         AND c.community_name IS NOT NULL
         AND COALESCE(c.created_at_source, c.first_seen_at) >= $3
         AND COALESCE(c.created_at_source, c.first_seen_at) < $4
         AND ($1::uuid[] IS NULL OR d.collection_source_id = ANY($1))
         AND ($2::uuid[] IS NULL OR d.collection_source_id = ANY($2))
       ORDER BY c.id
     )
     SELECT
       community_name AS subreddit,
       MAX(subscribers) AS subscribers,
       COUNT(*)::int AS post_count,
       COUNT(DISTINCT author_handle) FILTER (WHERE author_handle IS NOT NULL)::int AS unique_authors,
       ROUND(AVG(metric_score)::numeric, 2)::float8 AS avg_score,
       ROUND(AVG(metric_comments)::numeric, 2)::float8 AS avg_comments,
       ROUND(AVG(discussion_ratio)::numeric, 3)::float8 AS avg_discussion_ratio,
       PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY engagement_score)::float8 AS p90_eng,
       SUM(metric_score)::bigint AS total_score,
       SUM(metric_comments)::bigint AS total_comments,
       MAX(ts) AS latest_post_at
     FROM scoped
     GROUP BY community_name
     ORDER BY ${orderSql}, community_name ASC
     LIMIT $5`,
    [actor.allowedSourceIds, input.sourceIds ?? null, input.from.toISOString(), input.to.toISOString(), input.limit],
  );

  return rows.map((r) => ({
    subreddit: r.subreddit,
    subscribers: r.subscribers !== null && r.subscribers !== undefined ? Number(r.subscribers) : null,
    postCount: r.post_count,
    uniqueAuthors: r.unique_authors,
    avgScore: Number(r.avg_score ?? 0),
    avgComments: Number(r.avg_comments ?? 0),
    avgDiscussionRatio: Number(r.avg_discussion_ratio ?? 0),
    p90Engagement: Number(r.p90_eng ?? 0),
    totalScore: Number(r.total_score ?? 0),
    totalComments: Number(r.total_comments ?? 0),
    latestPostAt: r.latest_post_at instanceof Date ? r.latest_post_at.toISOString() : null,
  }));
}

export async function queryCommunityBreakdowns(
  db: Pool | PoolClient,
  actor: Actor,
  subreddit: string,
  from: Date,
  to: Date,
): Promise<{
  flairs: Array<{ flair: string; count: number; avgScore: number }>;
  postingHeatmap: Array<{ dow: number; hour: number; count: number; avgEngagement: number }>;
}> {
  const cleanSub = subreddit.replace(/^r\//i, "").toLowerCase();
  const baseFilter = `
    SELECT DISTINCT ON (c.id)
      COALESCE(NULLIF(c.platform_details->>'flair', ''), 'Unflaired') AS flair,
      COALESCE(c.metric_score, 0) AS score,
      c.engagement_score,
      EXTRACT(DOW FROM COALESCE(c.created_at_source, c.first_seen_at) AT TIME ZONE 'UTC')::int AS dow,
      EXTRACT(HOUR FROM COALESCE(c.created_at_source, c.first_seen_at) AT TIME ZONE 'UTC')::int AS hour
    FROM content c
    JOIN source s ON s.id = c.source_id
    JOIN content_discovery d ON d.content_id = c.id
    WHERE s.code = 'reddit'
      AND c.availability = 'available'
      AND c.kind = 'post'
      AND c.community_name = $1
      AND COALESCE(c.created_at_source, c.first_seen_at) >= $2
      AND COALESCE(c.created_at_source, c.first_seen_at) < $3
      AND ($4::uuid[] IS NULL OR d.collection_source_id = ANY($4))
    ORDER BY c.id
  `;
  const [flairRes, heatRes] = await Promise.all([
    db.query<{ flair: string; count: number; avg_score: number }>(
      `WITH posts AS (${baseFilter})
       SELECT flair, COUNT(*)::int AS count, ROUND(AVG(score)::numeric, 1)::float8 AS avg_score
       FROM posts GROUP BY flair ORDER BY count DESC, avg_score DESC LIMIT 12`,
      [cleanSub, from.toISOString(), to.toISOString(), actor.allowedSourceIds],
    ),
    db.query<{ dow: number; hour: number; count: number; avg_eng: number }>(
      `WITH posts AS (${baseFilter})
       SELECT dow, hour, COUNT(*)::int AS count, ROUND(AVG(engagement_score)::numeric, 2)::float8 AS avg_eng
       FROM posts GROUP BY dow, hour ORDER BY dow, hour`,
      [cleanSub, from.toISOString(), to.toISOString(), actor.allowedSourceIds],
    ),
  ]);
  return {
    flairs: flairRes.rows.map((r) => ({ flair: r.flair, count: r.count, avgScore: Number(r.avg_score) })),
    postingHeatmap: heatRes.rows.map((r) => ({ dow: r.dow, hour: r.hour, count: r.count, avgEngagement: Number(r.avg_eng) })),
  };
}

