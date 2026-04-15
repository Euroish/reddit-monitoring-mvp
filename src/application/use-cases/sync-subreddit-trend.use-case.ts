import type { RedditConnector } from "../../connectors/reddit/reddit-connector.interface";
import type { RedditMapper } from "../../connectors/reddit/reddit-mapper.interface";
import type { AccountRepository } from "../../domain/repositories/account-repository";
import type { CollectionJobRepository } from "../../domain/repositories/collection-job-repository";
import type { ContentRepository } from "../../domain/repositories/content-repository";
import type { CrawlCursorRepository } from "../../domain/repositories/crawl-cursor-repository";
import type { MetricsSnapshotRepository } from "../../domain/repositories/metrics-snapshot-repository";
import type { ProviderHealthWindowRepository } from "../../domain/repositories/provider-health-window-repository";
import type { RawEventRepository } from "../../domain/repositories/raw-event-repository";
import { collectSubredditAboutJob } from "../../jobs/collect-subreddit-about.job";
import { collectSubredditNewPostsJob } from "../../jobs/collect-subreddit-new-posts.job";

export interface SyncSubredditTrendDependencies {
  redditConnector: RedditConnector;
  redditMapper: RedditMapper;
  rawEventRepository: RawEventRepository;
  accountRepository: AccountRepository;
  contentRepository: ContentRepository;
  crawlCursorRepository?: CrawlCursorRepository;
  providerHealthWindowRepository?: ProviderHealthWindowRepository;
  metricsSnapshotRepository: MetricsSnapshotRepository;
  collectionJobRepository: CollectionJobRepository;
}

export interface SyncSubredditTrendInput {
  targetId: string;
  subreddit: string;
  nowIso: string;
}

export async function syncSubredditTrend(
  deps: SyncSubredditTrendDependencies,
  input: SyncSubredditTrendInput,
): Promise<void> {
  const base = {
    targetId: input.targetId,
    subreddit: input.subreddit,
    nowIso: input.nowIso,
  };

  await collectSubredditAboutJob(
    {
      redditConnector: deps.redditConnector,
      redditMapper: deps.redditMapper,
      collectionJobRepository: deps.collectionJobRepository,
      rawEventRepository: deps.rawEventRepository,
      metricsSnapshotRepository: deps.metricsSnapshotRepository,
    },
    base,
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
    { ...base, limit: 50 },
  );
}
