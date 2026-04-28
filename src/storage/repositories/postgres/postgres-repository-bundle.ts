import type { AccountRepository } from "../../../domain/repositories/account-repository";
import type { AppInviteRepository } from "../../../domain/repositories/app-invite-repository";
import type { AppSessionRepository } from "../../../domain/repositories/app-session-repository";
import type { AppUserRepository } from "../../../domain/repositories/app-user-repository";
import type { AnomalyEventRepository } from "../../../domain/repositories/anomaly-event-repository";
import type { CollectionJobRepository } from "../../../domain/repositories/collection-job-repository";
import type { ContentRepository } from "../../../domain/repositories/content-repository";
import type { CrawlCursorRepository } from "../../../domain/repositories/crawl-cursor-repository";
import type { KeywordTrendDailyRepository } from "../../../domain/repositories/keyword-trend-daily-repository";
import type { KeywordQuerySessionRepository } from "../../../domain/repositories/keyword-query-session-repository";
import type { MetricsSnapshotRepository } from "../../../domain/repositories/metrics-snapshot-repository";
import type { MonitorTargetRepository } from "../../../domain/repositories/monitor-target-repository";
import type { PostSearchDocumentRepository } from "../../../domain/repositories/post-search-document-repository";
import type { PostGrowthFactRepository } from "../../../domain/repositories/post-growth-fact-repository";
import type { PostEngagementRepository } from "../../../domain/repositories/post-engagement-repository";
import type { ProviderHealthWindowRepository } from "../../../domain/repositories/provider-health-window-repository";
import type { SavedWorkbenchViewRepository } from "../../../domain/repositories/saved-workbench-view-repository";
import type { SubredditDailyFactRepository } from "../../../domain/repositories/subreddit-daily-fact-repository";
import type { SubredditCollectionCoverageRepository } from "../../../domain/repositories/subreddit-collection-coverage-repository";
import type { RawEventRepository } from "../../../domain/repositories/raw-event-repository";
import type { SubredditTrendPointRepository } from "../../../domain/repositories/subreddit-trend-point-repository";
import type { StorageObservabilityRepository } from "../../../domain/repositories/storage-observability-repository";
import { PostgresClient } from "../../postgres/postgres-client";
import { PostgresAccountRepository } from "./postgres-account.repository";
import { PostgresAppInviteRepository } from "./postgres-app-invite.repository";
import { PostgresAppSessionRepository } from "./postgres-app-session.repository";
import { PostgresAppUserRepository } from "./postgres-app-user.repository";
import { PostgresAnomalyEventRepository } from "./postgres-anomaly-event.repository";
import { PostgresCollectionJobRepository } from "./postgres-collection-job.repository";
import { PostgresContentRepository } from "./postgres-content.repository";
import { PostgresCrawlCursorRepository } from "./postgres-crawl-cursor.repository";
import { PostgresKeywordTrendDailyRepository } from "./postgres-keyword-trend-daily.repository";
import { PostgresKeywordQuerySessionRepository } from "./postgres-keyword-query-session.repository";
import { PostgresMetricsSnapshotRepository } from "./postgres-metrics-snapshot.repository";
import { PostgresMonitorTargetRepository } from "./postgres-monitor-target.repository";
import { PostgresPostSearchDocumentRepository } from "./postgres-post-search-document.repository";
import { PostgresPostGrowthFactRepository } from "./postgres-post-growth-fact.repository";
import { PostgresPostEngagementRepository } from "./postgres-post-engagement.repository";
import { PostgresProviderHealthWindowRepository } from "./postgres-provider-health-window.repository";
import { PostgresRawEventRepository } from "./postgres-raw-event.repository";
import { PostgresSavedWorkbenchViewRepository } from "./postgres-saved-workbench-view.repository";
import { PostgresSubredditDailyFactRepository } from "./postgres-subreddit-daily-fact.repository";
import { PostgresSubredditCollectionCoverageRepository } from "./postgres-subreddit-collection-coverage.repository";
import { PostgresSubredditTrendPointRepository } from "./postgres-subreddit-trend-point.repository";
import { PostgresStorageObservabilityRepository } from "./postgres-storage-observability.repository";

export interface RepositoryBundle {
  monitorTargetRepository: MonitorTargetRepository;
  collectionJobRepository: CollectionJobRepository;
  crawlCursorRepository: CrawlCursorRepository;
  rawEventRepository: RawEventRepository;
  accountRepository: AccountRepository;
  appUserRepository: AppUserRepository;
  appInviteRepository: AppInviteRepository;
  appSessionRepository: AppSessionRepository;
  anomalyEventRepository: AnomalyEventRepository;
  contentRepository: ContentRepository;
  keywordTrendDailyRepository: KeywordTrendDailyRepository;
  keywordQuerySessionRepository: KeywordQuerySessionRepository;
  postSearchDocumentRepository: PostSearchDocumentRepository;
  postGrowthFactRepository: PostGrowthFactRepository;
  postEngagementRepository: PostEngagementRepository;
  metricsSnapshotRepository: MetricsSnapshotRepository;
  subredditDailyFactRepository: SubredditDailyFactRepository;
  subredditCollectionCoverageRepository: SubredditCollectionCoverageRepository;
  subredditTrendPointRepository: SubredditTrendPointRepository;
  providerHealthWindowRepository: ProviderHealthWindowRepository;
  savedWorkbenchViewRepository: SavedWorkbenchViewRepository;
  storageObservabilityRepository: StorageObservabilityRepository;
}

export function createPostgresRepositoryBundle(db: PostgresClient): RepositoryBundle {
  return {
    monitorTargetRepository: new PostgresMonitorTargetRepository(db),
    collectionJobRepository: new PostgresCollectionJobRepository(db),
    crawlCursorRepository: new PostgresCrawlCursorRepository(db),
    rawEventRepository: new PostgresRawEventRepository(db),
    accountRepository: new PostgresAccountRepository(db),
    appUserRepository: new PostgresAppUserRepository(db),
    appInviteRepository: new PostgresAppInviteRepository(db),
    appSessionRepository: new PostgresAppSessionRepository(db),
    anomalyEventRepository: new PostgresAnomalyEventRepository(db),
    contentRepository: new PostgresContentRepository(db),
    keywordTrendDailyRepository: new PostgresKeywordTrendDailyRepository(db),
    keywordQuerySessionRepository: new PostgresKeywordQuerySessionRepository(db),
    postSearchDocumentRepository: new PostgresPostSearchDocumentRepository(db),
    postGrowthFactRepository: new PostgresPostGrowthFactRepository(db),
    postEngagementRepository: new PostgresPostEngagementRepository(db),
    metricsSnapshotRepository: new PostgresMetricsSnapshotRepository(db),
    subredditDailyFactRepository: new PostgresSubredditDailyFactRepository(db),
    subredditCollectionCoverageRepository: new PostgresSubredditCollectionCoverageRepository(db),
    subredditTrendPointRepository: new PostgresSubredditTrendPointRepository(db),
    providerHealthWindowRepository: new PostgresProviderHealthWindowRepository(db),
    savedWorkbenchViewRepository: new PostgresSavedWorkbenchViewRepository(db),
    storageObservabilityRepository: new PostgresStorageObservabilityRepository(db),
  };
}
