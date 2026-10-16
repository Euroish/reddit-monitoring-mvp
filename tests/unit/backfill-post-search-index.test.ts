import assert from "node:assert/strict";
import test from "node:test";
import { backfillPostSearchIndex, parsePostSearchBackfillArgs } from "../../scripts/backfill-post-search-index";

test("index backfill configuration is bounded and explicit config-only does not need a database", () => {
  assert.deepEqual(parsePostSearchBackfillArgs(["--config-only"], {}), { batchSize: 500, maxBatches: 10, configOnly: true });
  assert.deepEqual(parsePostSearchBackfillArgs(["--batch-size", "40", "--max-batches", "3"], {}), { batchSize: 40, maxBatches: 3, configOnly: false });
  for (const args of [["--batch-size", "0"], ["--max-batches", "101"], ["--batch-size", "5001"], ["--batch-size", "1.5"], ["--other"], ["--max-batches"]]) assert.throws(() => parsePostSearchBackfillArgs(args, {}));
});

test("index backfill stops on an exhausted batch and respects maximum work without claiming full completion", async () => {
  const calls: number[] = [];
  const exhausted = await backfillPostSearchIndex({ seedFromContent: async (limit) => { calls.push(limit); return calls.length === 1 ? limit : 2; } }, { batchSize: 5, maxBatches: 10 });
  assert.deepEqual(calls, [5, 5]);
  assert.deepEqual(exhausted, { rowsChanged: 7, batchesExecuted: 2, reachedBatchBudget: false });
  const capped = await backfillPostSearchIndex({ seedFromContent: async (limit) => limit }, { batchSize: 5, maxBatches: 2 });
  assert.deepEqual(capped, { rowsChanged: 10, batchesExecuted: 2, reachedBatchBudget: true });
});
