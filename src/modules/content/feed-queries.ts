import { scoreObservation } from "./enrich";
import { groupStories } from "./story-groups";
import type { BatchMembership } from "./search";
import type { Pool, PoolClient } from "pg";
import type { Actor } from "../../../packages/contracts/src/access";
import type { ChannelScope, ContentPlatform } from "../../../packages/contracts/src/common";
import type { ContentCardLayout, ContentIntentTag } from "../../../packages/contracts/src/content";

export interface FeedCandidateRow {
  id: string;
  platformId: string;
  platform: ContentPlatform;
  kind: string;
  externalId: string;
  title: string | null;
  cleanExcerpt: string | null;
  url: string | null;
  language: string | null;
  publishedAt: string | null;
  firstFetchedAt: string;
  sourceId: string;
  sourceLabel: string;
  sourceTier: "T1" | "T1_5" | "T2";
  sourceGroup: string | null;
  sourceLane: string;
  communityName: string | null;
  flair: string | null;
  cardLayout: ContentCardLayout;
  intentTag: ContentIntentTag | null;
  hashtags: string[];
  hasMedia: boolean;
  primaryMediaUrl: string | null;
  externalDomain: string | null;
  media: Array<{ type: "image" | "video" | "audio" | "link"; url: string; previewUrl: string | null }>;
  author: {
    handle: string;
    displayName: string | null;
    avatarUrl: string | null;
    verified: boolean;
    followersCount: number | null;
  } | null;
  metricScore: number | null;
  metricComments: number | null;
  metricViews: number | null;
  metricLikes: number | null;
  metricReposts: number | null;
  upvoteRatio: number | null;
  engagementScore: number;
  discussionRatio: number;
  velocityScore: number;
  corroborationCount: number;
}

export interface PlatformEngagementBaseline {
  platform: ContentPlatform;
  p50: number;
  p75: number;
  p90: number;
  max: number;
}

export interface TopCommentPreview {
  author: string;
  text: string;
  score: number | null;
}

export interface ContentDimensionSummary {
  id: string;
  sourceId: string | null;
  platform: ContentPlatform;
  sourceGroup: string | null;
  authorHandle: string | null;
  communityName: string | null;
}

function mapAuthor(row: import("pg").QueryResultRow): FeedCandidateRow["author"] {
  const handle = typeof row.author_handle === "string" && row.author_handle ? row.author_handle : row.author_fallback;
  if (!handle) return null;
  const followers = row.author_followers_count;
  return {
    handle: String(handle),
    displayName: row.author_display_name ?? row.author_json_name ?? null,
    avatarUrl: row.author_avatar_url ?? row.author_json_avatar ?? null,
    verified: Boolean(row.author_verified),
    followersCount: followers != null ? Number(followers) : null,
  };
}

function mapMetrics(row: import("pg").QueryResultRow) {
  return {
    metricScore: row.metric_score ?? null,
    metricComments: row.metric_comments ?? null,
    metricViews: row.metric_views != null ? Number(row.metric_views) : null,
    metricLikes: row.metric_likes ?? null,
    metricReposts: row.metric_reposts ?? null,
    upvoteRatio: row.upvote_ratio ?? null,
    engagementScore: Number(row.engagement_score ?? 0),
    discussionRatio: Number(row.discussion_ratio ?? 0),
    velocityScore: Number(row.velocity_score ?? 0),
  };
}

function mapMedia(raw: unknown): FeedCandidateRow["media"] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 4).map((m: Record<string, unknown>) => ({
    type: (m.type as "image" | "video" | "audio" | "link") ?? "link",
    url: String(m.url ?? ""),
    previewUrl: typeof m.previewUrl === "string" ? m.previewUrl : null,
  }));
}

function mapCandidateRow(row: import("pg").QueryResultRow): FeedCandidateRow {
  return {
    id: row.id,
    platformId: row.platform_id,
    platform: row.platform,
    kind: row.kind,
    externalId: row.external_id,
    title: row.title ?? null,
    cleanExcerpt: row.clean_excerpt ?? null,
    url: row.permalink ?? row.url ?? null,
    language: row.language ?? null,
    publishedAt: row.created_at_source instanceof Date ? row.created_at_source.toISOString() : null,
    firstFetchedAt: row.first_seen_at.toISOString(),
    sourceId: row.collection_source_id,
    sourceLabel: row.source_label,
    sourceTier: row.source_tier,
    sourceGroup: row.source_group ?? null,
    sourceLane: row.feed_lane ?? "discussion",
    communityName: row.community_name ?? null,
    flair: row.flair ?? null,
    cardLayout: row.card_layout ?? "compact_signal",
    intentTag: row.intent_tag ?? null,
    hashtags: Array.isArray(row.hashtags) ? row.hashtags : [],
    hasMedia: Boolean(row.has_media),
    primaryMediaUrl: row.primary_media_url ?? null,
    externalDomain: row.external_domain ?? null,
    media: mapMedia(row.content_media),
    author: mapAuthor(row),
    ...mapMetrics(row),
    corroborationCount: 1,
  };
}

export async function queryFeedCandidates(
  pool: Pool | PoolClient,
  actor: Actor,
  input: {
    lookbackHours: number;
    limit: number;
    topic?: string;
    platform?: ContentPlatform;
    channelScope?: ChannelScope;
    language?: string;
    includeNews: boolean;
    excludeContentIds?: string[];
    mutedSourceIds?: string[];
    mutedAuthors?: string[];
    mutedKeywords?: string[];
    visibility?: BatchMembership;
  },
): Promise<FeedCandidateRow[]> {
  const lanes = input.includeNews ? ["discussion", "release", "news"] : ["discussion", "release"];
  const excludeIds = input.excludeContentIds ?? [];
  const mutedSources = input.mutedSourceIds ?? [];
  const mutedAuthors = input.mutedAuthors ?? [];
  const mutedPatterns = (input.mutedKeywords ?? [])
    .map((kw) => kw.trim().toLowerCase())
    .filter(Boolean)
    .map((kw) => `%${kw.replace(/[\\%_]/g, "\\$&")}%`);

  const values: unknown[] = [
    actor.allowedSourceIds,
    lanes,
    input.lookbackHours,
    excludeIds,
    mutedSources,
    mutedAuthors,
    mutedPatterns,
    input.topic ?? null,
    input.platform ?? null,
    input.language ?? null,
    Math.min(400, Math.max(20, input.limit)),
  ];
  const visSql = input.visibility
    ? ` AND ${input.visibility.contains((v) => `$${values.push(v)}`, "d.content_id")}`
    : "";
  const scopeSql = input.channelScope === "info"
    ? " AND s.code = 'web'"
    : input.channelScope === "social"
      ? " AND s.code = ANY(ARRAY['reddit','x','bluesky']::text[])"
      : "";

  const { rows } = await pool.query(
    `WITH visible AS (
       SELECT DISTINCT ON (c.id)
         c.id,
         c.source_id AS platform_id,
         s.code AS platform,
         c.kind,
         c.external_id,
         c.title,
         c.clean_excerpt,
         c.url,
         c.permalink,
         c.language,
         c.created_at_source,
         c.first_seen_at,
         c.content_media,
         c.author_handle,
         c.content_author->>'handle' AS author_fallback,
         c.content_author->>'displayName' AS author_json_name,
         c.content_author->>'avatarUrl' AS author_json_avatar,
         c.community_name,
         c.platform_details->>'flair' AS flair,
         c.card_layout,
         c.intent_tag,
         c.hashtags,
         c.has_media,
         c.primary_media_url,
         c.external_domain,
         c.metric_score,
         c.metric_comments,
         c.metric_views,
         c.metric_likes,
         c.metric_reposts,
         c.upvote_ratio,
         c.engagement_score,
         c.discussion_ratio,
         c.velocity_score,
         cs.id AS collection_source_id,
         cs.label AS source_label,
         cs.tier AS source_tier,
         cs.source_group,
         cs.feed_lane
       FROM content c
       JOIN source s ON s.id = c.source_id
       JOIN content_discovery d ON d.content_id = c.id
       JOIN collection_source cs ON cs.id = d.collection_source_id
       WHERE c.availability = 'available'
         AND c.kind IN ('post', 'article')
         AND COALESCE(c.created_at_source, c.first_seen_at) >= NOW() - ($3::integer * interval '1 hour')
         AND cs.state = 'active'
         AND cs.feed_lane = ANY($2::text[])
         AND ($1::uuid[] IS NULL OR cs.id = ANY($1))
         AND NOT (c.id = ANY($4::uuid[]))
         AND NOT (cs.id = ANY($5::uuid[]))
         AND ($6::text[] = '{}' OR c.author_handle IS NULL OR NOT (c.author_handle = ANY($6::text[])))
         AND ($7::text[] = '{}' OR NOT EXISTS (SELECT 1 FROM UNNEST($7::text[]) AS pat WHERE LOWER(COALESCE(c.title, '') || ' ' || COALESCE(c.clean_excerpt, '')) LIKE pat ESCAPE '\\'))
         AND ($8::text IS NULL OR cs.source_group = $8)
         AND ($9::text IS NULL OR s.code = $9)
         AND ($10::text IS NULL OR c.language = $10)${scopeSql}${visSql}
       ORDER BY c.id, (CASE cs.tier WHEN 'T1' THEN 3 WHEN 'T1_5' THEN 2 ELSE 1 END) DESC, cs.id
     )
     SELECT v.*,
       ap.display_name AS author_display_name,
       ap.avatar_url AS author_avatar_url,
       COALESCE(ap.verified, FALSE) AS author_verified,
       ap.followers_count AS author_followers_count
     FROM visible v
     LEFT JOIN content_author_profile ap ON ap.platform_id = v.platform_id AND ap.author_handle = v.author_handle
     ORDER BY (v.engagement_score + v.velocity_score) DESC, COALESCE(v.created_at_source, v.first_seen_at) DESC, v.id
     LIMIT $11`,
    values,
  );
  const candidates = rows.map(mapCandidateRow);
  const stories = rows.map((row, index) => ({
    id: row.id as string,
    title: row.title ?? row.clean_excerpt ?? "",
    url: row.url as string | null,
    links: Array.isArray(row.content_media)
      ? (row.content_media as FeedCandidateRow["media"]).filter((media) => media.type === "link" && typeof media.url === "string").map((media) => media.url)
      : [],
    publishedAt: (row.created_at_source ?? row.first_seen_at).getTime() as number,
    candidate: candidates[index],
  })).sort((a, b) => a.publishedAt - b.publishedAt || a.id.localeCompare(b.id));
  for (const group of groupStories(stories)) {
    const distinctSources = new Set(group.map(({ candidate }) => candidate.sourceId)).size;
    for (const { candidate } of group) candidate.corroborationCount = distinctSources;
  }
  return candidates;
}

export async function loadFeedObservationHistory(
  db: Pool,
  actor: Actor,
  contentIds: readonly string[],
  asOf: Date,
  visibility?: BatchMembership,
): Promise<Map<string, number[]>> {
  const histories = new Map<string, number[]>();
  if (!contentIds.length) return histories;
  const values: unknown[] = [contentIds, actor.allowedSourceIds, asOf];
  const visSql = visibility
    ? ` AND ${visibility.contains((v) => `$${values.push(v)}`, "o.content_id")}`
    : "";
  const { rows } = await db.query<{ content_id: string; metrics: Record<string, number | null> }>(
    `SELECT content_id, metrics
     FROM (
       SELECT DISTINCT ON (o.content_id, date_bin('6 hours', observed.at, TIMESTAMPTZ '2000-01-01 UTC'))
         o.content_id, observed.at, o.metrics
       FROM content_observation o
       JOIN collection_source cs ON cs.id=o.collection_source_id
       CROSS JOIN LATERAL (SELECT COALESCE(o.source_observed_at, o.fetched_at) AS at) observed
       WHERE o.content_id = ANY($1::uuid[])
         AND cs.state = 'active' AND cs.feed_lane IN ('discussion', 'release')
         AND ($2::uuid[] IS NULL OR o.collection_source_id = ANY($2))
         AND observed.at BETWEEN $3::timestamptz - interval '48 hours' AND $3
         AND o.fetched_at <= $3
         AND EXISTS (SELECT 1 FROM jsonb_each(o.metrics) m WHERE jsonb_typeof(m.value) = 'number'
           AND m.key IN ('reddit.score', 'reddit.num_comments', 'x.likes', 'x.replies', 'x.reposts', 'bluesky.likes', 'bluesky.replies', 'bluesky.reposts', 'bsky.reposts'))${visSql}
       ORDER BY o.content_id, date_bin('6 hours', observed.at, TIMESTAMPTZ '2000-01-01 UTC'),
         observed.at DESC, o.fetched_at DESC, o.collection_source_id, o.provider, o.evidence_key
     ) snapshots
     ORDER BY content_id, at`,
    values,
  );
  for (const row of rows) {
    let points = histories.get(row.content_id);
    if (!points) histories.set(row.content_id, points = []);
    points.push(scoreObservation(row.metrics).engagementScore);
  }
  return histories;
}

export async function loadPlatformEngagementBaselines(
  pool: Pool | PoolClient,
  visibility?: BatchMembership,
): Promise<Map<ContentPlatform, PlatformEngagementBaseline>> {
  const values: unknown[] = [];
  const visSql = visibility
    ? ` AND ${visibility.contains((v) => `$${values.push(v)}`, "c.id")}`
    : "";
  const { rows } = await pool.query<{
    platform: ContentPlatform;
    p50: number;
    p75: number;
    p90: number;
    max: number;
  }>(
    `SELECT
       s.code AS platform,
       COALESCE(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY c.engagement_score), 0)::float8 AS p50,
       COALESCE(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY c.engagement_score), 0)::float8 AS p75,
       COALESCE(PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY c.engagement_score), 0)::float8 AS p90,
       COALESCE(MAX(c.engagement_score), 1)::float8 AS max
     FROM content c
     JOIN source s ON s.id = c.source_id
     WHERE c.availability = 'available'
       AND c.kind IN ('post', 'article')
       AND COALESCE(c.created_at_source, c.first_seen_at) >= NOW() - interval '7 days'${visSql}
     GROUP BY s.code`,
    values,
  );
  return new Map(rows.map((row) => [row.platform, row]));
}

export async function loadTopCommentsForPosts(
  pool: Pool | PoolClient,
  posts: ReadonlyArray<{ id: string; platformId: string; kind: string; externalId: string }>,
  maxPerPost = 2,
  visibility?: BatchMembership,
): Promise<Map<string, TopCommentPreview[]>> {
  const result = new Map<string, TopCommentPreview[]>();
  if (!posts.length) return result;
  const payload = posts.map((p) => JSON.stringify(p));
  const values: unknown[] = [payload, maxPerPost];
  const visSql = visibility
    ? ` AND ${visibility.contains((v) => `$${values.push(v)}`, "c.id")}`
    : "";
  const { rows } = await pool.query<{
    post_id: string;
    author: string | null;
    body_text: string | null;
    score: number | null;
  }>(
    `WITH targets AS (
       SELECT (v->>'id')::uuid AS post_id, (v->>'platformId')::uuid AS platform_id, v->>'kind' AS kind, v->>'externalId' AS external_id
       FROM UNNEST($1::jsonb[]) AS input(v)
     )
     SELECT t.post_id, cm.author, cm.body_text, cm.score
     FROM targets t
     JOIN LATERAL (
       SELECT
         COALESCE(c.content_author->>'handle', c.author_handle, 'anon') AS author,
         COALESCE(c.clean_excerpt, left(c.body_text, 200)) AS body_text,
         COALESCE(c.metric_score, c.metric_likes) AS score
       FROM content c
       WHERE c.source_id = t.platform_id
         AND c.availability = 'available'
         AND c.kind = 'comment'
         AND c.body_text IS NOT NULL
         AND (
           c.content_references @> jsonb_build_array(jsonb_build_object('relation', 'thread_root', 'kind', t.kind, 'externalId', t.external_id))
           OR c.content_references @> jsonb_build_array(jsonb_build_object('relation', 'reply_to', 'kind', t.kind, 'externalId', t.external_id))
         )${visSql}
       ORDER BY c.engagement_score DESC, COALESCE(c.metric_score, c.metric_likes, 0) DESC, c.id
       LIMIT $2
     ) cm ON TRUE`,
    values,
  );
  for (const row of rows) {
    if (!row.body_text) continue;
    const list = result.get(row.post_id) ?? [];
    list.push({ author: row.author ?? "anon", text: row.body_text, score: row.score ?? null });
    result.set(row.post_id, list);
  }
  return result;
}

export async function loadContentDimensionsByIds(
  db: Pool | PoolClient,
  actor: Actor,
  contentIds: readonly string[],
  visibility?: BatchMembership,
): Promise<Map<string, ContentDimensionSummary>> {
  const unique = [...new Set(contentIds)];
  if (!unique.length) return new Map();
  const values: unknown[] = [unique, actor.allowedSourceIds];
  const visSql = visibility
    ? ` AND ${visibility.contains((v) => `$${values.push(v)}`, "d.content_id")}`
    : "";
  const { rows } = await db.query<{
    id: string;
    source_id: string | null;
    platform: ContentPlatform;
    source_group: string | null;
    author_handle: string | null;
    community_name: string | null;
  }>(
    `SELECT DISTINCT ON (c.id)
       c.id,
       cs.id AS source_id,
       s.code AS platform,
       cs.source_group,
       c.author_handle,
       c.community_name
     FROM content c
     JOIN source s ON s.id = c.source_id
     JOIN content_discovery d ON d.content_id = c.id
     JOIN collection_source cs ON cs.id = d.collection_source_id
     WHERE c.id = ANY($1::uuid[])
       AND ($2::uuid[] IS NULL OR cs.id = ANY($2))${visSql}
     ORDER BY c.id, cs.id`,
    values,
  );
  return new Map(
    rows.map((r) => [
      r.id,
      {
        id: r.id,
        sourceId: r.source_id,
        platform: r.platform,
        sourceGroup: r.source_group,
        authorHandle: r.author_handle,
        communityName: r.community_name,
      },
    ]),
  );
}
