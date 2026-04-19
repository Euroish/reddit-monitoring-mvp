import { DefaultRedditMapper } from "../connectors/reddit/reddit.mapper";
import type { RedditMapper } from "../connectors/reddit/reddit-mapper.interface";
import {
  createRedditConnector,
  resolveRedditHttpTransport,
  resolveRedditLiveProvider,
  resolveRedditScraplingProfile,
  type CreateRedditConnectorOptions,
  type RedditRunMode,
} from "../connectors/reddit/create-reddit-connector";
import { resolveRedditCircuitBreakerOptionsFromEnv } from "../connectors/reddit/reddit-circuit-breaker.config";
import type { RedditScraplingProfile } from "../connectors/reddit/reddit-scrapling.connector";
import { stableUuidFromString } from "../shared/ids/stable-id";
import { PostgresClient } from "../storage/postgres/postgres-client";
import {
  createPostgresRepositoryBundle,
  type RepositoryBundle,
} from "../storage/repositories/postgres/postgres-repository-bundle";
import type { MonitorTargetRepository } from "../domain/repositories/monitor-target-repository";
import {
  DEFAULT_REDDIT_POST_LIMIT_BASE,
  DEFAULT_REDDIT_POST_LIMIT_BOOST,
} from "../workers/reddit-phase1-defaults";
import type { RedditPhase1CycleOptions } from "../workers/reddit-phase1.worker";
import {
  parseBooleanFlag,
  parseCrawlMode,
  parseFilterMode,
  parseOptionalPositiveInt,
  parsePositiveFloat,
  parsePositiveInt,
  parseSubredditList,
} from "./runtime-parsing";

export type Phase1RunMode = RedditRunMode;
export type Phase1CrawlMode = "live" | "backfill";

export interface PostgresPhase1Runtime {
  db: PostgresClient;
  repositories: RepositoryBundle;
  redditMapper: RedditMapper;
  createConnector: (
    mode: Phase1RunMode,
    crawlMode?: Phase1CrawlMode,
    providerOverride?: string,
    scraplingProfileOverride?: RedditScraplingProfile,
  ) => ReturnType<typeof createRedditConnector>;
  close: () => Promise<void>;
}

export interface ResolveRedditPhase1CycleOptionsArgs {
  env: NodeJS.ProcessEnv;
  mode: Phase1RunMode;
  crawlMode?: Phase1CrawlMode;
  targetCanonicalNames?: string[];
  postLimit?: number;
  continueOnError?: boolean;
}

export function resolvePhase1RunMode(value: string | undefined): Phase1RunMode {
  return value === "live" ? "live" : "mock";
}

export function createPostgresPhase1Runtime(args: {
  env?: NodeJS.ProcessEnv;
  db?: PostgresClient;
  redditMapper?: RedditMapper;
} = {}): PostgresPhase1Runtime {
  const env = args.env ?? process.env;
  const db = args.db ?? new PostgresClient();
  const shouldClose = !args.db;
  return {
    db,
    repositories: createPostgresRepositoryBundle(db),
    redditMapper: args.redditMapper ?? new DefaultRedditMapper(),
    createConnector: createRedditConnectorFactoryFromEnv(env),
    close: async () => {
      if (shouldClose) {
        await db.close();
      }
    },
  };
}

export function createRedditConnectorFactoryFromEnv(env: NodeJS.ProcessEnv) {
  return (
    mode: Phase1RunMode,
    crawlMode: Phase1CrawlMode = "live",
    providerOverride?: string,
    scraplingProfileOverride?: RedditScraplingProfile,
  ) =>
    createRedditConnectorFromEnv({
      env,
      mode,
      crawlMode,
      providerOverride,
      scraplingProfileOverride,
    });
}

export function createRedditConnectorFromEnv(args: {
  env: NodeJS.ProcessEnv;
  mode: Phase1RunMode;
  crawlMode?: Phase1CrawlMode;
  providerOverride?: string;
  scraplingProfileOverride?: RedditScraplingProfile;
}): ReturnType<typeof createRedditConnector> {
  const crawlMode = args.crawlMode ?? "live";
  const configuredProvider =
    args.providerOverride ??
    (crawlMode === "backfill"
      ? args.env.REDDIT_BACKFILL_PROVIDER
      : args.env.REDDIT_LIVE_PROVIDER);
  const liveProvider = resolveRedditLiveProvider(configuredProvider);
  const scraplingProfile = resolveRedditScraplingProfile(
    args.scraplingProfileOverride ?? args.env.REDDIT_SCRAPLING_PROFILE,
  );
  const circuitBreaker = resolveRedditCircuitBreakerOptionsFromEnv(args.env, {
    defaultEnabled: true,
  });
  const allowScraplingCircuitFallback = parseBooleanFlag(
    args.env.REDDIT_SCRAPLING_CB_ROUTE_TO_HTTP,
    false,
  );
  if (
    liveProvider === "scrapling" &&
    scraplingProfile !== "http" &&
    !allowScraplingCircuitFallback
  ) {
    circuitBreaker.routeToFallbackOnError = false;
  }
  return createRedditConnector({
    mode: args.mode,
    liveProvider,
    httpTransport: resolveRedditHttpTransport(args.env.REDDIT_HTTP_TRANSPORT),
    httpTimeoutMs: parsePositiveInt(args.env.REDDIT_HTTP_TIMEOUT_MS, 12_000),
    scraplingProfile,
    scraplingPythonExecutable: args.env.REDDIT_SCRAPLING_PYTHON,
    scraplingBridgeScriptPath: args.env.REDDIT_SCRAPLING_BRIDGE_SCRIPT,
    scraplingTimeoutMs: parsePositiveInt(
      args.env.REDDIT_SCRAPLING_TIMEOUT_MS,
      parsePositiveInt(args.env.REDDIT_HTTP_TIMEOUT_MS, 12_000),
    ),
    scraplingMaxRetries: parsePositiveInt(args.env.REDDIT_SCRAPLING_MAX_RETRIES, 2),
    accessToken: args.env.REDDIT_ACCESS_TOKEN,
    userAgent: args.env.REDDIT_USER_AGENT,
    apifyActorRunEndpoint: args.env.APIFY_REDDIT_ACTOR_RUN_ENDPOINT,
    apifyToken: args.env.APIFY_TOKEN,
    apifyFallbackToHttp: parseBooleanFlag(args.env.APIFY_FALLBACK_TO_HTTP, true),
    apifyCompareWithHttp: parseBooleanFlag(args.env.APIFY_COMPARE_WITH_HTTP, false),
    apifyRunWaitForFinishSeconds: parsePositiveInt(
      args.env.APIFY_RUN_WAIT_FOR_FINISH_SECONDS,
      60,
    ),
    apifyRunPollAttempts: parsePositiveInt(args.env.APIFY_RUN_POLL_ATTEMPTS, 3),
    circuitBreaker,
  });
}

export function resolveRedditPhase1CycleOptionsFromEnv(
  args: ResolveRedditPhase1CycleOptionsArgs,
): RedditPhase1CycleOptions {
  const crawlMode = args.crawlMode ?? "live";
  const scraplingPrimaryCanonicalNames = parseSubredditList(
    args.env.REDDIT_SCRAPLING_PRIMARY_SUBREDDITS,
  ).map((subreddit) => toCanonicalSubredditName(subreddit));
  return {
    targetCanonicalNames: args.targetCanonicalNames,
    scraplingPrimaryCanonicalNames,
    postLimit: args.postLimit ?? parseOptionalPositiveInt(args.env.REDDIT_POST_LIMIT),
    basePostLimit: parsePositiveInt(
      args.env.REDDIT_POST_LIMIT_BASE,
      DEFAULT_REDDIT_POST_LIMIT_BASE,
    ),
    boostPostLimit: parsePositiveInt(
      args.env.REDDIT_POST_LIMIT_BOOST,
      DEFAULT_REDDIT_POST_LIMIT_BOOST,
    ),
    samplingHealthLookbackMinutes: parsePositiveInt(
      args.env.REDDIT_POST_LIMIT_HEALTH_LOOKBACK_MINUTES,
      45,
    ),
    boostWindowMinutes: parsePositiveInt(
      args.env.REDDIT_POST_LIMIT_BOOST_WINDOW_MINUTES,
      180,
    ),
    boostSurgeThreshold: parsePositiveFloat(
      args.env.REDDIT_POST_LIMIT_BOOST_SURGE_THRESHOLD,
      0.85,
    ),
    boostHeatChangeThreshold: parsePositiveFloat(
      args.env.REDDIT_POST_LIMIT_BOOST_HEAT_CHANGE_THRESHOLD,
      0.8,
    ),
    boostImpactMomentumThreshold: parsePositiveFloat(
      args.env.REDDIT_POST_LIMIT_BOOST_IMPACT_MOMENTUM_THRESHOLD,
      0.7,
    ),
    boostMinDispersion: parsePositiveFloat(
      args.env.REDDIT_POST_LIMIT_BOOST_MIN_DISPERSION,
      0.45,
    ),
    boostMinHighScorePostCount: parsePositiveInt(
      args.env.REDDIT_POST_LIMIT_BOOST_MIN_HIGH_SCORE_POSTS,
      2,
    ),
    boostCooldownWindows: parsePositiveInt(
      args.env.REDDIT_POST_LIMIT_BOOST_COOLDOWN_WINDOWS,
      2,
    ),
    keywordDailyLookbackDays: parsePositiveInt(
      args.env.REDDIT_KEYWORD_DAILY_LOOKBACK_DAYS,
      90,
    ),
    dailyFactLookbackDays: parsePositiveInt(
      args.env.REDDIT_DAILY_FACT_LOOKBACK_DAYS,
      45,
    ),
    keywordDailyQualityMinScore: parsePositiveInt(
      args.env.REDDIT_KEYWORD_QUALITY_MIN_SCORE,
      10,
    ),
    keywordDailyQualityMinComments: parsePositiveInt(
      args.env.REDDIT_KEYWORD_QUALITY_MIN_COMMENTS,
      20,
    ),
    keywordDailyMaxKeywordsPerDay: parsePositiveInt(
      args.env.REDDIT_KEYWORD_DAILY_MAX_KEYWORDS_PER_DAY,
      50,
    ),
    disableAdaptiveSampling: !parseBooleanFlag(args.env.REDDIT_POST_LIMIT_ADAPTIVE, true),
    crawlMode,
    providerHint: resolveProviderHint({
      env: args.env,
      mode: args.mode,
      crawlMode,
    }),
    postCandidateMinScore: parsePositiveInt(args.env.REDDIT_CANDIDATE_MIN_SCORE, 0),
    postCandidateMinComments: parsePositiveInt(args.env.REDDIT_CANDIDATE_MIN_COMMENTS, 0),
    postCandidateFilterMode: parseFilterMode(args.env.REDDIT_CANDIDATE_FILTER_MODE),
    continueOnError: args.continueOnError,
  };
}

export async function upsertActiveSubredditTarget(args: {
  monitorTargetRepository: MonitorTargetRepository;
  subreddit: string;
  nowIso: string;
}): Promise<{
  targetId: string;
  canonicalName: string;
}> {
  const normalizedSubreddit = args.subreddit.trim().replace(/^r\//i, "").toLowerCase();
  const canonicalName = `r/${normalizedSubreddit}`;
  const targetId = stableUuidFromString(`reddit:target:${canonicalName}`);
  await args.monitorTargetRepository.upsert({
    id: targetId,
    source: "reddit",
    targetType: "subreddit",
    canonicalName,
    status: "active",
    config: {},
    createdAt: args.nowIso,
    updatedAt: args.nowIso,
  });
  return {
    targetId,
    canonicalName,
  };
}

export async function upsertActiveSubredditTargets(args: {
  monitorTargetRepository: MonitorTargetRepository;
  subreddits: string[];
  nowIso: string;
}): Promise<string[]> {
  const canonicalNames: string[] = [];
  for (const subreddit of args.subreddits) {
    const target = await upsertActiveSubredditTarget({
      monitorTargetRepository: args.monitorTargetRepository,
      subreddit,
      nowIso: args.nowIso,
    });
    canonicalNames.push(target.canonicalName);
  }
  return canonicalNames;
}

export function resolvePhase1CrawlMode(value: string | undefined): Phase1CrawlMode {
  return parseCrawlMode(value);
}

function toCanonicalSubredditName(value: string): string {
  const normalized = value.trim().replace(/^r\//i, "").toLowerCase();
  return `r/${normalized}`;
}

function resolveProviderHint(args: {
  env: NodeJS.ProcessEnv;
  mode: Phase1RunMode;
  crawlMode: Phase1CrawlMode;
}): string {
  if (args.env.REDDIT_PROVIDER_HINT?.trim()) {
    return args.env.REDDIT_PROVIDER_HINT.trim();
  }
  if (args.mode === "mock") {
    return "mock";
  }
  return args.crawlMode === "backfill"
    ? args.env.REDDIT_BACKFILL_PROVIDER ?? "apify"
    : args.env.REDDIT_LIVE_PROVIDER ?? "http";
}
