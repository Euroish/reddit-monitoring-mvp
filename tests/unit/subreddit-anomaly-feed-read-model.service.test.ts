import assert from "node:assert/strict";
import test from "node:test";
import { buildSubredditAnomalyFeedReadModel } from "../../src/application/services/subreddit-anomaly-feed-read-model.service";

const targetId = "11111111-1111-1111-1111-111111111111";

test("buildSubredditAnomalyFeedReadModel sorts by score and maps severity", () => {
  const model = buildSubredditAnomalyFeedReadModel({
    events: [
      {
        targetId,
        signalType: "keyword",
        signalKey: "llm",
        observedAt: "2026-04-18T10:10:00.000Z",
        anomalyScore: 0.61,
        algorithmVersion: "anomaly_event_v1",
        explainPayload: {},
      },
      {
        targetId,
        signalType: "driver",
        signalKey: "post-a",
        observedAt: "2026-04-18T10:11:00.000Z",
        anomalyScore: 0.89,
        algorithmVersion: "anomaly_event_v1",
        explainPayload: {},
      },
      {
        targetId,
        signalType: "volume",
        signalKey: "subreddit",
        observedAt: "2026-04-18T10:12:00.000Z",
        anomalyScore: 0.2,
        algorithmVersion: "anomaly_event_v1",
        explainPayload: {},
      },
    ],
    limit: 2,
  });

  assert.equal(model.events.length, 2);
  assert.equal(model.events[0]?.eventId, "driver:post-a:2026-04-18T10:11:00.000Z");
  assert.equal(model.events[0]?.signalType, "driver");
  assert.equal(model.events[0]?.severity, "high");
  assert.equal(model.events[0]?.explainPayload.contractVersion, "anomaly_feed_explain_v1");
  assert.equal(model.events[0]?.explainPayload.signalType, "driver");
  assert.equal(model.events[0]?.explainPayload.severity, "high");
  assert.equal(model.events[1]?.signalType, "keyword");
  assert.equal(model.events[1]?.severity, "medium");
  assert.equal(model.events[1]?.explainPayload.contractVersion, "anomaly_feed_explain_v1");
});
