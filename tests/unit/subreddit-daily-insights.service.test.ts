import test from "node:test";
import assert from "node:assert/strict";
import { buildSubredditDailyInsights } from "../../src/application/services/subreddit-daily-insights.service";
import type { Content } from "../../src/domain/entities/content";
import type { SubredditDailyFact } from "../../src/domain/entities/subreddit-daily-fact";
import type { SubredditTrendPoint } from "../../src/domain/entities/subreddit-trend-point";

const targetId = "11111111-1111-1111-1111-111111111111";

function point(args: {
  windowStart: string;
  windowEnd: string;
  newPosts: number;
  commentSum?: number;
}): SubredditTrendPoint {
  return {
    targetId,
    windowStart: args.windowStart,
    windowEnd: args.windowEnd,
    newPosts: args.newPosts,
    commentSum: args.commentSum ?? 0,
    deltaNewPostsVsPrevWindow: 0,
    deltaActiveUsersVsPrevWindow: 0,
    trendScore: 0,
  };
}

function post(args: {
  id: string;
  title: string;
  bodyText?: string;
  createdAtSource: string;
}): Content {
  return {
    id: args.id,
    source: "reddit",
    targetId,
    externalId: args.id,
    kind: "post",
    title: args.title,
    bodyText: args.bodyText,
    permalink: `/r/test/comments/${args.id}`,
    createdAtSource: args.createdAtSource,
    firstSeenAt: args.createdAtSource,
    lastSeenAt: args.createdAtSource,
  };
}

function dailyFact(args: {
  day: string;
  postVolume: number;
  qualifiedPostVolume: number;
  commentSum: number;
  heatPrice: number;
  heatChangePct: number;
  ema7: number;
  ema30: number;
}): SubredditDailyFact {
  return {
    targetId,
    day: args.day,
    postVolume: args.postVolume,
    qualifiedPostVolume: args.qualifiedPostVolume,
    sampledPostVolume: args.postVolume,
    scoreSum: args.postVolume * 10,
    commentSum: args.commentSum,
    subscriberCount: 12_000,
    activeUserCount: 500,
    activePostRatio: 1,
    dispersionScore: 0.5,
    impactScoreSum: 10,
    impactPostVolume: args.qualifiedPostVolume,
    topImpactShare: 0.5,
    heatPrice: args.heatPrice,
    heatChangePct: args.heatChangePct,
    ema7: args.ema7,
    ema30: args.ema30,
    subredditTier: "small",
    qualityThresholdScore: 10,
    qualityThresholdComments: 5,
    algorithmVersion: "daily_fact_v1",
    explainPayload: {
      qualifiedShare: 0.5,
    },
  };
}

test("buildSubredditDailyInsights aggregates daily posts and discussion", () => {
  const model = buildSubredditDailyInsights({
    fromIso: "2026-04-10T00:00:00.000Z",
    toIso: "2026-04-12T23:59:59.000Z",
    points: [
      point({
        windowStart: "2026-04-10T10:00:00.000Z",
        windowEnd: "2026-04-10T10:15:00.000Z",
        newPosts: 10,
        commentSum: 20,
      }),
      point({
        windowStart: "2026-04-11T10:00:00.000Z",
        windowEnd: "2026-04-11T10:15:00.000Z",
        newPosts: 12,
        commentSum: 21,
      }),
      point({
        windowStart: "2026-04-12T10:00:00.000Z",
        windowEnd: "2026-04-12T10:15:00.000Z",
        newPosts: 60,
        commentSum: 120,
      }),
    ],
    posts: [],
  });

  assert.equal(model.dayCount, 3);
  assert.equal(model.daily[0]?.totalNewPosts, 10);
  assert.equal(model.daily[1]?.postChangePct, 0.2);
  assert.equal(model.daily[2]?.totalDiscussion, 120);
  assert.equal(model.daily[2]?.isPostSpike, true);
});

test("buildSubredditDailyInsights computes keyword heat from post text", () => {
  const model = buildSubredditDailyInsights({
    fromIso: "2026-04-10T00:00:00.000Z",
    toIso: "2026-04-12T23:59:59.000Z",
    points: [],
    posts: [
      post({
        id: "a",
        title: "AI agents for coding",
        bodyText: "ai workflow with llm",
        createdAtSource: "2026-04-10T11:00:00.000Z",
      }),
      post({
        id: "b",
        title: "LLM deployment tips",
        bodyText: "agent ops and ai stack",
        createdAtSource: "2026-04-11T11:00:00.000Z",
      }),
      post({
        id: "c",
        title: "AI benchmark update",
        bodyText: "ai ai and model eval",
        createdAtSource: "2026-04-12T11:00:00.000Z",
      }),
    ],
    keywords: ["ai", "llm"],
    keywordLimit: 5,
  });

  const ai = model.keywordHeat.find((item) => item.keyword === "ai");
  const llm = model.keywordHeat.find((item) => item.keyword === "llm");
  assert.ok(ai);
  assert.ok(llm);
  assert.equal(ai?.totalMentions, 3);
  assert.equal(llm?.totalMentions, 2);
  assert.equal(ai?.daily.length, 3);
});

test("buildSubredditDailyInsights can read keyword heat from materialized daily rows", () => {
  const model = buildSubredditDailyInsights({
    fromIso: "2026-04-10T00:00:00.000Z",
    toIso: "2026-04-12T23:59:59.000Z",
    points: [],
    keywordDailyRows: [
      {
        targetId,
        day: "2026-04-10",
        keyword: "ai",
        track: "auto_keyword",
        normalizedQueryText: "ai",
        queryScope: "subreddit",
        sampledPosts: 10,
        matchedPosts: 3,
        qualifiedMatchedPosts: 1,
        mentionRate: 0.3,
        qualifiedMentionRate: 0.1,
        matchedScoreSum: 100,
        matchedCommentSum: 40,
        keywordHeat: 0.5,
        algorithmVersion: "keyword_trend_v2_dual_track",
        explainPayload: {},
        sourceType: "live",
      },
      {
        targetId,
        day: "2026-04-11",
        keyword: "ai",
        track: "auto_keyword",
        normalizedQueryText: "ai",
        queryScope: "subreddit",
        sampledPosts: 10,
        matchedPosts: 2,
        qualifiedMatchedPosts: 1,
        mentionRate: 0.2,
        qualifiedMentionRate: 0.1,
        matchedScoreSum: 80,
        matchedCommentSum: 20,
        keywordHeat: 0.4,
        algorithmVersion: "keyword_trend_v2_dual_track",
        explainPayload: {},
        sourceType: "live",
      },
      {
        targetId,
        day: "2026-04-12",
        keyword: "ai",
        track: "auto_keyword",
        normalizedQueryText: "ai",
        queryScope: "subreddit",
        sampledPosts: 10,
        matchedPosts: 6,
        qualifiedMatchedPosts: 4,
        mentionRate: 0.6,
        qualifiedMentionRate: 0.4,
        matchedScoreSum: 220,
        matchedCommentSum: 90,
        keywordHeat: 0.9,
        algorithmVersion: "keyword_trend_v2_dual_track",
        explainPayload: {},
        sourceType: "live",
      },
    ],
    keywords: ["ai"],
    keywordLimit: 5,
  });

  const ai = model.keywordHeat.find((item) => item.keyword === "ai");
  assert.ok(ai);
  assert.equal(ai?.totalMentions, 11);
  assert.equal(ai?.track, "auto_keyword");
  assert.equal(ai?.source, "materialized_keyword_trend_daily");
  assert.equal(ai?.latestDayMentions, 6);
  assert.equal(ai?.daily[0]?.mentions, 3);
  assert.equal(ai?.daily[2]?.mentions, 6);
});

test("buildSubredditDailyInsights prefers daily fact fields when available", () => {
  const model = buildSubredditDailyInsights({
    fromIso: "2026-04-10T00:00:00.000Z",
    toIso: "2026-04-12T23:59:59.000Z",
    dailyFacts: [
      dailyFact({
        day: "2026-04-10",
        postVolume: 10,
        qualifiedPostVolume: 2,
        commentSum: 20,
        heatPrice: 30,
        heatChangePct: 0,
        ema7: 30,
        ema30: 30,
      }),
      dailyFact({
        day: "2026-04-11",
        postVolume: 12,
        qualifiedPostVolume: 3,
        commentSum: 24,
        heatPrice: 40,
        heatChangePct: 0.333333,
        ema7: 32.5,
        ema30: 30.645161,
      }),
      dailyFact({
        day: "2026-04-12",
        postVolume: 20,
        qualifiedPostVolume: 5,
        commentSum: 44,
        heatPrice: 55,
        heatChangePct: 0.375,
        ema7: 38.125,
        ema30: 32.217482,
      }),
    ],
    posts: [],
  });

  assert.equal(model.daily[2]?.postVolume, 20);
  assert.equal(model.daily[2]?.qualifiedPostVolume, 5);
  assert.equal(model.daily[2]?.heatPrice, 55);
  assert.equal(model.daily[2]?.ema7, 38.125);
  assert.equal(model.daily[2]?.subredditTier, "small");
  assert.equal(model.daily[2]?.algorithmVersion, "daily_fact_v1");
});

test("buildSubredditDailyInsights preserves larger observed totals from trend windows", () => {
  const model = buildSubredditDailyInsights({
    fromIso: "2026-04-10T00:00:00.000Z",
    toIso: "2026-04-12T23:59:59.000Z",
    points: [
      point({
        windowStart: "2026-04-10T10:00:00.000Z",
        windowEnd: "2026-04-10T16:00:00.000Z",
        newPosts: 80,
        commentSum: 20,
      }),
      point({
        windowStart: "2026-04-11T10:00:00.000Z",
        windowEnd: "2026-04-11T16:00:00.000Z",
        newPosts: 160,
        commentSum: 24,
      }),
      point({
        windowStart: "2026-04-12T10:00:00.000Z",
        windowEnd: "2026-04-12T16:00:00.000Z",
        newPosts: 640,
        commentSum: 44,
      }),
    ],
    dailyFacts: [
      dailyFact({
        day: "2026-04-10",
        postVolume: 10,
        qualifiedPostVolume: 2,
        commentSum: 20,
        heatPrice: 30,
        heatChangePct: 0,
        ema7: 30,
        ema30: 30,
      }),
      dailyFact({
        day: "2026-04-11",
        postVolume: 12,
        qualifiedPostVolume: 3,
        commentSum: 24,
        heatPrice: 40,
        heatChangePct: 0.333333,
        ema7: 32.5,
        ema30: 30.645161,
      }),
      dailyFact({
        day: "2026-04-12",
        postVolume: 20,
        qualifiedPostVolume: 5,
        commentSum: 44,
        heatPrice: 55,
        heatChangePct: 0.375,
        ema7: 38.125,
        ema30: 32.217482,
      }),
    ],
    posts: [],
  });

  assert.equal(model.daily[0]?.totalNewPosts, 80);
  assert.equal(model.daily[1]?.totalNewPosts, 160);
  assert.equal(model.daily[2]?.totalNewPosts, 640);
  assert.equal(model.daily[2]?.postVolume, 640);
  assert.equal(model.daily[2]?.qualifiedPostVolume, 5);
  assert.equal(model.daily[2]?.isPostSpike, true);
});

test("buildSubredditDailyInsights prefers captured listing totals over daily fact volume", () => {
  const model = buildSubredditDailyInsights({
    fromIso: "2026-04-10T00:00:00.000Z",
    toIso: "2026-04-10T23:59:59.000Z",
    points: [
      point({
        windowStart: "2026-04-10T10:00:00.000Z",
        windowEnd: "2026-04-10T16:00:00.000Z",
        newPosts: 2000,
        commentSum: 20,
      }),
    ],
    dailyFacts: [
      dailyFact({
        day: "2026-04-10",
        postVolume: 240,
        qualifiedPostVolume: 25,
        commentSum: 20,
        heatPrice: 30,
        heatChangePct: 0,
        ema7: 30,
        ema30: 30,
      }),
    ],
    posts: [],
  });

  assert.equal(model.daily[0]?.totalNewPosts, 2000);
  assert.equal(model.daily[0]?.postVolume, 2000);
  assert.equal(model.daily[0]?.qualifiedPostVolume, 25);
});

test("buildSubredditDailyInsights builds confidence-weighted relative activity indexes", () => {
  const model = buildSubredditDailyInsights({
    fromIso: "2026-04-10T00:00:00.000Z",
    toIso: "2026-04-12T23:59:59.000Z",
    dailyFacts: [
      dailyFact({
        day: "2026-04-10",
        postVolume: 60,
        qualifiedPostVolume: 12,
        commentSum: 120,
        heatPrice: 60,
        heatChangePct: 0,
        ema7: 60,
        ema30: 60,
      }),
      dailyFact({
        day: "2026-04-11",
        postVolume: 4,
        qualifiedPostVolume: 1,
        commentSum: 8,
        heatPrice: 20,
        heatChangePct: -0.666667,
        ema7: 50,
        ema30: 57.419355,
      }),
      dailyFact({
        day: "2026-04-12",
        postVolume: 5,
        qualifiedPostVolume: 1,
        commentSum: 10,
        heatPrice: 21,
        heatChangePct: 0.05,
        ema7: 42.75,
        ema30: 55.069813,
      }),
    ].map((fact) => ({ ...fact, subredditTier: "large" as const })),
    posts: [],
  });

  assert.equal(model.daily[0]?.activityConfidence, 1);
  assert.equal(model.daily[1]?.activityConfidence, 0.632456);
  assert.equal(model.daily[0]?.activityIndex, 300);
  assert.equal(model.daily[1]?.activityIndex > 35, true);
  assert.equal(model.daily[1]?.activityIndex < 100, true);
  assert.equal(model.daily[1]?.explainPayload?.observedPostBaseline, 5);
});
