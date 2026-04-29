import { buildAnomalyEventsJob } from "../jobs/build-anomaly-events.job";
import { buildPostGrowthFactsJob } from "../jobs/build-post-growth-facts.job";
import { buildSubredditCollectionCoverageJob } from "../jobs/build-subreddit-collection-coverage.job";
import { buildSubredditDailyFactsJob } from "../jobs/build-subreddit-daily-facts.job";
import { buildSubredditKeywordTrendDailyJob } from "../jobs/build-subreddit-keyword-trend-daily.job";
import { buildSubredditTrendPointsJob } from "../jobs/build-subreddit-trend-points.job";
import type { ContentRepository } from "../domain/repositories/content-repository";
import type { CrawlCursorRepository } from "../domain/repositories/crawl-cursor-repository";
import type { KeywordTrendDailyRepository } from "../domain/repositories/keyword-trend-daily-repository";
import type { MetricsSnapshotRepository } from "../domain/repositories/metrics-snapshot-repository";
import type { PostEngagementRepository } from "../domain/repositories/post-engagement-repository";
import type { PostGrowthFactRepository } from "../domain/repositories/post-growth-fact-repository";
import type { ProviderHealthWindowRepository } from "../domain/repositories/provider-health-window-repository";
import type { SubredditCollectionCoverageRepository } from "../domain/repositories/subreddit-collection-coverage-repository";
import type { SubredditDailyFactRepository } from "../domain/repositories/subreddit-daily-fact-repository";
import type { SubredditTrendPointRepository } from "../domain/repositories/subreddit-trend-point-repository";
import type { AnomalyEventRepository } from "../domain/repositories/anomaly-event-repository";

export interface Phase1MaterializationRepositories {
  contentRepository: ContentRepository;
  metricsSnapshotRepository: MetricsSnapshotRepository;
  postEngagementRepository: PostEngagementRepository;
  subredditDailyFactRepository: SubredditDailyFactRepository;
  subredditCollectionCoverageRepository?: SubredditCollectionCoverageRepository;
  crawlCursorRepository?: CrawlCursorRepository;
  providerHealthWindowRepository?: ProviderHealthWindowRepository;
  postGrowthFactRepository?: PostGrowthFactRepository;
  keywordTrendDailyRepository?: KeywordTrendDailyRepository;
  anomalyEventRepository?: AnomalyEventRepository;
  subredditTrendPointRepository: SubredditTrendPointRepository;
}

export interface Phase1MaterializationRanges {
  dailyFactFromIso: string;
  coverageFromIso: string;
  trendFromIso: string;
  postGrowthFromIso: string;
  keywordFromIso: string;
}

export interface MaterializeTargetAnalyticsArgs {
  repos: Phase1MaterializationRepositories;
  targetId: string;
  canonicalSubreddit?: string;
  crawlMode: "live" | "backfill";
  nowIso: string;
  generatedAtIso?: string;
  ranges: Phase1MaterializationRanges;
  explicitQueries?: string[];
  keywordDailyQualityMinScore?: number;
  keywordDailyQualityMinComments?: number;
  keywordDailyMaxKeywordsPerDay?: number;
}

export async function materializeTargetAnalytics(
  args: MaterializeTargetAnalyticsArgs,
): Promise<void> {
  await buildSubredditDailyFactsJob(
    {
      contentRepository: args.repos.contentRepository,
      metricsSnapshotRepository: args.repos.metricsSnapshotRepository,
      postEngagementRepository: args.repos.postEngagementRepository,
      subredditDailyFactRepository: args.repos.subredditDailyFactRepository,
    },
    {
      targetId: args.targetId,
      fromIso: args.ranges.dailyFactFromIso,
      toIso: args.nowIso,
    },
  );

  if (args.repos.subredditCollectionCoverageRepository) {
    await buildSubredditCollectionCoverageJob(
      {
        contentRepository: args.repos.contentRepository,
        subredditDailyFactRepository: args.repos.subredditDailyFactRepository,
        subredditCollectionCoverageRepository: args.repos.subredditCollectionCoverageRepository,
        crawlCursorRepository: args.repos.crawlCursorRepository,
        providerHealthWindowRepository: args.repos.providerHealthWindowRepository,
      },
      {
        targetId: args.targetId,
        fromIso: args.ranges.coverageFromIso,
        toIso: args.nowIso,
        generatedAtIso: args.generatedAtIso ?? args.nowIso,
      },
    );
  }

  await buildSubredditTrendPointsJob(
    {
      metricsSnapshotRepository: args.repos.metricsSnapshotRepository,
      postEngagementRepository: args.repos.postEngagementRepository,
      subredditTrendPointRepository: args.repos.subredditTrendPointRepository,
      subredditDailyFactRepository: args.repos.subredditDailyFactRepository,
    },
    {
      targetId: args.targetId,
      fromIso: args.ranges.trendFromIso,
      toIso: args.nowIso,
    },
  );

  if (args.repos.postGrowthFactRepository) {
    await buildPostGrowthFactsJob(
      {
        contentRepository: args.repos.contentRepository,
        metricsSnapshotRepository: args.repos.metricsSnapshotRepository,
        postEngagementRepository: args.repos.postEngagementRepository,
        postGrowthFactRepository: args.repos.postGrowthFactRepository,
      },
      {
        targetId: args.targetId,
        fromIso: args.ranges.postGrowthFromIso,
        toIso: args.nowIso,
      },
    );
  }

  if (args.repos.keywordTrendDailyRepository) {
    await buildSubredditKeywordTrendDailyJob(
      {
        contentRepository: args.repos.contentRepository,
        metricsSnapshotRepository: args.repos.metricsSnapshotRepository,
        postEngagementRepository: args.repos.postEngagementRepository,
        keywordTrendDailyRepository: args.repos.keywordTrendDailyRepository,
        subredditDailyFactRepository: args.repos.subredditDailyFactRepository,
      },
      {
        targetId: args.targetId,
        canonicalSubreddit: args.canonicalSubreddit,
        explicitQueries: args.explicitQueries,
        fromIso: args.ranges.keywordFromIso,
        toIso: args.nowIso,
        qualityMinScore: args.keywordDailyQualityMinScore,
        qualityMinComments: args.keywordDailyQualityMinComments,
        maxKeywordsPerDay: args.keywordDailyMaxKeywordsPerDay,
        sourceType: args.crawlMode,
      },
    );
  }

  if (args.repos.anomalyEventRepository) {
    await buildAnomalyEventsJob(
      {
        anomalyEventRepository: args.repos.anomalyEventRepository,
        subredditTrendPointRepository: args.repos.subredditTrendPointRepository,
        subredditDailyFactRepository: args.repos.subredditDailyFactRepository,
        keywordTrendDailyRepository: args.repos.keywordTrendDailyRepository,
        postGrowthFactRepository: args.repos.postGrowthFactRepository,
      },
      {
        targetId: args.targetId,
        fromIso: args.ranges.trendFromIso,
        toIso: args.nowIso,
      },
    );
  }
}
