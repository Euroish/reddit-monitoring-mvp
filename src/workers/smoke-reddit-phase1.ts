import { DefaultRedditMapper } from "../connectors/reddit/reddit.mapper";
import { RedditHttpConnector } from "../connectors/reddit/reddit-http.connector";
import { RedditMockConnector } from "../connectors/reddit/reddit-mock.connector";
import { stableUuidFromString } from "../shared/ids/stable-id";
import {
  InMemoryAccountRepository,
  InMemoryCollectionJobRepository,
  InMemoryContentRepository,
  InMemoryMetricsSnapshotRepository,
  InMemoryMonitorTargetRepository,
  InMemoryRawEventRepository,
  InMemorySubredditTrendPointRepository,
} from "../storage/repositories/in-memory/in-memory.repositories";
import { runRedditPhase1Cycle } from "./reddit-phase1.worker";

async function main(): Promise<void> {
  const subreddit = process.env.REDDIT_SMOKE_SUBREDDIT ?? "machinelearning";
  const mode = process.env.REDDIT_SMOKE_MODE ?? "mock";
  const nowIso = new Date().toISOString();

  const monitorTargetRepository = new InMemoryMonitorTargetRepository();
  const collectionJobRepository = new InMemoryCollectionJobRepository();
  const rawEventRepository = new InMemoryRawEventRepository();
  const accountRepository = new InMemoryAccountRepository();
  const contentRepository = new InMemoryContentRepository();
  const metricsSnapshotRepository = new InMemoryMetricsSnapshotRepository();
  const subredditTrendPointRepository = new InMemorySubredditTrendPointRepository();

  await monitorTargetRepository.upsert({
    id: stableUuidFromString(`reddit:target:r/${subreddit}`),
    source: "reddit",
    targetType: "subreddit",
    canonicalName: `r/${subreddit}`,
    status: "active",
    config: {},
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  const redditConnector = mode === "live" ? new RedditHttpConnector() : new RedditMockConnector();

  await runRedditPhase1Cycle(
    {
      monitorTargetRepository,
      collectionJobRepository,
      rawEventRepository,
      accountRepository,
      contentRepository,
      metricsSnapshotRepository,
      subredditTrendPointRepository,
      redditConnector,
      redditMapper: new DefaultRedditMapper(),
    },
    nowIso,
  );

  const summary = {
    subreddit: `r/${subreddit}`,
    jobs: collectionJobRepository.all().length,
    rawEvents: rawEventRepository.all().length,
    accounts: accountRepository.all().length,
    contents: contentRepository.all().length,
    snapshots: metricsSnapshotRepository.all().length,
    trendPoints: subredditTrendPointRepository.all().length,
    mode,
  };

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(summary, null, 2));
}

void main();
