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
import type { ProviderHealthWindowRepository } from "../../../domain/repositories/provider-health-window-repository";
import type { SubredditDailyFactRepository } from "../../../domain/repositories/subreddit-daily-fact-repository";
import type { RawEventRepository } from "../../../domain/repositories/raw-event-repository";
import type { SubredditTrendPointRepository } from "../../../domain/repositories/subreddit-trend-point-repository";
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
import { PostgresProviderHealthWindowRepository } from "./postgres-provider-health-window.repository";
import { PostgresRawEventRepository } from "./postgres-raw-event.repository";
import { PostgresSubredditDailyFactRepository } from "./postgres-subreddit-daily-fact.repository";
import { PostgresSubredditTrendPointRepository } from "./postgres-subreddit-trend-point.repository";

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
  metricsSnapshotRepository: MetricsSnapshotRepository;
  subredditDailyFactRepository: SubredditDailyFactRepository;
  subredditTrendPointRepository: SubredditTrendPointRepository;
  providerHealthWindowRepository: ProviderHealthWindowRepository;
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
    metricsSnapshotRepository: new PostgresMetricsSnapshotRepository(db),
    subredditDailyFactRepository: new PostgresSubredditDailyFactRepository(db),
    subredditTrendPointRepository: new PostgresSubredditTrendPointRepository(db),
    providerHealthWindowRepository: new PostgresProviderHealthWindowRepository(db),
  };
}
