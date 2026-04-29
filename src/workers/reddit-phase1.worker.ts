import type { RedditConnector } from "../connectors/reddit/reddit-connector.interface";
import type { RedditMapper } from "../connectors/reddit/reddit-mapper.interface";
import type { RedditLiveProvider } from "../connectors/reddit/create-reddit-connector";
import type {
  BackfillCoverageStatus,
  BackfillStopReason,
  CrawlCursor,
} from "../domain/entities/crawl-cursor";
import type { AccountRepository } from "../domain/repositories/account-repository";
import type { CollectionJobRepository } from "../domain/repositories/collection-job-repository";
import type { ContentRepository } from "../domain/repositories/content-repository";
import type { CrawlCursorRepository } from "../domain/repositories/crawl-cursor-repository";
import type { KeywordQuerySessionRepository } from "../domain/repositories/keyword-query-session-repository";
import type { KeywordTrendDailyRepository } from "../domain/repositories/keyword-trend-daily-repository";
import type { MetricsSnapshotRepository } from "../domain/repositories/metrics-snapshot-repository";
import type { MonitorTargetRepository } from "../domain/repositories/monitor-target-repository";
import type { PostEngagementRepository } from "../domain/repositories/post-engagement-repository";
import type { PostGrowthFactRepository } from "../domain/repositories/post-growth-fact-repository";
import type { ProviderHealthWindowRepository } from "../domain/repositories/provider-health-window-repository";
import type { RawEventRepository } from "../domain/repositories/raw-event-repository";
import type { SubredditDailyFactRepository } from "../domain/repositories/subreddit-daily-fact-repository";
import type { SubredditCollectionCoverageRepository } from "../domain/repositories/subreddit-collection-coverage-repository";
import type { SubredditTrendPointRepository } from "../domain/repositories/subreddit-trend-point-repository";
import type { AnomalyEventRepository } from "../domain/repositories/anomaly-event-repository";
import type { SubredditTrendPoint } from "../domain/entities/subreddit-trend-point";
import { collectSubredditAboutJob } from "../jobs/collect-subreddit-about.job";
import { collectSubredditNewPostsJob } from "../jobs/collect-subreddit-new-posts.job";
import { materializeTargetAnalytics } from "./reddit-phase1-materialization";
import {
  BACKFILL_COLLECTION_WINDOW_MINUTES,
  DEFAULT_REDDIT_BACKFILL_MAX_ITERATIONS_PER_TARGET,
  DEFAULT_REDDIT_BACKFILL_POST_LIMIT,
  DEFAULT_REDDIT_POST_LIMIT_BASE,
  DEFAULT_REDDIT_POST_LIMIT_BOOST,
} from "./reddit-phase1-defaults";
import { PHASE1_SAMPLING_THRESHOLDS } from "./reddit-phase1-thresholds";
import { selectTargetsForLiveCollection } from "./reddit-target-scheduling";

interface RedditExecutionStrategy {
  selectedProvider: RedditLiveProvider;
  providerHint: string;
  connector: RedditConnector;
  scraplingProfile: string | null;
  routingClass: string;
  reasons: string[];
}

export interface RedditPhase1WorkerDependencies {
  monitorTargetRepository: MonitorTargetRepository;
  collectionJobRepository: CollectionJobRepository;
  rawEventRepository: RawEventRepository;
  accountRepository: AccountRepository;
  contentRepository: ContentRepository;
  crawlCursorRepository?: CrawlCursorRepository;
  providerHealthWindowRepository?: ProviderHealthWindowRepository;
  keywordTrendDailyRepository?: KeywordTrendDailyRepository;
  keywordQuerySessionRepository?: KeywordQuerySessionRepository;
  postGrowthFactRepository?: PostGrowthFactRepository;
  anomalyEventRepository?: AnomalyEventRepository;
  metricsSnapshotRepository: MetricsSnapshotRepository;
  postEngagementRepository?: PostEngagementRepository;
  subredditDailyFactRepository: SubredditDailyFactRepository;
  subredditCollectionCoverageRepository?: SubredditCollectionCoverageRepository;
  subredditTrendPointRepository: SubredditTrendPointRepository;
  redditConnector: RedditConnector;
  redditConnectorResolver?: (args: {
    canonicalName: string;
    providerHint?: string;
    crawlMode: "live" | "backfill";
  }) => RedditConnector;
  redditExecutionStrategyResolver?: (args: {
    targetId: string;
    canonicalName: string;
    providerHint?: string;
    crawlMode: "live" | "backfill";
    nowIso: string;
  }) => Promise<RedditExecutionStrategy>;
  redditMapper: RedditMapper;
}

export interface RedditPhase1CycleOptions {
  targetCanonicalNames?: string[];
  scraplingPrimaryCanonicalNames?: string[];
  defaultFavoriteTargetCadenceHours?: number;
  postLimit?: number;
  basePostLimit?: number;
  boostPostLimit?: number;
  backfillPostLimit?: number;
  samplingHealthLookbackMinutes?: number;
  boostWindowMinutes?: number;
  boostSurgeThreshold?: number;
  boostHeatChangeThreshold?: number;
  boostImpactMomentumThreshold?: number;
  boostMinDispersion?: number;
  boostMinHighScorePostCount?: number;
  boostCooldownWindows?: number;
  keywordDailyLookbackDays?: number;
  dailyFactLookbackDays?: number;
  keywordDailyQualityMinScore?: number;
  keywordDailyQualityMinComments?: number;
  keywordDailyMaxKeywordsPerDay?: number;
  backfillTargetDays?: number;
  backfillMaxIterationsPerTarget?: number;
  crawlMode?: "live" | "backfill";
  providerHint?: string;
  postCandidateMinScore?: number;
  postCandidateMinComments?: number;
  postCandidateFilterMode?: "and" | "or";
  disableAdaptiveSampling?: boolean;
  trendLookbackMinutes?: number;
  continueOnError?: boolean;
}

export interface RedditPhase1TargetFailure {
  canonicalName: string;
  error: string;
}

export interface RedditPhase1CycleResult {
  processedCanonicalNames: string[];
  requestedCanonicalNames: string[];
  failedTargets: RedditPhase1TargetFailure[];
}

type SamplingTier = "base" | "elevated" | "boost";

interface SamplingDecision {
  limit: number;
  tier: SamplingTier;
  pressure: number;
  reasons: string[];
  providerProfile: "http_primary" | "generic";
  signals: SamplingSignals;
}

interface ResolvedSamplingPlan {
  limit: number;
  tier: SamplingTier;
}

interface SamplingSignals {
  coverageGap: number;
  surge: number;
  heat: number;
  impact: number;
  acceleration: number;
  persistence: number;
  qualitySupport: number;
  leadingPulse: number;
  transportPressure: number;
  staleHeadPressure: number;
  switchInstability: number;
  activePostRatio: number;
}

interface SamplingHealthEvidence {
  fetchSuccessRate: number | null;
  emptyRate: number | null;
  fallbackRate: number | null;
  duplicateRate: number | null;
  ingestLagSeconds: number | null;
  providerDiffRate: number | null;
  errorRate: number | null;
  rateLimitRate: number | null;
  timeoutRate: number | null;
  circuitOpenRate: number | null;
  providerSwitchShare: number;
}

const DEFAULT_SAMPLING_HEALTH_LOOKBACK_MINUTES = 45;

function toCanonicalSubredditName(value: string): string {
  const normalized = value.trim().replace(/^r\//i, "").toLowerCase();
  return `r/${normalized}`;
}

function resolveTargetProviderHint(args: {
  canonicalName: string;
  defaultProviderHint?: string;
  promotedScraplingCanonicalNames: ReadonlySet<string>;
}): string | undefined {
  const canonicalName = toCanonicalSubredditName(args.canonicalName);
  if (args.promotedScraplingCanonicalNames.has(canonicalName)) {
    return "scrapling";
  }
  const normalized = args.defaultProviderHint?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

export async function runRedditPhase1Cycle(
  deps: RedditPhase1WorkerDependencies,
  nowIso: string,
  options: RedditPhase1CycleOptions = {},
): Promise<RedditPhase1CycleResult> {
  const fixedPostLimit = options.postLimit;
  const basePostLimit = Math.max(1, options.basePostLimit ?? DEFAULT_REDDIT_POST_LIMIT_BASE);
  const boostPostLimit = Math.max(
    basePostLimit,
    options.boostPostLimit ?? DEFAULT_REDDIT_POST_LIMIT_BOOST,
  );
  const backfillPostLimit = Math.max(
    boostPostLimit,
    options.backfillPostLimit ?? DEFAULT_REDDIT_BACKFILL_POST_LIMIT,
  );
  const samplingHealthLookbackMinutes = Math.max(
    5,
    options.samplingHealthLookbackMinutes ?? DEFAULT_SAMPLING_HEALTH_LOOKBACK_MINUTES,
  );
  const boostWindowMinutes = Math.max(15, options.boostWindowMinutes ?? 180);
  const boostSurgeThreshold = options.boostSurgeThreshold ?? 0.85;
  const boostHeatChangeThreshold = options.boostHeatChangeThreshold ?? 0.8;
  const boostImpactMomentumThreshold = options.boostImpactMomentumThreshold ?? 0.7;
  const boostMinDispersion = clamp(options.boostMinDispersion ?? 0.45, 0, 1);
  const boostMinHighScorePostCount = Math.max(1, options.boostMinHighScorePostCount ?? 2);
  const boostCooldownWindows = Math.max(0, options.boostCooldownWindows ?? 2);
  const keywordDailyLookbackDays = Math.max(1, options.keywordDailyLookbackDays ?? 90);
  const dailyFactLookbackDays = Math.max(30, options.dailyFactLookbackDays ?? 45);
  const backfillTargetDays = Math.max(1, options.backfillTargetDays ?? 15);
  const backfillMaxIterationsPerTarget = Math.max(
    1,
    options.backfillMaxIterationsPerTarget ?? DEFAULT_REDDIT_BACKFILL_MAX_ITERATIONS_PER_TARGET,
  );
  const keywordDailyQualityMinScore = Math.max(0, options.keywordDailyQualityMinScore ?? 10);
  const keywordDailyQualityMinComments = Math.max(0, options.keywordDailyQualityMinComments ?? 20);
  const keywordDailyMaxKeywordsPerDay = Math.max(1, options.keywordDailyMaxKeywordsPerDay ?? 50);
  const crawlMode = options.crawlMode ?? "live";
  const providerHint = options.providerHint?.trim() || undefined;
  const postCandidateMinScore = Math.max(0, options.postCandidateMinScore ?? 0);
  const postCandidateMinComments = Math.max(0, options.postCandidateMinComments ?? 0);
  const postCandidateFilterMode = options.postCandidateFilterMode === "and" ? "and" : "or";
  const disableAdaptiveSampling = options.disableAdaptiveSampling ?? false;
  const trendLookbackMinutes = options.trendLookbackMinutes ?? 72 * 60;
  const continueOnError = options.continueOnError ?? false;
  const promotedScraplingCanonicalNames = new Set(
    (options.scraplingPrimaryCanonicalNames ?? []).map(toCanonicalSubredditName),
  );
  const requestedCanonicalNames = Array.from(
    new Set((options.targetCanonicalNames ?? []).map(toCanonicalSubredditName)),
  );

  const targets =
    requestedCanonicalNames.length === 0
      ? selectTargetsForLiveCollection({
          targets: await deps.monitorTargetRepository.findActiveSubreddits(),
          nowIso,
          defaultCadenceHours: options.defaultFavoriteTargetCadenceHours,
        })
      : (
          await Promise.all(
            requestedCanonicalNames.map((name) =>
              deps.monitorTargetRepository.findByCanonicalName(name),
            ),
          )
        ).filter((target): target is NonNullable<typeof target> => {
          return target !== null && target.targetType === "subreddit" && target.status === "active";
        });

  const processedCanonicalNames: string[] = [];
  const failedTargets: RedditPhase1TargetFailure[] = [];

  for (const target of targets) {
    try {
      const defaultTargetProviderHint = resolveTargetProviderHint({
        canonicalName: target.canonicalName,
        defaultProviderHint: providerHint,
        promotedScraplingCanonicalNames,
      });
      const executionStrategy = deps.redditExecutionStrategyResolver
        ? await deps.redditExecutionStrategyResolver({
            targetId: target.id,
            canonicalName: target.canonicalName,
            providerHint: defaultTargetProviderHint,
            crawlMode,
            nowIso,
          })
        : null;
      const targetProviderHint =
        executionStrategy?.selectedProvider ??
        executionStrategy?.providerHint ??
        defaultTargetProviderHint;
      const targetConnector =
        executionStrategy?.connector ??
        deps.redditConnectorResolver?.({
          canonicalName: target.canonicalName,
          providerHint: targetProviderHint,
          crawlMode,
        }) ??
        deps.redditConnector;
      if (executionStrategy) {
        // eslint-disable-next-line no-console
        console.log(
          JSON.stringify({
            event: "reddit.provider_route.selected",
            nowIso,
            targetId: target.id,
            canonicalName: target.canonicalName,
            selectedProvider: executionStrategy.selectedProvider,
            providerHint: executionStrategy.providerHint,
            scraplingProfile: executionStrategy.scraplingProfile,
            routingClass: executionStrategy.routingClass,
            reasons: executionStrategy.reasons,
          }),
        );
      }
      const postSamplingPlan: ResolvedSamplingPlan =
        fixedPostLimit != null
          ? {
              limit: Math.max(1, fixedPostLimit),
              tier: "base",
            }
          : await resolvePostSamplingLimit({
              targetId: target.id,
              nowIso,
              basePostLimit,
              boostPostLimit,
              backfillPostLimit,
              samplingHealthLookbackMinutes,
              boostWindowMinutes,
              boostSurgeThreshold,
              boostHeatChangeThreshold,
              boostImpactMomentumThreshold,
              boostMinDispersion,
              boostMinHighScorePostCount,
              boostCooldownWindows,
              disableAdaptiveSampling,
              mode: crawlMode,
              providerHint: targetProviderHint,
              providerHealthWindowRepository: deps.providerHealthWindowRepository,
              subredditTrendPointRepository: deps.subredditTrendPointRepository,
            });
      const postLimit = postSamplingPlan.limit;
      const subreddit = target.canonicalName.replace(/^r\//, "");
      const baseInput = {
        targetId: target.id,
        subreddit,
        nowIso,
        crawlMode,
      };

      await collectSubredditAboutJob(
        {
          redditConnector: targetConnector,
          redditMapper: deps.redditMapper,
          collectionJobRepository: deps.collectionJobRepository,
          rawEventRepository: deps.rawEventRepository,
          metricsSnapshotRepository: deps.metricsSnapshotRepository,
        },
        baseInput,
      );

      const collectionCompletedAtIso = await runBoundedTargetBackfill(
        {
          contentRepository: deps.contentRepository,
          crawlCursorRepository: deps.crawlCursorRepository,
          collectionJobRepository: deps.collectionJobRepository,
          rawEventRepository: deps.rawEventRepository,
          accountRepository: deps.accountRepository,
          metricsSnapshotRepository: deps.metricsSnapshotRepository,
          postEngagementRepository: deps.postEngagementRepository,
          providerHealthWindowRepository: deps.providerHealthWindowRepository,
          redditConnector: targetConnector,
          redditMapper: deps.redditMapper,
        },
        {
          targetId: target.id,
          subreddit,
          nowIso,
          crawlMode,
          limit: postLimit,
          samplingTier: postSamplingPlan.tier,
          providerHint: targetProviderHint,
          candidateFilter: {
            minScore: postCandidateMinScore,
            minComments: postCandidateMinComments,
            mode: postCandidateFilterMode,
          },
          targetBackfillFromIso: new Date(
            new Date(nowIso).getTime() - backfillTargetDays * 24 * 60 * 60 * 1000,
          ).toISOString(),
          maxIterationsPerTarget: backfillMaxIterationsPerTarget,
        },
      );

      const trendFromIso = new Date(
        new Date(nowIso).getTime() - trendLookbackMinutes * 60 * 1000,
      ).toISOString();
      const dailyFactFromIso = new Date(
        new Date(nowIso).getTime() - dailyFactLookbackDays * 24 * 60 * 60 * 1000,
      ).toISOString();
      if (deps.postEngagementRepository) {
        const explicitQueries = deps.keywordQuerySessionRepository
          ? (
              await deps.keywordQuerySessionRepository.listLiveRefreshCandidates({
                statuses: ["initial_ready", "live_refreshing", "completed"],
                limit: 60,
              })
            )
              .filter((session) => {
                if (!session.canonicalSubreddit) {
                  return true;
                }
                return (
                  toCanonicalSubredditName(session.canonicalSubreddit) ===
                  toCanonicalSubredditName(target.canonicalName)
                );
              })
              .map((session) => session.queryText)
          : [];
        await materializeTargetAnalytics({
          repos: {
            contentRepository: deps.contentRepository,
            metricsSnapshotRepository: deps.metricsSnapshotRepository,
            postEngagementRepository: deps.postEngagementRepository,
            subredditDailyFactRepository: deps.subredditDailyFactRepository,
            subredditCollectionCoverageRepository: deps.subredditCollectionCoverageRepository,
            crawlCursorRepository: deps.crawlCursorRepository,
            providerHealthWindowRepository: deps.providerHealthWindowRepository,
            postGrowthFactRepository: deps.postGrowthFactRepository,
            keywordTrendDailyRepository: deps.keywordTrendDailyRepository,
            anomalyEventRepository: deps.anomalyEventRepository,
            subredditTrendPointRepository: deps.subredditTrendPointRepository,
          },
          targetId: target.id,
          canonicalSubreddit: target.canonicalName,
          crawlMode,
          nowIso: collectionCompletedAtIso,
          generatedAtIso: collectionCompletedAtIso,
          ranges: {
            dailyFactFromIso,
            coverageFromIso: dailyFactFromIso,
            trendFromIso,
            postGrowthFromIso: new Date(
              new Date(nowIso).getTime() - 24 * 60 * 60 * 1000,
            ).toISOString(),
            keywordFromIso: new Date(
              new Date(nowIso).getTime() - keywordDailyLookbackDays * 24 * 60 * 60 * 1000,
            ).toISOString(),
          },
          explicitQueries,
          keywordDailyQualityMinScore,
          keywordDailyQualityMinComments,
          keywordDailyMaxKeywordsPerDay,
        });
      }
      processedCanonicalNames.push(target.canonicalName);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      if (!continueOnError) {
        throw error;
      }
      failedTargets.push({
        canonicalName: target.canonicalName,
        error: message,
      });
    }
  }

  return {
    processedCanonicalNames,
    requestedCanonicalNames,
    failedTargets,
  };
}

async function runBoundedTargetBackfill(
  deps: Pick<
    RedditPhase1WorkerDependencies,
    | "accountRepository"
    | "collectionJobRepository"
    | "contentRepository"
    | "crawlCursorRepository"
    | "metricsSnapshotRepository"
    | "postEngagementRepository"
    | "providerHealthWindowRepository"
    | "rawEventRepository"
    | "redditConnector"
    | "redditMapper"
  >,
  args: {
    targetId: string;
    subreddit: string;
    nowIso: string;
    crawlMode: "live" | "backfill";
    limit: number;
    samplingTier: SamplingTier;
    providerHint?: string;
    candidateFilter: {
      minScore?: number;
      minComments?: number;
      mode?: "and" | "or";
    };
    targetBackfillFromIso: string;
    maxIterationsPerTarget: number;
  },
): Promise<string> {
  const iterations = args.crawlMode === "backfill" ? args.maxIterationsPerTarget : 1;
  const backfillProvider = resolveBackfillStateProvider(args.providerHint);
  let latestIterationNowIso = args.nowIso;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const priorBackfillProgress =
      args.crawlMode === "backfill"
        ? await resolveLatestBackfillCursorProgress({
            crawlCursorRepository: deps.crawlCursorRepository,
            targetId: args.targetId,
            provider: backfillProvider,
          })
        : null;
    const iterationNowIso = new Date(
      new Date(args.nowIso).getTime() +
        iteration * BACKFILL_COLLECTION_WINDOW_MINUTES * 60 * 1000,
    ).toISOString();
    latestIterationNowIso = iterationNowIso;

    await collectSubredditNewPostsJob(
      {
        redditConnector: deps.redditConnector,
        redditMapper: deps.redditMapper,
        collectionJobRepository: deps.collectionJobRepository,
        rawEventRepository: deps.rawEventRepository,
        accountRepository: deps.accountRepository,
        contentRepository: deps.contentRepository,
        crawlCursorRepository: deps.crawlCursorRepository,
        providerHealthWindowRepository: deps.providerHealthWindowRepository,
        metricsSnapshotRepository: deps.metricsSnapshotRepository,
        postEngagementRepository: deps.postEngagementRepository,
      },
      {
        targetId: args.targetId,
        subreddit: args.subreddit,
        nowIso: iterationNowIso,
        limit: args.limit,
        samplingTier: args.samplingTier,
        mode: args.crawlMode,
        providerHint: args.providerHint,
        candidateFilter: args.candidateFilter,
      },
    );

    if (args.crawlMode !== "backfill") {
      return latestIterationNowIso;
    }

    const latestCursor = await resolveLatestBackfillCursor({
      crawlCursorRepository: deps.crawlCursorRepository,
      targetId: args.targetId,
      provider: backfillProvider,
    });
    const reachedCoverage = hasReachedBackfillCoverage({
      latestCursor,
      targetBackfillFromIso: args.targetBackfillFromIso,
    });
    if (reachedCoverage) {
      await persistBackfillCoverageState({
        crawlCursorRepository: deps.crawlCursorRepository,
        latestCursor,
        targetBackfillFromIso: args.targetBackfillFromIso,
        status: "covered",
        stopReason: "coverage_reached",
        updatedAt: iterationNowIso,
      });
      return latestIterationNowIso;
    }

    const reachedTerminalCursor = hasBackfillReachedTerminalCursor(latestCursor);
    if (reachedTerminalCursor) {
      await persistBackfillCoverageState({
        crawlCursorRepository: deps.crawlCursorRepository,
        latestCursor,
        targetBackfillFromIso: args.targetBackfillFromIso,
        status: "source_limited",
        stopReason: "terminal_eof",
        updatedAt: iterationNowIso,
      });
      return latestIterationNowIso;
    }

    const nextBackfillProgress = await resolveLatestBackfillCursorProgress({
      crawlCursorRepository: deps.crawlCursorRepository,
      targetId: args.targetId,
      provider: backfillProvider,
    });
    if (
      hasBackfillCursorSaturated({
        previous: priorBackfillProgress,
        next: nextBackfillProgress,
      })
    ) {
      await persistBackfillCoverageState({
        crawlCursorRepository: deps.crawlCursorRepository,
        latestCursor: await resolveLatestBackfillCursor({
          crawlCursorRepository: deps.crawlCursorRepository,
          targetId: args.targetId,
          provider: backfillProvider,
        }),
        targetBackfillFromIso: args.targetBackfillFromIso,
        status: "saturated_before_15d",
        stopReason: "cursor_saturated",
        updatedAt: iterationNowIso,
      });
      return latestIterationNowIso;
    }

    await persistBackfillCoverageState({
      crawlCursorRepository: deps.crawlCursorRepository,
      latestCursor,
      targetBackfillFromIso: args.targetBackfillFromIso,
      status: "progressing",
      stopReason: "awaiting_progress",
      updatedAt: iterationNowIso,
    });
  }

  await persistBackfillCoverageState({
    crawlCursorRepository: deps.crawlCursorRepository,
    latestCursor: await resolveLatestBackfillCursor({
      crawlCursorRepository: deps.crawlCursorRepository,
      targetId: args.targetId,
      provider: backfillProvider,
    }),
    targetBackfillFromIso: args.targetBackfillFromIso,
    status: "progressing",
    stopReason: "iteration_budget_exhausted",
    updatedAt: args.nowIso,
  });
  return latestIterationNowIso;
}

function resolveBackfillStateProvider(providerHint: string | undefined): string | undefined {
  const normalized = providerHint?.trim().toLowerCase();
  if (!normalized || normalized === "reddit") {
    return undefined;
  }
  return normalized;
}

function hasReachedBackfillCoverage(args: {
  latestCursor: CrawlCursor | null;
  targetBackfillFromIso: string;
}): boolean {
  const latestProgress = args.latestCursor;
  return (
    latestProgress?.oldestObservedAt != null &&
    latestProgress.oldestObservedAt <= args.targetBackfillFromIso
  );
}

function hasBackfillReachedTerminalCursor(latestCursor: CrawlCursor | null): boolean {
  return latestCursor?.cursor === "__backfill_eof__";
}

async function resolveLatestBackfillCursor(args: {
  crawlCursorRepository?: CrawlCursorRepository;
  targetId: string;
  provider?: string;
}): Promise<CrawlCursor | null> {
  if (!args.crawlCursorRepository) {
    return null;
  }
  const cursors = await args.crawlCursorRepository.list({
    targetId: args.targetId,
    mode: "backfill",
    provider: args.provider,
  });
  return cursors[0] ?? null;
}

async function resolveLatestBackfillCursorProgress(args: {
  crawlCursorRepository?: CrawlCursorRepository;
  targetId: string;
  provider?: string;
}): Promise<{
  cursor: string;
  oldestObservedAt?: string;
} | null> {
  if (!args.crawlCursorRepository) {
    return null;
  }
  const cursors = await args.crawlCursorRepository.list({
    targetId: args.targetId,
    mode: "backfill",
    provider: args.provider,
  });
  const latest = cursors[0];
  if (!latest) {
    return null;
  }
  return {
    cursor: latest.cursor,
    oldestObservedAt: latest.oldestObservedAt,
  };
}

function hasBackfillCursorSaturated(args: {
  previous: {
    cursor: string;
    oldestObservedAt?: string;
  } | null;
  next: {
    cursor: string;
    oldestObservedAt?: string;
  } | null;
}): boolean {
  if (!args.previous || !args.next) {
    return false;
  }
  if (args.next.cursor === "__backfill_eof__") {
    return false;
  }
  if (!args.previous.oldestObservedAt || !args.next.oldestObservedAt) {
    return false;
  }
  return (
    args.previous.cursor === args.next.cursor &&
    args.previous.oldestObservedAt === args.next.oldestObservedAt
  );
}

async function persistBackfillCoverageState(args: {
  crawlCursorRepository?: CrawlCursorRepository;
  latestCursor: CrawlCursor | null;
  targetBackfillFromIso: string;
  status: BackfillCoverageStatus;
  stopReason: BackfillStopReason;
  updatedAt: string;
}): Promise<void> {
  if (!args.crawlCursorRepository || !args.latestCursor) {
    return;
  }
  await args.crawlCursorRepository.upsert({
    provider: args.latestCursor.provider,
    targetId: args.latestCursor.targetId,
    mode: args.latestCursor.mode,
    cursor: args.latestCursor.cursor,
    rewindCursor: args.latestCursor.rewindCursor,
    oldestObservedAt: args.latestCursor.oldestObservedAt,
    newestObservedAt: args.latestCursor.newestObservedAt,
    backfillTargetFromIso: args.targetBackfillFromIso,
    backfillCoverageStatus: args.status,
    backfillStopReason: args.stopReason,
    lastFetchedAt: args.latestCursor.lastFetchedAt,
    updatedAt: args.updatedAt,
  });
}

async function resolvePostSamplingLimit(args: {
  targetId: string;
  nowIso: string;
  mode: "live" | "backfill";
  providerHint?: string;
  basePostLimit: number;
  boostPostLimit: number;
  backfillPostLimit: number;
  samplingHealthLookbackMinutes: number;
  boostWindowMinutes: number;
  boostSurgeThreshold: number;
  boostHeatChangeThreshold: number;
  boostImpactMomentumThreshold: number;
  boostMinDispersion: number;
  boostMinHighScorePostCount: number;
  boostCooldownWindows: number;
  disableAdaptiveSampling: boolean;
  providerHealthWindowRepository?: ProviderHealthWindowRepository;
  subredditTrendPointRepository: SubredditTrendPointRepository;
}): Promise<ResolvedSamplingPlan> {
  if (args.disableAdaptiveSampling) {
    return {
      limit: args.basePostLimit,
      tier: "base",
    };
  }
  if (args.mode === "backfill") {
    return {
      limit: args.backfillPostLimit,
      tier: "boost",
    };
  }

  const trendFromIso = new Date(
    new Date(args.nowIso).getTime() - args.boostWindowMinutes * 60 * 1000,
  ).toISOString();
  const healthFromIso = new Date(
    new Date(args.nowIso).getTime() - args.samplingHealthLookbackMinutes * 60 * 1000,
  ).toISOString();
  const [recentPoints, healthEvidence] = await Promise.all([
    args.subredditTrendPointRepository.listByTargetInRange({
      targetId: args.targetId,
      from: trendFromIso,
      to: args.nowIso,
    }),
    resolveSamplingHealthEvidence({
      repository: args.providerHealthWindowRepository,
      targetId: args.targetId,
      fromIso: healthFromIso,
      nowIso: args.nowIso,
      providerHint: args.providerHint,
    }),
  ]);
  if (recentPoints.length === 0 && !healthEvidence) {
    const coldStartDecision = buildColdStartSamplingDecision({
      basePostLimit: args.basePostLimit,
      boostPostLimit: args.boostPostLimit,
      providerHint: args.providerHint,
    });
    logSamplingDecision({
      nowIso: args.nowIso,
      targetId: args.targetId,
      decision: coldStartDecision,
    });
    return {
      limit: coldStartDecision.limit,
      tier: coldStartDecision.tier,
    };
  }

  const decision = buildSamplingDecision({
    points: recentPoints,
    healthEvidence,
    providerHint: args.providerHint,
    basePostLimit: args.basePostLimit,
    boostPostLimit: args.boostPostLimit,
    boostSurgeThreshold: args.boostSurgeThreshold,
    boostHeatChangeThreshold: args.boostHeatChangeThreshold,
    boostImpactMomentumThreshold: args.boostImpactMomentumThreshold,
    boostMinDispersion: args.boostMinDispersion,
    boostMinHighScorePostCount: args.boostMinHighScorePostCount,
    cooldownWindows: args.boostCooldownWindows,
  });
  logSamplingDecision({
    nowIso: args.nowIso,
    targetId: args.targetId,
    decision,
  });
  return {
    limit: decision.limit,
    tier: decision.tier,
  };
}

function hasRecentBoost(args: {
  points: Awaited<ReturnType<SubredditTrendPointRepository["listByTargetInRange"]>>;
  boostPostLimit: number;
  cooldownWindows: number;
}): boolean {
  const recent = args.points.slice(-args.cooldownWindows);
  return recent.some((point) => (point.sampledPostCount ?? 0) >= args.boostPostLimit);
}

function buildSamplingDecision(args: {
  points: Awaited<ReturnType<SubredditTrendPointRepository["listByTargetInRange"]>>;
  healthEvidence: SamplingHealthEvidence | null;
  providerHint?: string;
  basePostLimit: number;
  boostPostLimit: number;
  boostSurgeThreshold: number;
  boostHeatChangeThreshold: number;
  boostImpactMomentumThreshold: number;
  boostMinDispersion: number;
  boostMinHighScorePostCount: number;
  cooldownWindows: number;
}): SamplingDecision {
  const latestPoint = args.points[args.points.length - 1];
  const recentSupport = args.points.slice(-3);
  const httpPrimary = isHttpPrimaryProvider(args.providerHint);
  const thresholds = httpPrimary
    ? {
        elevatedPressureMin: PHASE1_SAMPLING_THRESHOLDS.elevatedPressureMin.httpPrimary,
        boostPressureMin: PHASE1_SAMPLING_THRESHOLDS.boostPressureMin.httpPrimary,
        strongLeadingEdgePulseMin:
          PHASE1_SAMPLING_THRESHOLDS.strongLeadingEdge.pulseMin.httpPrimary,
        strongLeadingEdgeActivePostRatioMin:
          PHASE1_SAMPLING_THRESHOLDS.strongLeadingEdge.activePostRatioMin.httpPrimary,
        sustainedCoverageGapMin:
          PHASE1_SAMPLING_THRESHOLDS.sustainedCoverageStress.coverageGapMin.httpPrimary,
        severeTimeoutRateMin:
          PHASE1_SAMPLING_THRESHOLDS.severeTransportFailure.timeoutRateMin.httpPrimary,
        severeCircuitOpenRateMin:
          PHASE1_SAMPLING_THRESHOLDS.severeTransportFailure.circuitOpenRateMin.httpPrimary,
        severeRateLimitRateMin:
          PHASE1_SAMPLING_THRESHOLDS.severeTransportFailure.rateLimitRateMin.httpPrimary,
        severeErrorRateMin:
          PHASE1_SAMPLING_THRESHOLDS.severeTransportFailure.errorRateMin.httpPrimary,
        stressedTransportPressureMin:
          PHASE1_SAMPLING_THRESHOLDS.stressedTransport.pressureMin.httpPrimary,
        staleHeadPressureMin: PHASE1_SAMPLING_THRESHOLDS.staleHead.pressureMin.httpPrimary,
        staleHeadDuplicateRateMin:
          PHASE1_SAMPLING_THRESHOLDS.staleHead.duplicateRateMin.httpPrimary,
        staleHeadIngestLagSecondsMin:
          PHASE1_SAMPLING_THRESHOLDS.staleHead.ingestLagSecondsMin.httpPrimary,
        severeStaleHeadDuplicateRateMin:
          PHASE1_SAMPLING_THRESHOLDS.staleHead.severeDuplicateRateMin.httpPrimary,
        severeStaleHeadIngestLagSecondsMin:
          PHASE1_SAMPLING_THRESHOLDS.staleHead.severeIngestLagSecondsMin.httpPrimary,
        switchInstabilityMin:
          PHASE1_SAMPLING_THRESHOLDS.switchInstability.instabilityMin.httpPrimary,
        providerSwitchShareMin:
          PHASE1_SAMPLING_THRESHOLDS.switchInstability.providerSwitchShareMin.httpPrimary,
        switchBoostLeadingPulseMin:
          PHASE1_SAMPLING_THRESHOLDS.switchInstability.boostLeadingPulseMin.httpPrimary,
        elevatedTransportPressureMin:
          PHASE1_SAMPLING_THRESHOLDS.elevatedTier.transportPressureMin.httpPrimary,
        elevatedLeadingPulseMin:
          PHASE1_SAMPLING_THRESHOLDS.elevatedTier.leadingPulseMin.httpPrimary,
        elevatedQualitySupportMin:
          PHASE1_SAMPLING_THRESHOLDS.elevatedTier.qualitySupportMin.httpPrimary,
        elevatedLimitBaseRatio:
          PHASE1_SAMPLING_THRESHOLDS.elevatedTier.limitBaseRatio.httpPrimary,
        elevatedLimitPressureScale:
          PHASE1_SAMPLING_THRESHOLDS.elevatedTier.limitPressureScale.httpPrimary,
      }
    : {
        elevatedPressureMin: PHASE1_SAMPLING_THRESHOLDS.elevatedPressureMin.generic,
        boostPressureMin: PHASE1_SAMPLING_THRESHOLDS.boostPressureMin.generic,
        strongLeadingEdgePulseMin:
          PHASE1_SAMPLING_THRESHOLDS.strongLeadingEdge.pulseMin.generic,
        strongLeadingEdgeActivePostRatioMin:
          PHASE1_SAMPLING_THRESHOLDS.strongLeadingEdge.activePostRatioMin.generic,
        sustainedCoverageGapMin:
          PHASE1_SAMPLING_THRESHOLDS.sustainedCoverageStress.coverageGapMin.generic,
        severeTimeoutRateMin:
          PHASE1_SAMPLING_THRESHOLDS.severeTransportFailure.timeoutRateMin.generic,
        severeCircuitOpenRateMin:
          PHASE1_SAMPLING_THRESHOLDS.severeTransportFailure.circuitOpenRateMin.generic,
        severeRateLimitRateMin:
          PHASE1_SAMPLING_THRESHOLDS.severeTransportFailure.rateLimitRateMin.generic,
        severeErrorRateMin:
          PHASE1_SAMPLING_THRESHOLDS.severeTransportFailure.errorRateMin.generic,
        stressedTransportPressureMin:
          PHASE1_SAMPLING_THRESHOLDS.stressedTransport.pressureMin.generic,
        staleHeadPressureMin: PHASE1_SAMPLING_THRESHOLDS.staleHead.pressureMin.generic,
        staleHeadDuplicateRateMin:
          PHASE1_SAMPLING_THRESHOLDS.staleHead.duplicateRateMin.generic,
        staleHeadIngestLagSecondsMin:
          PHASE1_SAMPLING_THRESHOLDS.staleHead.ingestLagSecondsMin.generic,
        severeStaleHeadDuplicateRateMin:
          PHASE1_SAMPLING_THRESHOLDS.staleHead.severeDuplicateRateMin.generic,
        severeStaleHeadIngestLagSecondsMin:
          PHASE1_SAMPLING_THRESHOLDS.staleHead.severeIngestLagSecondsMin.generic,
        switchInstabilityMin:
          PHASE1_SAMPLING_THRESHOLDS.switchInstability.instabilityMin.generic,
        providerSwitchShareMin:
          PHASE1_SAMPLING_THRESHOLDS.switchInstability.providerSwitchShareMin.generic,
        switchBoostLeadingPulseMin:
          PHASE1_SAMPLING_THRESHOLDS.switchInstability.boostLeadingPulseMin.generic,
        elevatedTransportPressureMin:
          PHASE1_SAMPLING_THRESHOLDS.elevatedTier.transportPressureMin.generic,
        elevatedLeadingPulseMin:
          PHASE1_SAMPLING_THRESHOLDS.elevatedTier.leadingPulseMin.generic,
        elevatedQualitySupportMin:
          PHASE1_SAMPLING_THRESHOLDS.elevatedTier.qualitySupportMin.generic,
        elevatedLimitBaseRatio:
          PHASE1_SAMPLING_THRESHOLDS.elevatedTier.limitBaseRatio.generic,
        elevatedLimitPressureScale:
          PHASE1_SAMPLING_THRESHOLDS.elevatedTier.limitPressureScale.generic,
      };
  const maxSurgeScore = Math.max(0, ...args.points.map((point) => point.surgeScore ?? 0));
  const latestHeatChange = Math.max(0, latestPoint?.heatChangePct ?? 0);
  const latestDispersion = latestPoint?.dispersionScore ?? 0;
  const latestHighScorePostCount = latestPoint?.highScorePostCount ?? 0;
  const latestImpactMomentum = Math.max(
    0,
    latestPoint ? getScoreComponentNumber(latestPoint, "impactMomentum") : 0,
  );
  const latestReliability = latestPoint ? resolveSampleReliability(latestPoint) : 1;
  const minRecentReliability =
    recentSupport.length > 0 ? Math.min(...recentSupport.map(resolveSampleReliability)) : 1;
  const coverageGap = clamp(
    (PHASE1_SAMPLING_THRESHOLDS.targetSampleReliability - minRecentReliability) /
      PHASE1_SAMPLING_THRESHOLDS.targetSampleReliability,
    0,
    1,
  );
  const demandAcceleration = clamp(
    (latestPoint?.deltaNewPostsVsPrevWindow ?? 0) / Math.max(latestPoint?.newPosts ?? 0, 1),
    0,
    1,
  );
  const persistence = clamp(
    average(recentSupport.map((point) => normalizeTrendScore(point.trendScore ?? 0))),
    0,
    1,
  );
  const qualitySupport = clamp(
    latestHighScorePostCount / Math.max(args.boostMinHighScorePostCount * 2, 1),
    0,
    1,
  );
  const leadingPulse = clamp(
    0.34 * Math.max(0, latestPoint?.velocityScore ?? 0) +
      0.28 * Math.max(0, latestPoint?.accelerationScore ?? 0) +
      0.22 * Math.max(0, latestPoint?.anomalyScore ?? 0) +
      0.16 * Math.max(0, latestPoint?.baselineDeviationScore ?? 0),
    0,
    1,
  );
  const activePostRatio = clamp(latestPoint?.activePostRatio ?? 0, 0, 1);
  const transportPressure = resolveTransportPressure({
    healthEvidence: args.healthEvidence,
    httpPrimary,
  });
  const staleHeadPressure = resolveStaleHeadPressure({
    healthEvidence: args.healthEvidence,
    httpPrimary,
  });
  const switchInstability = resolveSwitchInstability({
    healthEvidence: args.healthEvidence,
  });
  const pressure = clamp(
    0.2 * coverageGap +
      0.14 * maxSurgeScore +
      0.09 * latestHeatChange +
      0.09 * latestImpactMomentum +
      0.08 * demandAcceleration +
      0.07 * persistence +
      0.13 * leadingPulse +
      0.05 * activePostRatio +
      0.11 * transportPressure +
      0.1 * staleHeadPressure +
      0.06 * switchInstability +
      (httpPrimary ? 0.04 * qualitySupport : 0.08 * qualitySupport),
    0,
    1,
  );
  const cooling =
    args.cooldownWindows > 0 &&
    hasRecentBoost({
      points: args.points,
      boostPostLimit: args.boostPostLimit,
      cooldownWindows: args.cooldownWindows,
    });
  const strongSurge =
    maxSurgeScore >= args.boostSurgeThreshold &&
    latestDispersion >= args.boostMinDispersion;
  const strongHeat =
    latestHeatChange >= args.boostHeatChangeThreshold &&
    latestHighScorePostCount >= args.boostMinHighScorePostCount;
  const strongImpact =
    latestImpactMomentum >= args.boostImpactMomentumThreshold &&
    latestDispersion >= args.boostMinDispersion;
  const strongLeadingEdge =
    leadingPulse >= thresholds.strongLeadingEdgePulseMin &&
    activePostRatio >= thresholds.strongLeadingEdgeActivePostRatioMin &&
    (qualitySupport >= PHASE1_SAMPLING_THRESHOLDS.strongLeadingEdge.qualitySupportMin ||
      coverageGap >= PHASE1_SAMPLING_THRESHOLDS.strongLeadingEdge.coverageGapMin);
  const sustainedCoverageStress =
    coverageGap >= thresholds.sustainedCoverageGapMin &&
    persistence >= PHASE1_SAMPLING_THRESHOLDS.sustainedCoverageStress.persistenceMin &&
    latestReliability < PHASE1_SAMPLING_THRESHOLDS.targetSampleReliability;
  const severeTransportFailure =
    (args.healthEvidence?.timeoutRate ?? 0) >= thresholds.severeTimeoutRateMin ||
    (args.healthEvidence?.circuitOpenRate ?? 0) >= thresholds.severeCircuitOpenRateMin ||
    (args.healthEvidence?.rateLimitRate ?? 0) >= thresholds.severeRateLimitRateMin ||
    (args.healthEvidence?.errorRate ?? 0) >= thresholds.severeErrorRateMin;
  const stressedTransport =
    transportPressure >= thresholds.stressedTransportPressureMin &&
    (coverageGap >= PHASE1_SAMPLING_THRESHOLDS.stressedTransport.coverageGapMin ||
      leadingPulse >= PHASE1_SAMPLING_THRESHOLDS.stressedTransport.leadingPulseMin);
  const staleHeadDetected =
    staleHeadPressure >= thresholds.staleHeadPressureMin &&
    ((args.healthEvidence?.duplicateRate ?? 0) >= thresholds.staleHeadDuplicateRateMin ||
      (args.healthEvidence?.ingestLagSeconds ?? 0) >=
        thresholds.staleHeadIngestLagSecondsMin);
  const severeStaleHeadDetected =
    staleHeadDetected &&
    (args.healthEvidence?.duplicateRate ?? 0) >= thresholds.severeStaleHeadDuplicateRateMin &&
    (args.healthEvidence?.ingestLagSeconds ?? 0) >=
      thresholds.severeStaleHeadIngestLagSecondsMin;
  const switchInstabilityDetected =
    switchInstability >= thresholds.switchInstabilityMin &&
    (args.healthEvidence?.providerSwitchShare ?? 0) >= thresholds.providerSwitchShareMin;
  const elevatedTransport = severeTransportFailure || stressedTransport;

  const elevatedLimit = resolveElevatedPostLimit(
    args.basePostLimit,
    args.boostPostLimit,
    clamp(
      thresholds.elevatedLimitBaseRatio + pressure * thresholds.elevatedLimitPressureScale,
      0,
      PHASE1_SAMPLING_THRESHOLDS.elevatedTier.limitCap,
    ),
  );

  const reasons: string[] = [];
  if (coverageGap > 0) {
    reasons.push(`coverage_gap:${coverageGap.toFixed(3)}`);
  }
  if (maxSurgeScore > 0) {
    reasons.push(`surge:${maxSurgeScore.toFixed(3)}`);
  }
  if (latestHeatChange > 0) {
    reasons.push(`heat:${latestHeatChange.toFixed(3)}`);
  }
  if (latestImpactMomentum > 0) {
    reasons.push(`impact:${latestImpactMomentum.toFixed(3)}`);
  }
  if (demandAcceleration > 0) {
    reasons.push(`acceleration:${demandAcceleration.toFixed(3)}`);
  }
  if (persistence > 0) {
    reasons.push(`persistence:${persistence.toFixed(3)}`);
  }
  if (qualitySupport > 0) {
    reasons.push(`quality_support:${qualitySupport.toFixed(3)}`);
  }
  if (leadingPulse > 0) {
    reasons.push(`leading_pulse:${leadingPulse.toFixed(3)}`);
  }
  if (activePostRatio > 0) {
    reasons.push(`active_post_ratio:${activePostRatio.toFixed(3)}`);
  }
  if (transportPressure > 0) {
    reasons.push(`transport_pressure:${transportPressure.toFixed(3)}`);
  }
  if (staleHeadPressure > 0) {
    reasons.push(`stale_head_pressure:${staleHeadPressure.toFixed(3)}`);
  }
  if (severeStaleHeadDetected) {
    reasons.push("severe_stale_head");
  }
  if (switchInstability > 0) {
    reasons.push(`switch_instability:${switchInstability.toFixed(3)}`);
  }
  if (args.healthEvidence) {
    pushHealthReasons(reasons, args.healthEvidence);
  }
  if (cooling) {
    reasons.push("cooldown");
  }

  const signals: SamplingSignals = {
    coverageGap,
    surge: maxSurgeScore,
    heat: latestHeatChange,
    impact: latestImpactMomentum,
    acceleration: demandAcceleration,
    persistence,
    qualitySupport,
    leadingPulse,
    transportPressure,
    staleHeadPressure,
    switchInstability,
    activePostRatio,
  };

  if (
    cooling &&
    !sustainedCoverageStress &&
    !elevatedTransport &&
    !strongLeadingEdge &&
    !staleHeadDetected &&
    !switchInstabilityDetected
  ) {
    return {
      limit: args.basePostLimit,
      tier: "base",
      pressure,
      reasons,
      providerProfile: httpPrimary ? "http_primary" : "generic",
      signals,
    };
  }

  if (
    severeStaleHeadDetected ||
    ((strongSurge ||
      strongHeat ||
      strongImpact ||
      strongLeadingEdge ||
      stressedTransport ||
      (switchInstabilityDetected && leadingPulse >= thresholds.switchBoostLeadingPulseMin) ||
      pressure >= thresholds.boostPressureMin) &&
      !cooling)
  ) {
    return {
      limit: args.boostPostLimit,
      tier: "boost",
      pressure,
      reasons,
      providerProfile: httpPrimary ? "http_primary" : "generic",
      signals,
    };
  }

  if (
    sustainedCoverageStress ||
    elevatedTransport ||
    staleHeadDetected ||
    switchInstabilityDetected ||
    transportPressure >= thresholds.elevatedTransportPressureMin ||
    pressure >= thresholds.elevatedPressureMin ||
    strongSurge ||
    strongLeadingEdge ||
    leadingPulse >= thresholds.elevatedLeadingPulseMin ||
    qualitySupport >= thresholds.elevatedQualitySupportMin
  ) {
    return {
      limit: elevatedLimit,
      tier: "elevated",
      pressure,
      reasons,
      providerProfile: httpPrimary ? "http_primary" : "generic",
      signals,
    };
  }

  return {
    limit: args.basePostLimit,
    tier: "base",
    pressure,
    reasons,
    providerProfile: httpPrimary ? "http_primary" : "generic",
    signals,
  };
}

function resolveElevatedPostLimit(
  basePostLimit: number,
  boostPostLimit: number,
  ratio: number,
): number {
  return Math.max(
    basePostLimit,
    Math.ceil(basePostLimit + (boostPostLimit - basePostLimit) * clamp(ratio, 0, 1)),
  );
}

function buildColdStartSamplingDecision(args: {
  basePostLimit: number;
  boostPostLimit: number;
  providerHint?: string;
}): SamplingDecision {
  const httpPrimary = isHttpPrimaryProvider(args.providerHint);
  const extraPosts = httpPrimary
    ? PHASE1_SAMPLING_THRESHOLDS.coldStart.extraPosts.httpPrimary
    : PHASE1_SAMPLING_THRESHOLDS.coldStart.extraPosts.generic;
  const limit = Math.min(args.boostPostLimit, args.basePostLimit + extraPosts);
  const tier: SamplingTier = limit > args.basePostLimit ? "elevated" : "base";

  return {
    limit,
    tier,
    pressure: 0,
    reasons: [
      "cold_start_warmup",
      `warmup_extra_posts:${extraPosts}`,
    ],
    providerProfile: httpPrimary ? "http_primary" : "generic",
    signals: zeroSamplingSignals(),
  };
}

function getScoreComponentNumber(point: SubredditTrendPoint, key: string): number {
  const value = point.scoreComponents?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function resolveSampleReliability(point: SubredditTrendPoint): number {
  const fromScoreComponent = getScoreComponentNumber(point, "sampleReliability");
  if (fromScoreComponent > 0) {
    return clamp(fromScoreComponent, 0, 1);
  }
  return clamp((point.sampledPostCount ?? 0) / Math.max(point.newPosts, 1), 0, 1);
}

function normalizeTrendScore(trendScore: number): number {
  return clamp((trendScore + 1) / 2, 0, 1);
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function zeroSamplingSignals(): SamplingSignals {
  return {
    coverageGap: 0,
    surge: 0,
    heat: 0,
    impact: 0,
    acceleration: 0,
    persistence: 0,
    qualitySupport: 0,
    leadingPulse: 0,
    transportPressure: 0,
    staleHeadPressure: 0,
    switchInstability: 0,
    activePostRatio: 0,
  };
}

async function resolveSamplingHealthEvidence(args: {
  repository?: ProviderHealthWindowRepository;
  targetId: string;
  fromIso: string;
  nowIso: string;
  providerHint?: string;
}): Promise<SamplingHealthEvidence | null> {
  if (!args.repository) {
    return null;
  }

  const aggregates = await args.repository.summarizeByProviderInRange({
    targetId: args.targetId,
    from: args.fromIso,
    to: args.nowIso,
    mode: "live",
  });
  if (aggregates.length === 0) {
    return null;
  }

  const preferredProvider = resolvePreferredHealthProvider(args.providerHint, aggregates);
  const preferred =
    aggregates.find((item) => item.provider === preferredProvider) ??
    aggregates.slice().sort((left, right) => right.requestCount - left.requestCount)[0]!;
  const totals = aggregates.reduce(
    (summary, item) => {
      summary.requestCount += item.requestCount;
      summary.successCount += item.successCount;
      summary.emptyResponseCount += item.emptyResponseCount;
      summary.fallbackCount += item.fallbackCount;
      summary.candidateCount += item.candidateCount;
      summary.acceptedCount += item.acceptedCount;
      summary.filteredOutCount += item.filteredOutCount;
      summary.duplicatePostCount += item.duplicatePostCount;
      summary.ingestLagSecondsSum += item.ingestLagSecondsSum;
      summary.ingestLagSampleCount += item.ingestLagSampleCount;
      summary.providerDiffCount += item.providerDiffCount;
      summary.providerDiffSampleCount += item.providerDiffSampleCount;
      summary.errorCount += item.errorCount;
      summary.rateLimitCount += item.rateLimitCount;
      summary.timeoutCount += item.timeoutCount;
      summary.circuitOpenCount += item.circuitOpenCount;
      return summary;
    },
    {
      requestCount: 0,
      successCount: 0,
      emptyResponseCount: 0,
      fallbackCount: 0,
      candidateCount: 0,
      acceptedCount: 0,
      filteredOutCount: 0,
      duplicatePostCount: 0,
      ingestLagSecondsSum: 0,
      ingestLagSampleCount: 0,
      providerDiffCount: 0,
      providerDiffSampleCount: 0,
      errorCount: 0,
      rateLimitCount: 0,
      timeoutCount: 0,
      circuitOpenCount: 0,
    },
  );

  return {
    fetchSuccessRate: toRate(preferred.successCount, preferred.requestCount),
    emptyRate: toRate(preferred.emptyResponseCount, preferred.requestCount),
    fallbackRate: toRate(preferred.fallbackCount, preferred.requestCount),
    duplicateRate: toDuplicateRate({
      duplicatePostCount: preferred.duplicatePostCount,
      candidateCount: preferred.candidateCount,
      acceptedCount: preferred.acceptedCount,
    }),
    ingestLagSeconds: toAverage(preferred.ingestLagSecondsSum, preferred.ingestLagSampleCount),
    providerDiffRate: toRate(preferred.providerDiffCount, preferred.providerDiffSampleCount),
    errorRate: toRate(preferred.errorCount, preferred.requestCount),
    rateLimitRate: toRate(preferred.rateLimitCount, preferred.requestCount),
    timeoutRate: toRate(preferred.timeoutCount, preferred.requestCount),
    circuitOpenRate: toRate(preferred.circuitOpenCount, preferred.requestCount),
    providerSwitchShare: clamp(
      totals.requestCount > 0
        ? (totals.requestCount - preferred.requestCount) / totals.requestCount
        : 0,
      0,
      1,
    ),
  };
}

function resolvePreferredHealthProvider(
  providerHint: string | undefined,
  aggregates: Array<{ provider: string }>,
): string {
  const available = new Set(aggregates.map((item) => item.provider));
  const normalized = providerHint?.trim().toLowerCase();
  if (!normalized || normalized === "reddit") {
    if (available.has("http")) {
      return "http";
    }
    if (available.has("reddit")) {
      return "reddit";
    }
  }
  if (normalized && available.has(normalized)) {
    return normalized;
  }
  return aggregates[0]!.provider;
}

function resolveTransportPressure(args: {
  healthEvidence: SamplingHealthEvidence | null;
  httpPrimary: boolean;
}): number {
  if (!args.healthEvidence) {
    return 0;
  }

  const successRisk = rateRisk(
    args.healthEvidence.fetchSuccessRate == null ? null : 1 - args.healthEvidence.fetchSuccessRate,
    args.httpPrimary ? 0.12 : 0.18,
  );
  const emptyRisk = rateRisk(args.healthEvidence.emptyRate, args.httpPrimary ? 0.28 : 0.4);
  const fallbackRisk = rateRisk(args.healthEvidence.fallbackRate, args.httpPrimary ? 0.08 : 0.18);
  const duplicateRisk = rateRisk(args.healthEvidence.duplicateRate, 0.18);
  const lagRisk = clamp((args.healthEvidence.ingestLagSeconds ?? 0) / 1800, 0, 1);
  const diffRisk = clamp(args.healthEvidence.providerDiffRate ?? 0, 0, 1);
  const errorRisk = rateRisk(args.healthEvidence.errorRate, args.httpPrimary ? 0.16 : 0.22);
  const rateLimitRisk = rateRisk(
    args.healthEvidence.rateLimitRate,
    args.httpPrimary ? 0.08 : 0.12,
  );
  const timeoutRisk = rateRisk(args.healthEvidence.timeoutRate, args.httpPrimary ? 0.1 : 0.14);
  const circuitOpenRisk = rateRisk(
    args.healthEvidence.circuitOpenRate,
    args.httpPrimary ? 0.06 : 0.1,
  );
  const switchRisk = clamp(args.healthEvidence.providerSwitchShare, 0, 1);

  return clamp(
    0.18 * successRisk +
      0.14 * emptyRisk +
      0.12 * fallbackRisk +
      0.1 * duplicateRisk +
      0.08 * lagRisk +
      0.08 * diffRisk +
      0.1 * errorRisk +
      0.08 * rateLimitRisk +
      0.07 * timeoutRisk +
      0.05 * circuitOpenRisk +
      0.08 * switchRisk,
    0,
    1,
  );
}

function resolveStaleHeadPressure(args: {
  healthEvidence: SamplingHealthEvidence | null;
  httpPrimary: boolean;
}): number {
  if (!args.healthEvidence) {
    return 0;
  }

  const duplicateRisk = rateRisk(args.healthEvidence.duplicateRate, args.httpPrimary ? 0.32 : 0.42);
  const emptyRisk = rateRisk(args.healthEvidence.emptyRate, args.httpPrimary ? 0.12 : 0.2);
  const lagFloor = args.httpPrimary ? 1800 : 2400;
  const lagSpan = args.httpPrimary ? 3600 : 4800;
  const lagRisk =
    args.healthEvidence.ingestLagSeconds == null
      ? 0
      : clamp((args.healthEvidence.ingestLagSeconds - lagFloor) / lagSpan, 0, 1);

  return clamp(0.5 * duplicateRisk + 0.35 * lagRisk + 0.15 * emptyRisk, 0, 1);
}

function resolveSwitchInstability(args: {
  healthEvidence: SamplingHealthEvidence | null;
}): number {
  if (!args.healthEvidence) {
    return 0;
  }

  return clamp(
    0.7 * clamp(args.healthEvidence.providerSwitchShare, 0, 1) +
      0.3 * clamp(args.healthEvidence.providerDiffRate ?? 0, 0, 1),
    0,
    1,
  );
}

function rateRisk(rate: number | null, baseline: number): number {
  if (rate == null) {
    return 0;
  }
  return clamp((rate - baseline) / Math.max(1 - baseline, 0.0001), 0, 1);
}

function toRate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function toAverage(total: number, count: number): number | null {
  return count > 0 ? total / count : null;
}

function toDuplicateRate(args: {
  duplicatePostCount: number;
  candidateCount: number;
  acceptedCount: number;
}): number | null {
  const denominator = args.candidateCount > 0 ? args.candidateCount : args.acceptedCount;
  return denominator > 0 ? args.duplicatePostCount / denominator : null;
}

function pushHealthReasons(reasons: string[], healthEvidence: SamplingHealthEvidence): void {
  if (healthEvidence.fetchSuccessRate != null) {
    reasons.push(`fetch_success:${healthEvidence.fetchSuccessRate.toFixed(3)}`);
  }
  if (healthEvidence.emptyRate != null) {
    reasons.push(`empty_rate:${healthEvidence.emptyRate.toFixed(3)}`);
  }
  if (healthEvidence.fallbackRate != null) {
    reasons.push(`fallback_rate:${healthEvidence.fallbackRate.toFixed(3)}`);
  }
  if (healthEvidence.duplicateRate != null) {
    reasons.push(`duplicate_rate:${healthEvidence.duplicateRate.toFixed(3)}`);
  }
  if (healthEvidence.ingestLagSeconds != null && healthEvidence.ingestLagSeconds > 0) {
    reasons.push(`ingest_lag:${healthEvidence.ingestLagSeconds.toFixed(1)}`);
  }
  if (healthEvidence.providerDiffRate != null) {
    reasons.push(`provider_diff:${healthEvidence.providerDiffRate.toFixed(3)}`);
  }
  if (healthEvidence.errorRate != null) {
    reasons.push(`error_rate:${healthEvidence.errorRate.toFixed(3)}`);
  }
  if (healthEvidence.rateLimitRate != null) {
    reasons.push(`rate_limit_rate:${healthEvidence.rateLimitRate.toFixed(3)}`);
  }
  if (healthEvidence.timeoutRate != null) {
    reasons.push(`timeout_rate:${healthEvidence.timeoutRate.toFixed(3)}`);
  }
  if (healthEvidence.circuitOpenRate != null) {
    reasons.push(`circuit_open_rate:${healthEvidence.circuitOpenRate.toFixed(3)}`);
  }
  if (healthEvidence.providerSwitchShare > 0) {
    reasons.push(`provider_switch_share:${healthEvidence.providerSwitchShare.toFixed(3)}`);
  }
}

function isHttpPrimaryProvider(providerHint: string | undefined): boolean {
  const normalized = providerHint?.trim().toLowerCase();
  return (
    !normalized ||
    normalized === "http" ||
    normalized === "reddit" ||
    normalized === "scrapling"
  );
}

function logSamplingDecision(args: {
  nowIso: string;
  targetId: string;
  decision: SamplingDecision;
}): void {
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      event: "reddit.sampling_plan.selected",
      targetId: args.targetId,
      providerProfile: args.decision.providerProfile,
      tier: args.decision.tier,
      limit: args.decision.limit,
      pressure: Number(args.decision.pressure.toFixed(6)),
      signals: Object.fromEntries(
        Object.entries(args.decision.signals).map(([key, value]) => [
          key,
          Number(value.toFixed(6)),
        ]),
      ),
      reasons: args.decision.reasons,
      recordedAt: args.nowIso,
    }),
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
