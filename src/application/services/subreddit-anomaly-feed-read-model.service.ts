import type { AnomalyEvent } from "../../domain/entities/anomaly-event";
import { buildAnomalyEventId } from "./anomaly-event-id";
import {
  resolveAnomalySeverity,
  type AnomalySeverity,
} from "./anomaly-severity";

export interface SubredditAnomalyFeedItem {
  eventId: string;
  signalType: "volume" | "quality" | "keyword" | "driver";
  signalKey: string;
  observedAt: string;
  windowStart?: string;
  windowEnd?: string;
  anomalyScore: number;
  severity: AnomalySeverity;
  algorithmVersion: string;
  explainPayload: {
    contractVersion: "anomaly_feed_explain_v1";
    signalType: "volume" | "quality" | "keyword" | "driver";
    signalKey: string;
    observedAt: string;
    windowStart?: string;
    windowEnd?: string;
    anomalyScore: number;
    severity: AnomalySeverity;
    algorithmVersion: string;
    details: Record<string, unknown>;
  };
}

export interface SubredditAnomalyFeedReadModel {
  events: SubredditAnomalyFeedItem[];
}

export function buildSubredditAnomalyFeedReadModel(args: {
  events: AnomalyEvent[];
  limit: number;
}): SubredditAnomalyFeedReadModel {
  const events = [...args.events]
    .sort((a, b) => {
      const byScore = b.anomalyScore - a.anomalyScore;
      if (byScore !== 0) {
        return byScore;
      }
      const byObserved = b.observedAt.localeCompare(a.observedAt);
      if (byObserved !== 0) {
        return byObserved;
      }
      const bySignalType = a.signalType.localeCompare(b.signalType);
      if (bySignalType !== 0) {
        return bySignalType;
      }
      return a.signalKey.localeCompare(b.signalKey);
    })
    .slice(0, args.limit)
    .map((event) => {
      const severity = resolveAnomalySeverity(event.anomalyScore);
      return {
        eventId: buildAnomalyEventId(event),
        signalType: event.signalType,
        signalKey: event.signalKey,
        observedAt: event.observedAt,
        windowStart: event.windowStart,
        windowEnd: event.windowEnd,
        anomalyScore: event.anomalyScore,
        severity,
        algorithmVersion: event.algorithmVersion,
        explainPayload: {
          contractVersion: "anomaly_feed_explain_v1" as const,
          signalType: event.signalType,
          signalKey: event.signalKey,
          observedAt: event.observedAt,
          windowStart: event.windowStart,
          windowEnd: event.windowEnd,
          anomalyScore: event.anomalyScore,
          severity,
          algorithmVersion: event.algorithmVersion,
          details: event.explainPayload ?? {},
        },
      };
    });

  return { events };
}
