import assert from "node:assert/strict";
import test from "node:test";
import { capacityProjection, validateSourceRetentionPolicy } from "../../src/ops/source-storage-plan";

test("retention policy requires exact bounded horizons instead of silently deleting on malformed input", () => {
  const policy = { jobDays: 90, observationDays: 90, heartbeatDays: 14, usageDays: 90, auditDays: 180 };
  assert.deepEqual(validateSourceRetentionPolicy(policy), policy);
  for (const value of [0, -1, 1.2, NaN, 3651, "90"])
    assert.throws(() => validateSourceRetentionPolicy({ ...policy, jobDays: value }), /jobDays/);
});

test("capacity estimates preserve unknown density and distinguish allocation from incremental payload", () => {
  assert.deepEqual(capacityProjection({ allocatedContentBytes: 0, contentRows: 0, allocatedObservationBytes: 0, observationRows: 0 }, { dailyContent: 100, dailyObservations: 200, days: 90 }), {
    estimatedContentBytes: null, estimatedObservationBytes: null, estimatedTotalBytes: null,
    method: "allocated_relation_bytes_per_stored_row", excludes: ["WAL", "backup", "free-space reuse", "future schema growth"],
  });
  const estimate = capacityProjection({ allocatedContentBytes: 10000, contentRows: 10, allocatedObservationBytes: 2000, observationRows: 20 }, { dailyContent: 100, dailyObservations: 200, days: 90 });
  assert.equal(estimate.estimatedContentBytes, 9000000); assert.equal(estimate.estimatedObservationBytes, 1800000);
  assert.equal(estimate.estimatedTotalBytes, 10800000);
  assert.throws(() => capacityProjection({ allocatedContentBytes: 1, contentRows: 1, allocatedObservationBytes: 1, observationRows: 1 }, { dailyContent: -1, dailyObservations: 1, days: 90 }), /dailyContent/);
});
