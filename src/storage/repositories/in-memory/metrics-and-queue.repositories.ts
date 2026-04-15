import type { CollectionJob, CollectionJobStatus } from "../../../domain/entities/collection-job";
import type { MetricsSnapshot } from "../../../domain/entities/metrics-snapshot";
import type {
  CollectionJobOperationalCounters,
  CollectionJobFailurePolicy,
  CollectionJobOperationalSummary,
  CollectionJobRepository,
} from "../../../domain/repositories/collection-job-repository";
import type { MetricsSnapshotRepository } from "../../../domain/repositories/metrics-snapshot-repository";

export class InMemoryMetricsSnapshotRepository implements MetricsSnapshotRepository {
  private readonly byUniqueKey = new Map<string, MetricsSnapshot>();

  public async appendMany(snapshots: MetricsSnapshot[]): Promise<void> {
    for (const snapshot of snapshots) {
      const key = [
        snapshot.targetId,
        snapshot.contentId ?? "target-level",
        snapshot.granularity,
        snapshot.metricName,
        snapshot.snapshotAt,
      ].join("|");
      this.byUniqueKey.set(key, snapshot);
    }
  }

  public async listByTargetInRange(args: {
    targetId: string;
    from: string;
    to: string;
    metricNames: string[];
  }): Promise<MetricsSnapshot[]> {
    return Array.from(this.byUniqueKey.values()).filter((snapshot) => {
      return (
        snapshot.targetId === args.targetId &&
        snapshot.snapshotAt >= args.from &&
        snapshot.snapshotAt <= args.to &&
        args.metricNames.includes(snapshot.metricName)
      );
    });
  }

  public all(): MetricsSnapshot[] {
    return Array.from(this.byUniqueKey.values());
  }
}

export class InMemoryCollectionJobRepository implements CollectionJobRepository {
  private readonly byId = new Map<string, CollectionJob>();

  public async create(job: CollectionJob): Promise<CollectionJob> {
    if (!this.byId.has(job.id)) {
      this.byId.set(job.id, {
        ...job,
        crawlMode: job.crawlMode,
        payload: job.payload ? { ...job.payload } : undefined,
        nextRunAt: job.nextRunAt ?? job.scheduledAt,
      });
    }
    return this.byId.get(job.id)!;
  }

  public async claimRunnable(jobId: string, nowIso: string): Promise<boolean> {
    const current = this.byId.get(jobId);
    if (!current) {
      return false;
    }
    const dueAt = current.nextRunAt ?? current.scheduledAt;
    if ((current.status !== "queued" && current.status !== "retrying") || dueAt > nowIso) {
      return false;
    }
    current.status = "running";
    current.startedAt = current.startedAt ?? nowIso;
    current.nextRunAt = undefined;
    this.byId.set(jobId, current);
    return true;
  }

  public async updateStatus(
    jobId: string,
    status: CollectionJobStatus,
    errorMessage?: string,
  ): Promise<void> {
    const current = this.byId.get(jobId);
    if (!current) {
      return;
    }
    current.status = status;
    if (status === "running") {
      current.startedAt = new Date().toISOString();
      current.nextRunAt = undefined;
    }
    if (status === "succeeded" || status === "failed") {
      current.finishedAt = new Date().toISOString();
      current.nextRunAt = undefined;
    }
    if (status === "dead_letter") {
      const nowIso = new Date().toISOString();
      current.finishedAt = nowIso;
      current.deadLetteredAt = nowIso;
      current.nextRunAt = undefined;
    }
    current.errorMessage = errorMessage;
    this.byId.set(jobId, current);
  }

  public async fail(
    jobId: string,
    errorMessage: string,
    policy: CollectionJobFailurePolicy,
  ): Promise<CollectionJob> {
    const current = this.byId.get(jobId);
    if (!current) {
      throw new Error(`Collection job not found: ${jobId}`);
    }

    const nextRetryCount = current.retryCount + 1;
    current.retryCount = nextRetryCount;
    current.errorMessage = errorMessage;

    if (nextRetryCount > policy.maxRetries) {
      current.status = "dead_letter";
      current.deadLetteredAt = policy.nowIso;
      current.finishedAt = policy.nowIso;
      current.nextRunAt = undefined;
    } else {
      current.status = "retrying";
      current.nextRunAt = new Date(
        new Date(policy.nowIso).getTime() + Math.max(0, policy.retryDelayMs),
      ).toISOString();
      current.finishedAt = undefined;
      current.deadLetteredAt = undefined;
    }

    this.byId.set(jobId, current);
    return { ...current, payload: current.payload ? { ...current.payload } : undefined };
  }

  public async saveCursor(jobId: string, cursor: string): Promise<void> {
    const current = this.byId.get(jobId);
    if (!current) {
      return;
    }
    current.cursor = cursor;
    this.byId.set(jobId, current);
  }

  public async findRunnableJobs(nowIso: string, limit: number): Promise<CollectionJob[]> {
    return Array.from(this.byId.values())
      .filter((job) => {
        return (
          (job.status === "queued" || job.status === "retrying") &&
          (job.nextRunAt ?? job.scheduledAt) <= nowIso
        );
      })
      .sort((a, b) => (a.nextRunAt ?? a.scheduledAt).localeCompare(b.nextRunAt ?? b.scheduledAt))
      .slice(0, limit);
  }

  public async getOperationalSummary(nowIso: string): Promise<CollectionJobOperationalSummary> {
    const byMode = {
      live: createOperationalCounters(),
      backfill: createOperationalCounters(),
      default: createOperationalCounters(),
    } satisfies CollectionJobOperationalSummary["byMode"];
    const summary: CollectionJobOperationalSummary = {
      queuedDue: 0,
      queuedDelayed: 0,
      retryingDue: 0,
      retryingDelayed: 0,
      running: 0,
      deadLetter: 0,
      byMode,
    };

    for (const job of this.byId.values()) {
      const modeSummary = summary.byMode[job.crawlMode ?? "default"];
      if (job.status === "running") {
        summary.running += 1;
        modeSummary.running += 1;
        continue;
      }
      if (job.status === "dead_letter") {
        summary.deadLetter += 1;
        modeSummary.deadLetter += 1;
        continue;
      }
      if (job.status !== "queued" && job.status !== "retrying") {
        continue;
      }

      const dueAt = job.nextRunAt ?? job.scheduledAt;
      const isDue = dueAt <= nowIso;
      if (job.status === "queued") {
        if (isDue) {
          summary.queuedDue += 1;
          modeSummary.queuedDue += 1;
        } else {
          summary.queuedDelayed += 1;
          modeSummary.queuedDelayed += 1;
        }
        continue;
      }
      if (isDue) {
        summary.retryingDue += 1;
        modeSummary.retryingDue += 1;
      } else {
        summary.retryingDelayed += 1;
        modeSummary.retryingDelayed += 1;
      }
    }

    return summary;
  }

  public all(): CollectionJob[] {
    return Array.from(this.byId.values());
  }
}

function createOperationalCounters(): CollectionJobOperationalCounters {
  return {
    queuedDue: 0,
    queuedDelayed: 0,
    retryingDue: 0,
    retryingDelayed: 0,
    running: 0,
    deadLetter: 0,
  };
}
