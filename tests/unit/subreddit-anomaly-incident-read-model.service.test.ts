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
  assert.equal(
    model.incidents[0]?.explainPayload.contractVersion,
    "anomaly_incident_explain_v1",
  );
  assert.equal(
    model.incidents[0]?.explainPayload.mergeStrategy,
    "weighted_signal_boost_v1",
  );
  assert.equal(
    model.incidents[0]?.explainPayload.sourceEvents[0]?.eventId,
    "volume:subreddit:2026-04-18T10:11:00.000Z",
  );
  assert.equal(
    model.incidents[0]?.explainPayload.sourceEvents[0]?.severity,
    "high",
  );
  assert.equal(model.incidents[1]?.dominantSignalType, "driver");
  assert.equal(model.incidents[1]?.signalCount, 1);
});

test("buildSubredditAnomalyIncidentReadModel uses signal-type weighted merge boost", () => {
  const model = buildSubredditAnomalyIncidentReadModel({
    events: [
      {
        targetId,
        signalType: "volume",
        signalKey: "subreddit",
        observedAt: "2026-04-18T12:05:00.000Z",
        windowStart: "2026-04-18T12:00:00.000Z",
        windowEnd: "2026-04-18T12:15:00.000Z",
        anomalyScore: 0.8,
        algorithmVersion: "anomaly_event_v2_tier_directional_quality",
        explainPayload: {},
      },
      {
        targetId,
        signalType: "quality",
        signalKey: "quality_down",
        observedAt: "2026-04-18T12:06:00.000Z",
        windowStart: "2026-04-18T12:00:00.000Z",
        windowEnd: "2026-04-18T12:15:00.000Z",
        anomalyScore: 0.7,
        algorithmVersion: "anomaly_event_v2_tier_directional_quality",
        explainPayload: {},
      },
      {
        targetId,
        signalType: "volume",
        signalKey: "subreddit",
        observedAt: "2026-04-18T13:05:00.000Z",
        windowStart: "2026-04-18T13:00:00.000Z",
        windowEnd: "2026-04-18T13:15:00.000Z",
        anomalyScore: 0.8,
        algorithmVersion: "anomaly_event_v2_tier_directional_quality",
        explainPayload: {},
      },
      {
        targetId,
        signalType: "driver",
        signalKey: "post-a",
        observedAt: "2026-04-18T13:06:00.000Z",
        windowStart: "2026-04-18T13:00:00.000Z",
        windowEnd: "2026-04-18T13:15:00.000Z",
        anomalyScore: 0.7,
        algorithmVersion: "anomaly_event_v2_tier_directional_quality",
        explainPayload: {},
      },
    ],
    limit: 10,
  });

  assert.equal(model.incidents.length, 2);
  const qualityIncident = model.incidents.find(
    (incident) => incident.windowStart === "2026-04-18T12:00:00.000Z",
  );
  const driverIncident = model.incidents.find(
    (incident) => incident.windowStart === "2026-04-18T13:00:00.000Z",
  );
  assert.notEqual(qualityIncident, undefined);
  assert.notEqual(driverIncident, undefined);
  assert.equal(qualityIncident?.mergedScore, 0.84);
  assert.equal(driverIncident?.mergedScore, 0.86);
});
