import type {
  MarketWorkbenchResponse,
  TargetComparisonWorkbenchResponse,
  TargetWorkbenchResponse,
  WorkbenchComparableSeriesId,
} from "../../../packages/contracts/src/http";
import type { CrawlCursor } from "../../domain/entities/crawl-cursor";
import type { ProviderHealthWindow } from "../../domain/entities/provider-health-window";
import type { SubredditCollectionCoverage } from "../../domain/entities/subreddit-collection-coverage";
import type { SubredditDailyFact } from "../../domain/entities/subreddit-daily-fact";
import type { MonitorTargetRepository } from "../../domain/repositories/monitor-target-repository";
import type { SubredditDailyFactRepository } from "../../domain/repositories/subreddit-daily-fact-repository";
import type { SubredditTrendPointRepository } from "../../domain/repositories/subreddit-trend-point-repository";
import type { PostGrowthFactRepository } from "../../domain/repositories/post-growth-fact-repository";
import type { PostEngagementRepository } from "../../domain/repositories/post-engagement-repository";
import type { ContentRepository } from "../../domain/repositories/content-repository";
import type { AnomalyEventRepository } from "../../domain/repositories/anomaly-event-repository";
import type { ProviderHealthWindowRepository } from "../../domain/repositories/provider-health-window-repository";
import type { SubredditCollectionCoverageRepository } from "../../domain/repositories/subreddit-collection-coverage-repository";
import type { CrawlCursorRepository } from "../../domain/repositories/crawl-cursor-repository";
import type { KeywordTrendDailyRepository } from "../../domain/repositories/keyword-trend-daily-repository";
import type { PostSearchDocumentRepository } from "../../domain/repositories/post-search-document-repository";
import { buildMarketWorkbenchReadModel } from "./market-workbench-read-model.service";
import { buildTargetComparisonWorkbenchReadModel } from "./target-comparison-workbench-read-model.service";
import { buildTargetWorkbenchReadModel } from "./target-workbench-read-model.service";
import {
  resolveDriverKeywordMatches,
  type NormalizedTargetKeywordQuery,
} from "./workbench-refresh-driver-match.service";

export interface WorkbenchRefreshRepositories {
  monitorTargetRepository: MonitorTargetRepository;
  subredditDailyFactRepository: SubredditDailyFactRepository;
  subredditTrendPointRepository: SubredditTrendPointRepository;
  postGrowthFactRepository: PostGrowthFactRepository;
  postEngagementRepository?: PostEngagementRepository;
  contentRepository: ContentRepository;
  anomalyEventRepository: AnomalyEventRepository;
  providerHealthWindowRepository?: ProviderHealthWindowRepository;
  subredditCollectionCoverageRepository?: SubredditCollectionCoverageRepository;
  crawlCursorRepository?: CrawlCursorRepository;
  keywordTrendDailyRepository?: KeywordTrendDailyRepository;
  postSearchDocumentRepository?: PostSearchDocumentRepository;
}

export interface ComparisonWorkbenchRefreshContract {
  requestId: string;
  generatedAtIso: string;
  canonicalNames: string[];
  fromIso: string;
  toIso: string;
  timeframe?: "1d";
  rangePreset?: "7d" | "30d" | "90d";
  seriesIds?: WorkbenchComparableSeriesId[];
}

export interface MarketWorkbenchRefreshContract {
  requestId: string;
  generatedAtIso: string;
  fromIso: string;
  toIso: string;
  rankingLimit: number;
  breakoutLimit: number;
  anomalyLimit: number;
}

export interface TargetWorkbenchRefreshContract {
  requestId: string;
  generatedAtIso: string;
  canonicalName: string;
  fromIso: string;
  toIso: string;
  timeframe?: "1d";
  rangePreset?: "7d" | "30d" | "90d";
  keywordLimit: number;
  driverLimit: number;
  anomalyLimit: number;
  normalizedQueries: NormalizedTargetKeywordQuery[];
}

export async function buildComparisonWorkbenchFromRefreshContract(
  repos: WorkbenchRefreshRepositories,
  contract: ComparisonWorkbenchRefreshContract,
): Promise<TargetComparisonWorkbenchResponse | { code: "target_not_found"; canonicalName: string }> {
  const fromDay = toUtcDay(contract.fromIso);
  const toDay = toUtcDay(contract.toIso);
  const targets = await Promise.all(
    contract.canonicalNames.map((canonicalName) =>
      repos.monitorTargetRepository.findByCanonicalName(canonicalName),
    ),
  );
  const missingCanonicalName = contract.canonicalNames.find((_, index) => !targets[index]);
  if (missingCanonicalName) {
    return { code: "target_not_found", canonicalName: missingCanonicalName };
  }

  const resolvedTargets = targets.filter((target): target is NonNullable<typeof target> => Boolean(target));
  const dailyFactsByTargetId = new Map<
    string,
    Awaited<ReturnType<SubredditDailyFactRepository["listByTargetInRange"]>>
  >();
  const coverageByTargetId = new Map<
    string,
    Awaited<ReturnType<SubredditCollectionCoverageRepository["listByTargetInRange"]>>
  >();
  const [dailyFactGroups, coverageGroups] = await Promise.all([
    Promise.all(
      resolvedTargets.map((target) =>
        repos.subredditDailyFactRepository.listByTargetInRange({
          targetId: target.id,
          fromDay,
          toDay,
        }),
      ),
    ),
    Promise.all(
      resolvedTargets.map((target) =>
        repos.subredditCollectionCoverageRepository?.listByTargetInRange({
          targetId: target.id,
          fromDay,
          toDay,
        }) ?? Promise.resolve([]),
      ),
    ),
  ]);
  for (const [index, facts] of dailyFactGroups.entries()) {
    dailyFactsByTargetId.set(resolvedTargets[index]!.id, facts);
  }
  for (const [index, coverageRows] of coverageGroups.entries()) {
    coverageByTargetId.set(resolvedTargets[index]!.id, coverageRows);
  }

  return buildTargetComparisonWorkbenchReadModel({
    requestId: contract.requestId,
    generatedAtIso: contract.generatedAtIso,
    targets: resolvedTargets,
    fromIso: contract.fromIso,
    toIso: contract.toIso,
    timeframe: contract.timeframe,
    rangePreset: contract.rangePreset,
    dailyFactsByTargetId,
    coverageByTargetId,
    seriesIds: contract.seriesIds,
  });
}

export async function buildMarketWorkbenchFromRefreshContract(
  repos: WorkbenchRefreshRepositories,
  contract: MarketWorkbenchRefreshContract,
): Promise<MarketWorkbenchResponse> {
  const targets = await repos.monitorTargetRepository.findActiveSubreddits();
  const targetIds = targets.map((target) => target.id);
  const breakoutContentFromIso = new Date(
    new Date(contract.fromIso).getTime() - 24 * 60 * 60 * 1000,
  ).toISOString();
  const fromDay = toUtcDay(contract.fromIso);
  const toDay = toUtcDay(contract.toIso);

  const [
    latestTrendPoints,
    latestDailyFacts,
    breakoutFactsGroups,
    breakoutContentsGroups,
    anomalyGroups,
    liveHealthGroups,
    coverageGroups,
    liveCursorGroups,
    backfillCursorGroups,
  ] = await Promise.all([
    repos.subredditTrendPointRepository.listLatestByTargetsInRange({
      targetIds,
      from: contract.fromIso,
      to: contract.toIso,
    }),
    repos.subredditDailyFactRepository.listLatestByTargetsInRange({
      targetIds,
      fromDay,
      toDay,
    }),
    Promise.all(
      targets.map((target) =>
        repos.postGrowthFactRepository.listTopByTargetInRange({
          targetId: target.id,
          fromIso: contract.fromIso,
          toIso: contract.toIso,
          limit: 1,
        }),
      ),
    ),
    Promise.all(
      targets.map((target) =>
        repos.contentRepository.findByTargetCreatedAtRange({
          targetId: target.id,
          from: breakoutContentFromIso,
          to: contract.toIso,
          limit: 250,
        }),
      ),
    ),
    Promise.all(
      targets.map((target) =>
        repos.anomalyEventRepository.listByTargetInRange({
          targetId: target.id,
          fromIso: contract.fromIso,
          toIso: contract.toIso,
          limit: contract.anomalyLimit,
        }),
      ),
    ),
    Promise.all(
      targets.map((target) =>
        repos.providerHealthWindowRepository?.listByTargetInRange({
          targetId: target.id,
          from: contract.fromIso,
          to: contract.toIso,
          mode: "live",
        }) ?? Promise.resolve([]),
      ),
    ),
    Promise.all(
      targets.map((target) =>
        repos.subredditCollectionCoverageRepository?.listByTargetInRange({
          targetId: target.id,
          fromDay,
          toDay,
        }) ?? Promise.resolve([]),
      ),
    ),
    Promise.all(
      targets.map((target) =>
        repos.crawlCursorRepository?.list({
          targetId: target.id,
          mode: "live",
        }) ?? Promise.resolve([]),
      ),
    ),
    Promise.all(
      targets.map((target) =>
        repos.crawlCursorRepository?.list({
          targetId: target.id,
          mode: "backfill",
        }) ?? Promise.resolve([]),
      ),
    ),
  ]);

  const latestDailyFactsByTargetId = new Map<string, SubredditDailyFact>(
    latestDailyFacts.map((fact) => [fact.targetId, fact] as const),
  );
  const latestCoverageByTargetId = new Map<string, SubredditCollectionCoverage | undefined>();
  const liveCursorByTargetId = new Map<string, CrawlCursor | null>();
  const backfillCursorByTargetId = new Map<string, CrawlCursor | null>();
  const latestLiveHealthByTargetId = new Map<string, ProviderHealthWindow | undefined>();
  const breakoutFactsByTargetId = new Map<
    string,
    Awaited<ReturnType<PostGrowthFactRepository["listTopByTargetInRange"]>>
  >();
  const breakoutContentsByTargetId = new Map<
    string,
    Awaited<ReturnType<ContentRepository["findByTargetCreatedAtRange"]>>
  >();
  const anomalyEventsByTargetId = new Map<
    string,
    Awaited<ReturnType<AnomalyEventRepository["listByTargetInRange"]>>
  >();

  for (const [index, target] of targets.entries()) {
    latestCoverageByTargetId.set(target.id, coverageGroups[index]?.at(-1));
    liveCursorByTargetId.set(target.id, liveCursorGroups[index]?.[0] ?? null);
    backfillCursorByTargetId.set(target.id, backfillCursorGroups[index]?.[0] ?? null);
    latestLiveHealthByTargetId.set(target.id, liveHealthGroups[index]?.at(-1));
    breakoutFactsByTargetId.set(target.id, breakoutFactsGroups[index] ?? []);
    breakoutContentsByTargetId.set(target.id, breakoutContentsGroups[index] ?? []);
    anomalyEventsByTargetId.set(target.id, anomalyGroups[index] ?? []);
  }

  return buildMarketWorkbenchReadModel({
    requestId: contract.requestId,
    generatedAtIso: contract.generatedAtIso,
    fromIso: contract.fromIso,
    toIso: contract.toIso,
    targets,
    latestTrendPoints,
    latestDailyFactsByTargetId,
    latestCoverageByTargetId,
    liveCursorByTargetId,
    backfillCursorByTargetId,
    latestLiveHealthByTargetId,
    breakoutFactsByTargetId,
    breakoutContentsByTargetId,
    anomalyEventsByTargetId,
    rankingLimit: contract.rankingLimit,
    breakoutLimit: contract.breakoutLimit,
    anomalyLimit: contract.anomalyLimit,
  });
}

export async function buildTargetWorkbenchFromRefreshContract(
  repos: WorkbenchRefreshRepositories,
  contract: TargetWorkbenchRefreshContract,
): Promise<TargetWorkbenchResponse | { code: "target_not_found"; canonicalName: string }> {
  const target = await repos.monitorTargetRepository.findByCanonicalName(contract.canonicalName);
  if (!target) {
    return {
      code: "target_not_found",
      canonicalName: contract.canonicalName,
    };
  }

  const explicitQueryTexts = contract.normalizedQueries.map((query) => query.normalizedQueryText);
  const queryScopes =
    contract.normalizedQueries.length > 0
      ? Array.from(new Set(contract.normalizedQueries.map((query) => query.queryScope)))
      : undefined;
  const tracks =
    contract.normalizedQueries.length > 0 ? (["explicit_query"] as const) : undefined;
  const fromDay = toUtcDay(contract.fromIso);
  const toDay = toUtcDay(contract.toIso);
  const [
    dailyFacts,
    trendPoints,
    keywordDailyRows,
    postGrowthFacts,
    contents,
    capturedContents,
    anomalyEvents,
    providerHealthWindows,
    collectionCoverage,
    liveCursor,
    backfillCursor,
    queryMatchesByContentId,
  ] = await Promise.all([
    repos.subredditDailyFactRepository.listByTargetInRange({
      targetId: target.id,
      fromDay,
      toDay,
    }),
    repos.subredditTrendPointRepository.listByTargetInRange({
      targetId: target.id,
      from: contract.fromIso,
      to: contract.toIso,
    }),
    repos.keywordTrendDailyRepository?.listByTargetInRange({
      targetId: target.id,
      fromDay,
      toDay,
      keywords: explicitQueryTexts,
      tracks: tracks ? [...tracks] : undefined,
      queryScopes,
      limit: contract.keywordLimit,
    }) ?? Promise.resolve([]),
    repos.postGrowthFactRepository.listTopByTargetInRange({
      targetId: target.id,
      fromIso: contract.fromIso,
      toIso: contract.toIso,
      limit: contract.driverLimit,
    }),
    repos.contentRepository.findByTargetCreatedAtRange({
      targetId: target.id,
      from: contract.fromIso,
      to: contract.toIso,
      limit: Math.max(contract.driverLimit * 5, 100),
    }),
    repos.contentRepository.findByTargetFirstSeenAtRange({
      targetId: target.id,
      from: contract.fromIso,
      to: contract.toIso,
      limit: 20_000,
      totalEligibleOnly: false,
    }),
    repos.anomalyEventRepository.listByTargetInRange({
      targetId: target.id,
      fromIso: contract.fromIso,
      toIso: contract.toIso,
      limit: contract.anomalyLimit,
    }),
    repos.providerHealthWindowRepository?.listByTargetInRange({
      targetId: target.id,
      from: contract.fromIso,
      to: contract.toIso,
      mode: "live",
    }) ?? Promise.resolve([]),
    repos.subredditCollectionCoverageRepository?.listByTargetInRange({
      targetId: target.id,
      fromDay,
      toDay,
    }) ?? Promise.resolve([]),
    repos.crawlCursorRepository
      ?.list({
        targetId: target.id,
        mode: "live",
      })
      .then((rows) => rows[0] ?? null) ?? Promise.resolve(null),
    repos.crawlCursorRepository
      ?.list({
        targetId: target.id,
        mode: "backfill",
      })
      .then((rows) => rows[0] ?? null) ?? Promise.resolve(null),
    resolveDriverKeywordMatches({
      postSearchDocumentRepository: repos.postSearchDocumentRepository,
      normalizedQueries: contract.normalizedQueries,
      canonicalName: contract.canonicalName,
      fromIso: new Date(new Date(contract.fromIso).getTime() - 24 * 60 * 60 * 1000).toISOString(),
      toIso: contract.toIso,
      limit: Math.max(contract.driverLimit * 10, 200),
    }),
  ]);
  const capturedLatestEngagements =
    repos.postEngagementRepository && capturedContents.length > 0
      ? await repos.postEngagementRepository.listLatestByContentIdsInRange({
          contentIds: capturedContents.map((content) => content.id),
          from: "1970-01-01T00:00:00.000Z",
          to: contract.toIso,
        })
      : [];

  return buildTargetWorkbenchReadModel({
    requestId: contract.requestId,
    generatedAtIso: contract.generatedAtIso,
    target,
    fromIso: contract.fromIso,
    toIso: contract.toIso,
    timeframe: contract.timeframe,
    rangePreset: contract.rangePreset,
    dailyFacts,
    trendPoints,
    keywordDailyRows,
    postGrowthFacts,
    contents,
    capturedContents,
    capturedLatestEngagements,
    anomalyEvents,
    providerHealthWindows,
    collectionCoverage,
    liveCursor,
    backfillCursor,
    keywords: explicitQueryTexts,
    normalizedQueries: contract.normalizedQueries.map((query) => ({
      raw: query.raw,
      normalizedQueryText: query.normalizedQueryText,
      queryScope: query.queryScope,
      scopeCanonicalSubreddit: query.scopeCanonicalSubreddit,
    })),
    matchedQueriesByContentId: queryMatchesByContentId,
    keywordLimit: contract.keywordLimit,
    driverLimit: contract.driverLimit,
    anomalyLimit: contract.anomalyLimit,
  });
}

function toUtcDay(iso: string): string {
  return iso.slice(0, 10);
}
