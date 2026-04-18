import assert from "node:assert/strict";
import test from "node:test";
import { buildSubredditAnomalyIncidentReadModel } from "../../src/application/services/subreddit-anomaly-incident-read-model.service";

const targetId = "11111111-1111-1111-1111-111111111111";

test("buildSubredditAnomalyIncidentReadModel merges same-window signals", () => {
  const model = buildSubredditAnomalyIncidentReadModel({
    events: [
      {
        targetId,
        signalType: "keyword",
        signalKey: "llm",
        observedAt: "2026-04-18T10:10:00.000Z",
        windowStart: "2026-04-18T10:00:00.000Z",
        windowEnd: "2026-04-18T10:15:00.000Z",
        anomalyScore: 0.62,
        algorithmVersion: "anomaly_event_v1",
        explainPayload: {},
      },
      {
        targetId,
        signalType: "volume",
        signalKey: "subreddit",
        observedAt: "2026-04-18T10:11:00.000Z",
        windowStart: "2026-04-18T10:00:00.000Z",
        windowEnd: "2026-04-18T10:15:00.000Z",
        anomalyScore: 0.81,
        algorithmVersion: "anomaly_event_v1",
        explainPayload: {},
      },
      {
        targetId,
        signalType: "driver",
        signalKey: "post-a",
        observedAt: "2026-04-18T11:20:00.000Z",
        windowStart: "2026-04-18T11:15:00.000Z",
        windowEnd: "2026-04-18T11:30:00.000Z",
        anomalyScore: 0.77,
        algorithmVersion: "anomaly_event_v1",
        explainPayload: {},
      },
    ],
    limit: 10,
  });

  assert.equal(model.incidents.length, 2);
  assert.equal(model.incidents[0]?.dominantSignalType, "volume");
  assert.equal(model.incidents[0]?.signalCount, 2);
  assert.deepEqual(model.incidents[0]?.signalTypes, ["keyword", "volume"]);
  assert.equal(model.incidents[0]?.mergedScore, 0.89);
  assert.equal(model.incidents[0]?.severity, "high");
  assert.equal(model.incidents[1]?.dominantSignalType, "driver");
  assert.equal(model.incidents[1]?.signalCount, 1);
});
