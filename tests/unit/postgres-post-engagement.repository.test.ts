import assert from "node:assert/strict";
import test from "node:test";
import { PostgresPostEngagementRepository } from "../../src/storage/repositories/postgres/postgres-post-engagement.repository";
import { stableUuidFromString } from "../../src/shared/ids/stable-id";

test("PostgresPostEngagementRepository upsertLatestMany batches structured engagement rows", async () => {
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

  const repo = new PostgresPostEngagementRepository(db as never);
  await repo.upsertLatestMany([
    {
      contentId: stableUuidFromString("reddit:content:t3_a"),
      targetId: stableUuidFromString("reddit:target:r/test"),
      source: "reddit",
      observedAt: "2026-04-28T08:00:00.000Z",
      score: 42,
      numComments: 7,
      collectionJobId: stableUuidFromString("job:a"),
    },
  ]);

  assert.equal(calls.length, 1);
  assert.match(calls[0]!.text, /INSERT INTO post_engagement_latest/);
  assert.match(calls[0]!.text, /ON CONFLICT \(content_id\) DO UPDATE/);
  assert.equal(calls[0]!.params?.length, 8);
});

test("PostgresPostEngagementRepository listWindowedByTargetInRange maps rows", async () => {
  const db = {
    async withTransaction<T>(_fn: unknown): Promise<T> {
      throw new Error("not used");
    },
    async query() {
      return {
        rows: [
          {
            target_id: stableUuidFromString("reddit:target:r/test"),
            content_id: stableUuidFromString("reddit:content:t3_a"),
            window_start: "2026-04-28T06:00:00.000Z",
            window_end: "2026-04-28T12:00:00.000Z",
            observed_at: "2026-04-28T08:00:00.000Z",
            score: "42",
            num_comments: "7",
            upvote_ratio: "0.91",
            collection_job_id: stableUuidFromString("job:a"),
            created_at: "2026-04-28T08:00:00.000Z",
            updated_at: "2026-04-28T08:00:00.000Z",
          },
        ],
      };
    },
  };

  const repo = new PostgresPostEngagementRepository(db as never);
  const rows = await repo.listWindowedByTargetInRange({
    targetId: stableUuidFromString("reddit:target:r/test"),
    from: "2026-04-28T00:00:00.000Z",
    to: "2026-04-28T23:59:59.000Z",
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.score, 42);
  assert.equal(rows[0]!.numComments, 7);
  assert.equal(rows[0]!.upvoteRatio, 0.91);
});
