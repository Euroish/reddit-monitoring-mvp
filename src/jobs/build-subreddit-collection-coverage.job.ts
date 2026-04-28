import type {
  SubredditCollectionCoverage,
  SubredditCollectionCoverageBasis,
  SubredditCollectionCoverageStatus,
} from "../domain/entities/subreddit-collection-coverage";
import type { ContentRepository } from "../domain/repositories/content-repository";
import type { CrawlCursorRepository } from "../domain/repositories/crawl-cursor-repository";
import type { ProviderHealthWindowRepository } from "../domain/repositories/provider-health-window-repository";
import type { SubredditCollectionCoverageRepository } from "../domain/repositories/subreddit-collection-coverage-repository";
import type { SubredditDailyFactRepository } from "../domain/repositories/subreddit-daily-fact-repository";

export interface BuildSubredditCollectionCoverageDependencies {
  contentRepository: ContentRepository;
  subredditDailyFactRepository: SubredditDailyFactRepository;
  subredditCollectionCoverageRepository: SubredditCollectionCoverageRepository;
  crawlCursorRepository?: CrawlCursorRepository;
  providerHealthWindowRepository?: ProviderHealthWindowRepository;
}

export interface BuildSubredditCollectionCoverageInput {
  targetId: string;
  fromIso: string;
  toIso: string;
  generatedAtIso: string;
}

export async function buildSubredditCollectionCoverageJob(
  deps: BuildSubredditCollectionCoverageDependencies,
  input: BuildSubredditCollectionCoverageInput,
): Promise<SubredditCollectionCoverage[]> {
  const days = enumerateUtcDays(input.fromIso, input.toIso);
  if (days.length === 0) {
    return [];
  }
  const fromDay = days[0]!;
  const toDay = days[days.length - 1]!;
  const [facts, posts, liveCursors, backfillCursors, providerHealthWindows] = await Promise.all([
    deps.subredditDailyFactRepository.listByTargetInRange({
      targetId: input.targetId,
      fromDay,
      toDay,
    }),
    deps.contentRepository.findByTargetCreatedAtRange({
      targetId: input.targetId,
      from: input.fromIso,
      to: input.toIso,
      limit: 50_000,
      totalEligibleOnly: true,
    }),
    deps.crawlCursorRepository?.list({
      targetId: input.targetId,
      mode: "live",
    }) ?? Promise.resolve([]),
    deps.crawlCursorRepository?.list({
      targetId: input.targetId,
      mode: "backfill",
    }) ?? Promise.resolve([]),
    deps.providerHealthWindowRepository?.listByTargetInRange({
      targetId: input.targetId,
      from: input.fromIso,
      to: input.toIso,
      mode: "live",
    }) ?? Promise.resolve([]),
  ]);

  const factByDay = new Map(facts.map((fact) => [fact.day, fact]));
  const postsByDay = new Map<string, typeof posts>();
  for (const post of posts) {
    const day = post.createdAtSource.slice(0, 10);
    postsByDay.set(day, [...(postsByDay.get(day) ?? []), post]);
  }
  const liveCursor = liveCursors
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const backfillCursor = backfillCursors
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const rateLimitedDaySet = new Set(
    providerHealthWindows
      .filter((window) => window.rateLimitCount > 0)
      .map((window) => window.windowStart.slice(0, 10)),
  );

  const rows = days.map((day): SubredditCollectionCoverage => {
    const fact = factByDay.get(day);
    const dayPosts = postsByDay.get(day) ?? [];
    const statusAndBasis = resolveCoverageStatus({
      day,
      observedPostCount: fact?.postVolume ?? 0,
      rateLimited: rateLimitedDaySet.has(day),
      liveCursor,
      backfillCursor,
    });
    const firstSeenPostAt = minIso(dayPosts.map((post) => post.firstSeenAt));
    const lastSeenPostAt = maxIso(dayPosts.map((post) => post.lastSeenAt));
    const oldestNewListingSeenAt = minIso(dayPosts.map((post) => post.createdAtSource));
    const newestNewListingSeenAt = maxIso(dayPosts.map((post) => post.createdAtSource));

    return {
      targetId: input.targetId,
      day,
      coverageStatus: statusAndBasis.status,
      coverageBasis: statusAndBasis.basis,
      observedPostCount: fact?.postVolume ?? 0,
      totalEligiblePostCount: fact?.postVolume ?? 0,
      firstSeenPostAt,
      lastSeenPostAt,
      oldestNewListingSeenAt,
      newestNewListingSeenAt,
      liveWindowCount: statusAndBasis.liveWindowCount,
      missedLiveWindowCount: statusAndBasis.missedLiveWindowCount,
      backfillCursor: backfillCursor?.cursor,
      backfillStopReason: backfillCursor?.backfillStopReason,
      listingHorizonHit: Boolean(liveCursor?.liveListingHorizonHit),
      sourceLimited: statusAndBasis.status === "source_limited",
      generatedAt: input.generatedAtIso,
    };
  });

  await deps.subredditCollectionCoverageRepository.replaceRange({
    targetId: input.targetId,
    fromDay,
    toDay,
    rows,
  });
  return rows;
}

function resolveCoverageStatus(args: {
  day: string;
  observedPostCount: number;
  rateLimited: boolean;
  liveCursor?: {
    liveCoverageStatus?: string;
    liveRequestedFromIso?: string;
    liveListingHorizonHit?: boolean;
    newestObservedAt?: string;
  };
  backfillCursor?: {
    cursor: string;
    oldestObservedAt?: string;
    backfillCoverageStatus?: string;
    backfillStopReason?: string;
  };
}): {
  status: SubredditCollectionCoverageStatus;
  basis: SubredditCollectionCoverageBasis;
  liveWindowCount: number;
  missedLiveWindowCount: number;
} {
  const dayStartIso = `${args.day}T00:00:00.000Z`;
  const dayEndIso = `${args.day}T23:59:59.999Z`;
  if (args.rateLimited) {
    return {
      status: args.observedPostCount > 0 ? "partial" : "source_limited",
      basis: "rate_limited",
      liveWindowCount: args.liveCursor?.liveRequestedFromIso ? 1 : 0,
      missedLiveWindowCount: 0,
    };
  }
  if (
    args.backfillCursor?.backfillCoverageStatus === "covered" &&
    args.backfillCursor.oldestObservedAt &&
    args.backfillCursor.oldestObservedAt <= dayStartIso
  ) {
    return {
      status: "complete",
      basis: "backfill_reached_day_start",
      liveWindowCount: 0,
      missedLiveWindowCount: 0,
    };
  }
  if (
    args.backfillCursor?.backfillStopReason === "terminal_eof" &&
    args.backfillCursor.oldestObservedAt &&
    args.backfillCursor.oldestObservedAt <= dayStartIso
  ) {
    return {
      status: "complete",
      basis: "terminal_eof_reached",
      liveWindowCount: 0,
      missedLiveWindowCount: 0,
    };
  }
  if (
    args.liveCursor?.liveCoverageStatus === "complete" &&
    args.liveCursor.liveRequestedFromIso &&
    args.liveCursor.liveRequestedFromIso <= dayStartIso &&
    args.liveCursor.newestObservedAt &&
    args.liveCursor.newestObservedAt >= dayEndIso
  ) {
    return {
      status: "complete",
      basis: "live_continuous",
      liveWindowCount: 1,
      missedLiveWindowCount: 0,
    };
  }
  if (
    args.liveCursor?.liveCoverageStatus === "complete" &&
    args.liveCursor.liveRequestedFromIso &&
    args.liveCursor.liveRequestedFromIso > dayStartIso &&
    args.observedPostCount > 0
  ) {
    return {
      status: "partial",
      basis: "missed_live_window",
      liveWindowCount: 1,
      missedLiveWindowCount: 1,
    };
  }
  if (args.backfillCursor?.backfillStopReason === "iteration_budget_exhausted") {
    return {
      status: args.observedPostCount > 0 ? "partial" : "unknown",
      basis: "iteration_budget_exhausted",
      liveWindowCount: args.liveCursor?.liveRequestedFromIso ? 1 : 0,
      missedLiveWindowCount: 0,
    };
  }
  if (
    args.backfillCursor?.backfillCoverageStatus === "source_limited" ||
    args.backfillCursor?.backfillCoverageStatus === "saturated_before_15d" ||
    args.backfillCursor?.backfillStopReason === "cursor_saturated" ||
    args.liveCursor?.liveCoverageStatus === "source_limited"
  ) {
    return {
      status: args.observedPostCount > 0 ? "partial" : "source_limited",
      basis:
        args.backfillCursor?.backfillStopReason === "cursor_saturated"
          ? "cursor_saturated"
          : "iteration_budget_exhausted",
      liveWindowCount: args.liveCursor?.liveRequestedFromIso ? 1 : 0,
      missedLiveWindowCount: 0,
    };
  }
  if (args.observedPostCount > 0) {
    return {
      status: "partial",
      basis: "observed_without_proof",
      liveWindowCount: args.liveCursor?.liveRequestedFromIso ? 1 : 0,
      missedLiveWindowCount: 0,
    };
  }
  return {
    status: "unknown",
    basis: "no_collection_evidence",
    liveWindowCount: 0,
    missedLiveWindowCount: 0,
  };
}

function enumerateUtcDays(fromIso: string, toIso: string): string[] {
  const start = new Date(fromIso);
  const end = new Date(toIso);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) {
    return [];
  }
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const finalDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  const days: string[] = [];
  while (cursor <= finalDay) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function minIso(values: Array<string | undefined>): string | undefined {
  return values.filter((value): value is string => Boolean(value)).sort()[0];
}

function maxIso(values: Array<string | undefined>): string | undefined {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1);
}
