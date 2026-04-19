import type { AnomalyEvent, AnomalySignalType } from "../../domain/entities/anomaly-event";

export function buildAnomalyEventId(event: Pick<AnomalyEvent, "signalType" | "signalKey" | "observedAt">): string {
  return `${event.signalType}:${event.signalKey}:${event.observedAt}`;
}

export function parseAnomalyEventId(value: string): {
  signalType: AnomalySignalType;
  signalKey: string;
  observedAt: string;
} | null {
  const firstColon = value.indexOf(":");
  const secondColon = value.indexOf(":", firstColon + 1);
  if (firstColon <= 0 || secondColon <= firstColon + 1 || secondColon >= value.length - 1) {
    return null;
  }
  const signalType = value.slice(0, firstColon);
  if (
    signalType !== "volume" &&
    signalType !== "quality" &&
    signalType !== "keyword" &&
    signalType !== "driver"
  ) {
    return null;
  }
  return {
    signalType,
    signalKey: value.slice(firstColon + 1, secondColon),
    observedAt: value.slice(secondColon + 1),
  };
}
