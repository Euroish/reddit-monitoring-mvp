import type { AnomalyEvent, AnomalySignalType } from "../entities/anomaly-event";

export interface AnomalyEventRepository {
  upsertMany(rows: AnomalyEvent[]): Promise<void>;
  listByTargetInRange(args: {
    targetId: string;
    fromIso: string;
    toIso: string;
    signalTypes?: AnomalySignalType[];
    limit?: number;
  }): Promise<AnomalyEvent[]>;
}
