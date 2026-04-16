import test from "node:test";
import assert from "node:assert/strict";
import {
  buildShadowParityResult,
  evaluateShadowParityGate,
  type ShadowProviderSample,
} from "../../src/application/services/shadow-parity.service";

function sample(overrides: Partial<ShadowProviderSample> = {}): ShadowProviderSample {
  return {
    provider: "http",
    status: 200,
    durationMs: 100,
    extractedCount: 10,
    uniqueExternalCount: 10,
    duplicateWithinResponse: 0,
    avgIngestLagSeconds: 120,
    ...overrides,
  };
}

test("buildShadowParityResult computes overlap and jaccard", () => {
  const parity = buildShadowParityResult({
    baseline: sample({ provider: "http" }),
    shadow: sample({ provider: "scrapling", extractedCount: 11 }),
    baselineExternalIds: ["a", "b", "c", "d"],
    shadowExternalIds: ["b", "c", "d", "e", "f"],
  });

  assert.equal(parity.statusMatch, true);
  assert.equal(parity.bothSucceeded, true);
  assert.equal(parity.extractedDelta, 1);
  assert.equal(parity.overlapCount, 3);
  assert.equal(parity.unionCount, 6);
  assert.equal(parity.overlapJaccard, 0.5);
  assert.equal(parity.avgIngestLagDeltaSeconds, 0);
});

test("buildShadowParityResult keeps lag delta null when one side lacks lag", () => {
  const parity = buildShadowParityResult({
    baseline: sample({ avgIngestLagSeconds: null }),
    shadow: sample({ provider: "scrapling", avgIngestLagSeconds: 200 }),
    baselineExternalIds: ["a"],
    shadowExternalIds: ["a"],
  });

  assert.equal(parity.avgIngestLagDeltaSeconds, null);
});

test("evaluateShadowParityGate enforces success, status, extracted delta, and jaccard", () => {
  const passing = buildShadowParityResult({
    baseline: sample(),
    shadow: sample({ provider: "scrapling", extractedCount: 12 }),
    baselineExternalIds: ["a", "b", "c", "d"],
    shadowExternalIds: ["a", "b", "c", "d", "e", "f"],
  });
  const failingStatus = buildShadowParityResult({
    baseline: sample({ status: 200 }),
    shadow: sample({ provider: "scrapling", status: 500 }),
    baselineExternalIds: ["a"],
    shadowExternalIds: ["a"],
  });
  const failingJaccard = buildShadowParityResult({
    baseline: sample(),
    shadow: sample({ provider: "scrapling" }),
    baselineExternalIds: ["a", "b", "c"],
    shadowExternalIds: ["x", "y", "z"],
  });

  assert.equal(
    evaluateShadowParityGate({
      parity: passing,
      minJaccard: 0.5,
      maxExtractedDeltaAbs: 3,
      requireStatusMatch: true,
    }),
    true,
  );

  assert.equal(
    evaluateShadowParityGate({
      parity: failingStatus,
      minJaccard: 0.1,
      maxExtractedDeltaAbs: 3,
      requireStatusMatch: true,
    }),
    false,
  );

  assert.equal(
    evaluateShadowParityGate({
      parity: failingJaccard,
      minJaccard: 0.1,
      maxExtractedDeltaAbs: 3,
      requireStatusMatch: true,
    }),
    false,
  );
});

