import { buildReadinessState } from "../apps/api/src/readyz-observability";
import { PostgresClient } from "../src/storage/postgres/postgres-client";
import { createPostgresRepositoryBundle } from "../src/storage/repositories/postgres/postgres-repository-bundle";
import { runMigrations } from "../src/storage/schema/run-migrations";
import { runPhase1OnceWithPostgres, type RunMode } from "../workers/reddit-phase1-once";

interface TableCountRow {
  count: string;
}

interface JobRow {
  id: string;
  job_type: string;
  status: string;
  target_id: string;
  scheduled_at: string;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
}

interface RawEventHeaderRow {
  response_headers: Record<string, unknown> | null;
}

async function queryCount(db: PostgresClient, tableName: string): Promise<number> {
  const result = await db.query<TableCountRow>(`SELECT COUNT(*)::text AS count FROM ${tableName}`);
  return Number(result.rows[0]?.count ?? "0");
}

function resolveRunMode(value: string | undefined): RunMode {
  if (value === "mock" || value === "live") {
    return value;
  }
  return "mock";
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    // eslint-disable-next-line no-console
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const runMode = resolveRunMode(process.env.REDDIT_RUN_MODE);
  const subreddit = process.env.REDDIT_RUN_SUBREDDIT ?? "machinelearning";

  const appliedFiles = await runMigrations();
  const runResult = await runPhase1OnceWithPostgres({
    runMode,
    subreddit,
  });

  const db = new PostgresClient();
  try {
    const repositories = createPostgresRepositoryBundle(db);
    const [rawEventCount, contentCount, metricsSnapshotCount, trendPointCount] = await Promise.all([
      queryCount(db, "raw_reddit_event"),
      queryCount(db, "content"),
      queryCount(db, "metrics_snapshot"),
      queryCount(db, "subreddit_trend_point"),
    ]);

    const recentJobs = await db.query<JobRow>(
      `
        SELECT
          id,
          job_type,
          status,
          target_id,
          scheduled_at::text,
          started_at::text,
          finished_at::text,
          error_message
        FROM collection_job
        ORDER BY scheduled_at DESC
        LIMIT 6
      `,
    );
    const recentJobIds = recentJobs.rows.map((job) => job.id);
    const rawEventHeaders =
      recentJobIds.length === 0
        ? []
        : (
            await db.query<RawEventHeaderRow>(
              `
                SELECT response_headers
                FROM raw_reddit_event
                WHERE collection_job_id = ANY($1::uuid[])
                ORDER BY fetched_at DESC
                LIMIT 100
              `,
              [recentJobIds],
            )
          ).rows;
    const scraplingFallbackTransportCounts: Record<string, number> = {};
    let providerFallbackCount = 0;
    for (const row of rawEventHeaders) {
      const headers =
        row.response_headers && typeof row.response_headers === "object"
          ? row.response_headers
          : {};
      const fallbackTransport = headers["x-scrapling-fallback"];
      if (typeof fallbackTransport === "string" && fallbackTransport.trim().length > 0) {
        const key = fallbackTransport.trim().toLowerCase();
        scraplingFallbackTransportCounts[key] =
          (scraplingFallbackTransportCounts[key] ?? 0) + 1;
      }
      const providerFallback = headers["x-provider-fallback"];
      if (typeof providerFallback === "string" && providerFallback.trim().length > 0) {
        providerFallbackCount += 1;
      }
    }
    const readiness = await buildReadinessState({
      repositories,
      nowIso: runResult.nowIso,
    });

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: runMode,
          appliedMigrations: appliedFiles,
          run: runResult,
          counts: {
            raw_reddit_event: rawEventCount,
            content: contentCount,
            metrics_snapshot: metricsSnapshotCount,
            subreddit_trend_point: trendPointCount,
          },
          readiness: {
            status: readiness.status,
            checks: readiness.checks,
            degradedReasons: readiness.degradedReasons,
            observability: readiness.observability,
          },
          fallbackEvidence: {
            sampledRawEvents: rawEventHeaders.length,
            providerFallbackCount,
            scraplingFallbackTransportCounts,
          },
          recentJobs: recentJobs.rows.map((job) => ({
            id: job.id,
            jobType: job.job_type,
            status: job.status,
            targetId: job.target_id,
            scheduledAt: job.scheduled_at,
            startedAt: job.started_at,
            finishedAt: job.finished_at,
            errorMessage: job.error_message,
          })),
        },
        null,
        2,
      ),
    );
  } finally {
    await db.close();
  }
}

void main();
