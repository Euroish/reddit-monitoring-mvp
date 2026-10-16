import assert from "node:assert/strict";
import test from "node:test";
import { buildSubredditDriverPostReadModel } from "../../src/application/services/subreddit-driver-post-read-model.service";
import type { PostGrowthFact } from "../../src/domain/entities/post-growth-fact";

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
        algorithmVersion: "post_growth_v2_observation_delta",
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

test("Historical cumulative score/age facts never appear as measured driver growth", () => {
  const historical: PostGrowthFact = { targetId, contentId: "legacy", ageBucket: "1h", observedAt: "2026-10-12T01:00:00Z", ageMinutes: 10, score: 100, comments: 20, scoreVelocityPerHour: 600, commentVelocityPerHour: 120, cohortPostCount: 1, cohortMedianScoreVelocity: 600, cohortMedianCommentVelocity: 120, velocityZScore: 0, driverScore: 50, algorithmVersion: "post_growth_v1", explainPayload: {} };
  const contents = [{ id: "legacy", source: "reddit" as const, targetId, externalId: "t3_legacy", kind: "post" as const, title: "Historical fixture", permalink: "/r/demo/legacy", createdAtSource: "2026-10-12T00:50:00Z", firstSeenAt: "2026-10-12T00:50:00Z", lastSeenAt: "2026-10-12T01:00:00Z" }];
  assert.deepEqual(buildSubredditDriverPostReadModel({ facts: [historical], contents }), []);
});
