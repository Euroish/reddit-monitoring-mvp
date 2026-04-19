import type { AnomalyEvent, AnomalySignalType } from "../../domain/entities/anomaly-event";
import { ANOMALY_EVENT_DEFAULTS } from "../../jobs/anomaly-event-defaults";
import { buildAnomalyEventId } from "./anomaly-event-id";
import {
  resolveAnomalySeverity,
  type AnomalySeverity,
} from "./anomaly-severity";

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
    mergeBoostBySignalType: Record<AnomalySignalType, number>;
    maxSourceScore: number;
    mergeBoost: number;
    sourceEvents: Array<{
      eventId: string;
      signalType: AnomalySignalType;
      signalKey: string;
      anomalyScore: number;
      observedAt: string;
      severity: AnomalySeverity;
      algorithmVersion: string;
    }>;
    contractVersion: "anomaly_incident_explain_v1";
    mergeStrategy: "weighted_signal_boost_v1";
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

const MERGE_BOOST_BY_SIGNAL_TYPE = ANOMALY_EVENT_DEFAULTS.incidentMergeBoostBySignal;

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
    eventId: buildAnomalyEventId(event),
    signalType: event.signalType,
    signalKey: event.signalKey,
    anomalyScore: event.anomalyScore,
    observedAt: event.observedAt,
    severity: resolveAnomalySeverity(event.anomalyScore),
    algorithmVersion: event.algorithmVersion,
  }));
  const signalTypeSet = new Set(sourceEvents.map((event) => event.signalType));
  const signalTypes = Array.from(signalTypeSet.values()).sort((a, b) =>
    a.localeCompare(b),
  ) as AnomalySignalType[];
  const signalCount = signalTypes.length;
  const maxSourceScore = sorted[0]?.anomalyScore ?? 0;
  const dominantSignalType = sorted[0]?.signalType ?? "volume";
  const mergeBoostBySignalType: Record<AnomalySignalType, number> = {
    volume: signalTypes.includes("volume") && dominantSignalType !== "volume"
      ? MERGE_BOOST_BY_SIGNAL_TYPE.volume
      : 0,
    quality: signalTypes.includes("quality") && dominantSignalType !== "quality"
      ? MERGE_BOOST_BY_SIGNAL_TYPE.quality
      : 0,
    keyword: signalTypes.includes("keyword") && dominantSignalType !== "keyword"
      ? MERGE_BOOST_BY_SIGNAL_TYPE.keyword
      : 0,
    driver: signalTypes.includes("driver") && dominantSignalType !== "driver"
      ? MERGE_BOOST_BY_SIGNAL_TYPE.driver
      : 0,
  };
  const mergeBoost = Object.values(mergeBoostBySignalType).reduce((sum, value) => sum + value, 0);
  const mergedScore = Number(Math.min(1, maxSourceScore + mergeBoost).toFixed(6));
  const observedAt = sorted[0]?.observedAt ?? group.windowStart;
  const algorithmVersion = sorted[0]?.algorithmVersion ?? "anomaly_incident_v1";

  return {
    incidentId: group.id,
    windowStart: group.windowStart,
    windowEnd: group.windowEnd,
    observedAt,
    mergedScore,
    severity: resolveAnomalySeverity(mergedScore),
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
      mergeBoostBySignalType,
      maxSourceScore,
      mergeBoost,
      sourceEvents,
      contractVersion: "anomaly_incident_explain_v1",
      mergeStrategy: "weighted_signal_boost_v1",
    },
  };
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
