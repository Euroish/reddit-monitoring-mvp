import type { RedditConnector } from "../connectors/reddit/reddit-connector.interface";
import type { RedditMapper } from "../connectors/reddit/reddit-mapper.interface";
import type { AccountRepository } from "../domain/repositories/account-repository";
import type { CollectionJobRepository } from "../domain/repositories/collection-job-repository";
import type { ContentRepository } from "../domain/repositories/content-repository";
import type { CrawlCursorRepository } from "../domain/repositories/crawl-cursor-repository";
import type { KeywordTrendDailyRepository } from "../domain/repositories/keyword-trend-daily-repository";
import type { MetricsSnapshotRepository } from "../domain/repositories/metrics-snapshot-repository";
import type { MonitorTargetRepository } from "../domain/repositories/monitor-target-repository";
import type { ProviderHealthWindowRepository } from "../domain/repositories/provider-health-window-repository";
import type { RawEventRepository } from "../domain/repositories/raw-event-repository";
import type { SubredditTrendPointRepository } from "../domain/repositories/subreddit-trend-point-repository";
import type { SubredditTrendPoint } from "../domain/entities/subreddit-trend-point";
import { buildSubredditTrendPointsJob } from "../jobs/build-subreddit-trend-points.job";
import { buildSubredditKeywordTrendDailyJob } from "../jobs/build-subreddit-keyword-trend-daily.job";
import { collectSubredditAboutJob } from "../jobs/collect-subreddit-about.job";
import { collectSubredditNewPostsJob } from "../jobs/collect-subreddit-new-posts.job";
import {
  DEFAULT_REDDIT_POST_LIMIT_BASE,
  DEFAULT_REDDIT_POST_LIMIT_BOOST,
} from "./reddit-phase1-defaults";

export interface RedditPhase1WorkerDependencies {
  monitorTargetRepository: MonitorTargetRepository;
  collectionJobRepository: CollectionJobRepository;
  rawEventRepository: RawEventRepository;
  accountRepository: AccountRepository;
  contentRepository: ContentRepository;
  crawlCursorRepository?: CrawlCursorRepository;
  providerHealthWindowRepository?: ProviderHealthWindowRepository;
  keywordTrendDailyRepository?: KeywordTrendDailyRepository;
  metricsSnapshotRepository: MetricsSnapshotRepository;
  subredditTrendPointRepository: SubredditTrendPointRepository;
  redditConnector: RedditConnector;
  redditMapper: RedditMapper;
}

export interface RedditPhase1CycleOptions {
  targetCanonicalNames?: string[];
  postLimit?: number;
  basePostLimit?: number;
  boostPostLimit?: number;
  samplingHealthLookbackMinutes?: number;
  boostWindowMinutes?: number;
  boostSurgeThreshold?: number;
  boostHeatChangeThreshold?: number;
  boostImpactMomentumThreshold?: number;
  boostMinDispersion?: number;
  boostMinHighScorePostCount?: number;
  boostCooldownWindows?: number;
  keywordDailyLookbackDays?: number;
  keywordDailyQualityMinScore?: number;
  keywordDailyQualityMinComments?: number;
  keywordDailyMaxKeywordsPerDay?: number;
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

const TARGET_SAMPLE_RELIABILITY = 0.85;
const ELEVATED_PRESSURE_MIN = 0.38;
const BOOST_PRESSURE_MIN = 0.78;
const DEFAULT_SAMPLING_HEALTH_LOOKBACK_MINUTES = 45;

function toCanonicalSubredditName(value: string): string {
  const normalized = value.trim().replace(/^r\//i, "").toLowerCase();
  return `r/${normalized}`;
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
  const requestedCanonicalNames = Array.from(
    new Set((options.targetCanonicalNames ?? []).map(toCanonicalSubredditName)),
  );

  const targets =
    requestedCanonicalNames.length === 0
      ? await deps.monitorTargetRepository.findActiveSubreddits()
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
      const postLimit =
        fixedPostLimit != null
          ? Math.max(1, fixedPostLimit)
          : await resolvePostSamplingLimit({
              targetId: target.id,
              nowIso,
              basePostLimit,
              boostPostLimit,
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
              providerHint,
              providerHealthWindowRepository: deps.providerHealthWindowRepository,
              subredditTrendPointRepository: deps.subredditTrendPointRepository,
            });
      const subreddit = target.canonicalName.replace(/^r\//, "");
      const baseInput = {
        targetId: target.id,
        subreddit,
        nowIso,
        crawlMode,
      };

      await collectSubredditAboutJob(
        {
          redditConnector: deps.redditConnector,
          redditMapper: deps.redditMapper,
          collectionJobRepository: deps.collectionJobRepository,
          rawEventRepository: deps.rawEventRepository,
          metricsSnapshotRepository: deps.metricsSnapshotRepository,
        },
        baseInput,
      );

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
        },
        {
          ...baseInput,
          limit: postLimit,
          mode: crawlMode,
          providerHint,
          candidateFilter: {
            minScore: postCandidateMinScore,
            minComments: postCandidateMinComments,
            mode: postCandidateFilterMode,
          },
        },
      );

      const fromIso = new Date(
        new Date(nowIso).getTime() - trendLookbackMinutes * 60 * 1000,
      ).toISOString();
      await buildSubredditTrendPointsJob(
        {
          metricsSnapshotRepository: deps.metricsSnapshotRepository,
          subredditTrendPointRepository: deps.subredditTrendPointRepository,
        },
        {
          targetId: target.id,
          fromIso,
          toIso: nowIso,
        },
      );

      if (deps.keywordTrendDailyRepository) {
        const keywordFromIso = new Date(
          new Date(nowIso).getTime() - keywordDailyLookbackDays * 24 * 60 * 60 * 1000,
        ).toISOString();
        await buildSubredditKeywordTrendDailyJob(
          {
            contentRepository: deps.contentRepository,
            metricsSnapshotRepository: deps.metricsSnapshotRepository,
            keywordTrendDailyRepository: deps.keywordTrendDailyRepository,
          },
          {
            targetId: target.id,
            fromIso: keywordFromIso,
            toIso: nowIso,
            qualityMinScore: keywordDailyQualityMinScore,
            qualityMinComments: keywordDailyQualityMinComments,
            maxKeywordsPerDay: keywordDailyMaxKeywordsPerDay,
            sourceType: crawlMode,
          },
        );
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

async function resolvePostSamplingLimit(args: {
  targetId: string;
  nowIso: string;
  mode: "live" | "backfill";
  providerHint?: string;
  basePostLimit: number;
  boostPostLimit: number;
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
}): Promise<number> {
  if (args.disableAdaptiveSampling) {
    return args.basePostLimit;
  }
  if (args.mode === "backfill") {
    return args.boostPostLimit;
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
    return args.basePostLimit;
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
  return decision.limit;
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
  const elevatedPressureMin = httpPrimary ? 0.34 : ELEVATED_PRESSURE_MIN;
  const boostPressureMin = httpPrimary ? 0.68 : BOOST_PRESSURE_MIN;
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
    (TARGET_SAMPLE_RELIABILITY - minRecentReliability) / TARGET_SAMPLE_RELIABILITY,
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
    leadingPulse >= (httpPrimary ? 0.62 : 0.72) &&
    activePostRatio >= (httpPrimary ? 0.25 : 0.32) &&
    (qualitySupport >= 0.25 || coverageGap >= 0.25);
  const sustainedCoverageStress =
    coverageGap >= (httpPrimary ? 0.18 : 0.28) &&
    persistence >= 0.35 &&
    latestReliability < TARGET_SAMPLE_RELIABILITY;
  const severeTransportFailure =
    (args.healthEvidence?.timeoutRate ?? 0) >= (httpPrimary ? 0.2 : 0.26) ||
    (args.healthEvidence?.circuitOpenRate ?? 0) >= (httpPrimary ? 0.08 : 0.12) ||
    (args.healthEvidence?.rateLimitRate ?? 0) >= (httpPrimary ? 0.18 : 0.24) ||
    (args.healthEvidence?.errorRate ?? 0) >= (httpPrimary ? 0.28 : 0.34);
  const stressedTransport =
    transportPressure >= (httpPrimary ? 0.42 : 0.52) &&
    (coverageGap >= 0.12 || leadingPulse >= 0.35);
  const staleHeadDetected =
    staleHeadPressure >= (httpPrimary ? 0.52 : 0.6) &&
    ((args.healthEvidence?.duplicateRate ?? 0) >= (httpPrimary ? 0.55 : 0.65) ||
      (args.healthEvidence?.ingestLagSeconds ?? 0) >= (httpPrimary ? 5400 : 7200));
  const switchInstabilityDetected =
    switchInstability >= (httpPrimary ? 0.18 : 0.24) &&
    (args.healthEvidence?.providerSwitchShare ?? 0) >= (httpPrimary ? 0.2 : 0.26);
  const elevatedTransport = severeTransportFailure || stressedTransport;

  const elevatedLimit = resolveElevatedPostLimit(
    args.basePostLimit,
    args.boostPostLimit,
    clamp(
      (httpPrimary ? 0.56 : 0.36) + pressure * (httpPrimary ? 0.28 : 0.3),
      0,
      0.92,
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
    (strongSurge ||
      strongHeat ||
      strongImpact ||
      strongLeadingEdge ||
      stressedTransport ||
      (switchInstabilityDetected && leadingPulse >= (httpPrimary ? 0.28 : 0.36)) ||
      pressure >= boostPressureMin) &&
    !cooling
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
    transportPressure >= (httpPrimary ? 0.3 : 0.38) ||
    pressure >= elevatedPressureMin ||
    strongSurge ||
    strongLeadingEdge ||
    leadingPulse >= (httpPrimary ? 0.38 : 0.48) ||
    qualitySupport >= (httpPrimary ? 0.35 : 0.5)
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
    duplicateRate: toDuplicateRate(preferred.duplicatePostCount, preferred.candidateCount),
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

function toDuplicateRate(duplicatePostCount: number, candidateCount: number): number | null {
  return candidateCount > 0 ? duplicatePostCount / candidateCount : null;
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
  return !normalized || normalized === "http" || normalized === "reddit";
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
