import test from "node:test";
import assert from "node:assert/strict";
import { scoreTrendWindows } from "../../src/domain/services/trend-scoring.service";

function buildWindow(
  minuteOffset: number,
  values: { newPosts: number; activeUsers: number; subscribers: number; scoreSum?: number; commentSum?: number },
) {
  const start = new Date(Date.UTC(2026, 3, 11, 0, minuteOffset));
  const end = new Date(start.getTime() + 15 * 60 * 1000);
  return {
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
    granularity: "15m" as const,
    newPosts: values.newPosts,
    activeUsers: values.activeUsers,
    subscribers: values.subscribers,
    scoreSum: values.scoreSum ?? values.newPosts * 10,
    commentSum: values.commentSum ?? values.newPosts * 3,
    highScorePostCount: Math.max(0, Math.floor(values.newPosts / 2)),
    sampledPostCount: values.newPosts,
    activePostRatio: 0.8,
    dispersionScore: 0.6,
    hasNewPosts: true,
    hasActiveUsers: true,
    hasSubscribers: true,
  };
}

test("scoreTrendWindows returns explainable trend points for rising series", () => {
  const points = scoreTrendWindows({
    targetId: "00000000-0000-0000-0000-000000000001",
    windows: [
      buildWindow(0, { newPosts: 5, activeUsers: 100, subscribers: 1_000 }),
      buildWindow(15, { newPosts: 6, activeUsers: 104, subscribers: 1_001 }),
      buildWindow(30, { newPosts: 8, activeUsers: 112, subscribers: 1_003 }),
      buildWindow(45, { newPosts: 12, activeUsers: 130, subscribers: 1_005 }),
    ],
  });

  assert.equal(points.length, 4);
  assert.equal(points[0].algorithmVersion, "trend_v3_impact_signals");
  assert.equal(points[3].windowComplete, true);
  assert.ok((points[3].heatIndex ?? 0) > 0);
  assert.ok((points[3].surgeScore ?? 0) >= 0);
  assert.ok((points[3].velocityScore ?? 0) > 0);
  assert.ok(points[3].trendScore > points[0].trendScore);
  assert.equal(typeof points[3].scoreComponents?.impactMomentum, "number");
  assert.equal(typeof points[3].scoreComponents?.sampleReliability, "number");
});

test("scoreTrendWindows marks spike window with anomaly and change signals", () => {
  const points = scoreTrendWindows({
    targetId: "00000000-0000-0000-0000-000000000002",
    windows: [
      buildWindow(0, { newPosts: 4, activeUsers: 80, subscribers: 900 }),
      buildWindow(15, { newPosts: 5, activeUsers: 82, subscribers: 901 }),
      buildWindow(30, { newPosts: 4, activeUsers: 79, subscribers: 902 }),
      buildWindow(45, { newPosts: 5, activeUsers: 81, subscribers: 903 }),
      buildWindow(60, { newPosts: 4, activeUsers: 80, subscribers: 904 }),
      buildWindow(75, { newPosts: 5, activeUsers: 82, subscribers: 905 }),
      buildWindow(90, { newPosts: 4, activeUsers: 79, subscribers: 906 }),
      buildWindow(105, { newPosts: 25, activeUsers: 160, subscribers: 907 }),
    ],
  });

  const spikePoint = points[7];
  assert.ok((spikePoint.surgeScore ?? 0) > 0);
  assert.ok((spikePoint.anomalyScore ?? 0) > 0);
  assert.ok((spikePoint.changeScore ?? 0) > 0);
  assert.ok(spikePoint.trendScore > 0);
});
