import type { AnomalyEvent } from "../../domain/entities/anomaly-event";

export type AnomalySeverity = "low" | "medium" | "high";

export interface SubredditAnomalyFeedItem {
  signalType: "volume" | "quality" | "keyword" | "driver";
  signalKey: string;
  observedAt: string;
  windowStart?: string;
  windowEnd?: string;
  anomalyScore: number;
  severity: AnomalySeverity;
  algorithmVersion: string;
  explainPayload: Record<string, unknown>;
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
    .map((event) => ({
      signalType: event.signalType,
      signalKey: event.signalKey,
      observedAt: event.observedAt,
      windowStart: event.windowStart,
      windowEnd: event.windowEnd,
      anomalyScore: event.anomalyScore,
      severity: resolveAnomalySeverity(event.anomalyScore),
      algorithmVersion: event.algorithmVersion,
      explainPayload: event.explainPayload,
    }));

  return { events };
}

function resolveAnomalySeverity(anomalyScore: number): AnomalySeverity {
  if (anomalyScore >= 0.8) {
    return "high";
  }
  if (anomalyScore >= 0.5) {
    return "medium";
  }
  return "low";
}
