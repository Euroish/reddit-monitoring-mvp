import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { ContentPlatform } from "../../packages/contracts/src/common";
import type { FeedCandidateRow, PlatformEngagementBaseline } from "../../src/modules/content/index";
import { computeUnifiedHeat, mixFeedStream } from "../../src/modules/feed/index";

const nowMs = Date.parse("2026-11-22T12:00:00.000Z");

function candidate(i: number, overrides: Partial<FeedCandidateRow> = {}): FeedCandidateRow {
  return {
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    platformId: randomUUID(),
    platform: "reddit",
    kind: "post",
    externalId: `t3_${i}`,
    title: `High signal discussion ${i}`,
    cleanExcerpt: `Concise summary ${i}`,
    url: `https://reddit.com/r/test/comments/${i}`,
    language: "en",
    publishedAt: new Date(nowMs - (i % 8) * 3_600_000).toISOString(),
    firstFetchedAt: new Date(nowMs - 3_600_000).toISOString(),
    sourceId: `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    sourceLabel: `Source ${i}`,
    sourceTier: "T1",
    sourceGroup: "dev-infra",
    sourceLane: "discussion",
    communityName: `sub_${i}`,
    flair: null,
    cardLayout: "discussion_thread",
    intentTag: "discussion",
    hashtags: [],
    hasMedia: false,
    primaryMediaUrl: null,
    externalDomain: null,
    media: [],
    author: { handle: `user_${i}`, displayName: null, avatarUrl: null, verified: false, followersCount: 1000 },
    metricScore: 100 + i,
    metricComments: 30,
    metricViews: null,
    metricLikes: null,
    metricReposts: null,
    upvoteRatio: 0.92,
    engagementScore: 10,
    discussionRatio: 0.3,
    velocityScore: 1.2,
    corroborationCount: 1,
    ...overrides,
  };
}

const baselines = new Map<ContentPlatform, PlatformEngagementBaseline>([
  ["reddit", { platform: "reddit", p50: 4, p75: 7, p90: 10, max: 14 }],
  ["x", { platform: "x", p50: 5, p75: 8, p90: 12, max: 16 }],
  ["web", { platform: "web", p50: 1, p75: 2, p90: 4, max: 6 }],
]);

test("mixFeedStream prevents filter-bubble lock-in and enforces window diversity across 4 pools", () => {
  const aiItems = Array.from({ length: 12 }, (_, i) =>
    candidate(i + 1, { sourceGroup: "ai-firsthand", sourceId: "22222222-2222-4222-8222-222222222222", communityName: "localllama", author: { handle: "same_ai_kol", displayName: null, avatarUrl: null, verified: true, followersCount: 50000 } }),
  );
  const diverseHot = Array.from({ length: 10 }, (_, i) =>
    candidate(100 + i, {
      platform: i % 2 === 0 ? "x" : "reddit",
      sourceGroup: i % 2 === 0 ? "dev-infra" : "social-trends",
      engagementScore: 12.5,
      velocityScore: 3.5,
    }),
  );
  const all = [...aiItems, ...diverseHot];

  const { picks, channelMix } = mixFeedStream(
    all,
    baselines,
    {
      authenticated: true,
      exploreRatio: 0.2,
      followedTopics: ["ai-firsthand"],
      affinities: [
        { dimType: "topic", dimKey: "ai-firsthand", weight: 2.0, exposureCount: 50 },
        { dimType: "author", dimKey: "same_ai_kol", weight: 2.0, exposureCount: 50 },
      ],
    },
    { mode: "foryou", limit: 15, seed: "swipe-1", nowMs },
  );

  assert.equal(picks.length, 15);
  assert.ok((channelMix.explore ?? 0) >= 1, "Explore pool must remain represented despite high AI affinity");
  assert.ok((channelMix.hot ?? 0) >= 1, "Global hot pool must break echo chamber");

  // Author same_ai_kol should never appear consecutively or dominate a 10-card window when other candidates exist.
  const firstTenAuthors = picks.slice(0, 10).filter((p) => p.row.author?.handle === "same_ai_kol");
  assert.ok(firstTenAuthors.length <= 2, `Expected anti-author repetition cap, got ${firstTenAuthors.length}`);

  const anon = mixFeedStream(
    all,
    baselines,
    { authenticated: false, exploreRatio: 0.2, followedTopics: [], affinities: [] },
    { mode: "foryou", limit: 12, seed: "anon-1", nowMs },
  );
  assert.equal(anon.picks.length, 12);
  assert.equal(anon.channelMix.affinity ?? 0, 0);
  assert.ok((anon.channelMix.hot ?? 0) >= 5);
});

test("computeUnifiedHeat normalizes across platforms and rewards velocity & discussion ratio", () => {
  const highDiscReddit = computeUnifiedHeat(candidate(1, { platform: "reddit", engagementScore: 10, discussionRatio: 0.9, velocityScore: 4 }), baselines, nowMs);
  const passiveWeb = computeUnifiedHeat(candidate(2, { platform: "web", engagementScore: 1, discussionRatio: 0, velocityScore: 0, sourceTier: "T2" }), baselines, nowMs);
  assert.ok(highDiscReddit.unifiedHeat > passiveWeb.unifiedHeat + 20);
  assert.equal(highDiscReddit.heatVelocity, "surging");
});
