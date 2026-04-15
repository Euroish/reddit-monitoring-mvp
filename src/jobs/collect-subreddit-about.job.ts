import type { RedditConnector } from "../connectors/reddit/reddit-connector.interface";
import type { RedditMapper } from "../connectors/reddit/reddit-mapper.interface";
import type { CollectionJob } from "../domain/entities/collection-job";
import type { MetricsSnapshot } from "../domain/entities/metrics-snapshot";
import type { CollectionJobRepository } from "../domain/repositories/collection-job-repository";
import type { MetricsSnapshotRepository } from "../domain/repositories/metrics-snapshot-repository";
import type { RawEventRepository } from "../domain/repositories/raw-event-repository";
import { stableUuidFromString } from "../shared/ids/stable-id";
import { buildDedupeKey, floorToWindow } from "../shared/time/windowing";
import { computeRetryDelayMs, resolveJobRetryPolicy } from "./job-retry-policy";
import type { RedditCollectionJobInput } from "./reddit-job.types";

export interface CollectSubredditAboutDependencies {
  redditConnector: RedditConnector;
  redditMapper: RedditMapper;
  collectionJobRepository: CollectionJobRepository;
  rawEventRepository: RawEventRepository;
  metricsSnapshotRepository: MetricsSnapshotRepository;
}

export interface RunExistingSubredditAboutJobInput {
  job: CollectionJob;
  subreddit: string;
  nowIso: string;
}

export async function enqueueSubredditAboutJob(
  deps: Pick<CollectSubredditAboutDependencies, "collectionJobRepository">,
  input: RedditCollectionJobInput,
): Promise<CollectionJob> {
  const windowStart = floorToWindow(input.nowIso, 15);
  const job: CollectionJob = {
    id: stableUuidFromString(`job:collect_subreddit_about:${input.targetId}:${windowStart}`),
    source: "reddit",
    targetId: input.targetId,
    jobType: "collect_subreddit_about",
    crawlMode: input.crawlMode,
    status: "queued",
    scheduledAt: input.nowIso,
    nextRunAt: input.nowIso,
    dedupeKey: buildDedupeKey("collect_subreddit_about", input.targetId, windowStart),
    retryCount: 0,
  };

  return deps.collectionJobRepository.create(job);
}

export async function collectSubredditAboutJob(
  deps: CollectSubredditAboutDependencies,
  input: RedditCollectionJobInput,
): Promise<void> {
  const created = await enqueueSubredditAboutJob(deps, input);
  await runExistingSubredditAboutJob(deps, {
    job: created,
    subreddit: input.subreddit,
    nowIso: input.nowIso,
  });
}

export async function runExistingSubredditAboutJob(
  deps: CollectSubredditAboutDependencies,
  input: RunExistingSubredditAboutJobInput,
): Promise<boolean> {
  if (input.job.jobType !== "collect_subreddit_about") {
    throw new Error(`unsupported job type for about job executor: ${input.job.jobType}`);
  }
  if (input.job.status === "succeeded" || input.job.status === "dead_letter") {
    return false;
  }

  const retryPolicy = resolveJobRetryPolicy();
  const windowStart = floorToWindow(input.job.scheduledAt, 15);
  const claimed = await deps.collectionJobRepository.claimRunnable(input.job.id, input.nowIso);
  if (!claimed) {
    return false;
  }

  try {
    const page = await deps.redditConnector.collectSubredditAbout(
      { subreddit: input.subreddit },
      { requestId: input.job.id, now: input.nowIso },
    );

    await deps.rawEventRepository.append({
      collectionJobId: input.job.id,
      targetId: input.job.targetId,
      envelope: page.raw,
    });

    const normalized = deps.redditMapper.toSubredditSnapshot(page.raw, {
      requestId: input.job.id,
      now: input.nowIso,
    });

    const snapshots: MetricsSnapshot[] = [];
    if (typeof normalized.subscribers === "number") {
      snapshots.push({
        snapshotAt: windowStart,
        source: "reddit",
        targetId: input.job.targetId,
        granularity: "15m",
        metricName: "subscribers",
        metricValue: normalized.subscribers,
        collectionJobId: input.job.id,
      });
    }

    if (typeof normalized.activeUsers === "number") {
      snapshots.push({
        snapshotAt: windowStart,
        source: "reddit",
        targetId: input.job.targetId,
        granularity: "15m",
        metricName: "active_users",
        metricValue: normalized.activeUsers,
        collectionJobId: input.job.id,
      });
    }

    if (snapshots.length > 0) {
      await deps.metricsSnapshotRepository.appendMany(snapshots);
    }

    await deps.collectionJobRepository.updateStatus(input.job.id, "succeeded");
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    await deps.collectionJobRepository.fail(input.job.id, message, {
      nowIso: input.nowIso,
      maxRetries: retryPolicy.maxRetries,
      retryDelayMs: computeRetryDelayMs(input.job.retryCount + 1, retryPolicy),
    });
    throw error;
  }
}
