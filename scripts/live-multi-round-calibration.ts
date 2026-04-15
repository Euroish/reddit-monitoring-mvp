import { setTimeout as delay } from "node:timers/promises";
import { buildReadinessState } from "../apps/api/src/readyz-observability";
import { stableUuidFromString } from "../src/shared/ids/stable-id";
import { PostgresClient } from "../src/storage/postgres/postgres-client";
import { createPostgresRepositoryBundle } from "../src/storage/repositories/postgres/postgres-repository-bundle";
import { runMigrations } from "../src/storage/schema/run-migrations";
import { runPhase1OnceWithPostgres } from "../workers/reddit-phase1-once";

interface SamplingEvent {
  event: "reddit.sampling_plan.selected";
  targetId: string;
  providerProfile: "http_primary" | "generic";
  tier: "base" | "elevated" | "boost";
  limit: number;
  pressure: number;
  reasons: string[];
}

interface LatestMetricRow {
  metric_value: string;
}

interface LatestJobRow {
  payload: Record<string, unknown> | null;
}

interface RunObservation {
  round: number;
  subreddit: string;
  targetId: string;
  nowIso: string;
  runOk: boolean;
  runError: string | null;
  tier: "base" | "elevated" | "boost" | null;
  limit: number | null;
  pressure: number | null;
  severeStaleHead: boolean;
  duplicatePostRate: number | null;
  ingestLagSeconds: number | null;
  fetchSuccessRate: number | null;
  newPosts15m: number | null;
  jobPostLimit: number | null;
  readinessStatus: "ready" | "degraded" | "not_ready";
  readinessReasons: string[];
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function toDuplicateRate(args: {
  duplicatePostCount: number;
  candidateCount: number;
  acceptedCount: number;
}): number | null {
  const denominator = args.candidateCount > 0 ? args.candidateCount : args.acceptedCount;
  if (denominator <= 0) {
    return null;
  }
  return Number((args.duplicatePostCount / denominator).toFixed(6));
}

function toAverage(sum: number, count: number): number | null {
  if (count <= 0) {
    return null;
  }
  return Number((sum / count).toFixed(3));
}

function tryParseSamplingEvent(line: string): SamplingEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as Partial<SamplingEvent>;
    if (parsed.event !== "reddit.sampling_plan.selected") {
      return null;
    }
    if (
      typeof parsed.targetId !== "string" ||
      typeof parsed.providerProfile !== "string" ||
      typeof parsed.tier !== "string" ||
      typeof parsed.limit !== "number" ||
      typeof parsed.pressure !== "number" ||
      !Array.isArray(parsed.reasons)
    ) {
      return null;
    }
    return parsed as SamplingEvent;
  } catch {
    return null;
  }
}

function captureSamplingEvent(
  logs: string[],
): SamplingEvent | null {
  for (let i = logs.length - 1; i >= 0; i -= 1) {
    const event = tryParseSamplingEvent(logs[i]!);
    if (event) {
      return event;
    }
  }
  return null;
}

async function resolveLatestNewPostsMetric(args: {
  db: PostgresClient;
  targetId: string;
}): Promise<number | null> {
  const result = await args.db.query<LatestMetricRow>(
    `
      SELECT metric_value::text
      FROM metrics_snapshot
      WHERE target_id = $1
        AND metric_name = 'new_posts_15m'
      ORDER BY snapshot_at DESC
      LIMIT 1
    `,
    [args.targetId],
  );
  const raw = result.rows[0]?.metric_value;
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

async function resolveLatestJobPostLimit(args: {
  db: PostgresClient;
  targetId: string;
}): Promise<number | null> {
  const result = await args.db.query<LatestJobRow>(
    `
      SELECT payload
      FROM collection_job
      WHERE target_id = $1
        AND job_type = 'collect_subreddit_new_posts'
      ORDER BY scheduled_at DESC
      LIMIT 1
    `,
    [args.targetId],
  );
  const payload = result.rows[0]?.payload;
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const raw = payload.postLimit;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function summarizeBySubreddit(rows: RunObservation[]): Array<Record<string, unknown>> {
  const bySubreddit = new Map<string, RunObservation[]>();
  for (const row of rows) {
    const bucket = bySubreddit.get(row.subreddit) ?? [];
    bucket.push(row);
    bySubreddit.set(row.subreddit, bucket);
  }

  const summary: Array<Record<string, unknown>> = [];
  for (const [subreddit, bucket] of bySubreddit.entries()) {
    const duplicateRates = bucket
      .map((row) => row.duplicatePostRate)
      .filter((value): value is number => value != null);
    const ingestLags = bucket
      .map((row) => row.ingestLagSeconds)
      .filter((value): value is number => value != null);
    const newPosts = bucket
      .map((row) => row.newPosts15m)
      .filter((value): value is number => value != null);
    const limits = bucket
      .map((row) => row.limit)
      .filter((value): value is number => value != null);

    const tierCounts = bucket.reduce(
      (acc, row) => {
        if (row.tier) {
          acc[row.tier] += 1;
        }
        return acc;
      },
      { base: 0, elevated: 0, boost: 0 },
    );

    summary.push({
      subreddit,
      rounds: bucket.length,
      avgDuplicatePostRate:
        duplicateRates.length > 0
          ? Number(
              (
                duplicateRates.reduce((sum, value) => sum + value, 0) /
                duplicateRates.length
              ).toFixed(6),
            )
          : null,
      avgIngestLagSeconds:
        ingestLags.length > 0
          ? Number(
              (
                ingestLags.reduce((sum, value) => sum + value, 0) / ingestLags.length
              ).toFixed(3),
            )
          : null,
      avgNewPosts15m:
        newPosts.length > 0
          ? Number(
              (
                newPosts.reduce((sum, value) => sum + value, 0) / newPosts.length
              ).toFixed(3),
            )
          : null,
      avgSamplingLimit:
        limits.length > 0
          ? Number(
              (
                limits.reduce((sum, value) => sum + value, 0) / limits.length
              ).toFixed(3),
            )
          : null,
      severeStaleHeadRuns: bucket.filter((row) => row.severeStaleHead).length,
      tierCounts,
      degradedRuns: bucket.filter((row) => row.readinessStatus !== "ready").length,
    });
  }

  return summary.sort((left, right) =>
    String(left.subreddit).localeCompare(String(right.subreddit)),
  );
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    // eslint-disable-next-line no-console
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const rounds = parsePositiveInt(process.env.REDDIT_MULTI_ROUNDS, 3);
  const pauseMs = parsePositiveInt(process.env.REDDIT_MULTI_PAUSE_MS, 250);
  const stepMinutes = parsePositiveInt(process.env.REDDIT_MULTI_STEP_MINUTES, 6);
  const subreddits = (process.env.REDDIT_MULTI_SUBREDDITS ??
    "machinelearning,datascience,programming,technology,artificial,learnmachinelearning,computervision,dataisbeautiful")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);

  const appliedMigrations = await runMigrations();
  const db = new PostgresClient();
  const repositories = createPostgresRepositoryBundle(db);
  const observations: RunObservation[] = [];
  const startMs = Date.now();

  try {
    for (let round = 1; round <= rounds; round += 1) {
      for (let subredditIndex = 0; subredditIndex < subreddits.length; subredditIndex += 1) {
        const subreddit = subreddits[subredditIndex]!;
        const logs: string[] = [];
        const originalConsoleLog = console.log;
        console.log = (...args: unknown[]) => {
          const line = args
            .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
            .join(" ");
          logs.push(line);
        };

        const runOrdinal = (round - 1) * subreddits.length + subredditIndex;
        let runNowIso = new Date(startMs + runOrdinal * stepMinutes * 60 * 1000).toISOString();
        let runOk = true;
        let runError: string | null = null;
        try {
          const runResult = await runPhase1OnceWithPostgres({
            subreddit,
            runMode: "live",
            nowIso: runNowIso,
            db,
          });
          runNowIso = runResult.nowIso;
        } catch (error) {
          runOk = false;
          runError = error instanceof Error ? error.message : "unknown error";
        } finally {
          console.log = originalConsoleLog;
        }

        const samplingEvent = captureSamplingEvent(logs);
        const targetId = stableUuidFromString(`reddit:target:r/${subreddit}`);
        const healthFromIso = new Date(
          new Date(runNowIso).getTime() - 30 * 60 * 1000,
        ).toISOString();
        const providerHealth =
          await repositories.providerHealthWindowRepository.summarizeByProviderInRange({
            targetId,
            from: healthFromIso,
            to: runNowIso,
            mode: "live",
          });
        const preferredProvider =
          providerHealth.find((item) => item.provider === "http") ?? providerHealth[0];

        const duplicatePostRate = preferredProvider
          ? toDuplicateRate({
              duplicatePostCount: preferredProvider.duplicatePostCount,
              candidateCount: preferredProvider.candidateCount,
              acceptedCount: preferredProvider.acceptedCount,
            })
          : null;
        const ingestLagSeconds = preferredProvider
          ? toAverage(
              preferredProvider.ingestLagSecondsSum,
              preferredProvider.ingestLagSampleCount,
            )
          : null;
        const fetchSuccessRate = preferredProvider
          ? preferredProvider.requestCount > 0
            ? Number(
                (preferredProvider.successCount / preferredProvider.requestCount).toFixed(6),
              )
            : null
          : null;
        const readiness = await buildReadinessState({
          repositories,
          nowIso: runNowIso,
        });
        const newPosts15m = await resolveLatestNewPostsMetric({
          db,
          targetId,
        });
        const jobPostLimit = await resolveLatestJobPostLimit({
          db,
          targetId,
        });

        observations.push({
          round,
          subreddit,
          targetId,
          nowIso: runNowIso,
          runOk,
          runError,
          tier: samplingEvent?.tier ?? null,
          limit: samplingEvent?.limit ?? null,
          pressure: samplingEvent?.pressure ?? null,
          severeStaleHead: samplingEvent?.reasons.includes("severe_stale_head") ?? false,
          duplicatePostRate,
          ingestLagSeconds,
          fetchSuccessRate,
          newPosts15m,
          jobPostLimit,
          readinessStatus: readiness.status,
          readinessReasons: readiness.degradedReasons,
        });

        await delay(pauseMs);
      }
    }

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          ok: true,
          appliedMigrations,
          rounds,
          stepMinutes,
          subreddits,
          runCount: observations.length,
          failedRuns: observations.filter((item) => !item.runOk).length,
          observations,
          bySubreddit: summarizeBySubreddit(observations),
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
