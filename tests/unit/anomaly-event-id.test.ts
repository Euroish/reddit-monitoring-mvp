import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAnomalyEventId,
  parseAnomalyEventId,
} from "../../src/application/services/anomaly-event-id";

test("anomaly event id round-trips signal tuple", () => {
  const id = buildAnomalyEventId({
    signalType: "keyword",
    signalKey: "llm",
    observedAt: "2026-04-19T00:00:00.000Z",
  });
  assert.equal(id, "keyword:llm:2026-04-19T00:00:00.000Z");
  assert.deepEqual(parseAnomalyEventId(id), {
    signalType: "keyword",
    signalKey: "llm",
    observedAt: "2026-04-19T00:00:00.000Z",
  });
});

test("anomaly event id parser rejects malformed or unknown signal type", () => {
  assert.equal(parseAnomalyEventId(""), null);
  assert.equal(parseAnomalyEventId("keyword:llm"), null);
  assert.equal(parseAnomalyEventId("unknown:llm:2026-04-19T00:00:00.000Z"), null);
});
