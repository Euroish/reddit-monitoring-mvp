import assert from "node:assert/strict";
import test from "node:test";
import { buildSubredditDriverPostReadModel } from "../../src/application/services/subreddit-driver-post-read-model.service";

const targetId = "11111111-1111-1111-1111-111111111111";

test("buildSubredditDriverPostReadModel adds labels and matched queries", () => {
  const model = buildSubredditDriverPostReadModel({
    facts: [
      {
        targetId,
        contentId: "content-a",
        ageBucket: "1h",
        observedAt: "2026-04-18T10:00:00.000Z",
        ageMinutes: 45,
        score: 220,
        comments: 40,
        scoreVelocityPerHour: 293.333333,
        commentVelocityPerHour: 53.333333,
        cohortPostCount: 12,
        cohortMedianScoreVelocity: 110,
        cohortMedianCommentVelocity: 18,
        velocityZScore: 2.7,
        driverScore: 94,
        algorithmVersion: "post_growth_v1",
        explainPayload: {
          normalized: {
            velocityZScore: 2.7,
          },
        },
      },
    ],
    contents: [
      {
        id: "content-a",
        source: "reddit",
        targetId,
        externalId: "t3_a",
        kind: "post",
        title: "AI agent launch",
        bodyText: "Fresh launch details",
        permalink: "/r/test/comments/a",
        createdAtSource: "2026-04-18T09:15:00.000Z",
        firstSeenAt: "2026-04-18T09:15:00.000Z",
        lastSeenAt: "2026-04-18T10:00:00.000Z",
      },
    ],
    matchedQueriesByContentId: new Map([["content-a", ["ai", "agent"]]]),
  });

  assert.equal(model.length, 1);
  assert.deepEqual(model[0]?.labels, ["breakout", "fresh"]);
  assert.deepEqual(model[0]?.matchedQueries, ["ai", "agent"]);
});
