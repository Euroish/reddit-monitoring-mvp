import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryPostGrowthFactRepository } from "../../src/storage/repositories/in-memory/raw-target-trend.repositories";

function buildRow(args: {
  targetId: string;
  contentId: string;
  ageBucket: "1h" | "6h" | "24h";
  observedAt: string;
  driverScore?: number;
}) {
  return {
    targetId: args.targetId,
    contentId: args.contentId,
    ageBucket: args.ageBucket,
    observedAt: args.observedAt,
    ageMinutes: args.ageBucket === "1h" ? 60 : args.ageBucket === "6h" ? 360 : 1440,
    score: 120,
    comments: 24,
    scoreVelocityPerHour: 8.5,
    commentVelocityPerHour: 2.2,
    cohortPostCount: 40,
    cohortMedianScoreVelocity: 4.1,
    cohortMedianCommentVelocity: 1.1,
    velocityZScore: 1.7,
    driverScore: args.driverScore ?? 63,
    algorithmVersion: "post_growth_v1",
    explainPayload: {
      source: "unit-test",
    },
  };
}

test("InMemoryPostGrowthFactRepository filters by target, range and age bucket", async () => {
  const repo = new InMemoryPostGrowthFactRepository();
  await repo.upsertMany([
    buildRow({
      targetId: "t1",
      contentId: "c-2",
      ageBucket: "6h",
      observedAt: "2026-04-17T00:20:00.000Z",
    }),
    buildRow({
      targetId: "t1",
      contentId: "c-1",
      ageBucket: "1h",
      observedAt: "2026-04-17T00:10:00.000Z",
    }),
    buildRow({
      targetId: "t2",
      contentId: "c-3",
      ageBucket: "1h",
      observedAt: "2026-04-17T00:15:00.000Z",
    }),
  ]);

  const rows = await repo.listByTargetInRange({
    targetId: "t1",
    fromIso: "2026-04-17T00:00:00.000Z",
    toIso: "2026-04-17T00:59:59.000Z",
    ageBuckets: ["1h", "24h"],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.targetId, "t1");
  assert.equal(rows[0]?.contentId, "c-1");
  assert.equal(rows[0]?.ageBucket, "1h");
});

test("InMemoryPostGrowthFactRepository upsert replaces same composite key", async () => {
  const repo = new InMemoryPostGrowthFactRepository();
  await repo.upsertMany([
    buildRow({
      targetId: "t1",
      contentId: "c-1",
      ageBucket: "1h",
      observedAt: "2026-04-17T00:10:00.000Z",
      driverScore: 40,
    }),
  ]);
  await repo.upsertMany([
    buildRow({
      targetId: "t1",
      contentId: "c-1",
      ageBucket: "1h",
      observedAt: "2026-04-17T00:10:00.000Z",
      driverScore: 88,
    }),
  ]);

  const rows = await repo.listByTargetInRange({
    targetId: "t1",
    fromIso: "2026-04-17T00:00:00.000Z",
    toIso: "2026-04-17T00:59:59.000Z",
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.driverScore, 88);
});

test("InMemoryPostGrowthFactRepository applies deterministic ordering and limit", async () => {
  const repo = new InMemoryPostGrowthFactRepository();
  await repo.upsertMany([
    buildRow({
      targetId: "t1",
      contentId: "c-2",
      ageBucket: "1h",
      observedAt: "2026-04-17T00:10:00.000Z",
    }),
    buildRow({
      targetId: "t1",
      contentId: "c-1",
      ageBucket: "1h",
      observedAt: "2026-04-17T00:10:00.000Z",
    }),
    buildRow({
      targetId: "t1",
      contentId: "c-3",
      ageBucket: "6h",
      observedAt: "2026-04-17T00:11:00.000Z",
    }),
  ]);

  const rows = await repo.listByTargetInRange({
    targetId: "t1",
    fromIso: "2026-04-17T00:00:00.000Z",
    toIso: "2026-04-17T00:59:59.000Z",
    limit: 2,
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.contentId, "c-1");
  assert.equal(rows[1]?.contentId, "c-2");
});
