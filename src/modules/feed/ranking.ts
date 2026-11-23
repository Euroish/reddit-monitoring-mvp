import type { ContentPlatform } from "../../../packages/contracts/src/common";
import type { FeedCardDto, FeedModeValue } from "../../../packages/contracts/src/feed";
import type {
  FeedCandidateRow,
  PlatformEngagementBaseline,
  TopCommentPreview,
} from "../content/index";

export type PoolChannel = "affinity" | "hot" | "explore" | "rising" | "following";

export interface AffinityRecord {
  dimType: "topic" | "source" | "platform" | "author" | "community";
  dimKey: string;
  weight: number;
  exposureCount: number;
}

export interface UserFeedProfile {
  authenticated: boolean;
  exploreRatio: number;
  followedTopics: string[];
  affinities: AffinityRecord[];
}

export interface ScoredCandidate {
  row: FeedCandidateRow;
  unifiedHeat: number;
  heatVelocity: "surging" | "rising" | "steady";
  qualityScore: number;
  affinityScore: number;
  ucbBonus: number;
  ageHours: number;
}

function hashSeed(seed: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822519);
    h = Math.imul(h ^ (h >>> 13), 3266489917);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function hostFromUrl(raw: string): string | null {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

export function computeUnifiedHeat(
  row: Pick<
    FeedCandidateRow,
    "platform" | "engagementScore" | "discussionRatio" | "velocityScore" | "sourceTier" | "corroborationCount" | "publishedAt" | "firstFetchedAt"
  >,
  baselines: ReadonlyMap<ContentPlatform, PlatformEngagementBaseline>,
  nowMs = Date.now(),
): { unifiedHeat: number; heatVelocity: "surging" | "rising" | "steady"; qualityScore: number; ageHours: number } {
  const publishedMs = Date.parse(row.publishedAt ?? row.firstFetchedAt);
  const ageHours = Math.max(0.25, (nowMs - (Number.isFinite(publishedMs) ? publishedMs : nowMs)) / 3_600_000);
  const baseline = baselines.get(row.platform);
  const scale = baseline && baseline.p90 > 0.5 ? baseline.p90 * 1.15 : 8;
  const normEng = clamp(row.engagementScore / scale, 0, 1);
  const discussionBonus = clamp(row.discussionRatio * 14, 0, 18);
  const velocityBonus = clamp(Math.log1p(row.velocityScore) * 4.5, 0, 14);
  const tierBonus = row.sourceTier === "T1" ? 8 : row.sourceTier === "T1_5" ? 5 : 2;
  const corrobBonus = clamp((row.corroborationCount - 1) * 4, 0, 10);
  const rawScore = normEng * 58 + discussionBonus + velocityBonus + tierBonus + corrobBonus;
  const decay = 0.5 ** (ageHours / 36);
  const unifiedHeat = Number(clamp(rawScore * (0.45 + 0.55 * decay), 0, 100).toFixed(1));
  const heatVelocity: "surging" | "rising" | "steady" =
    row.velocityScore >= 2.0 ? "surging" : row.velocityScore >= 0.45 ? "rising" : "steady";
  return { unifiedHeat, heatVelocity, qualityScore: rawScore, ageHours };
}

function lookupAffinityAndUcb(row: FeedCandidateRow, profile: UserFeedProfile) {
  const map = new Map<string, AffinityRecord>();
  let totalExp = 0;
  for (const rec of profile.affinities) {
    map.set(`${rec.dimType}:${rec.dimKey}`, rec);
    if (rec.dimType === "topic" || rec.dimType === "community") totalExp += rec.exposureCount;
  }
  const dims: Array<[AffinityRecord["dimType"], string | null]> = [
    ["topic", row.sourceGroup],
    ["source", row.sourceId],
    ["platform", row.platform],
    ["author", row.author?.handle ?? null],
    ["community", row.communityName],
  ];
  let affinity = 0;
  let topicExp = 0;
  for (const [t, k] of dims) {
    if (!k) continue;
    const hit = map.get(`${t}:${k}`);
    if (hit) affinity += hit.weight;
    if ((t === "topic" || t === "community") && hit) topicExp += hit.exposureCount;
  }
  if (row.sourceGroup && profile.followedTopics.includes(row.sourceGroup)) affinity += 0.6;
  const affinityScore = clamp(affinity, -1.5, 2.0);
  const ucbBonus = Math.sqrt(Math.log(totalExp + 2) / (topicExp + 1));
  return { affinityScore, ucbBonus, topicExp };
}

function plackettLuceSample<T>(
  items: readonly T[],
  scoreFn: (item: T) => number,
  take: number,
  tau: number,
  rng: () => number,
): T[] {
  const pool = items.slice(0, Math.max(take * 2, take));
  const out: T[] = [];
  while (pool.length && out.length < take) {
    let maxLogit = -Infinity;
    for (const item of pool) maxLogit = Math.max(maxLogit, scoreFn(item) / tau);
    const weights = pool.map((item) => Math.exp(clamp(scoreFn(item) / tau - maxLogit, -20, 0)));
    const sum = weights.reduce((a, b) => a + b, 0) || 1;
    let draw = rng() * sum;
    let pick = pool.length - 1;
    for (let i = 0; i < weights.length; i++) {
      draw -= weights[i];
      if (draw <= 0) {
        pick = i;
        break;
      }
    }
    out.push(pool[pick]);
    pool.splice(pick, 1);
  }
  return out;
}

function canPlaceCard(
  selected: readonly { row: FeedCandidateRow }[],
  row: FeedCandidateRow,
): boolean {
  const author = row.author?.handle ?? null;
  const topic = row.communityName ?? row.sourceGroup ?? row.platform;
  const win10 = selected.slice(-10);
  if (author && win10.some((c) => c.row.author?.handle === author)) return false;
  const win5 = selected.slice(-5);
  if (win5.some((c) => c.row.sourceId === row.sourceId)) return false;
  const win6 = selected.slice(-6);
  let topicCount = 0;
  for (const c of win6) {
    if ((c.row.communityName ?? c.row.sourceGroup ?? c.row.platform) === topic) topicCount++;
  }
  if (topicCount >= 2) return false;
  const win3 = selected.slice(-3);
  if (win3.length === 3 && win3.every((c) => c.row.platform === row.platform)) return false;
  return true;
}

export function diversifyFeedCards<T extends { row: FeedCandidateRow }>(
  ordered: readonly T[],
  limit: number,
): T[] {
  const remaining = [...ordered];
  const selected: T[] = [];
  while (remaining.length && selected.length < limit) {
    const idx = remaining.findIndex((item) => canPlaceCard(selected, item.row));
    const chosenIdx = idx >= 0 ? idx : 0;
    selected.push(remaining[chosenIdx]);
    remaining.splice(chosenIdx, 1);
  }
  return selected;
}

function reasonLabel(channel: PoolChannel, row: FeedCandidateRow): string {
  const community = row.communityName ? `r/${row.communityName}` : row.sourceGroup ?? row.sourceLabel;
  const comments = row.metricComments ?? 0;
  if (channel === "hot") return comments >= 10 ? `高热讨论 · ${community} (${comments} 条讨论)` : `全网高热度 · ${community}`;
  if (channel === "rising") return `近小时迅速升温 · ${community}`;
  if (channel === "explore") return `破茧高质探索 · ${community}`;
  if (channel === "following") return `来自关注偏好 · ${community}`;
  return `兴趣与高价值综合 · ${community}`;
}

function allocatePoolQuotas(mode: FeedModeValue, profile: UserFeedProfile, limit: number): Array<[PoolChannel, number]> {
  if (mode === "hot") return [["hot", limit]];
  if (mode === "explore") return [["explore", Math.ceil(limit * 0.75)], ["rising", Math.floor(limit * 0.25)]];
  if (mode === "following") return [["affinity", limit]];
  if (!profile.authenticated) {
    const hot = Math.round(limit * 0.55);
    const rising = Math.round(limit * 0.25);
    return [["hot", hot], ["rising", rising], ["explore", Math.max(0, limit - hot - rising)]];
  }
  const exploreShare = clamp(profile.exploreRatio, 0.05, 0.5);
  const affinityShare = clamp(0.65 - exploreShare, 0.15, 0.6);
  const aff = Math.round(limit * affinityShare);
  const exp = Math.round(limit * exploreShare);
  const rising = Math.max(1, Math.round(limit * 0.1));
  const hot = Math.max(0, limit - aff - exp - rising);
  return [["affinity", aff], ["hot", hot], ["explore", exp], ["rising", rising]];
}

export function mixFeedStream(
  candidates: readonly FeedCandidateRow[],
  baselines: ReadonlyMap<ContentPlatform, PlatformEngagementBaseline>,
  profile: UserFeedProfile,
  options: { mode: FeedModeValue; limit: number; seed?: string; nowMs?: number },
): {
  picks: Array<ScoredCandidate & { channel: PoolChannel }>;
  channelMix: Record<string, number>;
} {
  const rng = options.seed ? hashSeed(options.seed) : Math.random;
  const nowMs = options.nowMs ?? Date.now();
  const scored: ScoredCandidate[] = candidates.map((row) => {
    const heat = computeUnifiedHeat(row, baselines, nowMs);
    const aff = lookupAffinityAndUcb(row, profile);
    return { row, ...heat, affinityScore: aff.affinityScore, ucbBonus: aff.ucbBonus };
  });

  const sortedQuality = [...scored].sort((a, b) => b.qualityScore - a.qualityScore);
  const p75Threshold = sortedQuality[Math.floor(sortedQuality.length * 0.35)]?.qualityScore ?? 0;
  const exploreCandidates = scored
    .filter((c) => c.qualityScore >= p75Threshold)
    .sort((a, b) => (b.ucbBonus * 25 + b.unifiedHeat) - (a.ucbBonus * 25 + a.unifiedHeat));
  const hotCandidates = [...scored].sort((a, b) => b.unifiedHeat - a.unifiedHeat);
  const risingCandidates = [...scored]
    .filter((c) => c.ageHours <= 12)
    .sort((a, b) => (b.row.velocityScore * 15 + b.unifiedHeat) - (a.row.velocityScore * 15 + a.unifiedHeat));
  const affCandidates = [...scored].sort(
    (a, b) => (b.unifiedHeat * 0.65 + b.affinityScore * 18) - (a.unifiedHeat * 0.65 + a.affinityScore * 18),
  );

  const pools: Record<PoolChannel, { list: ScoredCandidate[]; score: (c: ScoredCandidate) => number }> = {
    affinity: { list: affCandidates, score: (c) => c.unifiedHeat * 0.65 + c.affinityScore * 18 },
    following: { list: affCandidates.filter((c) => c.affinityScore > 0.1), score: (c) => c.affinityScore * 20 + c.unifiedHeat * 0.5 },
    hot: { list: hotCandidates, score: (c) => c.unifiedHeat },
    explore: { list: exploreCandidates, score: (c) => c.ucbBonus * 25 + c.unifiedHeat },
    rising: { list: risingCandidates.length ? risingCandidates : hotCandidates, score: (c) => c.row.velocityScore * 15 + c.unifiedHeat },
  };

  const pickedIds = new Set<string>();
  const combined: Array<ScoredCandidate & { channel: PoolChannel }> = [];
  const quotas = allocatePoolQuotas(options.mode, profile, options.limit);
  for (const [channel, quota] of quotas) {
    if (quota <= 0) continue;
    const pool = pools[channel];
    const avail = pool.list.filter((c) => !pickedIds.has(c.row.id));
    const sampled = plackettLuceSample(avail, pool.score, quota, 12, rng);
    for (const item of sampled) {
      pickedIds.add(item.row.id);
      combined.push({ ...item, channel });
    }
  }
  for (const fallback of hotCandidates) {
    if (combined.length >= options.limit) break;
    if (!pickedIds.has(fallback.row.id)) {
      pickedIds.add(fallback.row.id);
      combined.push({ ...fallback, channel: "hot" });
    }
  }
  const diversified = diversifyFeedCards(combined, options.limit);
  const channelMix: Record<string, number> = {};
  for (const item of diversified) channelMix[item.channel] = (channelMix[item.channel] ?? 0) + 1;
  return { picks: diversified, channelMix };
}

export function formatFeedCard(
  scored: Pick<ScoredCandidate, "row" | "unifiedHeat" | "heatVelocity"> & { channel: PoolChannel },
  comments: readonly TopCommentPreview[],
  viewerState: { bookmarked: boolean; useful: boolean },
): FeedCardDto {
  const { row } = scored;
  return {
    id: row.id,
    platform: row.platform,
    cardLayout: row.cardLayout,
    headline: row.title ?? row.cleanExcerpt?.slice(0, 110) ?? `${row.sourceLabel} Discussion`,
    tldr: row.cleanExcerpt,
    url: row.url,
    media: row.media.map((m) => ({ ...m, domain: hostFromUrl(m.url) })),
    discussion: {
      score: row.metricScore,
      comments: row.metricComments,
      views: row.metricViews,
      likes: row.metricLikes,
      reposts: row.metricReposts,
      upvoteRatio: row.upvoteRatio,
      unifiedHeat: scored.unifiedHeat,
      heatVelocity: scored.heatVelocity,
    },
    author: row.author,
    source: {
      id: row.sourceId,
      label: row.sourceLabel,
      community: row.communityName,
      flair: row.flair,
      lane: row.sourceLane,
    },
    topCommentsPreview: [...comments],
    tags: row.hashtags,
    intentTag: row.intentTag,
    publishedAt: row.publishedAt,
    reason: { channel: scored.channel, label: reasonLabel(scored.channel, row) },
    viewerState,
  };
}
