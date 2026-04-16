import test from "node:test";
import assert from "node:assert/strict";
import {
  buildShadowPromotionPlan,
  type ShadowCompareSnapshot,
} from "../../src/application/services/shadow-promotion-plan.service";

function snapshot(records: ShadowCompareSnapshot["records"]): ShadowCompareSnapshot {
  return {
    generatedAt: "2026-04-16T00:00:00.000Z",
    baselineProvider: "http",
    shadowProvider: "scrapling",
    records,
  };
}

function record(args: {
  subreddit: string;
  baselineStatus?: number | null;
  shadowStatus?: number | null;
  durationBaseline?: number;
  durationShadow?: number;
  jaccard?: number | null;
  extractedDelta?: number;
  lagDelta?: number | null;
  gatePassed?: boolean;
}) {
  return {
    subreddit: args.subreddit,
    round: 1,
    baseline: {
      provider: {
        provider: "http",
        status: args.baselineStatus ?? 200,
        durationMs: args.durationBaseline ?? 1000,
        extractedCount: 25,
        uniqueExternalCount: 25,
        duplicateWithinResponse: 0,
        avgIngestLagSeconds: 100,
      },
    },
    shadow: {
      provider: {
        provider: "scrapling",
        status: args.shadowStatus ?? 200,
        durationMs: args.durationShadow ?? 2500,
        extractedCount: 25,
        uniqueExternalCount: 25,
        duplicateWithinResponse: 0,
        avgIngestLagSeconds: 100,
      },
    },
    parity: {
      statusMatch: (args.baselineStatus ?? 200) === (args.shadowStatus ?? 200),
      bothSucceeded:
        (args.baselineStatus ?? 200) >= 200 &&
        (args.baselineStatus ?? 200) < 300 &&
        (args.shadowStatus ?? 200) >= 200 &&
        (args.shadowStatus ?? 200) < 300,
      extractedDelta: args.extractedDelta ?? 0,
      overlapJaccard: args.jaccard ?? 1,
      avgIngestLagDeltaSeconds: args.lagDelta ?? 0,
    },
    parityGatePassed: args.gatePassed ?? true,
  };
}

test("buildShadowPromotionPlan marks subreddit eligible when all thresholds pass", () => {
  const plan = buildShadowPromotionPlan({
    snapshots: [
      snapshot([
        record({ subreddit: "machinelearning" }),
        record({ subreddit: "machinelearning" }),
      ]),
      snapshot([
        record({ subreddit: "machinelearning" }),
        record({ subreddit: "machinelearning" }),
      ]),
    ],
    policy: {
      minSamples: 4,
      maxDurationRatioP95: 3,
    },
  });

  assert.equal(plan.subreddits.length, 1);
  const item = plan.subreddits[0];
  assert.ok(item);
  assert.equal(item.subreddit, "machinelearning");
  assert.equal(item.eligible, true);
  assert.equal(
    item.recommendation,
    "promote_scrapling_primary_with_http_fallback",
  );
  assert.deepEqual(item.blockingReasons, []);
});

test("buildShadowPromotionPlan blocks subreddit with insufficient evidence and weak parity", () => {
  const plan = buildShadowPromotionPlan({
    snapshots: [
      snapshot([
        record({
          subreddit: "datascience",
          jaccard: 0.5,
          extractedDelta: 8,
          lagDelta: 900,
          durationShadow: 7000,
          gatePassed: false,
        }),
      ]),
    ],
    policy: {
      minSamples: 3,
      maxAbsExtractedDeltaP95: 2,
      maxAbsLagDeltaSecondsP95: 120,
      maxDurationRatioP95: 4,
      minJaccardP50: 0.9,
      minJaccardMin: 0.8,
      minParityGatePassRate: 1,
    },
  });

  const item = plan.subreddits[0];
  assert.ok(item);
  assert.equal(item.subreddit, "datascience");
  assert.equal(item.eligible, false);
  assert.equal(item.recommendation, "keep_shadow_only");
  assert.equal(item.blockingReasons.length > 0, true);
  assert.equal(
    item.blockingReasons.some((reason) =>
      reason.startsWith("sample_count_below_min:"),
    ),
    true,
  );
  assert.equal(
    item.blockingReasons.some((reason) =>
      reason.startsWith("jaccard_p50_below_min:"),
    ),
    true,
  );
  assert.equal(
    item.blockingReasons.some((reason) =>
      reason.startsWith("extracted_delta_p95_above_max:"),
    ),
    true,
  );
  assert.equal(
    item.blockingReasons.some((reason) =>
      reason.startsWith("lag_delta_p95_above_max:"),
    ),
    true,
  );
});

