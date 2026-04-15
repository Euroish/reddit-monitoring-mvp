import type { CollectionJob, CollectionJobStatus } from "../entities/collection-job";
import type { CrawlMode } from "../entities/crawl-cursor";

export interface CollectionJobFailurePolicy {
  nowIso: string;
  maxRetries: number;
  retryDelayMs: number;
}

export interface CollectionJobOperationalCounters {
  queuedDue: number;
  queuedDelayed: number;
  retryingDue: number;
  retryingDelayed: number;
  running: number;
  deadLetter: number;
}

export type CollectionJobQueueMode = CrawlMode | "default";

export interface CollectionJobOperationalSummary extends CollectionJobOperationalCounters {
  byMode: Record<CollectionJobQueueMode, CollectionJobOperationalCounters>;
}

export interface CollectionJobRepository {
  create(job: CollectionJob): Promise<CollectionJob>;
  claimRunnable(jobId: string, nowIso: string): Promise<boolean>;
  updateStatus(jobId: string, status: CollectionJobStatus, errorMessage?: string): Promise<void>;
  fail(jobId: string, errorMessage: string, policy: CollectionJobFailurePolicy): Promise<CollectionJob>;
  saveCursor(jobId: string, cursor: string): Promise<void>;
  findRunnableJobs(nowIso: string, limit: number): Promise<CollectionJob[]>;
  getOperationalSummary(nowIso: string): Promise<CollectionJobOperationalSummary>;
}
