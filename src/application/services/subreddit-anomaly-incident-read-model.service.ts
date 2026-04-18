import type { AnomalyEvent, AnomalySignalType } from "../../domain/entities/anomaly-event";
import type { AnomalySeverity } from "./subreddit-anomaly-feed-read-model.service";

export interface SubredditAnomalyIncidentItem {
  incidentId: string;
  windowStart: string;
  windowEnd: string;
  observedAt: string;
  mergedScore: number;
  severity: AnomalySeverity;
  dominantSignalType: AnomalySignalType;
  signalTypes: AnomalySignalType[];
  signalCount: number;
  algorithmVersion: string;
  explainPayload: {
    mergedFromEvents: number;
    signalBreakdown: Record<AnomalySignalType, number>;
    maxSourceScore: number;
    mergeBoost: number;
    sourceEvents: Array<{
      signalType: AnomalySignalType;
      signalKey: string;
      anomalyScore: number;
      observedAt: string;
    }>;
  };
}

export interface SubredditAnomalyIncidentReadModel {
  incidents: SubredditAnomalyIncidentItem[];
}

interface GroupedIncident {
  id: string;
  windowStart: string;
  windowEnd: string;
  events: AnomalyEvent[];
}

const MERGE_BOOST_PER_EXTRA_SIGNAL = 0.08;

export function buildSubredditAnomalyIncidentReadModel(args: {
  events: AnomalyEvent[];
  limit: number;
}): SubredditAnomalyIncidentReadModel {
  const grouped = groupEventsIntoIncidents(args.events);
  const incidents = grouped
    .map((group) => toIncidentItem(group))
    .sort((a, b) => {
      const byScore = b.mergedScore - a.mergedScore;
      if (byScore !== 0) {
        return byScore;
      }
      return b.windowStart.localeCompare(a.windowStart);
    })
    .slice(0, args.limit);

  return { incidents };
}

function groupEventsIntoIncidents(events: AnomalyEvent[]): GroupedIncident[] {
  const groups = new Map<string, GroupedIncident>();
  for (const event of events) {
    const windowStart = event.windowStart ?? floorTo15Minutes(event.observedAt);
    const windowEnd = event.windowEnd ?? addMinutes(windowStart, 15);
    const key = `${windowStart}|${windowEnd}`;
    const current = groups.get(key);
    if (!current) {
      groups.set(key, {
        id: `incident:${windowStart}`,
        windowStart,
        windowEnd,
        events: [event],
      });
      continue;
    }
    current.events.push(event);
  }
  return Array.from(groups.values());
}

function toIncidentItem(group: GroupedIncident): SubredditAnomalyIncidentItem {
  const sorted = [...group.events].sort((a, b) => {
    const byScore = b.anomalyScore - a.anomalyScore;
    if (byScore !== 0) {
      return byScore;
    }
    return b.observedAt.localeCompare(a.observedAt);
  });

  const sourceEvents = sorted.map((event) => ({
    signalType: event.signalType,
    signalKey: event.signalKey,
    anomalyScore: event.anomalyScore,
    observedAt: event.observedAt,
  }));
  const signalTypeSet = new Set(sourceEvents.map((event) => event.signalType));
  const signalTypes = Array.from(signalTypeSet.values()).sort((a, b) =>
    a.localeCompare(b),
  ) as AnomalySignalType[];
  const signalCount = signalTypes.length;
  const maxSourceScore = sorted[0]?.anomalyScore ?? 0;
  const mergeBoost = Math.max(0, signalCount - 1) * MERGE_BOOST_PER_EXTRA_SIGNAL;
  const mergedScore = Number(Math.min(1, maxSourceScore + mergeBoost).toFixed(6));
  const dominantSignalType = sorted[0]?.signalType ?? "volume";
  const observedAt = sorted[0]?.observedAt ?? group.windowStart;
  const algorithmVersion = sorted[0]?.algorithmVersion ?? "anomaly_incident_v1";

  return {
    incidentId: group.id,
    windowStart: group.windowStart,
    windowEnd: group.windowEnd,
    observedAt,
    mergedScore,
    severity: resolveSeverity(mergedScore),
    dominantSignalType,
    signalTypes,
    signalCount,
    algorithmVersion,
    explainPayload: {
      mergedFromEvents: sorted.length,
      signalBreakdown: {
        volume: sourceEvents.filter((event) => event.signalType === "volume").length,
        quality: sourceEvents.filter((event) => event.signalType === "quality").length,
        keyword: sourceEvents.filter((event) => event.signalType === "keyword").length,
        driver: sourceEvents.filter((event) => event.signalType === "driver").length,
      },
      maxSourceScore,
      mergeBoost,
      sourceEvents,
    },
  };
}

function resolveSeverity(score: number): AnomalySeverity {
  if (score >= 0.8) {
    return "high";
  }
  if (score >= 0.5) {
    return "medium";
  }
  return "low";
}

function floorTo15Minutes(iso: string): string {
  const date = new Date(iso);
  const ms = date.getTime();
  if (!Number.isFinite(ms)) {
    return iso;
  }
  const flooredMs = ms - (ms % (15 * 60 * 1000));
  return new Date(flooredMs).toISOString();
}

function addMinutes(iso: string, minutes: number): string {
  const date = new Date(iso);
  const ms = date.getTime();
  if (!Number.isFinite(ms)) {
    return iso;
  }
  return new Date(ms + minutes * 60 * 1000).toISOString();
}
