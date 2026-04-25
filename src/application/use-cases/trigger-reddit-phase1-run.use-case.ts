import { DefaultRedditMapper } from "../../connectors/reddit/reddit.mapper";
import type { RedditMapper } from "../../connectors/reddit/reddit-mapper.interface";
import type { RedditConnector } from "../../connectors/reddit/reddit-connector.interface";
import type { RedditScraplingProfile } from "../../connectors/reddit/reddit-scrapling.connector";
import type { RedditPhase1CycleResult, RedditPhase1WorkerDependencies } from "../../workers/reddit-phase1.worker";
import { runRedditPhase1Cycle } from "../../workers/reddit-phase1.worker";
import {
  resolveRedditPhase1CycleOptionsFromEnv,
  type Phase1CrawlMode,
  type Phase1RunMode,
  upsertActiveSubredditTarget,
} from "../../runtime/reddit-phase1-runtime";
import { createRedditFetchExecutionEngine } from "../../runtime/reddit-fetch-execution-engine";
import { resolveRedditProviderRoutingPolicyContextFromEnv } from "../../runtime/reddit-provider-routing-policy";

type Phase1Repositories = Omit<RedditPhase1WorkerDependencies, "redditConnector" | "redditMapper">;

export interface TriggerRedditPhase1RunDependencies {
  repositories: Phase1Repositories;
  createConnector: (
    mode: Phase1RunMode,
    crawlMode?: Phase1CrawlMode,
    providerOverride?: string,
    scraplingProfileOverride?: RedditScraplingProfile,
  ) => RedditConnector;
  redditMapper?: RedditMapper;
  now?: () => string;
  env?: NodeJS.ProcessEnv;
}

export interface TriggerRedditPhase1RunInput {
  mode: Phase1RunMode;
  crawlMode: Phase1CrawlMode;
  subreddit?: string;
  postLimit?: number;
  backfillPostLimit?: number;
  backfillMaxIterationsPerTarget?: number;
  backfillTargetDays?: number;
  continueOnError?: boolean;
}

export interface PreparedRedditPhase1Run {
  nowIso: string;
  canonicalName?: string;
  requestedCanonicalNames: string[];
  execute: () => Promise<RedditPhase1CycleResult>;
}

export async function prepareTriggeredRedditPhase1Run(
  deps: TriggerRedditPhase1RunDependencies,
  input: TriggerRedditPhase1RunInput,
): Promise<PreparedRedditPhase1Run> {
  const nowIso = deps.now?.() ?? new Date().toISOString();
  const env = deps.env ?? process.env;
  const redditMapper = deps.redditMapper ?? new DefaultRedditMapper();
  let canonicalName: string | undefined;

  if (input.subreddit) {
    const target = await upsertActiveSubredditTarget({
      monitorTargetRepository: deps.repositories.monitorTargetRepository,
      subreddit: input.subreddit,
      nowIso,
    });
    canonicalName = target.canonicalName;
  }

  const requestedCanonicalNames = canonicalName ? [canonicalName] : [];
  const options = resolveRedditPhase1CycleOptionsFromEnv({
    env,
    mode: input.mode,
    crawlMode: input.crawlMode,
    targetCanonicalNames: requestedCanonicalNames.length > 0 ? requestedCanonicalNames : undefined,
    postLimit: input.postLimit,
    backfillPostLimit: input.backfillPostLimit,
    backfillMaxIterationsPerTarget: input.backfillMaxIterationsPerTarget,
    backfillTargetDays: input.backfillTargetDays,
    continueOnError: input.continueOnError,
  });
  const fetchExecutionEngine = createRedditFetchExecutionEngine({
    mode: input.mode,
    createConnector: deps.createConnector,
    providerHealthWindowRepository: deps.repositories.providerHealthWindowRepository,
    crawlCursorRepository: deps.repositories.crawlCursorRepository,
    policyContext: resolveRedditProviderRoutingPolicyContextFromEnv(env),
  });

  return {
    nowIso,
    canonicalName,
    requestedCanonicalNames,
    execute: () =>
      runRedditPhase1Cycle(
        {
          ...deps.repositories,
          redditConnector: deps.createConnector(
            input.mode,
            input.crawlMode,
            options.providerHint,
          ),
          redditExecutionStrategyResolver: ({
            targetId,
            canonicalName: targetCanonicalName,
            providerHint,
            crawlMode,
            nowIso: executionNowIso,
          }) =>
            fetchExecutionEngine.resolveStrategy({
              targetId,
              canonicalName: targetCanonicalName,
              defaultProviderHint: providerHint,
              crawlMode,
              nowIso: executionNowIso,
            }),
          redditMapper,
        },
        nowIso,
        options,
      ),
  };
}
