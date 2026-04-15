import { DefaultRedditMapper } from "../../connectors/reddit/reddit.mapper";
import type { RedditMapper } from "../../connectors/reddit/reddit-mapper.interface";
import type { RedditConnector } from "../../connectors/reddit/reddit-connector.interface";
import type { RedditPhase1CycleResult, RedditPhase1WorkerDependencies } from "../../workers/reddit-phase1.worker";
import { runRedditPhase1Cycle } from "../../workers/reddit-phase1.worker";
import {
  resolveRedditPhase1CycleOptionsFromEnv,
  type Phase1CrawlMode,
  type Phase1RunMode,
  upsertActiveSubredditTarget,
} from "../../runtime/reddit-phase1-runtime";

type Phase1Repositories = Omit<RedditPhase1WorkerDependencies, "redditConnector" | "redditMapper">;

export interface TriggerRedditPhase1RunDependencies {
  repositories: Phase1Repositories;
  createConnector: (mode: Phase1RunMode, crawlMode?: Phase1CrawlMode) => RedditConnector;
  redditMapper?: RedditMapper;
  now?: () => string;
  env?: NodeJS.ProcessEnv;
}

export interface TriggerRedditPhase1RunInput {
  mode: Phase1RunMode;
  crawlMode: Phase1CrawlMode;
  subreddit?: string;
  postLimit?: number;
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
    continueOnError: input.continueOnError,
  });

  return {
    nowIso,
    canonicalName,
    requestedCanonicalNames,
    execute: () =>
      runRedditPhase1Cycle(
        {
          ...deps.repositories,
          redditConnector: deps.createConnector(input.mode, input.crawlMode),
          redditMapper,
        },
        nowIso,
        options,
      ),
  };
}
