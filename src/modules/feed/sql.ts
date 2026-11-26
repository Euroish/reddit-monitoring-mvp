import type { Static } from "@sinclair/typebox";
import type { Pool, PoolClient } from "pg";
import type { Actor } from "../../../packages/contracts/src/access";
import type { ContentPlatform } from "../../../packages/contracts/src/common";
import type {
  FeedEventBatchBody,
  FeedHotQuery,
  FeedPreferences,
  FeedPreferencesPatch,
  FeedStreamQuery,
} from "../../../packages/contracts/src/feed";
import { fail } from "../../shared/errors";
import { transaction } from "../../storage/db";
import {
  loadContentDimensionsByIds,
  loadFeedObservationHistory,
  loadPlatformEngagementBaselines,
  loadTopCommentsForPosts,
  queryFeedCandidates,
  type BatchMembership,
  type ContentDimensionSummary,
  type ContentVisibilityResolver,
  type PlatformEngagementBaseline,
} from "../content/index";
import {
  computeUnifiedHeat,
  formatFeedCard,
  mixFeedStream,
  type AffinityRecord,
  type UserFeedProfile,
} from "./ranking";

const GUEST_USER_ID = "00000000-0000-0000-0000-000000000000";
const baselineCache = new WeakMap<Pool, { expiresAt: number; data: Map<ContentPlatform, PlatformEngagementBaseline> }>();

export function isAuthenticatedUser(actor: Actor): boolean {
  return Boolean(actor.userId && actor.userId !== GUEST_USER_ID);
}

async function getBaselines(
  pool: Pool,
  visibility?: BatchMembership,
): Promise<Map<ContentPlatform, PlatformEngagementBaseline>> {
  const cached = baselineCache.get(pool);
  const now = Date.now();
  if (cached && cached.expiresAt > now && cached.data.size > 0) return cached.data;
  const data = await loadPlatformEngagementBaselines(pool, visibility);
  if (data.size > 0) baselineCache.set(pool, { expiresAt: now + 15_000, data });
  return data;
}

interface LoadedFeedState {
  profile: UserFeedProfile;
  seenIds: string[];
  mutedSources: string[];
  mutedAuthors: string[];
  mutedKeywords: string[];
  includeNewsLane: boolean;
}

async function loadUserFeedState(pool: Pool, actor: Actor): Promise<LoadedFeedState> {
  if (!isAuthenticatedUser(actor)) {
    return {
      profile: { authenticated: false, exploreRatio: 0.2, followedTopics: [], affinities: [] },
      seenIds: [], mutedSources: [], mutedAuthors: [], mutedKeywords: [], includeNewsLane: false,
    };
  }
  const [prefRes, seenRes, affRes] = await Promise.all([
    pool.query("SELECT * FROM feed_user_preference WHERE user_id=$1", [actor.userId]),
    pool.query<{ content_id: string }>(
      "SELECT content_id FROM feed_user_seen WHERE user_id=$1 ORDER BY seen_at DESC LIMIT 2000",
      [actor.userId],
    ),
    pool.query<{ dim_type: AffinityRecord["dimType"]; dim_key: string; decayed_weight: number; exposure_count: number }>(
      `SELECT dim_type, dim_key,
         (weight * EXP(-EXTRACT(EPOCH FROM (NOW() - updated_at)) * LN(2) / (14 * 86400)))::real AS decayed_weight,
         exposure_count
       FROM feed_user_affinity
       WHERE user_id=$1
       ORDER BY ABS(weight) DESC, updated_at DESC
       LIMIT 150`,
      [actor.userId],
    ),
  ]);
  const pref = prefRes.rows[0];
  return {
    profile: {
      authenticated: true,
      exploreRatio: pref?.explore_ratio ?? 0.2,
      followedTopics: pref?.followed_topics ?? [],
      affinities: affRes.rows.map((r) => ({
        dimType: r.dim_type, dimKey: r.dim_key,
        weight: Number(r.decayed_weight ?? 0), exposureCount: r.exposure_count,
      })),
    },
    seenIds: seenRes.rows.map((r) => r.content_id),
    mutedSources: pref?.muted_sources ?? [],
    mutedAuthors: pref?.muted_authors ?? [],
    mutedKeywords: pref?.muted_keywords ?? [],
    includeNewsLane: Boolean(pref?.include_news_lane),
  };
}

async function loadViewerBookmarkState(pool: Pool, actor: Actor, contentIds: readonly string[]) {
  const out = new Map<string, { bookmarked: boolean; useful: boolean }>();
  if (!isAuthenticatedUser(actor) || !contentIds.length) return out;
  const { rows } = await pool.query<{ content_id: string; bookmarked: boolean; useful: boolean }>(
    `SELECT content_id, BOOL_OR(event_type='bookmark') AS bookmarked, BOOL_OR(event_type='useful') AS useful
     FROM feed_user_event
     WHERE user_id=$1 AND content_id=ANY($2::uuid[]) AND event_type IN ('bookmark','useful')
     GROUP BY content_id`,
    [actor.userId, contentIds],
  );
  for (const r of rows) out.set(r.content_id, { bookmarked: Boolean(r.bookmarked), useful: Boolean(r.useful) });
  return out;
}

export async function readFeedStream(
  pool: Pool,
  actor: Actor,
  query: Static<typeof FeedStreamQuery>,
  excludeIds: readonly string[],
  resolveContentVisibility?: ContentVisibilityResolver,
) {
  const state = await loadUserFeedState(pool, actor);
  const mode = query.mode ?? "foryou";
  const limit = query.limit ?? 20;
  const mergedExclude = [...new Set([...state.seenIds, ...excludeIds])].slice(0, 2200);
  const publicVisibility = resolveContentVisibility?.(actor, { publicOnly: true });
  const [candidates, baselines] = await Promise.all([
    queryFeedCandidates(pool, actor, {
      lookbackHours: mode === "explore" ? 120 : 72,
      limit: Math.max(160, limit * 8),
      topic: query.topic, platform: query.platform, channelScope: query.channelScope, language: query.language,
      includeNews: query.includeNews ?? state.includeNewsLane,
      excludeContentIds: mergedExclude,
      mutedSourceIds: state.mutedSources, mutedAuthors: state.mutedAuthors, mutedKeywords: state.mutedKeywords,
      visibility: publicVisibility,
    }),
    getBaselines(pool, publicVisibility),
  ]);
  const { picks, channelMix } = mixFeedStream(candidates, baselines, state.profile, { mode, limit, seed: query.seed });
  const pickedRows = picks.map((p) => p.row);
  const [commentsMap, viewerStateMap] = await Promise.all([
    loadTopCommentsForPosts(
      pool,
      pickedRows.map((r) => ({ id: r.id, platformId: r.platformId, kind: r.kind, externalId: r.externalId })),
      2,
      publicVisibility,
    ),
    loadViewerBookmarkState(pool, actor, pickedRows.map((r) => r.id)),
  ]);
  return {
    mode,
    personalized: state.profile.authenticated,
    items: picks.map((p) => formatFeedCard(p, commentsMap.get(p.row.id) ?? [], viewerStateMap.get(p.row.id) ?? { bookmarked: false, useful: false })),
    meta: {
      candidateCount: candidates.length,
      unseenRemaining: Math.max(0, candidates.length - picks.length),
      exploreRatio: state.profile.exploreRatio,
      channelMix,
    },
  };
}

export async function readFeedHotBoard(
  pool: Pool,
  actor: Actor,
  query: Static<typeof FeedHotQuery>,
  resolveContentVisibility?: ContentVisibilityResolver,
) {
  const windowName = query.window ?? "24h";
  const hours = windowName === "6h" ? 6 : windowName === "48h" ? 48 : windowName === "7d" ? 168 : 24;
  const limit = query.limit ?? 30;
  const offset = query.offset ?? 0;
  const nowMs = Date.now();
  const publicVisibility = resolveContentVisibility?.(actor, { publicOnly: true });
  const [candidates, baselines] = await Promise.all([
    queryFeedCandidates(pool, actor, {
      lookbackHours: hours,
      limit: 300,
      topic: query.topic,
      platform: query.platform,
      channelScope: query.channelScope,
      includeNews: false,
      visibility: publicVisibility,
    }),
    getBaselines(pool, publicVisibility),
  ]);
  const ranked = candidates
    .map((row) => ({ row, ...computeUnifiedHeat(row, baselines, nowMs) }))
    .sort((a, b) => b.unifiedHeat - a.unifiedHeat || a.row.id.localeCompare(b.row.id));
  const slice = ranked.slice(offset, offset + limit);
  const [commentsMap, viewerMap, histories] = await Promise.all([
    loadTopCommentsForPosts(
      pool,
      slice.map((s) => ({ id: s.row.id, platformId: s.row.platformId, kind: s.row.kind, externalId: s.row.externalId })),
      2,
      publicVisibility,
    ),
    loadViewerBookmarkState(pool, actor, slice.map((s) => s.row.id)),
    loadFeedObservationHistory(pool, actor, slice.map((s) => s.row.id), new Date(nowMs), publicVisibility),
  ]);
  return {
    window: windowName,
    from: new Date(nowMs - hours * 3_600_000).toISOString(),
    to: new Date(nowMs).toISOString(),
    totalCount: ranked.length,
    nextOffset: offset + slice.length < ranked.length ? offset + slice.length : null,
    items: slice.map((entry, idx) => ({
      rank: offset + idx + 1,
      card: formatFeedCard({ ...entry, channel: "hot" }, commentsMap.get(entry.row.id) ?? [], viewerMap.get(entry.row.id) ?? { bookmarked: false, useful: false }),
      sparkline: histories.get(entry.row.id) ?? [],
      corroborationCount: entry.row.corroborationCount,
    })),
  };
}

function eventDelta(eventType: string, dwellMs?: number) {
  switch (eventType) {
    case "bookmark": return { weight: 0.8, pos: 1, neg: 0, exp: 0 };
    case "useful": return { weight: 0.6, pos: 1, neg: 0, exp: 0 };
    case "open": return { weight: 0.15, pos: 1, neg: 0, exp: 0 };
    case "dwell": return (dwellMs ?? 0) >= 5000 ? { weight: 0.2, pos: 1, neg: 0, exp: 0 } : { weight: 0, pos: 0, neg: 0, exp: 0 };
    case "dismiss": return { weight: -0.7, pos: 0, neg: 1, exp: 0 };
    case "mute_source":
    case "mute_topic":
    case "mute_author": return { weight: -1.5, pos: 0, neg: 1, exp: 0 };
    default: return { weight: 0, pos: 0, neg: 0, exp: 1 };
  }
}

function accumulateAffinityUpdates(
  events: Static<typeof FeedEventBatchBody>["events"],
  dimsMap: ReadonlyMap<string, ContentDimensionSummary>,
) {
  const updates = new Map<string, { dimType: string; dimKey: string; weight: number; exp: number; pos: number; neg: number }>();
  const muteSources = new Set<string>(), muteAuthors = new Set<string>(), muteTopics = new Set<string>();
  for (const ev of events) {
    const dims = dimsMap.get(ev.contentId);
    if (!dims) continue;
    if (ev.eventType === "mute_source" && dims.sourceId) muteSources.add(dims.sourceId);
    if (ev.eventType === "mute_author" && dims.authorHandle) muteAuthors.add(dims.authorHandle);
    if (ev.eventType === "mute_topic" && dims.sourceGroup) muteTopics.add(dims.sourceGroup);
    const delta = eventDelta(ev.eventType, ev.dwellMs);
    for (const [dimType, dimKey] of [
      ["topic", dims.sourceGroup], ["source", dims.sourceId], ["platform", dims.platform],
      ["author", dims.authorHandle], ["community", dims.communityName],
    ] as const) {
      if (!dimKey) continue;
      const key = `${dimType}:${dimKey}`;
      const prev = updates.get(key) ?? { dimType, dimKey, weight: 0, exp: 0, pos: 0, neg: 0 };
      prev.weight += delta.weight;
      prev.exp += delta.exp;
      prev.pos += delta.pos;
      prev.neg += delta.neg;
      updates.set(key, prev);
    }
  }
  return {
    affinities: [...updates.values()].sort((a, b) => `${a.dimType}:${a.dimKey}`.localeCompare(`${b.dimType}:${b.dimKey}`)),
    muteSources: [...muteSources],
    muteAuthors: [...muteAuthors],
    muteTopics: [...muteTopics],
  };
}

export async function recordFeedEvents(
  pool: Pool,
  actor: Actor,
  body: Static<typeof FeedEventBatchBody>,
  resolveContentVisibility?: ContentVisibilityResolver,
) {
  const uniqueContentIds = [...new Set(body.events.map((e) => e.contentId))];
  const dimsMap = await loadContentDimensionsByIds(
    pool,
    actor,
    uniqueContentIds,
    resolveContentVisibility?.(actor, { publicOnly: true }),
  );
  if (dimsMap.size !== uniqueContentIds.length) fail(404, "Content not found");
  return transaction(pool, async (client: PoolClient) => {
    await client.query(
      `INSERT INTO feed_user_seen(user_id, content_id, seen_at)
       SELECT $1, id, NOW() FROM UNNEST($2::uuid[]) AS seen(id) ORDER BY id
       ON CONFLICT (user_id, content_id) DO UPDATE SET seen_at = NOW()`,
      [actor.userId, uniqueContentIds],
    );
    const { rows: inserted } = await client.query<{
      contentId: string;
      eventType: Static<typeof FeedEventBatchBody>["events"][number]["eventType"];
      dwellMs: number | null;
    }>(
      `INSERT INTO feed_user_event(user_id, content_id, event_type, dwell_ms, meta, created_at)
       SELECT $1, (v->>'contentId')::uuid, v->>'eventType', (v->>'dwellMs')::int, COALESCE(v->'meta', '{}'::jsonb), NOW()
       FROM UNNEST($2::jsonb[]) AS input(v)
       ON CONFLICT (user_id, content_id, event_type) WHERE event_type IN ('bookmark', 'useful') DO NOTHING
       RETURNING content_id AS "contentId", event_type AS "eventType", dwell_ms AS "dwellMs"`,
      [actor.userId, body.events.map((e) => JSON.stringify(e))],
    );
    const agg = accumulateAffinityUpdates(inserted.map((event) => ({ ...event, dwellMs: event.dwellMs ?? undefined })), dimsMap);
    if (agg.affinities.length) {
      await client.query(
        `INSERT INTO feed_user_affinity(user_id, dim_type, dim_key, weight, exposure_count, positive_count, negative_count, updated_at)
         SELECT $1, v->>'dimType', v->>'dimKey', GREATEST(-2.0, LEAST(2.0, (v->>'weight')::real)),
           (v->>'exp')::int, (v->>'pos')::int, (v->>'neg')::int, NOW()
         FROM UNNEST($2::jsonb[]) AS input(v)
         ON CONFLICT (user_id, dim_type, dim_key) DO UPDATE SET
           weight = GREATEST(-2.0, LEAST(2.0,
             feed_user_affinity.weight * EXP(-EXTRACT(EPOCH FROM (NOW() - feed_user_affinity.updated_at)) * LN(2) / (14 * 86400)) + EXCLUDED.weight
           ))::real,
           exposure_count = feed_user_affinity.exposure_count + EXCLUDED.exposure_count,
           positive_count = feed_user_affinity.positive_count + EXCLUDED.positive_count,
           negative_count = feed_user_affinity.negative_count + EXCLUDED.negative_count,
           updated_at = NOW()`,
        [actor.userId, agg.affinities.map((a) => JSON.stringify(a))],
      );
    }
    if (agg.muteSources.length || agg.muteAuthors.length || agg.muteTopics.length) {
      await client.query(
        `INSERT INTO feed_user_preference(user_id, muted_sources, muted_authors, followed_topics, updated_at)
         VALUES($1, $2::uuid[], $3::text[], '{}', NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           muted_sources = ARRAY(SELECT DISTINCT x FROM UNNEST(feed_user_preference.muted_sources || $2::uuid[]) AS x),
           muted_authors = ARRAY(SELECT DISTINCT x FROM UNNEST(feed_user_preference.muted_authors || $3::text[]) AS x),
           followed_topics = ARRAY(SELECT x FROM UNNEST(feed_user_preference.followed_topics) AS x WHERE NOT (x = ANY($4::text[]))),
           updated_at = NOW()`,
        [actor.userId, agg.muteSources, agg.muteAuthors, agg.muteTopics],
      );
    }
    return { accepted: inserted.length };
  });
}

export async function getFeedPreferences(pool: Pool, actor: Actor): Promise<Static<typeof FeedPreferences>> {
  const row = (await pool.query("SELECT * FROM feed_user_preference WHERE user_id=$1", [actor.userId])).rows[0];
  return {
    exploreRatio: row?.explore_ratio ?? 0.2,
    followedTopics: row?.followed_topics ?? [],
    mutedSources: row?.muted_sources ?? [],
    mutedKeywords: row?.muted_keywords ?? [],
    mutedAuthors: row?.muted_authors ?? [],
    includeNewsLane: Boolean(row?.include_news_lane),
    updatedAt: row?.updated_at?.toISOString() ?? null,
  };
}

export async function updateFeedPreferences(
  pool: Pool, actor: Actor, patch: Static<typeof FeedPreferencesPatch>,
): Promise<Static<typeof FeedPreferences>> {
  const current = await getFeedPreferences(pool, actor);
  const next = {
    exploreRatio: patch.exploreRatio ?? current.exploreRatio,
    followedTopics: patch.followedTopics ?? current.followedTopics,
    mutedSources: patch.mutedSources ?? current.mutedSources,
    mutedKeywords: patch.mutedKeywords?.map((k) => k.trim().toLowerCase()).filter(Boolean) ?? current.mutedKeywords,
    mutedAuthors: patch.mutedAuthors?.map((a) => a.replace(/^[@u/]+/i, "").toLowerCase()).filter(Boolean) ?? current.mutedAuthors,
    includeNewsLane: patch.includeNewsLane ?? current.includeNewsLane,
  };
  const { rows } = await pool.query(
    `INSERT INTO feed_user_preference(user_id, explore_ratio, followed_topics, muted_sources, muted_keywords, muted_authors, include_news_lane, updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       explore_ratio=EXCLUDED.explore_ratio, followed_topics=EXCLUDED.followed_topics,
       muted_sources=EXCLUDED.muted_sources, muted_keywords=EXCLUDED.muted_keywords,
       muted_authors=EXCLUDED.muted_authors, include_news_lane=EXCLUDED.include_news_lane, updated_at=NOW()
     RETURNING updated_at`,
    [actor.userId, next.exploreRatio, next.followedTopics, next.mutedSources, next.mutedKeywords, next.mutedAuthors, next.includeNewsLane],
  );
  return { ...next, updatedAt: rows[0].updated_at.toISOString() };
}

export async function resetFeedProfile(pool: Pool, actor: Actor): Promise<{ reset: true }> {
  await transaction(pool, async (client) => {
    await client.query("DELETE FROM feed_user_affinity WHERE user_id=$1", [actor.userId]);
    await client.query("DELETE FROM feed_user_seen WHERE user_id=$1", [actor.userId]);
  });
  return { reset: true };
}

export async function getFeedAdminSummary(pool: Pool) {
  const [prefsRes, seenRes, affRes, eventsRes, lanesRes] = await Promise.all([
    pool.query<{ count: number }>("SELECT COUNT(*)::int AS count FROM feed_user_preference"),
    pool.query<{ total: number; stale: number; distinct_users: number }>(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE seen_at < NOW() - interval '14 days')::int AS stale,
              COUNT(DISTINCT user_id)::int AS distinct_users
       FROM feed_user_seen`,
    ),
    pool.query<{ count: number }>("SELECT COUNT(*)::int AS count FROM feed_user_affinity"),
    pool.query<{ event_type: string; cnt_7d: number; stale_cnt: number }>(
      `SELECT event_type,
              COUNT(*) FILTER (WHERE created_at >= NOW() - interval '7 days')::int AS cnt_7d,
              COUNT(*) FILTER (WHERE event_type NOT IN ('bookmark', 'useful') AND created_at < NOW() - interval '30 days')::int AS stale_cnt
       FROM feed_user_event
       GROUP BY event_type
       ORDER BY cnt_7d DESC, event_type ASC`,
    ),
    pool.query<{ feed_lane: string; cnt: number }>(
      `SELECT feed_lane, COUNT(*)::int AS cnt
       FROM collection_source
       WHERE usage_domain = 'feed' AND state = 'active'
       GROUP BY feed_lane`,
    ),
  ]);
  const eventBreakdown = eventsRes.rows.map((r) => ({
    eventType: r.event_type,
    count7d: Number(r.cnt_7d),
  }));
  const staleEvents = eventsRes.rows.reduce((sum, r) => sum + Number(r.stale_cnt), 0);
  const eventsLast7d = eventBreakdown.reduce((sum, r) => sum + r.count7d, 0);
  const activeFeedLanes: Record<string, number> = {};
  for (const r of lanesRes.rows) activeFeedLanes[r.feed_lane] = Number(r.cnt);
  return {
    preferencesUsers: Number(prefsRes.rows[0]?.count ?? 0),
    seenTotal: Number(seenRes.rows[0]?.total ?? 0),
    seenStale14d: Number(seenRes.rows[0]?.stale ?? 0),
    seenDistinctUsers: Number(seenRes.rows[0]?.distinct_users ?? 0),
    affinityRows: Number(affRes.rows[0]?.count ?? 0),
    eventsLast7d,
    staleEvents30d: staleEvents,
    eventBreakdown,
    activeFeedLanes,
  };
}

export async function pruneFeedArtifacts(pool: Pool): Promise<{ deletedSeen: number; deletedEvents: number }> {
  const seen = await pool.query("DELETE FROM feed_user_seen WHERE seen_at < NOW() - interval '14 days'");
  const events = await pool.query(
    "DELETE FROM feed_user_event WHERE event_type NOT IN ('bookmark', 'useful') AND created_at < NOW() - interval '30 days'",
  );
  return { deletedSeen: seen.rowCount ?? 0, deletedEvents: events.rowCount ?? 0 };
}
