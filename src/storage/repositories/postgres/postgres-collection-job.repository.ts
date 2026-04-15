import type {
  CollectionJob,
  CollectionJobStatus,
} from "../../../domain/entities/collection-job";
import type {
  CollectionJobFailurePolicy,
  CollectionJobOperationalSummary,
  CollectionJobRepository,
} from "../../../domain/repositories/collection-job-repository";
import type { SqlQueryable } from "../../postgres/postgres-client";
import { SOURCE_IDS } from "../../postgres/postgres.constants";
import { mapCollectionJob, type CollectionJobRow } from "./postgres-row-mappers";

export class PostgresCollectionJobRepository implements CollectionJobRepository {
  constructor(private readonly db: SqlQueryable) {}

  public async create(job: CollectionJob): Promise<CollectionJob> {
    const inserted = await this.db.query<CollectionJobRow>(
      `
      INSERT INTO collection_job (
        id, source_id, target_id, job_type, crawl_mode, payload, status, scheduled_at, started_at, finished_at, cursor,
        dedupe_key, retry_count, next_run_at, dead_lettered_at, error_message
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      ON CONFLICT (job_type, target_id, dedupe_key) DO NOTHING
      RETURNING id, target_id, job_type, crawl_mode, payload, status, scheduled_at, started_at, finished_at, cursor,
                dedupe_key, retry_count, next_run_at, dead_lettered_at, error_message
      `,
      [
        job.id,
        SOURCE_IDS[job.source],
        job.targetId,
        job.jobType,
        job.crawlMode ?? null,
        JSON.stringify(job.payload ?? {}),
        job.status,
        job.scheduledAt,
        job.startedAt ?? null,
        job.finishedAt ?? null,
        job.cursor ?? null,
        job.dedupeKey,
        job.retryCount,
        job.nextRunAt ?? job.scheduledAt,
        job.deadLetteredAt ?? null,
        job.errorMessage ?? null,
      ],
    );

    if (inserted.rows.length > 0) {
      return mapCollectionJob(inserted.rows[0]);
    }

    const existing = await this.db.query<CollectionJobRow>(
      `
      SELECT id, target_id, job_type, crawl_mode, payload, status, scheduled_at, started_at, finished_at, cursor,
             dedupe_key, retry_count, next_run_at, dead_lettered_at, error_message
      FROM collection_job
      WHERE job_type = $1
        AND target_id = $2
        AND dedupe_key = $3
      LIMIT 1
      `,
      [job.jobType, job.targetId, job.dedupeKey],
    );

    if (existing.rows.length === 0) {
      throw new Error("Collection job create failed and no conflict row found");
    }

    return mapCollectionJob(existing.rows[0]);
  }

  public async claimRunnable(jobId: string, nowIso: string): Promise<boolean> {
    const result = await this.db.query(
      `
      UPDATE collection_job
      SET status = 'running',
          started_at = COALESCE(started_at, NOW()),
          next_run_at = NULL
      WHERE id = $1
        AND status IN ('queued', 'retrying')
        AND COALESCE(next_run_at, scheduled_at) <= $2::timestamptz
      `,
      [jobId, nowIso],
    );
    return (result.rowCount ?? 0) > 0;
  }

  public async updateStatus(
    jobId: string,
    status: CollectionJobStatus,
    errorMessage?: string,
  ): Promise<void> {
    await this.db.query(
      `
      UPDATE collection_job
      SET status = $2,
          error_message = $3,
          started_at = CASE
            WHEN $2 = 'running' THEN COALESCE(started_at, NOW())
            ELSE started_at
          END,
          finished_at = CASE
            WHEN $2 IN ('succeeded', 'failed') THEN NOW()
            ELSE finished_at
          END,
          next_run_at = CASE
            WHEN $2 IN ('running', 'succeeded', 'failed', 'dead_letter') THEN NULL
            ELSE next_run_at
          END,
          dead_lettered_at = CASE
            WHEN $2 = 'dead_letter' THEN COALESCE(dead_lettered_at, NOW())
            ELSE dead_lettered_at
          END
      WHERE id = $1
      `,
      [jobId, status, errorMessage ?? null],
    );
  }

  public async fail(
    jobId: string,
    errorMessage: string,
    policy: CollectionJobFailurePolicy,
  ): Promise<CollectionJob> {
    const nextRunAtIso = new Date(
      new Date(policy.nowIso).getTime() + Math.max(0, policy.retryDelayMs),
    ).toISOString();

    const updated = await this.db.query<CollectionJobRow>(
      `
      UPDATE collection_job
      SET retry_count = retry_count + 1,
          error_message = $2,
          status = CASE
            WHEN retry_count + 1 > $3 THEN 'dead_letter'
            ELSE 'retrying'
          END,
          next_run_at = CASE
            WHEN retry_count + 1 > $3 THEN NULL
            ELSE $4::timestamptz
          END,
          dead_lettered_at = CASE
            WHEN retry_count + 1 > $3 THEN COALESCE(dead_lettered_at, NOW())
            ELSE NULL
          END,
          finished_at = CASE
            WHEN retry_count + 1 > $3 THEN NOW()
            ELSE NULL
          END
      WHERE id = $1
      RETURNING id, target_id, job_type, status, scheduled_at, started_at, finished_at, cursor,
                dedupe_key, retry_count, next_run_at, dead_lettered_at, error_message, crawl_mode, payload
      `,
      [jobId, errorMessage, policy.maxRetries, nextRunAtIso],
    );

    if (updated.rows.length === 0) {
      throw new Error(`Collection job not found: ${jobId}`);
    }
    return mapCollectionJob(updated.rows[0]);
  }

  public async saveCursor(jobId: string, cursor: string): Promise<void> {
    await this.db.query(
      `
      UPDATE collection_job
      SET cursor = $2
      WHERE id = $1
      `,
      [jobId, cursor],
    );
  }

  public async findRunnableJobs(nowIso: string, limit: number): Promise<CollectionJob[]> {
    const result = await this.db.query<CollectionJobRow>(
      `
      SELECT id, target_id, job_type, status, scheduled_at, started_at, finished_at, cursor,
             dedupe_key, retry_count, next_run_at, dead_lettered_at, error_message, crawl_mode, payload
      FROM collection_job
      WHERE status IN ('queued', 'retrying')
        AND COALESCE(next_run_at, scheduled_at) <= $1
      ORDER BY COALESCE(next_run_at, scheduled_at) ASC
      LIMIT $2
      `,
      [nowIso, limit],
    );

    return result.rows.map(mapCollectionJob);
  }

  public async getOperationalSummary(nowIso: string): Promise<CollectionJobOperationalSummary> {
    const result = await this.db.query<{
      queued_due: string | number;
      queued_delayed: string | number;
      retrying_due: string | number;
      retrying_delayed: string | number;
      running: string | number;
      dead_letter: string | number;
      live_queued_due: string | number;
      live_queued_delayed: string | number;
      live_retrying_due: string | number;
      live_retrying_delayed: string | number;
      live_running: string | number;
      live_dead_letter: string | number;
      backfill_queued_due: string | number;
      backfill_queued_delayed: string | number;
      backfill_retrying_due: string | number;
      backfill_retrying_delayed: string | number;
      backfill_running: string | number;
      backfill_dead_letter: string | number;
      default_queued_due: string | number;
      default_queued_delayed: string | number;
      default_retrying_due: string | number;
      default_retrying_delayed: string | number;
      default_running: string | number;
      default_dead_letter: string | number;
    }>(
      `
      SELECT
        COUNT(*) FILTER (
          WHERE status = 'queued'
            AND COALESCE(next_run_at, scheduled_at) <= $1::timestamptz
        ) AS queued_due,
        COUNT(*) FILTER (
          WHERE status = 'queued'
            AND COALESCE(next_run_at, scheduled_at) > $1::timestamptz
        ) AS queued_delayed,
        COUNT(*) FILTER (
          WHERE status = 'retrying'
            AND COALESCE(next_run_at, scheduled_at) <= $1::timestamptz
        ) AS retrying_due,
        COUNT(*) FILTER (
          WHERE status = 'retrying'
            AND COALESCE(next_run_at, scheduled_at) > $1::timestamptz
        ) AS retrying_delayed,
        COUNT(*) FILTER (WHERE status = 'running') AS running,
        COUNT(*) FILTER (WHERE status = 'dead_letter') AS dead_letter,
        COUNT(*) FILTER (
          WHERE crawl_mode = 'live'
            AND status = 'queued'
            AND COALESCE(next_run_at, scheduled_at) <= $1::timestamptz
        ) AS live_queued_due,
        COUNT(*) FILTER (
          WHERE crawl_mode = 'live'
            AND status = 'queued'
            AND COALESCE(next_run_at, scheduled_at) > $1::timestamptz
        ) AS live_queued_delayed,
        COUNT(*) FILTER (
          WHERE crawl_mode = 'live'
            AND status = 'retrying'
            AND COALESCE(next_run_at, scheduled_at) <= $1::timestamptz
        ) AS live_retrying_due,
        COUNT(*) FILTER (
          WHERE crawl_mode = 'live'
            AND status = 'retrying'
            AND COALESCE(next_run_at, scheduled_at) > $1::timestamptz
        ) AS live_retrying_delayed,
        COUNT(*) FILTER (WHERE crawl_mode = 'live' AND status = 'running') AS live_running,
        COUNT(*) FILTER (
          WHERE crawl_mode = 'live'
            AND status = 'dead_letter'
        ) AS live_dead_letter,
        COUNT(*) FILTER (
          WHERE crawl_mode = 'backfill'
            AND status = 'queued'
            AND COALESCE(next_run_at, scheduled_at) <= $1::timestamptz
        ) AS backfill_queued_due,
        COUNT(*) FILTER (
          WHERE crawl_mode = 'backfill'
            AND status = 'queued'
            AND COALESCE(next_run_at, scheduled_at) > $1::timestamptz
        ) AS backfill_queued_delayed,
        COUNT(*) FILTER (
          WHERE crawl_mode = 'backfill'
            AND status = 'retrying'
            AND COALESCE(next_run_at, scheduled_at) <= $1::timestamptz
        ) AS backfill_retrying_due,
        COUNT(*) FILTER (
          WHERE crawl_mode = 'backfill'
            AND status = 'retrying'
            AND COALESCE(next_run_at, scheduled_at) > $1::timestamptz
        ) AS backfill_retrying_delayed,
        COUNT(*) FILTER (
          WHERE crawl_mode = 'backfill'
            AND status = 'running'
        ) AS backfill_running,
        COUNT(*) FILTER (
          WHERE crawl_mode = 'backfill'
            AND status = 'dead_letter'
        ) AS backfill_dead_letter,
        COUNT(*) FILTER (
          WHERE crawl_mode IS NULL
            AND status = 'queued'
            AND COALESCE(next_run_at, scheduled_at) <= $1::timestamptz
        ) AS default_queued_due,
        COUNT(*) FILTER (
          WHERE crawl_mode IS NULL
            AND status = 'queued'
            AND COALESCE(next_run_at, scheduled_at) > $1::timestamptz
        ) AS default_queued_delayed,
        COUNT(*) FILTER (
          WHERE crawl_mode IS NULL
            AND status = 'retrying'
            AND COALESCE(next_run_at, scheduled_at) <= $1::timestamptz
        ) AS default_retrying_due,
        COUNT(*) FILTER (
          WHERE crawl_mode IS NULL
            AND status = 'retrying'
            AND COALESCE(next_run_at, scheduled_at) > $1::timestamptz
        ) AS default_retrying_delayed,
        COUNT(*) FILTER (
          WHERE crawl_mode IS NULL
            AND status = 'running'
        ) AS default_running,
        COUNT(*) FILTER (
          WHERE crawl_mode IS NULL
            AND status = 'dead_letter'
        ) AS default_dead_letter
      FROM collection_job
      `,
      [nowIso],
    );

    const row = result.rows[0];
    return {
      queuedDue: Number(row?.queued_due ?? 0),
      queuedDelayed: Number(row?.queued_delayed ?? 0),
      retryingDue: Number(row?.retrying_due ?? 0),
      retryingDelayed: Number(row?.retrying_delayed ?? 0),
      running: Number(row?.running ?? 0),
      deadLetter: Number(row?.dead_letter ?? 0),
      byMode: {
        live: {
          queuedDue: Number(row?.live_queued_due ?? 0),
          queuedDelayed: Number(row?.live_queued_delayed ?? 0),
          retryingDue: Number(row?.live_retrying_due ?? 0),
          retryingDelayed: Number(row?.live_retrying_delayed ?? 0),
          running: Number(row?.live_running ?? 0),
          deadLetter: Number(row?.live_dead_letter ?? 0),
        },
        backfill: {
          queuedDue: Number(row?.backfill_queued_due ?? 0),
          queuedDelayed: Number(row?.backfill_queued_delayed ?? 0),
          retryingDue: Number(row?.backfill_retrying_due ?? 0),
          retryingDelayed: Number(row?.backfill_retrying_delayed ?? 0),
          running: Number(row?.backfill_running ?? 0),
          deadLetter: Number(row?.backfill_dead_letter ?? 0),
        },
        default: {
          queuedDue: Number(row?.default_queued_due ?? 0),
          queuedDelayed: Number(row?.default_queued_delayed ?? 0),
          retryingDue: Number(row?.default_retrying_due ?? 0),
          retryingDelayed: Number(row?.default_retrying_delayed ?? 0),
          running: Number(row?.default_running ?? 0),
          deadLetter: Number(row?.default_dead_letter ?? 0),
        },
      },
    };
  }
}
