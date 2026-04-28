import type { SqlQueryable } from "../storage/postgres/postgres-client";

interface DeleteIdRow {
  id: number;
}

interface DeleteMetricRow {
  target_id: string;
  snapshot_at: string;
  metric_name: string;
  content_id: string | null;
}

export interface RetentionPruneConfig {
  enabled: boolean;
  intervalMinutes: number;
  rawEventRetentionDays: number;
  rawEventBatchSize: number;
  rawEventLoopUntilDone: boolean;
  metricsSnapshotRetentionDays: number;
  metricsSnapshotBatchSize: number;
  metricsSnapshotLoopUntilDone: boolean;
  postEngagementWindowRetentionDays: number;
  postEngagementWindowBatchSize: number;
  postEngagementWindowLoopUntilDone: boolean;
}

export interface RetentionPruneResult {
  rawEventsDeleted: number;
  metricsSnapshotsDeleted: number;
  postEngagementWindowsDeleted: number;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null) {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  return fallback;
}

export function resolveRetentionPruneConfig(
  env: NodeJS.ProcessEnv = process.env,
): RetentionPruneConfig {
  return {
    enabled: parseBoolean(env.REDDIT_RETENTION_PRUNE_ENABLED, true),
    intervalMinutes: parsePositiveInt(env.REDDIT_RETENTION_PRUNE_INTERVAL_MINUTES, 360),
    rawEventRetentionDays: parsePositiveInt(env.RAW_EVENT_RETENTION_DAYS, 7),
    rawEventBatchSize: parsePositiveInt(env.RAW_EVENT_PRUNE_BATCH_SIZE, 5000),
    rawEventLoopUntilDone: parseBoolean(env.RAW_EVENT_PRUNE_LOOP, true),
    metricsSnapshotRetentionDays: parsePositiveInt(env.METRICS_SNAPSHOT_RETENTION_DAYS, 30),
    metricsSnapshotBatchSize: parsePositiveInt(env.METRICS_SNAPSHOT_PRUNE_BATCH_SIZE, 10000),
    metricsSnapshotLoopUntilDone: parseBoolean(env.METRICS_SNAPSHOT_PRUNE_LOOP, true),
    postEngagementWindowRetentionDays: parsePositiveInt(
      env.POST_ENGAGEMENT_WINDOW_RETENTION_DAYS,
      7,
    ),
    postEngagementWindowBatchSize: parsePositiveInt(
      env.POST_ENGAGEMENT_WINDOW_PRUNE_BATCH_SIZE,
      10000,
    ),
    postEngagementWindowLoopUntilDone: parseBoolean(
      env.POST_ENGAGEMENT_WINDOW_PRUNE_LOOP,
      true,
    ),
  };
}

export function shouldRunRetentionPrune(args: {
  config: RetentionPruneConfig;
  nowIso: string;
  lastRunAtIso?: string;
}): boolean {
  if (!args.config.enabled) {
    return false;
  }
  if (!args.lastRunAtIso) {
    return true;
  }
  const nowMs = new Date(args.nowIso).getTime();
  const lastRunMs = new Date(args.lastRunAtIso).getTime();
  if (!Number.isFinite(nowMs) || !Number.isFinite(lastRunMs)) {
    return true;
  }
  return nowMs - lastRunMs >= args.config.intervalMinutes * 60 * 1000;
}

export async function runRetentionPrune(args: {
  db: SqlQueryable;
  config: RetentionPruneConfig;
}): Promise<RetentionPruneResult> {
  const rawEventsDeleted = await pruneRawEvents(args.db, {
    retentionDays: args.config.rawEventRetentionDays,
    batchSize: args.config.rawEventBatchSize,
    loopUntilDone: args.config.rawEventLoopUntilDone,
  });
  const metricsSnapshotsDeleted = await pruneMetricsSnapshots(args.db, {
    retentionDays: args.config.metricsSnapshotRetentionDays,
    batchSize: args.config.metricsSnapshotBatchSize,
    loopUntilDone: args.config.metricsSnapshotLoopUntilDone,
  });
  const postEngagementWindowsDeleted = await prunePostEngagementWindows(args.db, {
    retentionDays: args.config.postEngagementWindowRetentionDays,
    batchSize: args.config.postEngagementWindowBatchSize,
    loopUntilDone: args.config.postEngagementWindowLoopUntilDone,
  });
  return {
    rawEventsDeleted,
    metricsSnapshotsDeleted,
    postEngagementWindowsDeleted,
  };
}

export async function pruneRawEvents(
  db: SqlQueryable,
  args: {
    retentionDays: number;
    batchSize: number;
    loopUntilDone: boolean;
  },
): Promise<number> {
  let totalDeleted = 0;
  while (true) {
    const deleted = await db.query<DeleteIdRow>(
      `
      WITH candidates AS (
        SELECT id
        FROM raw_reddit_event
        WHERE fetched_at < NOW() - ($1::int * INTERVAL '1 day')
        ORDER BY fetched_at ASC
        LIMIT $2
      )
      DELETE FROM raw_reddit_event r
      USING candidates c
      WHERE r.id = c.id
      RETURNING r.id
      `,
      [args.retentionDays, args.batchSize],
    );
    const deletedCount = deleted.rows.length;
    totalDeleted += deletedCount;
    if (!args.loopUntilDone || deletedCount < args.batchSize) {
      return totalDeleted;
    }
  }
}

export async function pruneMetricsSnapshots(
  db: SqlQueryable,
  args: {
    retentionDays: number;
    batchSize: number;
    loopUntilDone: boolean;
  },
): Promise<number> {
  let totalDeleted = 0;
  while (true) {
    const deleted = await db.query<DeleteMetricRow>(
      `
      WITH candidates AS (
        SELECT target_id, snapshot_at, metric_name, content_id
        FROM metrics_snapshot
        WHERE content_id IS NULL
          AND snapshot_at < NOW() - ($1::int * INTERVAL '1 day')
        ORDER BY snapshot_at ASC
        LIMIT $2
      )
      DELETE FROM metrics_snapshot m
      USING candidates c
      WHERE m.target_id = c.target_id
        AND m.snapshot_at = c.snapshot_at
        AND m.metric_name = c.metric_name
        AND m.content_id IS NOT DISTINCT FROM c.content_id
      RETURNING m.target_id, m.snapshot_at, m.metric_name, m.content_id
      `,
      [args.retentionDays, args.batchSize],
    );
    const deletedCount = deleted.rows.length;
    totalDeleted += deletedCount;
    if (!args.loopUntilDone || deletedCount < args.batchSize) {
      return totalDeleted;
    }
  }
}

export async function prunePostEngagementWindows(
  db: SqlQueryable,
  args: {
    retentionDays: number;
    batchSize: number;
    loopUntilDone: boolean;
  },
): Promise<number> {
  let totalDeleted = 0;
  while (true) {
    const deleted = await db.query<DeleteIdRow>(
      `
      WITH candidates AS (
        SELECT target_id, content_id, window_start
        FROM post_engagement_window
        WHERE window_start < NOW() - ($1::int * INTERVAL '1 day')
        ORDER BY window_start ASC
        LIMIT $2
      )
      DELETE FROM post_engagement_window w
      USING candidates c
      WHERE w.target_id = c.target_id
        AND w.content_id = c.content_id
        AND w.window_start = c.window_start
      RETURNING 1 AS id
      `,
      [args.retentionDays, args.batchSize],
    );
    const deletedCount = deleted.rows.length;
    totalDeleted += deletedCount;
    if (!args.loopUntilDone || deletedCount < args.batchSize) {
      return totalDeleted;
    }
  }
}
