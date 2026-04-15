import type { MetricsSnapshot } from "../entities/metrics-snapshot";

export interface MetricsSnapshotRepository {
  appendMany(snapshots: MetricsSnapshot[]): Promise<void>;
  listByTargetInRange(args: {
    targetId: string;
    from: string;
    to: string;
    metricNames: string[];
  }): Promise<MetricsSnapshot[]>;
}

