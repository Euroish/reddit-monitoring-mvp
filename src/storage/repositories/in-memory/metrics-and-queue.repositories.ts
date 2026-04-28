import type { CollectionJob, CollectionJobStatus } from "../../../domain/entities/collection-job";
import type { MetricsSnapshot } from "../../../domain/entities/metrics-snapshot";
import type {
  PostEngagementLatest,
  PostEngagementWindow,
} from "../../../domain/entities/post-engagement";
import type {
  CollectionJobOperationalCounters,
  CollectionJobFailurePolicy,
  CollectionJobOperationalSummary,
  CollectionJobRepository,
} from "../../../domain/repositories/collection-job-repository";
import type { MetricsSnapshotRepository } from "../../../domain/repositories/metrics-snapshot-repository";
import type { PostEngagementRepository } from "../../../domain/repositories/post-engagement-repository";

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

  public async listLatestByTargetsInRange(args: {
    targetIds: string[];
    from: string;
    to: string;
    metricNames: string[];
  }): Promise<MetricsSnapshot[]> {
    if (args.targetIds.length === 0) {
      return [];
    }

    const targetSet = new Set(args.targetIds);
    const latestByTarget = new Map<string, MetricsSnapshot>();

    for (const snapshot of this.byUniqueKey.values()) {
      if (!targetSet.has(snapshot.targetId)) {
        continue;
      }
      if (snapshot.snapshotAt < args.from || snapshot.snapshotAt > args.to) {
        continue;
      }
      if (!args.metricNames.includes(snapshot.metricName)) {
        continue;
      }
      const current = latestByTarget.get(snapshot.targetId);
      if (
        !current ||
        snapshot.snapshotAt > current.snapshotAt ||
        (snapshot.snapshotAt === current.snapshotAt && (snapshot.id ?? 0) > (current.id ?? 0))
      ) {
        latestByTarget.set(snapshot.targetId, snapshot);
      }
    }

    return Array.from(latestByTarget.values()).sort((a, b) => a.targetId.localeCompare(b.targetId));
  }

  public all(): MetricsSnapshot[] {
    return Array.from(this.byUniqueKey.values());
  }
}

export class InMemoryPostEngagementRepository implements PostEngagementRepository {
  private readonly latestByContentId = new Map<string, PostEngagementLatest>();
  private readonly windowsByKey = new Map<string, PostEngagementWindow>();

  public async upsertLatestMany(rows: PostEngagementLatest[]): Promise<void> {
    for (const row of rows) {
      const current = this.latestByContentId.get(row.contentId);
      if (!current || row.observedAt >= current.observedAt) {
        this.latestByContentId.set(row.contentId, mergeLatest(current, row));
      }
    }
  }

  public async upsertWindowedMany(rows: PostEngagementWindow[]): Promise<void> {
    for (const row of rows) {
      const key = `${row.targetId}|${row.contentId}|${row.windowStart}`;
      const current = this.windowsByKey.get(key);
      if (!current || row.observedAt >= current.observedAt) {
        this.windowsByKey.set(key, mergeWindow(current, row));
      }
    }
  }

  public async listLatestByContentIdsInRange(args: {
    contentIds: string[];
    from: string;
    to: string;
  }): Promise<PostEngagementLatest[]> {
    const contentIds = new Set(args.contentIds);
    return Array.from(this.latestByContentId.values())
      .filter((row) => {
        return (
          contentIds.has(row.contentId) &&
          row.observedAt >= args.from &&
          row.observedAt <= args.to
        );
      })
      .sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.contentId.localeCompare(b.contentId));
  }

  public async listWindowedByTargetInRange(args: {
    targetId: string;
    from: string;
    to: string;
  }): Promise<PostEngagementWindow[]> {
    return Array.from(this.windowsByKey.values())
      .filter((row) => {
        return (
          row.targetId === args.targetId &&
          row.windowStart >= args.from &&
          row.windowStart <= args.to
        );
      })
      .sort((a, b) => a.windowStart.localeCompare(b.windowStart) || a.contentId.localeCompare(b.contentId));
  }

  public allLatest(): PostEngagementLatest[] {
    return Array.from(this.latestByContentId.values());
  }

  public allWindows(): PostEngagementWindow[] {
    return Array.from(this.windowsByKey.values());
  }
}

function mergeLatest(
  current: PostEngagementLatest | undefined,
  next: PostEngagementLatest,
): PostEngagementLatest {
  if (!current) {
    return next;
  }
  return {
    ...next,
    score: next.score ?? current.score,
    numComments: next.numComments ?? current.numComments,
    upvoteRatio: next.upvoteRatio ?? current.upvoteRatio,
  };
}

function mergeWindow(
  current: PostEngagementWindow | undefined,
  next: PostEngagementWindow,
): PostEngagementWindow {
  if (!current) {
    return next;
  }
  return {
    ...next,
    score: next.score ?? current.score,
    numComments: next.numComments ?? current.numComments,
    upvoteRatio: next.upvoteRatio ?? current.upvoteRatio,
  };
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
