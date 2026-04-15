import type { MonitorTargetRepository } from "../../domain/repositories/monitor-target-repository";
import type { CollectionJobRepository } from "../../domain/repositories/collection-job-repository";
import type { CrawlCursorRepository } from "../../domain/repositories/crawl-cursor-repository";
import type { MonitorTarget } from "../../domain/entities/monitor-target";
import {
  type Phase1CrawlMode,
  type Phase1RunMode,
  resolveRedditPhase1CycleOptionsFromEnv,
  upsertActiveSubredditTarget,
} from "../../runtime/reddit-phase1-runtime";
import { enqueueSubredditAboutJob } from "../../jobs/collect-subreddit-about.job";
import { enqueueSubredditNewPostsJob } from "../../jobs/collect-subreddit-new-posts.job";

export interface DispatchRedditPhase1RunDependencies {
  repositories: {
    monitorTargetRepository: MonitorTargetRepository;
    collectionJobRepository: CollectionJobRepository;
    crawlCursorRepository?: CrawlCursorRepository;
  };
  now?: () => string;
  env?: NodeJS.ProcessEnv;
}

export interface DispatchRedditPhase1RunInput {
  mode: Phase1RunMode;
  crawlMode: Phase1CrawlMode;
  subreddit?: string;
  postLimit?: number;
}

export interface DispatchRedditPhase1RunResult {
  nowIso: string;
  canonicalName?: string;
  requestedCanonicalNames: string[];
}

export async function dispatchRedditPhase1Run(
  deps: DispatchRedditPhase1RunDependencies,
  input: DispatchRedditPhase1RunInput,
): Promise<DispatchRedditPhase1RunResult> {
  const nowIso = deps.now?.() ?? new Date().toISOString();
  const env = deps.env ?? process.env;
  const targets = await resolveRequestedTargets(deps.repositories.monitorTargetRepository, {
    subreddit: input.subreddit,
    nowIso,
  });
  const requestedCanonicalNames = targets.map((target) => target.canonicalName);
  const options = resolveRedditPhase1CycleOptionsFromEnv({
    env,
    mode: input.mode,
    crawlMode: input.crawlMode,
    targetCanonicalNames: requestedCanonicalNames,
    postLimit: input.postLimit,
    continueOnError: true,
  });

  for (const target of targets) {
    const subreddit = target.canonicalName.replace(/^r\//, "");
    await enqueueSubredditAboutJob(
      {
        collectionJobRepository: deps.repositories.collectionJobRepository,
      },
      {
        targetId: target.id,
        subreddit,
        nowIso,
        crawlMode: input.crawlMode,
      },
    );
    await enqueueSubredditNewPostsJob(
      {
        collectionJobRepository: deps.repositories.collectionJobRepository,
        crawlCursorRepository: deps.repositories.crawlCursorRepository,
      },
      {
        targetId: target.id,
        subreddit,
        nowIso,
        crawlMode: input.crawlMode,
        limit: options.postLimit,
        providerHint: options.providerHint,
        candidateFilter: {
          minScore: options.postCandidateMinScore,
          minComments: options.postCandidateMinComments,
          mode: options.postCandidateFilterMode,
        },
      },
    );
  }

  return {
    nowIso,
    canonicalName: targets.length === 1 ? targets[0]?.canonicalName : undefined,
    requestedCanonicalNames,
  };
}

async function resolveRequestedTargets(
  repository: MonitorTargetRepository,
  args: {
    subreddit?: string;
    nowIso: string;
  },
): Promise<MonitorTarget[]> {
  if (!args.subreddit) {
    return repository.findActiveSubreddits();
  }
  const target = await upsertActiveSubredditTarget({
    monitorTargetRepository: repository,
    subreddit: args.subreddit,
    nowIso: args.nowIso,
  });
  return [
    {
      id: target.targetId,
      source: "reddit",
      targetType: "subreddit",
      canonicalName: target.canonicalName,
      status: "active",
      config: {},
      createdAt: args.nowIso,
      updatedAt: args.nowIso,
    },
  ];
}
