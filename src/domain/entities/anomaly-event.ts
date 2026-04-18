import type { ISODateTime, UUID } from "../../shared/types/common";

export type AnomalySignalType = "volume" | "quality" | "keyword" | "driver";

export interface AnomalyEvent {
  targetId: UUID;
  signalType: AnomalySignalType;
  signalKey: string;
  observedAt: ISODateTime;
  windowStart?: ISODateTime;
  windowEnd?: ISODateTime;
  anomalyScore: number;
  algorithmVersion: string;
  explainPayload: Record<string, unknown>;
  updatedAt?: ISODateTime;
}
