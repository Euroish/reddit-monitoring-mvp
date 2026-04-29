import type { MonitorTarget } from "../entities/monitor-target";

export interface MonitorTargetRepository {
  listSubreddits(): Promise<MonitorTarget[]>;
  findActiveSubreddits(): Promise<MonitorTarget[]>;
  findById(targetId: string): Promise<MonitorTarget | null>;
  findByCanonicalName(canonicalName: string): Promise<MonitorTarget | null>;
  upsert(target: MonitorTarget): Promise<MonitorTarget>;
}
