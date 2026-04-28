import { buildSubredditKeywordTrendDailyJob } from "../src/jobs/build-subreddit-keyword-trend-daily.job";
import { buildSubredditDailyFactsJob } from "../src/jobs/build-subreddit-daily-facts.job";
import { buildSubredditTrendPointsJob } from "../src/jobs/build-subreddit-trend-points.job";
import { buildPostGrowthFactsJob } from "../src/jobs/build-post-growth-facts.job";
import { buildAnomalyEventsJob } from "../src/jobs/build-anomaly-events.job";
import { runExistingSubredditAboutJob } from "../src/jobs/collect-subreddit-about.job";
import { runExistingSubredditNewPostsJob } from "../src/jobs/collect-subreddit-new-posts.job";
import type { RedditConnector } from "../src/connectors/reddit/reddit-connector.interface";
import type { RedditMapper } from "../src/connectors/reddit/reddit-mapper.interface";
import {
  createRedditCapabilityProbeConnectorFromEnv,
  createPostgresPhase1Runtime,
  resolvePhase1RunMode,
  resolveRedditPhase1CycleOptionsFromEnv,
  upsertActiveSubredditTargets,
} from "../src/runtime/reddit-phase1-runtime";
import { createRedditFetchExecutionEngine } from "../src/runtime/reddit-fetch-execution-engine";
import {
  resolveRetentionPruneConfig,
  runRetentionPrune,
  shouldRunRetentionPrune,
} from "../src/ops/retention-prune";
import {
  probeRedditProviderCapability,
  resolveRedditProviderCapabilityProbeConfigFromEnv,
} from "../src/runtime/reddit-provider-capability";
import { resolveRedditProviderRoutingPolicyContextFromEnv } from "../src/runtime/reddit-provider-routing-policy";
import {
  parseBooleanFlag,
  parseOptionalPositiveInt,
  parsePositiveInt,
  parseSubredditList,
} from "../src/runtime/runtime-parsing";
import { runRedditPhase1Cycle } from "../src/workers/reddit-phase1.worker";
import {
  DEFAULT_PHASE1_SCHEDULER_INTERVAL_MS,
} from "../src/workers/reddit-phase1-defaults";
import type { CollectionJobRepository } from "../src/domain/repositories/collection-job-repository";
import type { MonitorTargetRepository } from "../src/domain/repositories/monitor-target-repository";
import type { RawEventRepository } from "../src/domain/repositories/raw-event-repository";
import type { AccountRepository } from "../src/domain/repositories/account-repository";
import type { ContentRepository } from "../src/domain/repositories/content-repository";
import type { CrawlCursorRepository } from "../src/domain/repositories/crawl-cursor-repository";
import type { KeywordTrendDailyRepository } from "../src/domain/repositories/keyword-trend-daily-repository";
import type { ProviderHealthWindowRepository } from "../src/domain/repositories/provider-health-window-repository";
import type { MetricsSnapshotRepository } from "../src/domain/repositories/metrics-snapshot-repository";
import type { PostEngagementRepository } from "../src/domain/repositories/post-engagement-repository";
import type { PostGrowthFactRepository } from "../src/domain/repositories/post-growth-fact-repository";
import type { SubredditDailyFactRepository } from "../src/domain/repositories/subreddit-daily-fact-repository";
import type { SubredditTrendPointRepository } from "../src/domain/repositories/subreddit-trend-point-repository";
import type { AnomalyEventRepository } from "../src/domain/repositories/anomaly-event-repository";
import type { RedditLiveProvider } from "../src/connectors/reddit/create-reddit-connector";

export type SchedulerRunMode = "mock" | "live";

export type TouchedTargetReason =
  | "new_content"
  | "engagement_update"
  | "coverage_update"
  | "about_update";

export interface TouchedTargetScopeWindow {
  granularity: "15m" | "1h" | "6h" | "1d";
  start: string;
  end: string;
}

export interface TouchedTargetScope {
  affectedDays: string[];
  affectedWindows: TouchedTargetScopeWindow[];
  reasons: TouchedTargetReason[];
}

export interface TouchedTarget {
  targetId: string;
  canonicalName: string;
  crawlMode: "live" | "backfill";
  scope: TouchedTargetScope;
}

export interface SchedulerLiveProviderExecutionPlan {
  configuredProvider: RedditLiveProvider;
  effectiveProvider: RedditLiveProvider;
  fallbackProvider?: RedditLiveProvider;
  primaryReason?: string;
  primaryFailureCategory?: "unexpected_http_status" | "connector_error" | "network_policy_block";
  fallbackReason?: string;
  fallbackFailureCategory?: "unexpected_http_status" | "connector_error" | "network_policy_block";
  blocked: boolean;
}

function parseSubredditListFromEnv(env: NodeJS.ProcessEnv): string[] {
  return parseSubredditList(env.REDDIT_RUN_SUBREDDITS ?? env.REDDIT_RUN_SUBREDDIT);
}

function parseIntervalMs(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 5_000) {
    return DEFAULT_PHASE1_SCHEDULER_INTERVAL_MS;
  }
  return parsed;
}

interface RunnableJobRepositories {
  collectionJobRepository: CollectionJobRepository;
  monitorTargetRepository: MonitorTargetRepository;
  rawEventRepository: RawEventRepository;
  accountRepository: AccountRepository;
  contentRepository: ContentRepository;
  crawlCursorRepository: CrawlCursorRepository;
  providerHealthWindowRepository: ProviderHealthWindowRepository;
  metricsSnapshotRepository: MetricsSnapshotRepository;
  postEngagementRepository?: PostEngagementRepository;
  subredditDailyFactRepository: SubredditDailyFactRepository;
  postGrowthFactRepository?: PostGrowthFactRepository;
  keywordTrendDailyRepository?: KeywordTrendDailyRepository;
  anomalyEventRepository?: AnomalyEventRepository;
  subredditTrendPointRepository: SubredditTrendPointRepository;
}

export async function executeRunnableCollectionJobs(args: {
  repos: RunnableJobRepositories;
  connector: RedditConnector;
  connectorResolver?: (args: {
    providerHint: string | undefined;
    crawlMode: "live" | "backfill";
  }) => RedditConnector;
  redditMapper: RedditMapper;
  nowIso: string;
  runnableJobLimit: number;
  runMode: SchedulerRunMode;
}): Promise<{
  executedJobs: number;
  touchedTargets: TouchedTarget[];
}> {
  const runnableJobs = await args.repos.collectionJobRepository.findRunnableJobs(
    args.nowIso,
    args.runnableJobLimit,
  );
  let executedJobs = 0;
  const touchedTargets = new Map<string, TouchedTarget>();

  for (const job of runnableJobs) {
    const target = await args.repos.monitorTargetRepository.findById(job.targetId);
    if (!target || target.targetType !== "subreddit") {
      await args.repos.collectionJobRepository.updateStatus(
        job.id,
        "dead_letter",
        `target missing for retry: ${job.targetId}`,
      );
      continue;
    }

    const subreddit = target.canonicalName.replace(/^r\//, "");
    try {
      if (job.jobType === "collect_subreddit_about") {
        const executed = await runExistingSubredditAboutJob(
          {
            redditConnector: args.connector,
            redditMapper: args.redditMapper,
            collectionJobRepository: args.repos.collectionJobRepository,
            rawEventRepository: args.repos.rawEventRepository,
            metricsSnapshotRepository: args.repos.metricsSnapshotRepository,
          },
          {
            job,
            subreddit,
            nowIso: args.nowIso,
          },
        );
        if (executed) {
          executedJobs += 1;
          touchedTargets.set(
            target.id,
            mergeTouchedTarget(
              touchedTargets.get(target.id),
              createTouchedTarget({
                targetId: target.id,
                canonicalName: target.canonicalName,
                crawlMode: job.crawlMode ?? "live",
                nowIso: args.nowIso,
                reasons: ["about_update", "coverage_update"],
              }),
            ),
          );
        }
        continue;
      }

      if (job.jobType === "collect_subreddit_new_posts") {
        const connectorForJob = args.connectorResolver
          ? args.connectorResolver({
              providerHint: resolveProviderHintFromJobPayload(job.payload),
              crawlMode: job.crawlMode ?? "live",
            })
          : args.connector;
        const executed = await runExistingSubredditNewPostsJob(
          {
            redditConnector: connectorForJob,
            redditMapper: args.redditMapper,
            collectionJobRepository: args.repos.collectionJobRepository,
            crawlCursorRepository: args.repos.crawlCursorRepository,
            rawEventRepository: args.repos.rawEventRepository,
            accountRepository: args.repos.accountRepository,
            contentRepository: args.repos.contentRepository,
            providerHealthWindowRepository: args.repos.providerHealthWindowRepository,
            metricsSnapshotRepository: args.repos.metricsSnapshotRepository,
          },
          {
            job,
            subreddit,
            nowIso: args.nowIso,
            mode: job.crawlMode,
          },
        );
        if (executed) {
          executedJobs += 1;
          touchedTargets.set(
            target.id,
            mergeTouchedTarget(
              touchedTargets.get(target.id),
              createTouchedTarget({
                targetId: target.id,
                canonicalName: target.canonicalName,
                crawlMode: job.crawlMode ?? "live",
                nowIso: args.nowIso,
                reasons: ["new_content", "engagement_update", "coverage_update"],
              }),
            ),
          );
        }
        continue;
      }

      await args.repos.collectionJobRepository.updateStatus(
        job.id,
        "dead_letter",
        `unsupported runnable job type: ${job.jobType}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify({
          event: "scheduler.runnable_job.failed",
          nowIso: args.nowIso,
          mode: args.runMode,
          jobId: job.id,
          jobType: job.jobType,
          targetId: job.targetId,
          error: message,
        }),
      );
    }
  }

  return {
    executedJobs,
    touchedTargets: Array.from(touchedTargets.values()),
  };
}

function resolveProviderHintFromJobPayload(
  payload: Record<string, unknown> | undefined,
): string | undefined {
  const providerHint = payload?.providerHint;
  return typeof providerHint === "string" && providerHint.trim().length > 0
    ? providerHint.trim()
    : undefined;
}

function resolveProviderOverride(providerHint: string | undefined): string | undefined {
  const normalized = providerHint?.trim().toLowerCase();
  if (normalized === "http" || normalized === "scrapling") {
    return normalized;
  }
  return undefined;
}

export function resolveSchedulerRunnableProviderHint(args: {
  providerHint: string | undefined;
  crawlMode: "live" | "backfill";
  configuredProvider: RedditLiveProvider;
  effectiveProvider: RedditLiveProvider;
}): string | undefined {
  if (args.crawlMode !== "live") {
    return args.providerHint;
  }
  const normalized = resolveProviderOverride(args.providerHint);
  if (!normalized || normalized === args.configuredProvider) {
    return args.effectiveProvider;
  }
  return normalized;
}

export async function resolveSchedulerLiveProviderExecutionPlan(args: {
  runMode: SchedulerRunMode;
  providerCapability: ReturnType<typeof resolveRedditProviderCapabilityProbeConfigFromEnv>;
  nowIso: string;
  resolveConnectorForProviderHint: (
    providerHint: string | undefined,
    defaultLiveProviderOverride?: RedditLiveProvider,
  ) => RedditConnector;
}): Promise<SchedulerLiveProviderExecutionPlan> {
  const configuredProvider = args.providerCapability.provider;
  if (args.runMode !== "live" || !args.providerCapability.required) {
    return {
      configuredProvider,
      effectiveProvider: configuredProvider,
      blocked: false,
    };
  }

  const primaryProbe = await probeRedditProviderCapability({
    connector: args.resolveConnectorForProviderHint(configuredProvider, configuredProvider),
    provider: configuredProvider,
    subreddit: args.providerCapability.subreddit,
    nowIso: args.nowIso,
  });
  if (primaryProbe.ok) {
    return {
      configuredProvider,
      effectiveProvider: configuredProvider,
      blocked: false,
    };
  }

  if (configuredProvider !== "http") {
    return {
      configuredProvider,
      effectiveProvider: configuredProvider,
      primaryReason: primaryProbe.reason ?? "provider capability probe failed",
      primaryFailureCategory: primaryProbe.failureCategory,
      blocked: true,
    };
  }

  if (primaryProbe.failureCategory === "network_policy_block") {
    return {
      configuredProvider,
      effectiveProvider: configuredProvider,
      primaryReason: primaryProbe.reason ?? "provider capability probe failed",
      primaryFailureCategory: primaryProbe.failureCategory,
      blocked: true,
    };
  }

  const fallbackProvider: RedditLiveProvider = "scrapling";
  const fallbackProbe = await probeRedditProviderCapability({
    connector: args.resolveConnectorForProviderHint(fallbackProvider, fallbackProvider),
    provider: fallbackProvider,
    subreddit: args.providerCapability.subreddit,
    nowIso: args.nowIso,
  });
  if (fallbackProbe.ok) {
    return {
      configuredProvider,
      effectiveProvider: fallbackProvider,
      fallbackProvider,
      primaryReason: primaryProbe.reason ?? "provider capability probe failed",
      primaryFailureCategory: primaryProbe.failureCategory,
      blocked: false,
    };
  }

  return {
    configuredProvider,
    effectiveProvider: configuredProvider,
    fallbackProvider,
    primaryReason: primaryProbe.reason ?? "provider capability probe failed",
    primaryFailureCategory: primaryProbe.failureCategory,
    fallbackReason: fallbackProbe.reason ?? "provider capability probe failed",
    fallbackFailureCategory: fallbackProbe.failureCategory,
    blocked: true,
  };
}

export async function materializeTouchedTargets(args: {
  repos: Pick<
    RunnableJobRepositories,
    | "contentRepository"
    | "metricsSnapshotRepository"
    | "postEngagementRepository"
    | "subredditDailyFactRepository"
    | "postGrowthFactRepository"
    | "keywordTrendDailyRepository"
    | "anomalyEventRepository"
    | "subredditTrendPointRepository"
  >;
  targets: TouchedTarget[];
  nowIso: string;
  env: NodeJS.ProcessEnv;
  runMode: SchedulerRunMode;
}): Promise<number> {
  if (!args.repos.postEngagementRepository) {
    throw new Error("postEngagementRepository is required for scheduler materialization");
  }
  const postEngagementRepository = args.repos.postEngagementRepository;
  let materialized = 0;
  for (const target of args.targets) {
    const options = resolveRedditPhase1CycleOptionsFromEnv({
      env: args.env,
      mode: args.runMode,
      crawlMode: target.crawlMode,
    });
    const fallbackTrendFromIso = new Date(
      new Date(args.nowIso).getTime() - 72 * 60 * 60 * 1000,
    ).toISOString();
    const fallbackDailyFromIso = new Date(
      new Date(args.nowIso).getTime() - options.dailyFactLookbackDays! * 24 * 60 * 60 * 1000,
    ).toISOString();
    const fallbackKeywordFromIso = new Date(
      new Date(args.nowIso).getTime() - options.keywordDailyLookbackDays! * 24 * 60 * 60 * 1000,
    ).toISOString();
    const fallbackPostGrowthFromIso = new Date(
      new Date(args.nowIso).getTime() - 24 * 60 * 60 * 1000,
    ).toISOString();
    const scopeRanges = resolveMaterializationScopeRanges({
      scope: target.scope,
      nowIso: args.nowIso,
      fallbackTrendFromIso,
      fallbackDailyFromIso,
      fallbackKeywordFromIso,
      fallbackPostGrowthFromIso,
    });
    await buildSubredditDailyFactsJob(
      {
        contentRepository: args.repos.contentRepository,
        metricsSnapshotRepository: args.repos.metricsSnapshotRepository,
        postEngagementRepository,
        subredditDailyFactRepository: args.repos.subredditDailyFactRepository,
      },
      {
        targetId: target.targetId,
        fromIso: scopeRanges.dailyFactFromIso,
        toIso: args.nowIso,
      },
    );
    await buildSubredditTrendPointsJob(
      {
        metricsSnapshotRepository: args.repos.metricsSnapshotRepository,
        postEngagementRepository,
        subredditTrendPointRepository: args.repos.subredditTrendPointRepository,
        subredditDailyFactRepository: args.repos.subredditDailyFactRepository,
      },
      {
        targetId: target.targetId,
        fromIso: scopeRanges.trendFromIso,
        toIso: args.nowIso,
      },
    );
    if (args.repos.postGrowthFactRepository) {
      await buildPostGrowthFactsJob(
        {
          contentRepository: args.repos.contentRepository,
          metricsSnapshotRepository: args.repos.metricsSnapshotRepository,
          postEngagementRepository,
          postGrowthFactRepository: args.repos.postGrowthFactRepository,
        },
        {
          targetId: target.targetId,
          fromIso: scopeRanges.postGrowthFromIso,
          toIso: args.nowIso,
        },
      );
    }
    if (args.repos.keywordTrendDailyRepository) {
      await buildSubredditKeywordTrendDailyJob(
        {
          contentRepository: args.repos.contentRepository,
          metricsSnapshotRepository: args.repos.metricsSnapshotRepository,
          postEngagementRepository,
          keywordTrendDailyRepository: args.repos.keywordTrendDailyRepository,
          subredditDailyFactRepository: args.repos.subredditDailyFactRepository,
        },
        {
          targetId: target.targetId,
          fromIso: scopeRanges.keywordFromIso,
          toIso: args.nowIso,
          qualityMinScore: options.keywordDailyQualityMinScore,
          qualityMinComments: options.keywordDailyQualityMinComments,
          maxKeywordsPerDay: options.keywordDailyMaxKeywordsPerDay,
          sourceType: target.crawlMode,
        },
      );
    }
    if (args.repos.anomalyEventRepository) {
      await buildAnomalyEventsJob(
        {
          anomalyEventRepository: args.repos.anomalyEventRepository,
          subredditTrendPointRepository: args.repos.subredditTrendPointRepository,
          subredditDailyFactRepository: args.repos.subredditDailyFactRepository,
          keywordTrendDailyRepository: args.repos.keywordTrendDailyRepository,
          postGrowthFactRepository: args.repos.postGrowthFactRepository,
        },
        {
          targetId: target.targetId,
          fromIso: scopeRanges.trendFromIso,
          toIso: args.nowIso,
        },
      );
    }
    materialized += 1;
  }
  return materialized;
}

function createTouchedTarget(args: {
  targetId: string;
  canonicalName: string;
  crawlMode: "live" | "backfill";
  nowIso: string;
  reasons: TouchedTargetReason[];
}): TouchedTarget {
  return {
    targetId: args.targetId,
    canonicalName: args.canonicalName,
    crawlMode: args.crawlMode,
    scope: {
      affectedDays: [toUtcDay(args.nowIso)],
      affectedWindows: [{
        granularity: "6h",
        start: floorIsoToWindow(args.nowIso, 6 * 60),
        end: ceilIsoFromWindow(args.nowIso, 6 * 60),
      }],
      reasons: [...new Set(args.reasons)],
    },
  };
}

function mergeTouchedTarget(
  current: TouchedTarget | undefined,
  next: TouchedTarget,
): TouchedTarget {
  if (!current) {
    return next;
  }

  return {
    targetId: current.targetId,
    canonicalName: current.canonicalName,
    crawlMode: current.crawlMode === "live" ? "live" : next.crawlMode,
    scope: {
      affectedDays: sortStrings([...new Set([...current.scope.affectedDays, ...next.scope.affectedDays])]),
      affectedWindows: dedupeAndSortScopeWindows([
        ...current.scope.affectedWindows,
        ...next.scope.affectedWindows,
      ]),
      reasons: sortStrings([...new Set([...current.scope.reasons, ...next.scope.reasons])]) as TouchedTargetReason[],
    },
  };
}

function resolveMaterializationScopeRanges(args: {
  scope: TouchedTargetScope | undefined;
  nowIso: string;
  fallbackTrendFromIso: string;
  fallbackDailyFromIso: string;
  fallbackKeywordFromIso: string;
  fallbackPostGrowthFromIso: string;
}): {
  trendFromIso: string;
  dailyFactFromIso: string;
  keywordFromIso: string;
  postGrowthFromIso: string;
} {
  const earliestDayIso = resolveEarliestScopeDayStart(args.scope?.affectedDays);
  const earliestWindowStart = resolveEarliestScopeWindowStart(args.scope?.affectedWindows);

  return {
    trendFromIso: earliestWindowStart ?? args.fallbackTrendFromIso,
    dailyFactFromIso: earliestDayIso ?? args.fallbackDailyFromIso,
    keywordFromIso: earliestDayIso ?? args.fallbackKeywordFromIso,
    postGrowthFromIso: earliestWindowStart ?? args.fallbackPostGrowthFromIso,
  };
}

function resolveEarliestScopeDayStart(days: readonly string[] | undefined): string | undefined {
  if (!days || days.length === 0) {
    return undefined;
  }
  const sortedDays = [...days].sort((a, b) => a.localeCompare(b));
  const earliest = sortedDays[0];
  return earliest ? `${earliest}T00:00:00.000Z` : undefined;
}

function resolveEarliestScopeWindowStart(
  windows: readonly TouchedTargetScopeWindow[] | undefined,
): string | undefined {
  if (!windows || windows.length === 0) {
    return undefined;
  }
  return [...windows]
    .sort((a, b) => a.start.localeCompare(b.start))[0]
    ?.start;
}

function dedupeAndSortScopeWindows(
  windows: readonly TouchedTargetScopeWindow[],
): TouchedTargetScopeWindow[] {
  const byKey = new Map<string, TouchedTargetScopeWindow>();
  for (const window of windows) {
    byKey.set(`${window.granularity}|${window.start}|${window.end}`, window);
  }
  return Array.from(byKey.values()).sort((a, b) => {
    const byStart = a.start.localeCompare(b.start);
    if (byStart !== 0) {
      return byStart;
    }
    const byEnd = a.end.localeCompare(b.end);
    if (byEnd !== 0) {
      return byEnd;
    }
    return a.granularity.localeCompare(b.granularity);
  });
}

function sortStrings<T extends string>(values: readonly T[]): T[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function toUtcDay(iso: string): string {
  return iso.slice(0, 10);
}

function floorIsoToWindow(iso: string, windowMinutes: number): string {
  const date = new Date(iso);
  const time = date.getTime();
  const windowMs = windowMinutes * 60 * 1000;
  return new Date(Math.floor(time / windowMs) * windowMs).toISOString();
}

function ceilIsoFromWindow(iso: string, windowMinutes: number): string {
  return new Date(new Date(floorIsoToWindow(iso, windowMinutes)).getTime() + windowMinutes * 60 * 1000)
    .toISOString();
}

export async function maybeRunScheduledRetentionPrune(args: {
  db: Parameters<typeof runRetentionPrune>[0]["db"];
  env: NodeJS.ProcessEnv;
  nowIso: string;
  lastRunAtIso?: string;
}): Promise<{
  ran: boolean;
  result?: {
    rawEventsDeleted: number;
    metricsSnapshotsDeleted: number;
    postEngagementWindowsDeleted: number;
  };
}> {
  const config = resolveRetentionPruneConfig(args.env);
  if (!shouldRunRetentionPrune({ config, nowIso: args.nowIso, lastRunAtIso: args.lastRunAtIso })) {
    return { ran: false };
  }

  const result = await runRetentionPrune({
    db: args.db,
    config,
  });
  return {
    ran: true,
    result,
  };
}

async function main(): Promise<void> {
  const intervalMs = parseIntervalMs(process.env.PHASE1_SCHEDULER_INTERVAL_MS);
  const runOnBoot = parseBooleanFlag(process.env.PHASE1_SCHEDULER_RUN_ON_START, false);
  const runnableJobLimit = parsePositiveInt(process.env.PHASE1_SCHEDULER_RUNNABLE_LIMIT, 20);
  const runMode = resolvePhase1RunMode(process.env.REDDIT_RUN_MODE);
  const subreddits = parseSubredditListFromEnv(process.env);
  const runtime = createPostgresPhase1Runtime();
  const repos = runtime.repositories;
  const providerCapability = resolveRedditProviderCapabilityProbeConfigFromEnv(process.env);
  const connectorCache = new Map<string, RedditConnector>();
  const resolveConnectorForProviderHint = (
    providerHint: string | undefined,
    defaultLiveProviderOverride?: RedditLiveProvider,
  ): RedditConnector => {
    const providerOverride =
      resolveProviderOverride(providerHint) ?? defaultLiveProviderOverride;
    const cacheKey = providerOverride ?? "__default__";
    const cached = connectorCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const connector = runtime.createConnector(runMode, "live", providerOverride);
    connectorCache.set(cacheKey, connector);
    return connector;
  };
  const resolveCapabilityProbeConnectorForProviderHint = (
    providerHint: string | undefined,
    defaultLiveProviderOverride?: RedditLiveProvider,
  ): RedditConnector => {
    const providerOverride =
      resolveProviderOverride(providerHint) ?? defaultLiveProviderOverride;
    return createRedditCapabilityProbeConnectorFromEnv({
      env: process.env,
      mode: runMode,
      crawlMode: "live",
      providerOverride,
    });
  };
  const redditMapper = runtime.redditMapper;

  let inFlight = false;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let lastRetentionPruneAtIso: string | undefined;

  const runCycle = async (): Promise<void> => {
    if (stopped || inFlight) {
      return;
    }
    inFlight = true;
    const nowIso = new Date().toISOString();
    try {
      const providerPlan = await resolveSchedulerLiveProviderExecutionPlan({
        runMode,
        providerCapability,
        nowIso,
        resolveConnectorForProviderHint: resolveCapabilityProbeConnectorForProviderHint,
      });
      if (providerPlan.blocked) {
        // eslint-disable-next-line no-console
        console.error(
          JSON.stringify({
            event: "scheduler.provider_capability.blocked",
            nowIso,
            mode: runMode,
            provider: providerPlan.configuredProvider,
            fallbackProvider: providerPlan.fallbackProvider,
            subreddit: providerCapability.subreddit,
            reason: providerPlan.primaryReason ?? "provider capability probe failed",
            failureCategory: providerPlan.primaryFailureCategory,
            fallbackReason: providerPlan.fallbackReason,
            fallbackFailureCategory: providerPlan.fallbackFailureCategory,
          }),
        );
        return;
      }
      if (
        runMode === "live" &&
        providerPlan.effectiveProvider !== providerPlan.configuredProvider
      ) {
        // eslint-disable-next-line no-console
        console.warn(
          JSON.stringify({
            event: "scheduler.provider_capability.fallback_activated",
            nowIso,
            mode: runMode,
            provider: providerPlan.configuredProvider,
            effectiveProvider: providerPlan.effectiveProvider,
            subreddit: providerCapability.subreddit,
            reason: providerPlan.primaryReason,
            failureCategory: providerPlan.primaryFailureCategory,
          }),
        );
      }
      const cycleEnv =
        runMode === "live" &&
        providerPlan.effectiveProvider !== providerPlan.configuredProvider
          ? {
              ...process.env,
              REDDIT_LIVE_PROVIDER: providerPlan.effectiveProvider,
              REDDIT_SUPPRESS_HTTP_FALLBACK: "true",
            }
          : process.env;
      const fetchExecutionEngine = createRedditFetchExecutionEngine({
        mode: runMode,
        createConnector: runtime.createConnector,
        providerHealthWindowRepository: repos.providerHealthWindowRepository,
        crawlCursorRepository: repos.crawlCursorRepository,
        policyContext: resolveRedditProviderRoutingPolicyContextFromEnv(cycleEnv),
      });

      await upsertActiveSubredditTargets({
        monitorTargetRepository: repos.monitorTargetRepository,
        subreddits,
        nowIso,
      });

      const result = await runRedditPhase1Cycle(
        {
          ...repos,
          redditConnector: resolveConnectorForProviderHint(
            undefined,
            providerPlan.effectiveProvider,
          ),
          redditConnectorResolver: ({ providerHint }) =>
            resolveConnectorForProviderHint(
              providerHint,
              providerPlan.effectiveProvider,
            ),
          redditExecutionStrategyResolver: ({
            targetId,
            canonicalName,
            providerHint,
            crawlMode,
            nowIso: executionNowIso,
          }) =>
            fetchExecutionEngine.resolveStrategy({
              targetId,
              canonicalName,
              defaultProviderHint: providerHint,
              crawlMode,
              nowIso: executionNowIso,
            }),
          redditMapper,
        },
        nowIso,
        resolveRedditPhase1CycleOptionsFromEnv({
          env: cycleEnv,
          mode: runMode,
          crawlMode: "live",
          postLimit: parseOptionalPositiveInt(process.env.REDDIT_POST_LIMIT),
          continueOnError: true,
        }),
      );
      const replayed = await executeRunnableCollectionJobs({
        repos,
        connector: resolveConnectorForProviderHint(
          undefined,
          providerPlan.effectiveProvider,
        ),
        connectorResolver: ({ providerHint, crawlMode }) =>
          resolveConnectorForProviderHint(
            resolveSchedulerRunnableProviderHint({
              providerHint,
              crawlMode,
              configuredProvider: providerPlan.configuredProvider,
              effectiveProvider: providerPlan.effectiveProvider,
            }),
            providerPlan.effectiveProvider,
          ),
        redditMapper,
        nowIso,
        runnableJobLimit,
        runMode,
      });
      const materializedTargets = await materializeTouchedTargets({
        repos: {
          contentRepository: repos.contentRepository,
          metricsSnapshotRepository: repos.metricsSnapshotRepository,
          subredditDailyFactRepository: repos.subredditDailyFactRepository,
          postGrowthFactRepository: repos.postGrowthFactRepository,
          keywordTrendDailyRepository: repos.keywordTrendDailyRepository,
          anomalyEventRepository: repos.anomalyEventRepository,
          subredditTrendPointRepository: repos.subredditTrendPointRepository,
        },
        targets: replayed.touchedTargets,
        nowIso,
        env: cycleEnv,
        runMode,
      });
      const retentionPrune = await maybeRunScheduledRetentionPrune({
        db: runtime.db,
        env: cycleEnv,
        nowIso,
        lastRunAtIso: lastRetentionPruneAtIso,
      });
      if (retentionPrune.ran) {
        lastRetentionPruneAtIso = nowIso;
      }

      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          event: "scheduler.cycle.completed",
          nowIso,
          mode: runMode,
          intervalMs,
          processedCanonicalNames: result.processedCanonicalNames,
          requestedCanonicalNames: result.requestedCanonicalNames,
          failedTargets: result.failedTargets,
          replayedJobs: replayed.executedJobs,
          materializedTargets,
          retentionPrune,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify({
          event: "scheduler.cycle.failed",
          nowIso,
          mode: runMode,
          intervalMs,
          error: message,
        }),
      );
    } finally {
      inFlight = false;
    }
  };

  const closeGracefully = async (): Promise<void> => {
    if (stopped) {
      return;
    }
    stopped = true;
    if (timer) {
      clearInterval(timer);
      timer = undefined;
    }
    while (inFlight) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    await runtime.close();
  };

  process.on("SIGINT", () => {
    void closeGracefully().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void closeGracefully().finally(() => process.exit(0));
  });

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      event: "scheduler.started",
      mode: runMode,
      intervalMs,
      runOnBoot,
      providerCapabilityRequired: runMode === "live" && providerCapability.required,
      providerCapabilitySubreddit:
        runMode === "live" && providerCapability.required
          ? `r/${providerCapability.subreddit}`
          : undefined,
      seedSubreddits: subreddits.map((item) => `r/${item}`),
    }),
  );

  if (runOnBoot) {
    await runCycle();
  }
  timer = setInterval(() => {
    void runCycle();
  }, intervalMs);
}

if (require.main === module) {
  void main();
}
