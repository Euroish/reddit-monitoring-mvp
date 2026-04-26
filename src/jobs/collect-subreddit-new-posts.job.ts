import type { RedditConnector } from "../connectors/reddit/reddit-connector.interface";
import type { RedditMapper } from "../connectors/reddit/reddit-mapper.interface";
import type {
  RedditCollectSubredditPostsArgs,
  RedditPostListing,
  RedditTopTimeRange,
} from "../connectors/reddit/reddit.types";
import type { Account } from "../domain/entities/account";
import type { CollectionJob } from "../domain/entities/collection-job";
import type { Content } from "../domain/entities/content";
import type { MetricsSnapshot } from "../domain/entities/metrics-snapshot";
import type { CrawlCursor, CrawlMode } from "../domain/entities/crawl-cursor";
import type { AccountRepository } from "../domain/repositories/account-repository";
import type { CollectionJobRepository } from "../domain/repositories/collection-job-repository";
import type { ContentRepository } from "../domain/repositories/content-repository";
import type { CrawlCursorRepository } from "../domain/repositories/crawl-cursor-repository";
import type { MetricsSnapshotRepository } from "../domain/repositories/metrics-snapshot-repository";
import type { ProviderHealthWindowRepository } from "../domain/repositories/provider-health-window-repository";
import type { RawEventRepository } from "../domain/repositories/raw-event-repository";
import { resolveSubredditTier } from "../domain/services/subreddit-tiering.service";
import { stableUuidFromString } from "../shared/ids/stable-id";
import { buildDedupeKey, floorToWindow } from "../shared/time/windowing";
import { resolveCollectionWindowMinutes } from "../workers/reddit-phase1-defaults";
import { PHASE1_SAMPLING_THRESHOLDS } from "../workers/reddit-phase1-thresholds";
import { computeRetryDelayMs, resolveJobRetryPolicy } from "./job-retry-policy";
import type {
  RedditCollectionJobInput,
  RedditNewPostsJobPayload,
  RedditPostCandidateFilterConfig,
  RedditSamplingTier,
} from "./reddit-job.types";

export interface CollectSubredditNewPostsInput extends RedditCollectionJobInput {
  limit?: number;
  samplingTier?: RedditSamplingTier;
  after?: string;
  mode?: CrawlMode;
  providerHint?: string;
  candidateFilter?: RedditPostCandidateFilterConfig;
}

const BACKFILL_EOF_CURSOR = "__backfill_eof__";
const LIVE_CURSOR_SNAPSHOT = "__live_cursor_head__";
const STALE_LEGACY_BACKFILL_CURSOR_MAX_AGE_MS = 60 * 60 * 1000;
const LIVE_OVERFLOW_HEAD_FRESHNESS_MAX_SECONDS =
  PHASE1_SAMPLING_THRESHOLDS.staleHead.ingestLagSecondsMin.httpPrimary;
const LIVE_OVERFLOW_TAIL_AGE_MAX_SECONDS =
  PHASE1_SAMPLING_THRESHOLDS.staleHead.severeIngestLagSecondsMin.httpPrimary;
const REDDIT_PAGE_CAP_SIZE = 100;
const REDDIT_PAGE_CAPPED_PROVIDERS = new Set(["reddit", "http", "scrapling"]);
const BACKFILL_SUPPLEMENT_TRIGGER_AGE_SECONDS = 7 * 24 * 60 * 60;
const BACKFILL_SUPPLEMENT_LIMIT = 100;
const BACKFILL_TOP_TIME_WINDOWS: RedditTopTimeRange[] = ["week", "month", "year", "all"];
const BACKFILL_TIERED_CANDIDATE_FILTERS: Record<
  ReturnType<typeof resolveSubredditTier>,
  { minScore: number; minComments: number; mode: "and" | "or" }
> = {
  micro: { minScore: 0, minComments: 0, mode: "or" },
  small: { minScore: 5, minComments: 2, mode: "or" },
  mid: { minScore: 25, minComments: 10, mode: "or" },
  large: { minScore: 40, minComments: 20, mode: "or" },
} as const;

export interface CollectSubredditNewPostsDependencies {
  redditConnector: RedditConnector;
  redditMapper: RedditMapper;
  collectionJobRepository: CollectionJobRepository;
  crawlCursorRepository?: CrawlCursorRepository;
  rawEventRepository: RawEventRepository;
  accountRepository: AccountRepository;
  contentRepository: ContentRepository;
  metricsSnapshotRepository: MetricsSnapshotRepository;
  providerHealthWindowRepository?: ProviderHealthWindowRepository;
}

export interface RunExistingSubredditNewPostsJobInput {
  job: CollectionJob;
  subreddit: string;
  nowIso: string;
  limit?: number;
  samplingTier?: RedditSamplingTier;
  mode?: CrawlMode;
  providerHint?: string;
  candidateFilter?: RedditPostCandidateFilterConfig;
}

export async function enqueueSubredditNewPostsJob(
  deps: Pick<
    CollectSubredditNewPostsDependencies,
    "collectionJobRepository" | "crawlCursorRepository"
  >,
  input: CollectSubredditNewPostsInput,
): Promise<CollectionJob | null> {
  const mode = input.mode ?? "live";
  const collectionWindowMinutes = resolveCollectionWindowMinutes(mode);
  const windowStart = floorToWindow(input.nowIso, collectionWindowMinutes);
  const providerHint = resolveProviderHint(input.providerHint);
  const queueScope = resolveQueueScope({ mode, providerHint });
  const ignoreTerminalBackfillCursor = shouldIgnoreTerminalBackfillCursorForRun();
  let resolvedCursor = input.after;
  if (!resolvedCursor && mode === "backfill" && deps.crawlCursorRepository) {
    const crawlCursorState = await resolveBackfillCursorState(deps.crawlCursorRepository, {
      providerHint,
      targetId: input.targetId,
      mode,
      nowIso: input.nowIso,
      ignoreTerminalCursor: ignoreTerminalBackfillCursor,
    });
    resolvedCursor = resolveBackfillCursor(crawlCursorState?.cursor);
  }
  if (
    !ignoreTerminalBackfillCursor &&
    !input.after &&
    mode === "backfill" &&
    isBackfillTerminalCursor(resolvedCursor)
  ) {
    return null;
  }
  const job: CollectionJob = {
    id: stableUuidFromString(
      `job:collect_subreddit_new_posts:${input.targetId}:${queueScope}:${windowStart}`,
    ),
    source: "reddit",
    targetId: input.targetId,
    jobType: "collect_subreddit_new_posts",
    crawlMode: mode,
    status: "queued",
    scheduledAt: input.nowIso,
    nextRunAt: input.nowIso,
    dedupeKey: buildDedupeKey("collect_subreddit_new_posts", input.targetId, windowStart, queueScope),
    retryCount: 0,
    cursor: resolvedCursor,
    payload: toNewPostsJobPayload({
      postLimit: input.limit,
      samplingTier: input.samplingTier,
      providerHint,
      candidateFilter: input.candidateFilter,
    }),
  };

  return deps.collectionJobRepository.create(job);
}

export async function collectSubredditNewPostsJob(
  deps: CollectSubredditNewPostsDependencies,
  input: CollectSubredditNewPostsInput,
): Promise<void> {
  const created = await enqueueSubredditNewPostsJob(deps, input);
  if (!created) {
    return;
  }
  const mode = input.mode ?? "live";
  const providerHint = resolveProviderHint(input.providerHint);
  await runExistingSubredditNewPostsJob(deps, {
    job: created,
      subreddit: input.subreddit,
      nowIso: input.nowIso,
      limit: input.limit,
      samplingTier: input.samplingTier,
      mode,
      providerHint,
      candidateFilter: input.candidateFilter,
    });
}

export async function runExistingSubredditNewPostsJob(
  deps: CollectSubredditNewPostsDependencies,
  input: RunExistingSubredditNewPostsJobInput,
): Promise<boolean> {
  if (input.job.jobType !== "collect_subreddit_new_posts") {
    throw new Error(`unsupported job type for post job executor: ${input.job.jobType}`);
  }
  if (input.job.status === "succeeded" || input.job.status === "dead_letter") {
    return false;
  }

  const retryPolicy = resolveJobRetryPolicy();
  const payload = resolveNewPostsJobPayload(input.job.payload);
  const providerHint = resolveProviderHint(input.providerHint ?? payload.providerHint);
  const samplingTier = input.samplingTier ?? payload.samplingTier;
  const mode = input.mode ?? input.job.crawlMode ?? "live";
  const collectionWindowMinutes = resolveCollectionWindowMinutes(mode);
  const windowStart = floorToWindow(input.job.scheduledAt, collectionWindowMinutes);
  const claimed = await deps.collectionJobRepository.claimRunnable(input.job.id, input.nowIso);
  if (!claimed) {
    return false;
  }
  if (mode === "backfill" && isBackfillTerminalCursor(input.job.cursor)) {
    await deps.collectionJobRepository.updateStatus(input.job.id, "succeeded");
    return true;
  }
  const filter = await resolveEffectiveCandidateFilter({
    candidateFilter: input.candidateFilter ?? payload.candidateFilter,
    mode,
    targetId: input.job.targetId,
    nowIso: input.nowIso,
    metricsSnapshotRepository: deps.metricsSnapshotRepository,
  });
  const providerHealthWindowStart = floorToWindow(input.nowIso, 5);
  const priorCursor = input.job.cursor;
  const requestedLimit = Math.max(1, input.limit ?? payload.postLimit ?? 50);

  try {
    const observedPages = await collectObservedPages({
      redditConnector: deps.redditConnector,
      subreddit: input.subreddit,
      limit: requestedLimit,
      samplingTier,
      after: input.job.cursor,
      mode,
      providerHint,
      requestId: input.job.id,
      nowIso: input.nowIso,
    });
    const pages = observedPages.pages;
    const allUpserts = [];
    const allMetricPoints = [];
    let emptyResponseCount = 0;

    for (const page of pages) {
      await deps.rawEventRepository.append({
        collectionJobId: input.job.id,
        targetId: input.job.targetId,
        envelope: page.raw,
      });
      const pageUpserts = deps.redditMapper.toPostUpserts(input.job.targetId, page.raw, {
        requestId: input.job.id,
        now: input.nowIso,
      });
      const pageMetricPoints = deps.redditMapper.toPostMetricPoints(page.raw, {
        requestId: input.job.id,
        now: input.nowIso,
      });
      if (pageUpserts.length === 0) {
        emptyResponseCount += 1;
      }
      allUpserts.push(...pageUpserts);
      allMetricPoints.push(...pageMetricPoints);
    }
    const filtered = filterCandidates({
      upserts: allUpserts,
      metricPoints: allMetricPoints,
      filter,
    });
    const observedExternalIds = Array.from(
      new Set(filtered.upserts.map((item) => item.externalId)),
    );
    const duplicateWithinPageCount = Math.max(0, filtered.upserts.length - observedExternalIds.length);
    const existingExternalIds =
      observedExternalIds.length > 0
        ? await deps.contentRepository.findExistingExternalIds({
            targetId: input.job.targetId,
            externalIds: observedExternalIds,
          })
        : [];
    const existingExternalIdSet = new Set(existingExternalIds);
    const existingDuplicateCount = existingExternalIds.length;
    const duplicatePostCount = duplicateWithinPageCount + existingDuplicateCount;
    const newAcceptedUpserts = filtered.upserts.filter(
      (item) => !existingExternalIdSet.has(item.externalId),
    );
    const ingestLagStats = summarizeIngestLagSeconds(filtered.upserts, input.nowIso);
    const providerDiffStats = summarizeProviderDiffStats(pages);
    const lastPage = pages[pages.length - 1];
    const scraplingObservability = summarizeScraplingObservability(pages);
    const effectiveProvider = resolveProvider({
      providerHint,
      responseHeaders: lastPage.raw.responseHeaders,
      endpoint: lastPage.raw.endpoint,
    });

    const accountsMap = new Map<string, Account>();
    const contents: Content[] = [];

    for (const item of filtered.upserts) {
      const accountId = stableUuidFromString(`reddit:account:${item.accountExternalId}`);
      if (!accountsMap.has(item.accountExternalId)) {
        accountsMap.set(item.accountExternalId, {
          id: accountId,
          source: "reddit",
          externalId: item.accountExternalId,
          username: item.accountExternalId,
          isDeleted: item.accountExternalId === "[deleted]",
          firstSeenAt: input.nowIso,
          lastSeenAt: input.nowIso,
        });
      }

      const contentId = stableUuidFromString(`reddit:content:${item.externalId}`);
      contents.push({
        id: contentId,
        source: "reddit",
        targetId: item.targetId,
        accountId,
        externalId: item.externalId,
        kind: "post",
        title: item.title,
        bodyText: item.bodyText,
        url: item.url,
        permalink: item.permalink,
        createdAtSource: item.createdAtSource,
        firstSeenAt: input.nowIso,
        lastSeenAt: input.nowIso,
      });
    }

    if (accountsMap.size > 0) {
      await deps.accountRepository.upsertMany(Array.from(accountsMap.values()));
    }

    if (contents.length > 0) {
      await deps.contentRepository.upsertMany(contents);
    }

    const snapshots: MetricsSnapshot[] = [
      {
        snapshotAt: windowStart,
        source: "reddit",
        targetId: input.job.targetId,
        granularity: "15m",
        metricName: "new_posts_15m",
        metricValue: newAcceptedUpserts.length,
        collectionJobId: input.job.id,
      },
    ];

    for (const point of filtered.metricPoints) {
      const contentId = stableUuidFromString(`reddit:content:${point.externalId}`);
      if (typeof point.score === "number") {
        snapshots.push({
          snapshotAt: windowStart,
          source: "reddit",
          targetId: input.job.targetId,
          contentId,
          granularity: "15m",
          metricName: "score",
          metricValue: point.score,
          collectionJobId: input.job.id,
        });
      }
      if (typeof point.numComments === "number") {
        snapshots.push({
          snapshotAt: windowStart,
          source: "reddit",
          targetId: input.job.targetId,
          contentId,
          granularity: "15m",
          metricName: "num_comments",
          metricValue: point.numComments,
          collectionJobId: input.job.id,
        });
      }
      if (typeof point.upvoteRatio === "number") {
        snapshots.push({
          snapshotAt: windowStart,
          source: "reddit",
          targetId: input.job.targetId,
          contentId,
          granularity: "15m",
          metricName: "upvote_ratio",
          metricValue: point.upvoteRatio,
          collectionJobId: input.job.id,
        });
      }
    }

    await deps.metricsSnapshotRepository.appendMany(snapshots);

    const finalCursor = observedPages.finalCursor;
    if (mode === "backfill") {
      const cursorToPersist = finalCursor ?? BACKFILL_EOF_CURSOR;
      await deps.collectionJobRepository.saveCursor(input.job.id, cursorToPersist);
    }
    if (deps.crawlCursorRepository) {
      const cursorToPersist = resolveObservedCursorSnapshot({
        mode,
        finalCursor,
        lastPage: observedPages.lastCursorPage ?? lastPage,
      });
      if (cursorToPersist) {
        const existing =
          mode === "backfill"
            ? await resolveBackfillCursorState(deps.crawlCursorRepository, {
                providerHint,
                targetId: input.job.targetId,
                mode,
                nowIso: input.nowIso,
              })
            : null;
        const rewindCursor = existing?.cursor.cursor ?? priorCursor;
        await deps.crawlCursorRepository.upsert({
          provider: resolveCursorProviderKey(providerHint, effectiveProvider),
          targetId: input.job.targetId,
          mode,
          cursor: cursorToPersist,
          rewindCursor:
            mode === "backfill" &&
            finalCursor &&
            rewindCursor &&
            rewindCursor !== finalCursor
              ? rewindCursor
              : undefined,
          oldestObservedAt:
            mode === "backfill"
              ? mergeOldestObservedAt(existing?.cursor.oldestObservedAt, observedPages.oldestObservedAt)
              : undefined,
          newestObservedAt:
            mode === "backfill"
              ? mergeNewestObservedAt(existing?.cursor.newestObservedAt, observedPages.newestObservedAt)
              : undefined,
          backfillTargetFromIso: existing?.cursor.backfillTargetFromIso,
          backfillCoverageStatus: existing?.cursor.backfillCoverageStatus,
          backfillStopReason: existing?.cursor.backfillStopReason,
          lastFetchedAt: input.nowIso,
          updatedAt: input.nowIso,
        });
      }
    }

    await deps.providerHealthWindowRepository?.record({
      provider: effectiveProvider,
      targetId: input.job.targetId,
      mode,
      windowStart: providerHealthWindowStart,
      requestCountDelta: pages.length,
      successCountDelta: pages.filter((page) => page.raw.httpStatus >= 200 && page.raw.httpStatus < 300)
        .length,
      emptyResponseCountDelta: emptyResponseCount,
      fallbackCountDelta: pages.filter((page) => hasFallback(page.raw.responseHeaders)).length,
      candidateCountDelta: allUpserts.length,
      acceptedCountDelta: filtered.upserts.length,
      filteredOutCountDelta: filtered.filteredOutCount,
      duplicatePostCountDelta: duplicatePostCount,
      ingestLagSecondsSumDelta: ingestLagStats.sumSeconds,
      ingestLagSampleCountDelta: ingestLagStats.sampleCount,
      providerDiffCountDelta: providerDiffStats.diffCount,
      providerDiffSampleCountDelta: providerDiffStats.sampleCount,
      errorCountDelta: 0,
      rateLimitCountDelta: 0,
      timeoutCountDelta: 0,
      circuitOpenCountDelta: 0,
      scraplingHttpProfileCountDelta: scraplingObservability.httpProfileCount,
      scraplingDynamicProfileCountDelta: scraplingObservability.dynamicProfileCount,
      scraplingStealthProfileCountDelta: scraplingObservability.stealthProfileCount,
      scraplingSessionKeyCountDelta: scraplingObservability.sessionKeyCount,
      scraplingSessionKeyReuseCountDelta: scraplingObservability.sessionKeyReuseCount,
      lastStatusCode: lastPage.raw.httpStatus,
      lastScraplingProfile: scraplingObservability.lastProfile,
      lastScraplingFetcher: scraplingObservability.lastFetcher,
      lastScraplingSessionKey: scraplingObservability.lastSessionKey,
      updatedAt: input.nowIso,
    });
    logProviderObservability({
      targetId: input.job.targetId,
      provider: effectiveProvider,
      mode,
      requestCount: pages.length,
      candidateCount: allUpserts.length,
      filteredOutCount: filtered.filteredOutCount,
      acceptedCount: filtered.upserts.length,
      duplicatePostCount,
      ingestLagStats,
      providerDiffStats,
      nowIso: input.nowIso,
    });

    await deps.collectionJobRepository.updateStatus(input.job.id, "succeeded");
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    const errorStats = classifyProviderError(message);
    await deps.providerHealthWindowRepository?.record({
      provider: providerHint,
      targetId: input.job.targetId,
      mode,
      windowStart: providerHealthWindowStart,
      requestCountDelta: 1,
      successCountDelta: 0,
      emptyResponseCountDelta: 0,
      fallbackCountDelta: 0,
      candidateCountDelta: 0,
      acceptedCountDelta: 0,
      filteredOutCountDelta: 0,
      duplicatePostCountDelta: 0,
      ingestLagSecondsSumDelta: 0,
      ingestLagSampleCountDelta: 0,
      providerDiffCountDelta: 0,
      providerDiffSampleCountDelta: 0,
      errorCountDelta: 1,
      rateLimitCountDelta: errorStats.rateLimit ? 1 : 0,
      timeoutCountDelta: errorStats.timeout ? 1 : 0,
      circuitOpenCountDelta: errorStats.circuitOpen ? 1 : 0,
      scraplingHttpProfileCountDelta: 0,
      scraplingDynamicProfileCountDelta: 0,
      scraplingStealthProfileCountDelta: 0,
      scraplingSessionKeyCountDelta: 0,
      scraplingSessionKeyReuseCountDelta: 0,
      lastErrorCode: errorStats.code,
      lastErrorMessage: message.slice(0, 300),
      updatedAt: input.nowIso,
    });
    await deps.collectionJobRepository.fail(input.job.id, message, {
      nowIso: input.nowIso,
      maxRetries: retryPolicy.maxRetries,
      retryDelayMs: computeRetryDelayMs(input.job.retryCount + 1, retryPolicy),
    });
    throw error;
  }
}

function resolveNewPostsJobPayload(
  payload: Record<string, unknown> | undefined,
): RedditNewPostsJobPayload {
  if (!payload) {
    return {};
  }
  const candidateFilterRaw = payload.candidateFilter as Record<string, unknown> | undefined;
  const candidateFilter: RedditPostCandidateFilterConfig | undefined =
    candidateFilterRaw &&
    !Array.isArray(candidateFilterRaw)
      ? {
          minScore: toOptionalNonNegativeNumber(candidateFilterRaw.minScore),
          minComments: toOptionalNonNegativeNumber(candidateFilterRaw.minComments),
          mode: candidateFilterRaw.mode === "and" ? "and" : "or",
        }
      : undefined;
  return {
    postLimit: toOptionalPositiveNumber(payload.postLimit),
    samplingTier: toSamplingTier(payload.samplingTier),
    providerHint: typeof payload.providerHint === "string" ? payload.providerHint : undefined,
    candidateFilter,
  };
}

function toNewPostsJobPayload(input: RedditNewPostsJobPayload): Record<string, unknown> | undefined {
  const payload: Record<string, unknown> = {};
  if (typeof input.postLimit === "number") {
    payload.postLimit = Math.max(1, Math.trunc(input.postLimit));
  }
  if (input.samplingTier) {
    payload.samplingTier = input.samplingTier;
  }
  if (input.providerHint) {
    payload.providerHint = input.providerHint;
  }
  if (input.candidateFilter) {
    payload.candidateFilter = {
      minScore: input.candidateFilter.minScore,
      minComments: input.candidateFilter.minComments,
      mode: input.candidateFilter.mode === "and" ? "and" : "or",
    };
  }
  return Object.keys(payload).length > 0 ? payload : undefined;
}

function toOptionalPositiveNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.trunc(value);
}

function toOptionalNonNegativeNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.trunc(value);
}

function toSamplingTier(value: unknown): RedditSamplingTier | undefined {
  if (value === "base" || value === "elevated" || value === "boost") {
    return value;
  }
  return undefined;
}

function resolveProviderHint(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : "reddit";
}

function resolveObservedCursorSnapshot(args: {
  mode: CrawlMode;
  finalCursor: string | undefined;
  lastPage: Awaited<ReturnType<RedditConnector["collectSubredditPosts"]>>;
}): string | undefined {
  if (args.mode === "backfill") {
    return args.finalCursor ?? BACKFILL_EOF_CURSOR;
  }

  if (args.finalCursor) {
    return args.finalCursor;
  }

  const lastChildName =
    args.lastPage.raw.payload.data.children[args.lastPage.raw.payload.data.children.length - 1]?.data
      ?.name;
  if (typeof lastChildName === "string" && lastChildName.trim().length > 0) {
    return lastChildName.trim();
  }

  return LIVE_CURSOR_SNAPSHOT;
}

function resolveQueueScope(args: { mode: CrawlMode; providerHint: string }): string {
  if (args.mode !== "backfill") {
    return args.mode;
  }
  return `${args.mode}:${args.providerHint}`;
}

async function resolveBackfillCursorState(
  repository: CrawlCursorRepository,
  args: {
    providerHint: string;
    targetId: string;
    mode: CrawlMode;
    nowIso?: string;
    ignoreTerminalCursor?: boolean;
  },
): Promise<{ provider: string; cursor: CrawlCursor } | null> {
  for (const provider of resolveBackfillCursorProviders(args.providerHint)) {
    const cursor = await repository.resolve({
      provider,
      targetId: args.targetId,
      mode: args.mode,
    });
    if (cursor) {
      if (args.ignoreTerminalCursor && isBackfillTerminalCursor(cursor.cursor)) {
        continue;
      }
      if (shouldIgnoreLegacyBackfillTerminalCursor(cursor, args.nowIso)) {
        continue;
      }
      return {
        provider,
        cursor,
      };
    }
  }
  return null;
}

function resolveBackfillCursorProviders(providerHint: string): string[] {
  if (providerHint === "apify") {
    return ["apify", "http"];
  }
  if (providerHint === "scrapling") {
    return ["scrapling", "http"];
  }
  if (providerHint === "reddit") {
    return ["reddit", "http", "scrapling", "apify"];
  }
  return [providerHint];
}

function resolveCursorProviderKey(providerHint: string, effectiveProvider: string): string {
  return providerHint === "reddit" ? effectiveProvider : providerHint;
}

function resolveBackfillCursor(cursor: CrawlCursor | undefined): string | undefined {
  if (!cursor) {
    return undefined;
  }
  const candidate = cursor.cursor;
  return isBackfillTerminalCursor(candidate) ? BACKFILL_EOF_CURSOR : candidate;
}

function isBackfillTerminalCursor(cursor: string | undefined): boolean {
  return cursor === BACKFILL_EOF_CURSOR;
}

function shouldIgnoreLegacyBackfillTerminalCursor(
  cursor: CrawlCursor,
  nowIso: string | undefined,
): boolean {
  if (!isBackfillTerminalCursor(cursor.cursor)) {
    return false;
  }
  if (cursor.oldestObservedAt || cursor.newestObservedAt) {
    return false;
  }
  if (!cursor.lastFetchedAt || !nowIso) {
    return true;
  }
  const lastFetchedAtMs = new Date(cursor.lastFetchedAt).getTime();
  const nowMs = new Date(nowIso).getTime();
  if (!Number.isFinite(lastFetchedAtMs) || !Number.isFinite(nowMs)) {
    return true;
  }
  return nowMs - lastFetchedAtMs >= STALE_LEGACY_BACKFILL_CURSOR_MAX_AGE_MS;
}

function shouldIgnoreTerminalBackfillCursorForRun(): boolean {
  return process.env.REDDIT_BACKFILL_IGNORE_TERMINAL_CURSOR === "true";
}

async function collectObservedPages(args: {
  redditConnector: RedditConnector;
  subreddit: string;
  limit: number;
  samplingTier?: RedditSamplingTier;
  after?: string;
  mode: CrawlMode;
  providerHint: string;
  requestId: string;
  nowIso: string;
}): Promise<{
  pages: Array<Awaited<ReturnType<RedditConnector["collectSubredditPosts"]>>>;
  finalCursor?: string;
  lastCursorPage?: Awaited<ReturnType<RedditConnector["collectSubredditPosts"]>>;
  oldestObservedAt?: string;
  newestObservedAt?: string;
}> {
  const pages: Array<Awaited<ReturnType<RedditConnector["collectSubredditPosts"]>>> = [];
  let after = args.after;
  let remainingBudget = args.limit;
  let observedProvider = args.providerHint;
  let lastCursorPage: Awaited<ReturnType<RedditConnector["collectSubredditPosts"]>> | undefined;
  let oldestObservedAt: string | undefined;
  let newestObservedAt: string | undefined;
  let extraBudget =
    args.mode === "live"
      ? Math.max(args.limit, resolveLiveOverflowExtraBudget(args.limit, args.samplingTier))
      : 0;
  const maxLivePages = resolveLiveOverflowMaxPages(args.samplingTier);

  for (let pageIndex = 0; remainingBudget > 0; pageIndex += 1) {
    const requestLimit = resolvePageRequestLimit({
      remainingBudget,
      observedProvider,
    });
    const page = await requestObservedPage({
      redditConnector: args.redditConnector,
      subreddit: args.subreddit,
      limit: requestLimit,
      after,
      listing: "new",
      requestId: pageIndex === 0 ? args.requestId : `${args.requestId}:overflow:${pageIndex}`,
      nowIso: args.nowIso,
    });
    pages.push(page);
    lastCursorPage = page;
    const pageObservedBounds = resolvePageObservedDateBounds(page);
    if (pageObservedBounds) {
      oldestObservedAt = mergeOldestObservedAt(oldestObservedAt, pageObservedBounds.oldestObservedAt);
      newestObservedAt = mergeNewestObservedAt(newestObservedAt, pageObservedBounds.newestObservedAt);
    }
    observedProvider = resolveObservedPagingProvider({
      providerHint: observedProvider,
      responseHeaders: page.raw.responseHeaders,
    });

    const returnedCount = page.raw.payload.data.children.length;
    if (
      !page.nextCursor ||
      returnedCount < requestLimit
    ) {
      break;
    }

    if (args.mode !== "live") {
      remainingBudget -= returnedCount;
      if (remainingBudget <= 0) {
        break;
      }
      after = page.nextCursor;
      continue;
    }

    if (
      extraBudget <= 0 ||
      pageIndex >= maxLivePages - 1
    ) {
      break;
    }
    if (shouldStopLiveOverflowByAge({
      page,
      pageIndex,
      nowIso: args.nowIso,
    })) {
      break;
    }

    after = page.nextCursor;
    const nextBudget = Math.max(1, Math.min(args.limit, extraBudget));
    remainingBudget = nextBudget;
    extraBudget = Math.max(0, extraBudget - nextBudget);
  }

  if (
    shouldCollectBackfillTopSupplement({
      mode: args.mode,
      after: args.after,
      cursorPage: lastCursorPage,
      requestedLimit: args.limit,
      nowIso: args.nowIso,
    })
  ) {
    pages.push(
      ...(await collectBackfillSupplementalPages({
        redditConnector: args.redditConnector,
        subreddit: args.subreddit,
        limit: Math.min(args.limit, BACKFILL_SUPPLEMENT_LIMIT),
        requestId: args.requestId,
        nowIso: args.nowIso,
      })),
    );
  }

  return {
    pages,
    finalCursor: lastCursorPage?.nextCursor,
    lastCursorPage,
    oldestObservedAt,
    newestObservedAt,
  };
}

async function requestObservedPage(args: {
  redditConnector: RedditConnector;
  subreddit: string;
  limit: number;
  after?: string;
  listing: RedditPostListing;
  timeRange?: RedditTopTimeRange;
  requestId: string;
  nowIso: string;
}): Promise<Awaited<ReturnType<RedditConnector["collectSubredditPosts"]>>> {
  const request: RedditCollectSubredditPostsArgs = {
    subreddit: args.subreddit,
    limit: args.limit,
    after: args.after,
    listing: args.listing,
    timeRange: args.timeRange,
  };
  return args.redditConnector.collectSubredditPosts(request, {
    requestId: args.requestId,
    now: args.nowIso,
  });
}

function shouldCollectBackfillTopSupplement(args: {
  mode: CrawlMode;
  after?: string;
  cursorPage?: Awaited<ReturnType<RedditConnector["collectSubredditPosts"]>>;
  requestedLimit: number;
  nowIso: string;
}): boolean {
  if (args.mode !== "backfill" || args.after) {
    return false;
  }
  if (args.requestedLimit < BACKFILL_SUPPLEMENT_LIMIT) {
    return false;
  }
  if (!args.cursorPage) {
    return true;
  }
  const ageBounds = resolvePageAgeBoundsSeconds(args.cursorPage, args.nowIso);
  if (!ageBounds) {
    return true;
  }
  return ageBounds.oldestAgeSeconds < BACKFILL_SUPPLEMENT_TRIGGER_AGE_SECONDS;
}

async function collectBackfillSupplementalPages(args: {
  redditConnector: RedditConnector;
  subreddit: string;
  limit: number;
  requestId: string;
  nowIso: string;
}): Promise<Array<Awaited<ReturnType<RedditConnector["collectSubredditPosts"]>>>> {
  const pages: Array<Awaited<ReturnType<RedditConnector["collectSubredditPosts"]>>> = [];
  for (const timeRange of BACKFILL_TOP_TIME_WINDOWS) {
    pages.push(
      await requestObservedPage({
        redditConnector: args.redditConnector,
        subreddit: args.subreddit,
        limit: args.limit,
        listing: "top",
        timeRange,
        requestId: `${args.requestId}:top:${timeRange}`,
        nowIso: args.nowIso,
      }),
    );
  }
  return pages;
}

function resolvePageRequestLimit(args: {
  remainingBudget: number;
  observedProvider: string;
}): number {
  const boundedRemaining = Math.max(1, Math.trunc(args.remainingBudget));
  if (REDDIT_PAGE_CAPPED_PROVIDERS.has(args.observedProvider)) {
    return Math.min(boundedRemaining, REDDIT_PAGE_CAP_SIZE);
  }
  return boundedRemaining;
}

function resolveObservedPagingProvider(args: {
  providerHint: string;
  responseHeaders: Record<string, string>;
}): string {
  const fromHeader = args.responseHeaders["x-provider"];
  if (typeof fromHeader === "string" && fromHeader.trim().length > 0) {
    return fromHeader.trim().toLowerCase();
  }
  return args.providerHint;
}

function resolveLiveOverflowExtraBudget(
  requestedLimit: number,
  samplingTier: RedditSamplingTier | undefined,
): number {
  if (samplingTier === "boost") {
    return Math.max(1, Math.ceil(requestedLimit * 3));
  }
  if (samplingTier === "elevated") {
    return Math.max(1, Math.ceil(requestedLimit * 2));
  }
  return Math.max(1, Math.ceil(requestedLimit * 1.5));
}

function resolveLiveOverflowMaxPages(samplingTier: RedditSamplingTier | undefined): number {
  if (samplingTier === "boost") {
    return 4;
  }
  return 3;
}

function shouldStopLiveOverflowByAge(args: {
  page: Awaited<ReturnType<RedditConnector["collectSubredditPosts"]>>;
  pageIndex: number;
  nowIso: string;
}): boolean {
  const ageBounds = resolvePageAgeBoundsSeconds(args.page, args.nowIso);
  if (!ageBounds) {
    return false;
  }
  if (
    args.pageIndex === 0 &&
    ageBounds.freshestAgeSeconds > LIVE_OVERFLOW_HEAD_FRESHNESS_MAX_SECONDS
  ) {
    return true;
  }
  if (
    args.pageIndex > 0 &&
    ageBounds.oldestAgeSeconds > LIVE_OVERFLOW_TAIL_AGE_MAX_SECONDS
  ) {
    return true;
  }
  return false;
}

function resolvePageAgeBoundsSeconds(
  page: Awaited<ReturnType<RedditConnector["collectSubredditPosts"]>>,
  nowIso: string,
): {
  freshestAgeSeconds: number;
  oldestAgeSeconds: number;
} | null {
  const nowMs = new Date(nowIso).getTime();
  if (!Number.isFinite(nowMs)) {
    return null;
  }
  let freshestCreatedMs = Number.NEGATIVE_INFINITY;
  let oldestCreatedMs = Number.POSITIVE_INFINITY;
  let sampleCount = 0;
  for (const child of page.raw.payload.data.children) {
    const createdUtc = child?.data?.created_utc;
    if (typeof createdUtc !== "number" || !Number.isFinite(createdUtc)) {
      continue;
    }
    const createdMs = createdUtc * 1000;
    if (!Number.isFinite(createdMs) || createdMs > nowMs) {
      continue;
    }
    freshestCreatedMs = Math.max(freshestCreatedMs, createdMs);
    oldestCreatedMs = Math.min(oldestCreatedMs, createdMs);
    sampleCount += 1;
  }
  if (sampleCount <= 0) {
    return null;
  }
  return {
    freshestAgeSeconds: Math.max(0, Math.floor((nowMs - freshestCreatedMs) / 1000)),
    oldestAgeSeconds: Math.max(0, Math.floor((nowMs - oldestCreatedMs) / 1000)),
  };
}

function resolvePageObservedDateBounds(
  page: Awaited<ReturnType<RedditConnector["collectSubredditPosts"]>>,
): {
  oldestObservedAt: string;
  newestObservedAt: string;
} | null {
  let oldestObservedMs = Number.POSITIVE_INFINITY;
  let newestObservedMs = Number.NEGATIVE_INFINITY;
  let sampleCount = 0;
  for (const child of page.raw.payload.data.children) {
    const createdUtc = child?.data?.created_utc;
    if (typeof createdUtc !== "number" || !Number.isFinite(createdUtc)) {
      continue;
    }
    const createdMs = createdUtc * 1000;
    if (!Number.isFinite(createdMs)) {
      continue;
    }
    oldestObservedMs = Math.min(oldestObservedMs, createdMs);
    newestObservedMs = Math.max(newestObservedMs, createdMs);
    sampleCount += 1;
  }
  if (sampleCount <= 0) {
    return null;
  }
  return {
    oldestObservedAt: new Date(oldestObservedMs).toISOString(),
    newestObservedAt: new Date(newestObservedMs).toISOString(),
  };
}

function mergeOldestObservedAt(
  previous: string | undefined,
  next: string | undefined,
): string | undefined {
  if (!previous) {
    return next;
  }
  if (!next) {
    return previous;
  }
  return previous <= next ? previous : next;
}

function mergeNewestObservedAt(
  previous: string | undefined,
  next: string | undefined,
): string | undefined {
  if (!previous) {
    return next;
  }
  if (!next) {
    return previous;
  }
  return previous >= next ? previous : next;
}

function resolveCandidateFilter(input: CollectSubredditNewPostsInput["candidateFilter"]) {
  return {
    minScore: Math.max(0, input?.minScore ?? 0),
    minComments: Math.max(0, input?.minComments ?? 0),
    mode: input?.mode === "and" ? "and" : "or",
  } as const;
}

async function resolveEffectiveCandidateFilter(args: {
  candidateFilter: CollectSubredditNewPostsInput["candidateFilter"];
  mode: CrawlMode;
  targetId: string;
  nowIso: string;
  metricsSnapshotRepository: MetricsSnapshotRepository;
}) {
  const explicit = resolveCandidateFilter(args.candidateFilter);
  if (args.mode !== "backfill") {
    return explicit;
  }

  const subscriberCount = await resolveLatestSubscriberCount({
    targetId: args.targetId,
    nowIso: args.nowIso,
    metricsSnapshotRepository: args.metricsSnapshotRepository,
  });
  if (subscriberCount == null) {
    return explicit;
  }

  const tier = resolveSubredditTier(subscriberCount);
  const tiered = BACKFILL_TIERED_CANDIDATE_FILTERS[tier];
  return {
    minScore: Math.max(explicit.minScore, tiered.minScore),
    minComments: Math.max(explicit.minComments, tiered.minComments),
    mode:
      explicit.mode === "and" || tiered.mode === "and"
        ? "and"
        : "or",
  } as const;
}

async function resolveLatestSubscriberCount(args: {
  targetId: string;
  nowIso: string;
  metricsSnapshotRepository: MetricsSnapshotRepository;
}): Promise<number | null> {
  const fromIso = new Date(
    new Date(args.nowIso).getTime() - 30 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const snapshots = await args.metricsSnapshotRepository.listByTargetInRange({
    targetId: args.targetId,
    from: fromIso,
    to: args.nowIso,
    metricNames: ["subscribers"],
  });
  const latest = snapshots.sort((left, right) => right.snapshotAt.localeCompare(left.snapshotAt))[0];
  if (!latest) {
    return null;
  }
  return Math.max(0, Math.round(Number(latest.metricValue)));
}

function filterCandidates(args: {
  upserts: ReturnType<RedditMapper["toPostUpserts"]>;
  metricPoints: ReturnType<RedditMapper["toPostMetricPoints"]>;
  filter: ReturnType<typeof resolveCandidateFilter>;
}): {
  upserts: ReturnType<RedditMapper["toPostUpserts"]>;
  metricPoints: ReturnType<RedditMapper["toPostMetricPoints"]>;
  filteredOutCount: number;
} {
  if (args.filter.minScore <= 0 && args.filter.minComments <= 0) {
    return {
      upserts: args.upserts,
      metricPoints: args.metricPoints,
      filteredOutCount: 0,
    };
  }

  const metricsByExternalId = new Map(
    args.metricPoints.map((metric) => [metric.externalId, metric]),
  );
  const acceptedExternalIds = new Set<string>();
  const filteredUpserts = args.upserts.filter((post) => {
    const metric = metricsByExternalId.get(post.externalId);
    const score = Math.max(0, metric?.score ?? 0);
    const comments = Math.max(0, metric?.numComments ?? 0);
    const byScore = score >= args.filter.minScore;
    const byComments = comments >= args.filter.minComments;
    const accepted = args.filter.mode === "and" ? byScore && byComments : byScore || byComments;
    if (accepted) {
      acceptedExternalIds.add(post.externalId);
    }
    return accepted;
  });

  const filteredMetricPoints = args.metricPoints.filter((metric) =>
    acceptedExternalIds.has(metric.externalId),
  );
  return {
    upserts: filteredUpserts,
    metricPoints: filteredMetricPoints,
    filteredOutCount: Math.max(0, args.upserts.length - filteredUpserts.length),
  };
}

function hasFallback(headers: Record<string, string>): boolean {
  const fallback = headers["x-provider-fallback"];
  return typeof fallback === "string" && fallback.trim().length > 0;
}

function summarizeScraplingObservability(
  pages: Array<Awaited<ReturnType<RedditConnector["collectSubredditPosts"]>>>,
): {
  httpProfileCount: number;
  dynamicProfileCount: number;
  stealthProfileCount: number;
  sessionKeyCount: number;
  sessionKeyReuseCount: number;
  lastProfile?: "http" | "dynamic" | "stealth";
  lastFetcher?: string;
  lastSessionKey?: string;
} {
  let httpProfileCount = 0;
  let dynamicProfileCount = 0;
  let stealthProfileCount = 0;
  let sessionKeyCount = 0;
  let sessionKeyReuseCount = 0;
  let lastProfile: "http" | "dynamic" | "stealth" | undefined;
  let lastFetcher: string | undefined;
  let lastSessionKey: string | undefined;

  for (const page of pages) {
    const headers = page.raw.responseHeaders;
    const profile = headers["x-scrapling-profile"];
    if (profile === "http") {
      httpProfileCount += 1;
      lastProfile = "http";
    } else if (profile === "dynamic") {
      dynamicProfileCount += 1;
      lastProfile = "dynamic";
    } else if (profile === "stealth") {
      stealthProfileCount += 1;
      lastProfile = "stealth";
    }

    const sessionKey = headers["x-scrapling-session-key"];
    if (typeof sessionKey === "string" && sessionKey.trim().length > 0) {
      sessionKeyCount += 1;
      lastSessionKey = sessionKey.trim();
      if (isTruthyHeader(headers["x-scrapling-session-key-reused"])) {
        sessionKeyReuseCount += 1;
      }
    }

    const fetcher = headers["x-scrapling-fetcher"];
    if (typeof fetcher === "string" && fetcher.trim().length > 0) {
      lastFetcher = fetcher.trim().toLowerCase();
    }
  }

  return {
    httpProfileCount,
    dynamicProfileCount,
    stealthProfileCount,
    sessionKeyCount,
    sessionKeyReuseCount,
    lastProfile,
    lastFetcher,
    lastSessionKey,
  };
}

function isTruthyHeader(value: string | undefined): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function resolveProvider(args: {
  providerHint: string;
  responseHeaders: Record<string, string>;
  endpoint: string;
}): string {
  const fromHeader = args.responseHeaders["x-provider"];
  if (fromHeader && fromHeader.trim().length > 0) {
    return fromHeader.trim().toLowerCase();
  }
  if (args.endpoint.startsWith("/apify/")) {
    return "apify";
  }
  if (
    args.endpoint.includes("/new.json") ||
    args.endpoint.includes("/top.json") ||
    args.endpoint.includes("/about.json")
  ) {
    return "http";
  }
  return args.providerHint;
}

function classifyProviderError(message: string): {
  code: string;
  rateLimit: boolean;
  timeout: boolean;
  circuitOpen: boolean;
} {
  const normalized = message.toLowerCase();
  const rateLimit = normalized.includes("429") || normalized.includes("rate_limit");
  const timeout =
    normalized.includes("timeout") ||
    normalized.includes("timed out") ||
    normalized.includes("504");
  const circuitOpen = normalized.includes("circuit_open") || normalized.includes("breaker is open");
  const code = rateLimit
    ? "rate_limit"
    : timeout
      ? "timeout"
      : circuitOpen
        ? "circuit_open"
        : "provider_error";
  return {
    code,
    rateLimit,
    timeout,
    circuitOpen,
  };
}

function summarizeIngestLagSeconds(
  upserts: ReturnType<RedditMapper["toPostUpserts"]>,
  nowIso: string,
): {
  sumSeconds: number;
  sampleCount: number;
} {
  const nowMs = new Date(nowIso).getTime();
  if (!Number.isFinite(nowMs)) {
    return {
      sumSeconds: 0,
      sampleCount: 0,
    };
  }

  let sumSeconds = 0;
  let sampleCount = 0;
  for (const item of upserts) {
    const createdAtMs = new Date(item.createdAtSource).getTime();
    if (!Number.isFinite(createdAtMs) || createdAtMs > nowMs) {
      continue;
    }
    sumSeconds += Math.floor((nowMs - createdAtMs) / 1000);
    sampleCount += 1;
  }

  return {
    sumSeconds,
    sampleCount,
  };
}

function resolveProviderDiffStats(headers: Record<string, string>): {
  diffCount: number;
  sampleCount: number;
} {
  const rawDiff = headers["x-compare-post-count-diff"];
  if (typeof rawDiff !== "string" || rawDiff.trim().length === 0) {
    return {
      diffCount: 0,
      sampleCount: 0,
    };
  }

  const diff = Number.parseInt(rawDiff, 10);
  if (!Number.isFinite(diff)) {
    return {
      diffCount: 0,
      sampleCount: 0,
    };
  }

  return {
    diffCount: Math.abs(diff) > 0 ? 1 : 0,
    sampleCount: 1,
  };
}

function summarizeProviderDiffStats(
  pages: Array<Awaited<ReturnType<RedditConnector["collectSubredditPosts"]>>>,
): {
  diffCount: number;
  sampleCount: number;
} {
  let diffCount = 0;
  let sampleCount = 0;
  for (const page of pages) {
    const stats = resolveProviderDiffStats(page.raw.responseHeaders);
    diffCount += stats.diffCount;
    sampleCount += stats.sampleCount;
  }
  return {
    diffCount,
    sampleCount,
  };
}

function logProviderObservability(args: {
  targetId: string;
  provider: string;
  mode: CrawlMode;
  requestCount: number;
  candidateCount: number;
  filteredOutCount: number;
  acceptedCount: number;
  duplicatePostCount: number;
  ingestLagStats: {
    sumSeconds: number;
    sampleCount: number;
  };
  providerDiffStats: {
    diffCount: number;
    sampleCount: number;
  };
  nowIso: string;
}): void {
  const duplicatePostRate =
    args.candidateCount > 0
      ? Number((args.duplicatePostCount / args.candidateCount).toFixed(6))
      : args.acceptedCount > 0
        ? Number((args.duplicatePostCount / args.acceptedCount).toFixed(6))
        : null;
  const ingestLagSeconds =
    args.ingestLagStats.sampleCount > 0
      ? Number((args.ingestLagStats.sumSeconds / args.ingestLagStats.sampleCount).toFixed(3))
      : null;
  const providerDiffRate =
    args.providerDiffStats.sampleCount > 0
      ? Number((args.providerDiffStats.diffCount / args.providerDiffStats.sampleCount).toFixed(6))
      : null;

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      event: "reddit.provider_observability.recorded",
      targetId: args.targetId,
      provider: args.provider,
      mode: args.mode,
      requestCount: args.requestCount,
      candidateCount: args.candidateCount,
      filteredOutCount: args.filteredOutCount,
      acceptedCount: args.acceptedCount,
      duplicatePostCount: args.duplicatePostCount,
      duplicatePostRate,
      ingestLagSeconds,
      providerDiffRate,
      recordedAt: args.nowIso,
    }),
  );
}
