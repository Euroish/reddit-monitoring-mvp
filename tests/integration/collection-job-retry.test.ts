import test from "node:test";
import assert from "node:assert/strict";
import {
  collectSubredditAboutJob,
  runExistingSubredditAboutJob,
} from "../../src/jobs/collect-subreddit-about.job";
import { RedditMockConnector } from "../../src/connectors/reddit/reddit-mock.connector";
import { DefaultRedditMapper } from "../../src/connectors/reddit/reddit.mapper";
import type { RedditConnector } from "../../src/connectors/reddit/reddit-connector.interface";
import type { ConnectorRequestContext } from "../../src/connectors/shared/connector.interface";
import type {
  RedditCollectSubredditAboutArgs,
  RedditCollectSubredditPostsArgs,
} from "../../src/connectors/reddit/reddit.types";
import { stableUuidFromString } from "../../src/shared/ids/stable-id";
import {
  InMemoryCollectionJobRepository,
  InMemoryMetricsSnapshotRepository,
  InMemoryRawEventRepository,
} from "../../src/storage/repositories/in-memory/in-memory.repositories";

class FailingRedditConnector implements RedditConnector {
  public readonly sourceCode = "reddit" as const;

  public async collectSubredditAbout(
    _args: RedditCollectSubredditAboutArgs,
    _ctx: ConnectorRequestContext,
  ): Promise<never> {
    throw new Error("about endpoint temporary failure");
  }

  public async collectSubredditPosts(
    _args: RedditCollectSubredditPostsArgs,
    _ctx: ConnectorRequestContext,
  ): Promise<never> {
    throw new Error("posts endpoint temporary failure");
  }

  public async collect(
    _args: RedditCollectSubredditPostsArgs,
    _ctx: ConnectorRequestContext,
  ): Promise<never> {
    throw new Error("collect endpoint temporary failure");
  }

  public async healthCheck(_ctx: ConnectorRequestContext): Promise<boolean> {
    return false;
  }
}

test("collection job retry path enters retrying and then dead-letter", async () => {
  const originalMaxRetries = process.env.COLLECTION_JOB_MAX_RETRIES;
  const originalBaseDelay = process.env.COLLECTION_JOB_RETRY_BASE_MS;
  const originalMaxDelay = process.env.COLLECTION_JOB_RETRY_MAX_MS;
  process.env.COLLECTION_JOB_MAX_RETRIES = "1";
  process.env.COLLECTION_JOB_RETRY_BASE_MS = "1";
  process.env.COLLECTION_JOB_RETRY_MAX_MS = "1";

  const jobRepository = new InMemoryCollectionJobRepository();
  const deps = {
    redditConnector: new FailingRedditConnector(),
    redditMapper: new DefaultRedditMapper(),
    collectionJobRepository: jobRepository,
    rawEventRepository: new InMemoryRawEventRepository(),
    metricsSnapshotRepository: new InMemoryMetricsSnapshotRepository(),
  };
  const targetId = stableUuidFromString("reddit:target:r/datascience");

  try {
    await assert.rejects(
      collectSubredditAboutJob(deps, {
        targetId,
        subreddit: "datascience",
        nowIso: "2026-04-10T12:00:00.000Z",
      }),
    );
    assert.equal(jobRepository.all().length, 1);
    const first = jobRepository.all()[0];
    assert.equal(first.status, "retrying");
    assert.equal(first.retryCount, 1);
    assert.equal(typeof first.nextRunAt, "string");
    assert.equal(first.deadLetteredAt, undefined);

    await assert.rejects(
      collectSubredditAboutJob(deps, {
        targetId,
        subreddit: "datascience",
        nowIso: "2026-04-10T12:00:00.100Z",
      }),
    );
    const second = jobRepository.all()[0];
    assert.equal(second.status, "dead_letter");
    assert.equal(second.retryCount, 2);
    assert.equal(typeof second.deadLetteredAt, "string");
    assert.equal(second.nextRunAt, undefined);

    await collectSubredditAboutJob(deps, {
      targetId,
      subreddit: "datascience",
      nowIso: "2026-04-10T12:00:01.000Z",
    });
  } finally {
    if (originalMaxRetries === undefined) {
      delete process.env.COLLECTION_JOB_MAX_RETRIES;
    } else {
      process.env.COLLECTION_JOB_MAX_RETRIES = originalMaxRetries;
    }
    if (originalBaseDelay === undefined) {
      delete process.env.COLLECTION_JOB_RETRY_BASE_MS;
    } else {
      process.env.COLLECTION_JOB_RETRY_BASE_MS = originalBaseDelay;
    }
    if (originalMaxDelay === undefined) {
      delete process.env.COLLECTION_JOB_RETRY_MAX_MS;
    } else {
      process.env.COLLECTION_JOB_RETRY_MAX_MS = originalMaxDelay;
    }
  }
});

test("replaying existing retry job works across a later scheduler window", async () => {
  const originalMaxRetries = process.env.COLLECTION_JOB_MAX_RETRIES;
  const originalBaseDelay = process.env.COLLECTION_JOB_RETRY_BASE_MS;
  const originalMaxDelay = process.env.COLLECTION_JOB_RETRY_MAX_MS;
  process.env.COLLECTION_JOB_MAX_RETRIES = "2";
  process.env.COLLECTION_JOB_RETRY_BASE_MS = "1";
  process.env.COLLECTION_JOB_RETRY_MAX_MS = "1";

  const jobRepository = new InMemoryCollectionJobRepository();
  const metricsSnapshotRepository = new InMemoryMetricsSnapshotRepository();
  const targetId = stableUuidFromString("reddit:target:r/datascience");

  try {
    await assert.rejects(
      collectSubredditAboutJob(
        {
          redditConnector: new FailingRedditConnector(),
          redditMapper: new DefaultRedditMapper(),
          collectionJobRepository: jobRepository,
          rawEventRepository: new InMemoryRawEventRepository(),
          metricsSnapshotRepository,
        },
        {
          targetId,
          subreddit: "datascience",
          nowIso: "2026-04-10T12:00:00.000Z",
        },
      ),
    );

    const retryingJob = jobRepository.all()[0];
    assert.equal(retryingJob?.status, "retrying");

    const replayed = await runExistingSubredditAboutJob(
      {
        redditConnector: new RedditMockConnector(),
        redditMapper: new DefaultRedditMapper(),
        collectionJobRepository: jobRepository,
        rawEventRepository: new InMemoryRawEventRepository(),
        metricsSnapshotRepository,
      },
      {
        job: retryingJob!,
        subreddit: "datascience",
        nowIso: "2026-04-10T12:20:00.000Z",
      },
    );

    assert.equal(replayed, true);
    const afterReplay = jobRepository.all()[0];
    assert.equal(afterReplay?.status, "succeeded");
    assert.equal(jobRepository.all().length, 1);
    assert.equal(metricsSnapshotRepository.all().length > 0, true);
    assert.equal(metricsSnapshotRepository.all()[0]?.snapshotAt, "2026-04-10T12:00:00.000Z");
  } finally {
    if (originalMaxRetries === undefined) {
      delete process.env.COLLECTION_JOB_MAX_RETRIES;
    } else {
      process.env.COLLECTION_JOB_MAX_RETRIES = originalMaxRetries;
    }
    if (originalBaseDelay === undefined) {
      delete process.env.COLLECTION_JOB_RETRY_BASE_MS;
    } else {
      process.env.COLLECTION_JOB_RETRY_BASE_MS = originalBaseDelay;
    }
    if (originalMaxDelay === undefined) {
      delete process.env.COLLECTION_JOB_RETRY_MAX_MS;
    } else {
      process.env.COLLECTION_JOB_RETRY_MAX_MS = originalMaxDelay;
    }
  }
});
