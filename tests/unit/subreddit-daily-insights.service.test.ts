import test from "node:test";
import assert from "node:assert/strict";
import { buildSubredditDailyInsights } from "../../src/application/services/subreddit-daily-insights.service";
import type { Content } from "../../src/domain/entities/content";
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
        sampledPosts: 10,
        matchedPosts: 3,
        qualifiedMatchedPosts: 1,
        mentionRate: 0.3,
        qualifiedMentionRate: 0.1,
        matchedScoreSum: 100,
        matchedCommentSum: 40,
        keywordHeat: 0.5,
        sourceType: "live",
      },
      {
        targetId,
        day: "2026-04-11",
        keyword: "ai",
        sampledPosts: 10,
        matchedPosts: 2,
        qualifiedMatchedPosts: 1,
        mentionRate: 0.2,
        qualifiedMentionRate: 0.1,
        matchedScoreSum: 80,
        matchedCommentSum: 20,
        keywordHeat: 0.4,
        sourceType: "live",
      },
      {
        targetId,
        day: "2026-04-12",
        keyword: "ai",
        sampledPosts: 10,
        matchedPosts: 6,
        qualifiedMatchedPosts: 4,
        mentionRate: 0.6,
        qualifiedMentionRate: 0.4,
        matchedScoreSum: 220,
        matchedCommentSum: 90,
        keywordHeat: 0.9,
        sourceType: "live",
      },
    ],
    keywords: ["ai"],
    keywordLimit: 5,
  });

  const ai = model.keywordHeat.find((item) => item.keyword === "ai");
  assert.ok(ai);
  assert.equal(ai?.totalMentions, 11);
  assert.equal(ai?.latestDayMentions, 6);
  assert.equal(ai?.daily[0]?.mentions, 3);
  assert.equal(ai?.daily[2]?.mentions, 6);
});
