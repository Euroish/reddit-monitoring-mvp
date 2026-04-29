import test from "node:test";
import assert from "node:assert/strict";
import {
  isQualifiedDailyPost,
  resolveDailyQualityThreshold,
} from "../../src/domain/services/quality-threshold.service";

test("resolveDailyQualityThreshold returns tier-aware baseline thresholds", () => {
  assert.deepEqual(resolveDailyQualityThreshold({ tier: "micro", posts: [] }), {
    score: 8,
    comments: 3,
    percentileScore: 8,
    percentileComments: 3,
  });
  assert.deepEqual(resolveDailyQualityThreshold({ tier: "small", posts: [] }), {
    score: 15,
    comments: 5,
    percentileScore: 15,
    percentileComments: 5,
  });
  assert.deepEqual(resolveDailyQualityThreshold({ tier: "mid", posts: [] }), {
    score: 25,
    comments: 8,
    percentileScore: 25,
    percentileComments: 8,
  });
  assert.deepEqual(resolveDailyQualityThreshold({ tier: "large", posts: [] }), {
    score: 30,
    comments: 10,
    percentileScore: 30,
    percentileComments: 10,
  });
});

test("isQualifiedDailyPost allows balanced, score-led, and discussion-led quality posts", () => {
  assert.equal(
    isQualifiedDailyPost({
      score: 30,
      comments: 10,
      threshold: { score: 30, comments: 10 },
    }),
    true,
  );
  assert.equal(
    isQualifiedDailyPost({
      score: 65,
      comments: 5,
      threshold: { score: 30, comments: 10 },
    }),
    true,
  );
  assert.equal(
    isQualifiedDailyPost({
      score: 12,
      comments: 45,
      threshold: { score: 30, comments: 10 },
    }),
    true,
  );
  assert.equal(
    isQualifiedDailyPost({
      score: 18,
      comments: 4,
      threshold: { score: 30, comments: 10 },
    }),
    false,
  );
});
