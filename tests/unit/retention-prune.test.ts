import assert from "node:assert/strict";
import test from "node:test";
import {
  pruneRawEvents,
  pruneMetricsSnapshots,
  prunePostEngagementWindows,
} from "../../src/ops/retention-prune";

test("retention maintenance yields after its batch budget even with a persistent backlog", async () => {
  for (const prune of [pruneRawEvents, pruneMetricsSnapshots, prunePostEngagementWindows]) {
    let calls = 0;
    const db = {
      async query() {
        calls += 1;
        return { rows: [{ id: 1 }] };
      },
    };
    const deleted = await prune(db as never, {
      retentionDays: 7,
      batchSize: 1,
      loopUntilDone: true,
      maxBatches: 2,
    });
    assert.equal(deleted, 2);
    assert.equal(calls, 2);
  }
});
