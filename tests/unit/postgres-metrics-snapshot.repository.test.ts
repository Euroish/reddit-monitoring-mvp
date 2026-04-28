import assert from "node:assert/strict";
import test from "node:test";
import { PostgresMetricsSnapshotRepository } from "../../src/storage/repositories/postgres/postgres-metrics-snapshot.repository";
import { stableUuidFromString } from "../../src/shared/ids/stable-id";

test("PostgresMetricsSnapshotRepository rejects post-level rows after target-only split", async () => {
  const db = {
    async withTransaction<T>(_fn: unknown): Promise<T> {
      throw new Error("should not execute");
    },
    async query() {
      return { rows: [] };
    },
  };

  const repo = new PostgresMetricsSnapshotRepository(db as never);

  await assert.rejects(
    repo.appendMany([
      {
        snapshotAt: "2026-04-28T08:00:00.000Z",
        source: "reddit",
        targetId: stableUuidFromString("reddit:target:r/test"),
        contentId: stableUuidFromString("reddit:content:t3_a"),
        granularity: "15m",
        metricName: "score",
        metricValue: 42,
        collectionJobId: stableUuidFromString("job:a"),
      },
    ]),
    /metrics_snapshot only accepts target-level/,
  );
});

test("PostgresMetricsSnapshotRepository allows target-level rows after target-only split", async () => {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  const query = async (text: string, params?: unknown[]) => {
    calls.push({ text, params });
    return { rows: [] };
  };
  const db: {
    withTransaction<T>(fn: (client: { query: typeof query }) => Promise<T>): Promise<T>;
    query: typeof query;
  } = {
    async withTransaction<T>(fn: (client: { query: typeof query }) => Promise<T>): Promise<T> {
      return fn({ query });
    },
    query,
  };

  const repo = new PostgresMetricsSnapshotRepository(db as never);
  await repo.appendMany([
    {
      snapshotAt: "2026-04-28T08:00:00.000Z",
      source: "reddit",
      targetId: stableUuidFromString("reddit:target:r/test"),
      granularity: "15m",
      metricName: "new_posts_15m",
      metricValue: 3,
      collectionJobId: stableUuidFromString("job:a"),
    },
  ]);

  assert.equal(calls.length, 1);
  assert.match(calls[0]!.text, /INSERT INTO metrics_snapshot/);
});
