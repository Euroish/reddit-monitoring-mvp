import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAnomalyEventRepository } from "../../src/storage/repositories/in-memory/raw-target-trend.repositories";

function buildRow(args: {
  targetId: string;
  signalType: "volume" | "quality" | "keyword" | "driver";
  signalKey: string;
  observedAt: string;
  anomalyScore?: number;
}) {
  return {
    targetId: args.targetId,
    signalType: args.signalType,
    signalKey: args.signalKey,
    observedAt: args.observedAt,
    windowStart: "2026-04-18T10:00:00.000Z",
    windowEnd: "2026-04-18T10:15:00.000Z",
    anomalyScore: args.anomalyScore ?? 0.72,
    algorithmVersion: "anomaly_event_v1",
    explainPayload: {
      source: "unit-test",
    },
  };
}

test("InMemoryAnomalyEventRepository filters by target, range and signal type", async () => {
  const repo = new InMemoryAnomalyEventRepository();
  await repo.upsertMany([
    buildRow({
      targetId: "t1",
      signalType: "volume",
      signalKey: "subreddit",
      observedAt: "2026-04-18T10:10:00.000Z",
    }),
    buildRow({
      targetId: "t1",
      signalType: "keyword",
      signalKey: "llm",
      observedAt: "2026-04-18T10:11:00.000Z",
    }),
    buildRow({
      targetId: "t2",
      signalType: "driver",
      signalKey: "content-a",
      observedAt: "2026-04-18T10:12:00.000Z",
    }),
  ]);

  const rows = await repo.listByTargetInRange({
    targetId: "t1",
    fromIso: "2026-04-18T10:00:00.000Z",
    toIso: "2026-04-18T10:59:59.000Z",
    signalTypes: ["keyword"],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.signalType, "keyword");
  assert.equal(rows[0]?.signalKey, "llm");
});

test("InMemoryAnomalyEventRepository upsert replaces same composite key", async () => {
  const repo = new InMemoryAnomalyEventRepository();
  await repo.upsertMany([
    buildRow({
      targetId: "t1",
      signalType: "volume",
      signalKey: "subreddit",
      observedAt: "2026-04-18T10:10:00.000Z",
      anomalyScore: 0.4,
    }),
  ]);
  await repo.upsertMany([
    buildRow({
      targetId: "t1",
      signalType: "volume",
      signalKey: "subreddit",
      observedAt: "2026-04-18T10:10:00.000Z",
      anomalyScore: 0.93,
    }),
  ]);

  const rows = await repo.listByTargetInRange({
    targetId: "t1",
    fromIso: "2026-04-18T10:00:00.000Z",
    toIso: "2026-04-18T10:59:59.000Z",
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.anomalyScore, 0.93);
});

test("InMemoryAnomalyEventRepository applies deterministic ordering and limit", async () => {
  const repo = new InMemoryAnomalyEventRepository();
  await repo.upsertMany([
    buildRow({
      targetId: "t1",
      signalType: "keyword",
      signalKey: "llm",
      observedAt: "2026-04-18T10:11:00.000Z",
    }),
    buildRow({
      targetId: "t1",
      signalType: "driver",
      signalKey: "content-a",
      observedAt: "2026-04-18T10:10:00.000Z",
    }),
    buildRow({
      targetId: "t1",
      signalType: "volume",
      signalKey: "subreddit",
      observedAt: "2026-04-18T10:10:00.000Z",
    }),
  ]);

  const rows = await repo.listByTargetInRange({
    targetId: "t1",
    fromIso: "2026-04-18T10:00:00.000Z",
    toIso: "2026-04-18T10:59:59.000Z",
    limit: 2,
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.signalType, "driver");
  assert.equal(rows[1]?.signalType, "volume");
});
