import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildReadinessState } from "../apps/api/src/readyz-observability";
import { READYZ_THRESHOLDS } from "../apps/api/src/readyz-thresholds";
import {
  resolveRedditProviderRoutingPolicyContextFromEnv,
  resolveRedditTargetExecutionRoute,
} from "../src/runtime/reddit-provider-routing-policy";
import { stableUuidFromString } from "../src/shared/ids/stable-id";
import { buildDedupeKey, floorToWindow } from "../src/shared/time/windowing";
import {
  parseNonNegativeInt,
  parsePositiveInt,
  parseSubredditList,
} from "../src/runtime/runtime-parsing";
import { PostgresClient } from "../src/storage/postgres/postgres-client";
import { createPostgresRepositoryBundle } from "../src/storage/repositories/postgres/postgres-repository-bundle";
import { runMigrations } from "../src/storage/schema/run-migrations";
import { runPhase1OnceWithPostgres } from "../workers/reddit-phase1-once";

interface JobRow {
  id: string;
}

interface RawEventHeaderRow {
  response_headers: Record<string, unknown> | null;
}

interface TargetHeadAgeRow {
  latest_post_age_seconds: number | string | null;
}

interface LocalProviderHealth {
  provider: string;
  requestCount: number;
  successCount: number;
  fallbackCount: number;
  timeoutCount: number;
  errorCount: number;
  duplicatePostCount: number;
  emptyResponseCount: number;
  candidateCount: number;
  acceptedCount: number;
  filteredOutCount: number;
  ingestLagSecondsSum: number;
  ingestLagSampleCount: number;
  providerDiffCount: number;
  providerDiffSampleCount: number;
  rateLimitCount: number;
  circuitOpenCount: number;
  scraplingHttpProfileCount: number;
  scraplingDynamicProfileCount: number;
  scraplingStealthProfileCount: number;
  scraplingSessionKeyCount: number;
  scraplingSessionKeyReuseCount: number;
}

interface LocalTargetReadiness {
  status: "ready" | "degraded";
  degradedReasons: string[];
  staleHeadSuppressedProviders: string[];
  latestContentAgeSeconds: number | null;
}

interface VerifyCycle {
  subreddit: string;
  requestedNowIso: string;
  nowIso: string;
  windowShiftCount: number;
  runExecution: {
    ok: boolean;
    error: string | null;
    startedAtIso: string;
    finishedAtIso: string | null;
    executedJobCount: number;
  };
  globalReadinessStatus: "ready" | "degraded" | "not_ready";
  globalDegradedReasons: string[];
  localTargetReadinessStatus: "ready" | "degraded";
  localTargetDegradedReasons: string[];
  globalOnlyDegradedReasons: string[];
  localOnlyDegradedReasons: string[];
  isPromotedTarget: boolean;
  providerHealth: Array<{
    provider: string;
    requestCount: number;
    successCount: number;
    fallbackCount: number;
    timeoutCount: number;
    errorCount: number;
    duplicatePostCount: number;
    candidateCount: number;
    acceptedCount: number;
    duplicatePostRate: number | null;
    ingestLagSeconds: number | null;
  }>;
  targetFreshness: {
    latestContentAgeSeconds: number | null;
    staleHeadSuppressedProviders: string[];
  };
  fallbackEvidence: {
    sampledRawEvents: number;
    providerFallbackCount: number;
    scraplingFallbackTransportCounts: Record<string, number>;
  };
  scraplingEvidence: {
    requestCount: number;
    sessionKeyObservedRate: number | null;
    sessionKeyReuseRate: number | null;
    byProfile: Array<{
      profile: "http" | "dynamic" | "stealth";
      requestCount: number;
    }>;
  };
  runLocalScraplingEvidence: {
    sampledJobs: number;
    sampledRawEvents: number;
    requestCount: number;
    sessionKeyObservedRate: number | null;
    sessionKeyReuseRate: number | null;
    byProfile: Array<{
      profile: "http" | "dynamic" | "stealth";
      requestCount: number;
    }>;
  };
  routingDecision: {
    providerHint: string;
    scraplingProfile: "http" | "dynamic" | "stealth" | null;
    routingClass: string;
    reasons: string[];
  };
}

function toRate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function toDuplicatePostRate(args: {
  duplicatePostCount: number;
  candidateCount: number;
  acceptedCount: number;
}): number | null {
  const denominator = args.candidateCount > 0 ? args.candidateCount : args.acceptedCount;
  if (denominator <= 0) {
    return null;
  }
  return args.duplicatePostCount / denominator;
}

function toAverage(total: number, count: number): number | null {
  if (count <= 0) {
    return null;
  }
  return total / count;
}

function isProviderStaleHeadElevated(args: {
  duplicatePostRate: number | null;
  ingestLagSeconds: number | null;
}): boolean {
  if (args.duplicatePostRate == null || args.ingestLagSeconds == null) {
    return false;
  }
  return (
    args.duplicatePostRate >= READYZ_THRESHOLDS.staleHeadDuplicatePostRateMin &&
    args.ingestLagSeconds >= READYZ_THRESHOLDS.staleHeadIngestLagSecondsMin
  );
}

function isScraplingDynamicFreshnessRecovered(args: {
  provider: string;
  requestCount: number;
  successRate: number;
  fallbackRate: number;
  emptyRate: number;
  errorRate: number;
  rateLimitRate: number;
  timeoutRate: number;
  circuitOpenRate: number;
  dynamicProfileShare: number | null;
  sessionKeyObservedRate: number | null;
  sessionKeyReuseRate: number | null;
}): boolean {
  if (args.provider !== "scrapling") {
    return false;
  }
  if (
    args.requestCount <
    READYZ_THRESHOLDS.scraplingTransportMinRequestCountForFallback
  ) {
    return false;
  }
  if (
    args.dynamicProfileShare == null ||
    args.dynamicProfileShare < READYZ_THRESHOLDS.scraplingDynamicProfileShareMin
  ) {
    return false;
  }
  if (
    args.sessionKeyObservedRate == null ||
    args.sessionKeyObservedRate <
      READYZ_THRESHOLDS.scraplingSessionKeyObservedRateMin
  ) {
    return false;
  }
  if (
    args.sessionKeyReuseRate == null ||
    args.sessionKeyReuseRate < READYZ_THRESHOLDS.scraplingSessionKeyReuseRateMin
  ) {
    return false;
  }
  return (
    args.successRate >= READYZ_THRESHOLDS.providerHealthSuccessRateMin &&
    args.fallbackRate <= READYZ_THRESHOLDS.providerHealthFallbackRateMax &&
    args.emptyRate <= READYZ_THRESHOLDS.providerHealthEmptyRateMax &&
    args.errorRate <= READYZ_THRESHOLDS.providerHealthErrorRateMax &&
    args.rateLimitRate <= READYZ_THRESHOLDS.providerHealthRateLimitRateMax &&
    args.timeoutRate <= READYZ_THRESHOLDS.providerHealthTimeoutRateMax &&
    args.circuitOpenRate <= READYZ_THRESHOLDS.providerHealthCircuitOpenRateMax
  );
}

function toLagSeconds(nowIso: string, observedAtIso: string | undefined): number | null {
  if (!observedAtIso) {
    return null;
  }
  const nowMs = new Date(nowIso).getTime();
  const observedAtMs = new Date(observedAtIso).getTime();
  if (!Number.isFinite(nowMs) || !Number.isFinite(observedAtMs)) {
    return null;
  }
  return Math.max(0, Math.round((nowMs - observedAtMs) / 1000));
}

function toOptionalInt(value: number | string | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function toHeadersRecord(
  value: Record<string, unknown> | null,
): Record<string, string> {
  if (!value || typeof value !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([key, headerValue]) => [key.toLowerCase(), headerValue]),
  );
}

function isTruthyHeader(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function toScraplingEvidenceFromAggregate(
  aggregate: LocalProviderHealth | undefined,
): VerifyCycle["scraplingEvidence"] {
  return {
    requestCount: aggregate?.requestCount ?? 0,
    sessionKeyObservedRate:
      aggregate && aggregate.requestCount > 0
        ? Number(
            (
              aggregate.scraplingSessionKeyCount / aggregate.requestCount
            ).toFixed(6),
          )
        : null,
    sessionKeyReuseRate:
      aggregate && aggregate.scraplingSessionKeyCount > 0
        ? Number(
            (
              aggregate.scraplingSessionKeyReuseCount /
              aggregate.scraplingSessionKeyCount
            ).toFixed(6),
          )
        : null,
    byProfile: [
      {
        profile: "http" as const,
        requestCount: aggregate?.scraplingHttpProfileCount ?? 0,
      },
      {
        profile: "dynamic" as const,
        requestCount: aggregate?.scraplingDynamicProfileCount ?? 0,
      },
      {
        profile: "stealth" as const,
        requestCount: aggregate?.scraplingStealthProfileCount ?? 0,
      },
    ].filter((item) => item.requestCount > 0),
  };
}

function toRunLocalScraplingEvidence(args: {
  sampledJobs: number;
  rawEventHeaders: RawEventHeaderRow[];
}): VerifyCycle["runLocalScraplingEvidence"] {
  let requestCount = 0;
  let sessionKeyCount = 0;
  let sessionKeyReuseCount = 0;
  let httpProfileCount = 0;
  let dynamicProfileCount = 0;
  let stealthProfileCount = 0;

  for (const row of args.rawEventHeaders) {
    const headers = toHeadersRecord(row.response_headers);
    const profile = headers["x-scrapling-profile"]?.trim().toLowerCase();
    const sessionKey = headers["x-scrapling-session-key"]?.trim();
    const provider = headers["x-provider"]?.trim().toLowerCase();
    const hasScraplingSignal =
      profile === "http" ||
      profile === "dynamic" ||
      profile === "stealth" ||
      (sessionKey != null && sessionKey.length > 0) ||
      provider === "scrapling";
    if (!hasScraplingSignal) {
      continue;
    }

    requestCount += 1;
    if (profile === "http") {
      httpProfileCount += 1;
    } else if (profile === "dynamic") {
      dynamicProfileCount += 1;
    } else if (profile === "stealth") {
      stealthProfileCount += 1;
    }

    if (sessionKey && sessionKey.length > 0) {
      sessionKeyCount += 1;
      if (isTruthyHeader(headers["x-scrapling-session-key-reused"])) {
        sessionKeyReuseCount += 1;
      }
    }
  }

  return {
    sampledJobs: args.sampledJobs,
    sampledRawEvents: args.rawEventHeaders.length,
    requestCount,
    sessionKeyObservedRate:
      requestCount > 0 ? Number((sessionKeyCount / requestCount).toFixed(6)) : null,
    sessionKeyReuseRate:
      sessionKeyCount > 0
        ? Number((sessionKeyReuseCount / sessionKeyCount).toFixed(6))
        : null,
    byProfile: [
      {
        profile: "http" as const,
        requestCount: httpProfileCount,
      },
      {
        profile: "dynamic" as const,
        requestCount: dynamicProfileCount,
      },
      {
        profile: "stealth" as const,
        requestCount: stealthProfileCount,
      },
    ].filter((item) => item.requestCount > 0),
  };
}

function evaluateLocalTargetReadiness(args: {
  nowIso: string;
  latestContentAgeSeconds: number | null;
  providerHealth: LocalProviderHealth[];
  liveCursors: Array<{
    provider: string;
    lastFetchedAt?: string;
    updatedAt: string;
  }>;
}): LocalTargetReadiness {
  const degradedReasons: string[] = [];
  const staleHeadProviders = new Set<string>();
  const staleHeadSuppressedProviders = new Set<string>();
  const freshnessRecoveredProviders = new Set<string>();
  const recentLiveProviders = new Set<string>();
  const totals = args.providerHealth.reduce(
    (summary, item) => {
      summary.requestCount += item.requestCount;
      return summary;
    },
    {
      requestCount: 0,
    },
  );

  for (const item of args.providerHealth) {
    if (item.requestCount <= 0) {
      continue;
    }
    recentLiveProviders.add(item.provider);
    const successRate = toRate(item.successCount, item.requestCount);
    const fallbackRate = toRate(item.fallbackCount, item.requestCount);
    const emptyRate = toRate(item.emptyResponseCount, item.requestCount);
    const diffRate = toRate(item.providerDiffCount, item.providerDiffSampleCount);
    const errorRate = toRate(item.errorCount, item.requestCount);
    const rateLimitRate = toRate(item.rateLimitCount, item.requestCount);
    const timeoutRate = toRate(item.timeoutCount, item.requestCount);
    const circuitOpenRate = toRate(item.circuitOpenCount, item.requestCount);
    const providerSwitchShare =
      totals.requestCount > 0
        ? (totals.requestCount - item.requestCount) / totals.requestCount
        : 0;
    const dynamicProfileShare = toRate(
      item.scraplingDynamicProfileCount,
      item.requestCount,
    );
    const sessionKeyObservedRate = toRate(
      item.scraplingSessionKeyCount,
      item.requestCount,
    );
    const sessionKeyReuseRate = toRate(
      item.scraplingSessionKeyReuseCount,
      item.scraplingSessionKeyCount,
    );
    const scraplingDynamicFreshnessRecovered =
      isScraplingDynamicFreshnessRecovered({
        provider: item.provider,
        requestCount: item.requestCount,
        successRate,
        fallbackRate,
        emptyRate,
        errorRate,
        rateLimitRate,
        timeoutRate,
        circuitOpenRate,
        dynamicProfileShare,
        sessionKeyObservedRate,
        sessionKeyReuseRate,
      });
    const duplicatePostRate = toDuplicatePostRate({
      duplicatePostCount: item.duplicatePostCount,
      candidateCount: item.candidateCount,
      acceptedCount: item.acceptedCount,
    });
    const ingestLagSeconds = toAverage(
      item.ingestLagSecondsSum,
      item.ingestLagSampleCount,
    );
    if (successRate < READYZ_THRESHOLDS.providerHealthSuccessRateMin) {
      degradedReasons.push(`provider_fetch_success_low:${item.provider}`);
    }
    if (fallbackRate > READYZ_THRESHOLDS.providerHealthFallbackRateMax) {
      degradedReasons.push(`provider_fallback_elevated:${item.provider}`);
    }
    if (emptyRate > READYZ_THRESHOLDS.providerHealthEmptyRateMax) {
      degradedReasons.push(`provider_empty_window_elevated:${item.provider}`);
    }
    if (diffRate > READYZ_THRESHOLDS.providerHealthDiffRateMax) {
      degradedReasons.push(`provider_diff_elevated:${item.provider}`);
    }
    if (errorRate > READYZ_THRESHOLDS.providerHealthErrorRateMax) {
      degradedReasons.push(`provider_error_rate_elevated:${item.provider}`);
    }
    if (rateLimitRate > READYZ_THRESHOLDS.providerHealthRateLimitRateMax) {
      degradedReasons.push(`provider_rate_limit_elevated:${item.provider}`);
    }
    if (timeoutRate > READYZ_THRESHOLDS.providerHealthTimeoutRateMax) {
      degradedReasons.push(`provider_timeout_elevated:${item.provider}`);
    }
    if (circuitOpenRate > READYZ_THRESHOLDS.providerHealthCircuitOpenRateMax) {
      degradedReasons.push(`provider_circuit_open_elevated:${item.provider}`);
    }
    if (providerSwitchShare > READYZ_THRESHOLDS.providerHealthSwitchShareMax) {
      degradedReasons.push(`provider_switch_elevated:${item.provider}`);
    }
    if (scraplingDynamicFreshnessRecovered) {
      freshnessRecoveredProviders.add(item.provider);
    }
    if (isProviderStaleHeadElevated({ duplicatePostRate, ingestLagSeconds })) {
      if (scraplingDynamicFreshnessRecovered) {
        continue;
      }
      const hasFreshHead =
        args.latestContentAgeSeconds != null &&
        args.latestContentAgeSeconds <= READYZ_THRESHOLDS.staleHeadIngestLagSecondsMin;
      if (hasFreshHead) {
        staleHeadSuppressedProviders.add(item.provider);
      } else {
        staleHeadProviders.add(item.provider);
        degradedReasons.push(`provider_stale_head_elevated:${item.provider}`);
      }
    }
  }

  const filteredCursors = args.liveCursors.filter(
    (cursor) => recentLiveProviders.size === 0 || recentLiveProviders.has(cursor.provider),
  );
  const stalledByProvider = new Map<string, number>();
  for (const cursor of filteredCursors) {
    const lagSeconds = toLagSeconds(args.nowIso, cursor.lastFetchedAt ?? cursor.updatedAt);
    if (lagSeconds == null || lagSeconds <= READYZ_THRESHOLDS.cursorStallThresholdSeconds) {
      continue;
    }
    stalledByProvider.set(
      cursor.provider,
      (stalledByProvider.get(cursor.provider) ?? 0) + 1,
    );
  }
  for (const provider of stalledByProvider.keys()) {
    if (freshnessRecoveredProviders.has(provider)) {
      continue;
    }
    degradedReasons.push(`provider_cursor_stalled:${provider}`);
    if (staleHeadProviders.has(provider)) {
      degradedReasons.push(`provider_data_stalled:${provider}`);
    }
  }

  const uniqueReasons = Array.from(new Set(degradedReasons));
  return {
    status: uniqueReasons.length > 0 ? "degraded" : "ready",
    degradedReasons: uniqueReasons,
    staleHeadSuppressedProviders: Array.from(staleHeadSuppressedProviders).sort(),
    latestContentAgeSeconds: args.latestContentAgeSeconds,
  };
}

function resolveNowTag(now: Date): string {
  return now.toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

function parseSubredditSequence(raw: string | undefined): string[] {
  const parsed = parseSubredditList(raw);
  return parsed.length > 0 ? parsed : ["machinelearning", "datascience"];
}

async function resolveFreshCycleNowIso(args: {
  db: PostgresClient;
  targetId: string;
  requestedNowIso: string;
}): Promise<{ nowIso: string; shiftCount: number }> {
  const windowMinutes = 5;
  const maxShiftCount = parsePositiveInt(
    process.env.REDDIT_CONTROLLED_PROMOTION_MAX_WINDOW_SHIFT_COUNT,
    96,
  );
  let candidateNowIso = args.requestedNowIso;
  let shiftCount = 0;

  while (shiftCount <= maxShiftCount) {
    const windowStartIso = floorToWindow(candidateNowIso, windowMinutes);
    const dedupeKey = buildDedupeKey(
      "collect_subreddit_new_posts",
      args.targetId,
      windowStartIso,
    );
    const existsResult = await args.db.query<{ exists: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM collection_job
          WHERE target_id = $1
            AND crawl_mode = 'live'
            AND dedupe_key = $2
        ) AS exists
      `,
      [args.targetId, dedupeKey],
    );
    if (!existsResult.rows[0]?.exists) {
      return {
        nowIso: candidateNowIso,
        shiftCount,
      };
    }
    shiftCount += 1;
    const nextWindowStartMs =
      Date.parse(windowStartIso) + windowMinutes * 60 * 1000 + 1_000;
    candidateNowIso = new Date(nextWindowStartMs).toISOString();
  }

  throw new Error(
    `no fresh live collection window found for target ${args.targetId} after ${maxShiftCount} shifts`,
  );
}

async function runCycle(args: {
  subreddit: string;
  nowIso: string;
}): Promise<VerifyCycle> {
  const db = new PostgresClient();
  const targetId = stableUuidFromString(`reddit:target:r/${args.subreddit}`);
  const freshWindow = await resolveFreshCycleNowIso({
    db,
    targetId,
    requestedNowIso: args.nowIso,
  });
  let runExecution: VerifyCycle["runExecution"] = {
    ok: true,
    error: null,
    startedAtIso: new Date().toISOString(),
    finishedAtIso: null,
    executedJobCount: 0,
  };
  const originalLog = console.log;
  const originalError = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    await runPhase1OnceWithPostgres({
      subreddit: args.subreddit,
      runMode: "live",
      nowIso: freshWindow.nowIso,
      db,
    });
  } catch (error) {
    runExecution = {
      ...runExecution,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    runExecution = {
      ...runExecution,
      finishedAtIso: new Date().toISOString(),
    };
    console.log = originalLog;
    console.error = originalError;
  }
  try {
    const repositories = createPostgresRepositoryBundle(db);
    const nowIso = freshWindow.nowIso;
    const globalReadiness = await buildReadinessState({
      repositories,
      nowIso,
    });
    const latestContentAgeResult = await db.query<TargetHeadAgeRow>(
      `
        SELECT FLOOR(EXTRACT(EPOCH FROM ($2::timestamptz - MAX(created_at_source))))::int AS latest_post_age_seconds
        FROM content
        WHERE target_id = $1
      `,
      [targetId, nowIso],
    );
    const latestContentAgeSeconds = toOptionalInt(
      latestContentAgeResult.rows[0]?.latest_post_age_seconds,
    );

    const cycleExecutedJobs = await db.query<JobRow>(
      `
        SELECT id
        FROM collection_job
        WHERE target_id = $1
          AND crawl_mode = 'live'
          AND started_at BETWEEN ($2::timestamptz - INTERVAL '2 seconds')
            AND ($3::timestamptz + INTERVAL '2 seconds')
        ORDER BY started_at DESC, scheduled_at DESC
        LIMIT 12
      `,
      [targetId, runExecution.startedAtIso, runExecution.finishedAtIso ?? runExecution.startedAtIso],
    );
    const jobIds = cycleExecutedJobs.rows.map((row) => row.id);
    runExecution = {
      ...runExecution,
      executedJobCount: jobIds.length,
    };
    const rawEventHeaders =
      jobIds.length === 0
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
              [jobIds],
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

    const providerHealth = await repositories.providerHealthWindowRepository.summarizeByProviderInRange(
      {
        targetId,
        from: new Date(
          new Date(nowIso).getTime() -
            READYZ_THRESHOLDS.providerHealthLookbackMinutes * 60 * 1000,
        ).toISOString(),
        to: nowIso,
        mode: "live",
      },
    );
    const liveCursors = await repositories.crawlCursorRepository.list({
      mode: "live",
      targetId,
    });
    const localReadiness = evaluateLocalTargetReadiness({
      nowIso,
      latestContentAgeSeconds,
      providerHealth: providerHealth as LocalProviderHealth[],
      liveCursors: liveCursors.map((cursor) => ({
        provider: cursor.provider,
        lastFetchedAt: cursor.lastFetchedAt,
        updatedAt: cursor.updatedAt,
      })),
    });
    const globalReasonSet = new Set(globalReadiness.degradedReasons);
    const localReasonSet = new Set(localReadiness.degradedReasons);
    const globalOnlyDegradedReasons = Array.from(globalReasonSet).filter(
      (reason) => !localReasonSet.has(reason),
    );
    const localOnlyDegradedReasons = Array.from(localReasonSet).filter(
      (reason) => !globalReasonSet.has(reason),
    );
    const promotedSubreddits = new Set(
      parseSubredditList(process.env.REDDIT_SCRAPLING_PRIMARY_SUBREDDITS).map((item) =>
        item.toLowerCase(),
      ),
    );
    const scraplingAggregate = providerHealth.find((item) => item.provider === "scrapling");
    const runLocalScraplingEvidence = toRunLocalScraplingEvidence({
      sampledJobs: jobIds.length,
      rawEventHeaders,
    });
    const routingDecision = await resolveRedditTargetExecutionRoute({
      targetId,
      canonicalName: `r/${args.subreddit}`,
      crawlMode: "live",
      nowIso,
      defaultProviderHint: process.env.REDDIT_LIVE_PROVIDER ?? "http",
      providerHealthWindowRepository: repositories.providerHealthWindowRepository,
      crawlCursorRepository: repositories.crawlCursorRepository,
      policyContext: resolveRedditProviderRoutingPolicyContextFromEnv(process.env),
    });

    return {
      subreddit: `r/${args.subreddit}`,
      requestedNowIso: args.nowIso,
      nowIso,
      windowShiftCount: freshWindow.shiftCount,
      runExecution,
      globalReadinessStatus: globalReadiness.status,
      globalDegradedReasons: globalReadiness.degradedReasons,
      localTargetReadinessStatus: localReadiness.status,
      localTargetDegradedReasons: localReadiness.degradedReasons,
      globalOnlyDegradedReasons,
      localOnlyDegradedReasons,
      isPromotedTarget: promotedSubreddits.has(args.subreddit.toLowerCase()),
      providerHealth: providerHealth.map((item) => ({
        provider: item.provider,
        requestCount: item.requestCount,
        successCount: item.successCount,
        fallbackCount: item.fallbackCount,
        timeoutCount: item.timeoutCount,
        errorCount: item.errorCount,
        duplicatePostCount: item.duplicatePostCount,
        candidateCount: item.candidateCount,
        acceptedCount: item.acceptedCount,
        duplicatePostRate: toDuplicatePostRate({
          duplicatePostCount: item.duplicatePostCount,
          candidateCount: item.candidateCount,
          acceptedCount: item.acceptedCount,
        }),
        ingestLagSeconds: toAverage(item.ingestLagSecondsSum, item.ingestLagSampleCount),
      })),
      targetFreshness: {
        latestContentAgeSeconds: localReadiness.latestContentAgeSeconds,
        staleHeadSuppressedProviders: localReadiness.staleHeadSuppressedProviders,
      },
      fallbackEvidence: {
        sampledRawEvents: rawEventHeaders.length,
        providerFallbackCount,
        scraplingFallbackTransportCounts,
      },
      scraplingEvidence: toScraplingEvidenceFromAggregate(scraplingAggregate),
      runLocalScraplingEvidence,
      routingDecision: {
        providerHint: routingDecision.providerHint,
        scraplingProfile: routingDecision.scraplingProfile,
        routingClass: routingDecision.routingClass,
        reasons: routingDecision.reasons,
      },
    };
  } finally {
    await db.close();
  }
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const subreddits = parseSubredditSequence(process.env.REDDIT_CONTROLLED_PROMOTION_SUBREDDITS);
  const rounds = parsePositiveInt(process.env.REDDIT_CONTROLLED_PROMOTION_ROUNDS, 2);
  const pauseMs = parsePositiveInt(process.env.REDDIT_CONTROLLED_PROMOTION_PAUSE_MS, 1_000);
  const stepMinutes = parseNonNegativeInt(
    process.env.REDDIT_CONTROLLED_PROMOTION_STEP_MINUTES,
    0,
  );
  await runMigrations();

  const cycleSubreddits: string[] = [];
  for (let round = 0; round < rounds; round += 1) {
    cycleSubreddits.push(...subreddits);
  }

  const cycles: VerifyCycle[] = [];
  const baseNowMs = Date.now();
  const backshiftMs =
    stepMinutes > 0 ? (cycleSubreddits.length - 1) * stepMinutes * 60 * 1000 : 0;
  const baseCycleNowMs = baseNowMs - backshiftMs;
  for (const [index, subreddit] of cycleSubreddits.entries()) {
    const cycleNowIso = new Date(
      baseCycleNowMs + index * stepMinutes * 60 * 1000,
    ).toISOString();
    const cycle = await runCycle({
      subreddit,
      nowIso: cycleNowIso,
    });
    cycles.push(cycle);
    if (pauseMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, pauseMs));
    }
  }

  const degradedReasonCounts = new Map<string, number>();
  const localDegradedReasonCounts = new Map<string, number>();
  const globalOnlyReasonCounts = new Map<string, number>();
  const localOnlyReasonCounts = new Map<string, number>();
  const providersSeen = new Set<string>();
  let totalProviderFallbackCount = 0;
  const totalScraplingFallbackTransportCounts: Record<string, number> = {};

  for (const cycle of cycles) {
    for (const reason of cycle.globalDegradedReasons) {
      degradedReasonCounts.set(reason, (degradedReasonCounts.get(reason) ?? 0) + 1);
    }
    for (const reason of cycle.localTargetDegradedReasons) {
      localDegradedReasonCounts.set(
        reason,
        (localDegradedReasonCounts.get(reason) ?? 0) + 1,
      );
    }
    for (const reason of cycle.globalOnlyDegradedReasons) {
      globalOnlyReasonCounts.set(reason, (globalOnlyReasonCounts.get(reason) ?? 0) + 1);
    }
    for (const reason of cycle.localOnlyDegradedReasons) {
      localOnlyReasonCounts.set(reason, (localOnlyReasonCounts.get(reason) ?? 0) + 1);
    }
    for (const provider of cycle.providerHealth) {
      providersSeen.add(provider.provider);
    }
    totalProviderFallbackCount += cycle.fallbackEvidence.providerFallbackCount;
    for (const [transport, count] of Object.entries(
      cycle.fallbackEvidence.scraplingFallbackTransportCounts,
    )) {
      totalScraplingFallbackTransportCounts[transport] =
        (totalScraplingFallbackTransportCounts[transport] ?? 0) + count;
    }
  }

  const now = new Date();
  const payload = {
    generatedAt: now.toISOString(),
    config: {
      liveProvider: process.env.REDDIT_LIVE_PROVIDER ?? "http",
      promotedSubreddits: process.env.REDDIT_SCRAPLING_PRIMARY_SUBREDDITS ?? null,
      profile: process.env.REDDIT_SCRAPLING_PROFILE ?? "http",
      rounds,
      pauseMs,
      stepMinutes,
      cycleSubreddits,
    },
    summary: {
      runCount: cycles.length,
      failedCycleCount: cycles.filter((cycle) => !cycle.runExecution.ok).length,
      globalDegradedRuns: cycles.filter((cycle) => cycle.globalReadinessStatus !== "ready").length,
      localTargetDegradedRuns: cycles.filter(
        (cycle) => cycle.localTargetReadinessStatus !== "ready",
      ).length,
      globalDegradedReasonCounts: Object.fromEntries(degradedReasonCounts.entries()),
      localTargetDegradedReasonCounts: Object.fromEntries(
        localDegradedReasonCounts.entries(),
      ),
      globalOnlyReasonCounts: Object.fromEntries(globalOnlyReasonCounts.entries()),
      localOnlyReasonCounts: Object.fromEntries(localOnlyReasonCounts.entries()),
      providersSeen: Array.from(providersSeen).sort(),
      totalProviderFallbackCount,
      totalScraplingFallbackTransportCounts,
    },
    cycles,
  };

  const outputPath = path.resolve(
    process.cwd(),
    "docs",
    `live-controlled-promotion-${resolveNowTag(now)}.json`,
  );
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(payload, null, 2), "utf8");

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        event: "reddit.controlled_promotion.verify.completed",
        outputPath,
        summary: payload.summary,
      },
      null,
      2,
    ),
  );
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify(
      {
        event: "reddit.controlled_promotion.verify.failed",
        message,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
