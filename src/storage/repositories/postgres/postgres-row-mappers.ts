import type { Account } from "../../../domain/entities/account";
import type { AnomalyEvent } from "../../../domain/entities/anomaly-event";
import type { CollectionJob } from "../../../domain/entities/collection-job";
import type { Content } from "../../../domain/entities/content";
import type { CrawlCursor } from "../../../domain/entities/crawl-cursor";
import type {
  KeywordPulsePoint5m,
  KeywordQuerySamplePost,
  KeywordQuerySession,
} from "../../../domain/entities/keyword-query-session";
import type { MetricsSnapshot } from "../../../domain/entities/metrics-snapshot";
import type { MonitorTarget } from "../../../domain/entities/monitor-target";
import type { PostSearchDocument } from "../../../domain/entities/post-search-document";
import type { PostGrowthFact } from "../../../domain/entities/post-growth-fact";
import type { ProviderHealthWindow } from "../../../domain/entities/provider-health-window";
import type { SubredditDailyFact } from "../../../domain/entities/subreddit-daily-fact";
import type { SubredditTrendPoint } from "../../../domain/entities/subreddit-trend-point";
import type { KeywordTrendDaily } from "../../../domain/entities/keyword-trend-daily";

export interface MonitorTargetRow {
  id: string;
  target_type: "subreddit";
  external_id: string | null;
  canonical_name: string;
  status: "active" | "paused";
  config_json: Record<string, unknown>;
  created_at: string | Date;
  updated_at: string | Date;
}

export interface AccountRow {
  id: string;
  external_id: string;
  username: string;
  is_deleted: boolean;
  created_at_source: string | Date | null;
  first_seen_at: string | Date;
  last_seen_at: string | Date;
}

export interface ContentRow {
  id: string;
  target_id: string;
  account_id: string | null;
  external_id: string;
  kind: "post";
  title: string;
  body_text: string | null;
  url: string | null;
  permalink: string;
  created_at_source: string | Date;
  first_seen_at: string | Date;
  last_seen_at: string | Date;
}

export interface MetricsSnapshotRow {
  id: number;
  snapshot_at: string | Date;
  target_id: string;
  content_id: string | null;
  granularity: "15m" | "1h" | "6h" | "1d";
  metric_name:
    | "subscribers"
    | "active_users"
    | "new_posts_15m"
    | "score"
    | "num_comments"
    | "upvote_ratio";
  metric_value: string | number;
  collection_job_id: string;
  created_at: string | Date;
}

export interface CollectionJobRow {
  id: string;
  target_id: string;
  job_type: "collect_subreddit_about" | "collect_subreddit_new_posts" | "build_subreddit_trend_points";
  crawl_mode: "live" | "backfill" | null;
  payload: Record<string, unknown> | null;
  status: "queued" | "running" | "succeeded" | "failed" | "retrying" | "dead_letter";
  scheduled_at: string | Date;
  started_at: string | Date | null;
  finished_at: string | Date | null;
  cursor: string | null;
  dedupe_key: string;
  retry_count: number;
  next_run_at: string | Date | null;
  dead_lettered_at: string | Date | null;
  error_message: string | null;
}

export interface CrawlCursorRow {
  provider: string;
  target_id: string;
  mode: "live" | "backfill";
  cursor: string;
  rewind_cursor: string | null;
  last_fetched_at: string | Date | null;
  updated_at: string | Date;
}

export interface SubredditTrendPointRow {
  target_id: string;
  window_start: string | Date;
  window_end: string | Date;
  granularity: "15m" | "1h" | "6h" | "1d";
  new_posts: number;
  active_users: number | null;
  subscribers: number | null;
  score_sum: number;
  comment_sum: number;
  high_score_post_count: number;
  sampled_post_count: number;
  active_post_ratio: string | number;
  delta_new_posts_vs_prev_window: number;
  delta_active_users_vs_prev_window: number;
  heat_change_pct: string | number;
  heat_index: string | number;
  surge_score: string | number;
  dispersion_score: string | number;
  velocity_score: string | number;
  acceleration_score: string | number;
  baseline_deviation_score: string | number;
  change_score: string | number;
  anomaly_score: string | number;
  trend_score: string | number;
  algorithm_version: string;
  algorithm_params: Record<string, unknown>;
  sample_count: number;
  window_complete: boolean;
  build_job_id: string | null;
  score_components: Record<string, unknown>;
}

export interface KeywordTrendDailyRow {
  target_id: string;
  day: string | Date;
  keyword: string;
  track: "auto_keyword" | "explicit_query";
  normalized_query_text: string;
  query_scope: "subreddit" | "global";
  sampled_posts: number;
  matched_posts: number;
  qualified_matched_posts: number;
  mention_rate: string | number;
  qualified_mention_rate: string | number;
  matched_score_sum: number;
  matched_comment_sum: number;
  keyword_heat: string | number;
  algorithm_version: string;
  explain_payload: Record<string, unknown>;
  source_type: "live" | "backfill";
  updated_at: string | Date;
}

export interface SubredditDailyFactRow {
  target_id: string;
  day: string | Date;
  post_volume: number;
  qualified_post_volume: number;
  sampled_post_volume: number;
  score_sum: number;
  comment_sum: number;
  subscriber_count: number;
  active_user_count: number;
  active_post_ratio: string | number;
  dispersion_score: string | number;
  impact_score_sum: string | number;
  impact_post_volume: number;
  top_impact_share: string | number;
  heat_price: string | number;
  heat_change_pct: string | number;
  ema7: string | number;
  ema30: string | number;
  subreddit_tier: "micro" | "small" | "mid" | "large";
  quality_threshold_score: number;
  quality_threshold_comments: number;
  algorithm_version: string;
  explain_payload: Record<string, unknown>;
  updated_at: string | Date;
}

export interface PostGrowthFactRow {
  target_id: string;
  content_id: string;
  age_bucket: "1h" | "6h" | "24h";
  observed_at: string | Date;
  age_minutes: number;
  score: number;
  comments: number;
  score_velocity_per_hour: string | number;
  comment_velocity_per_hour: string | number;
  cohort_post_count: number;
  cohort_median_score_velocity: string | number;
  cohort_median_comment_velocity: string | number;
  velocity_z_score: string | number;
  driver_score: string | number;
  algorithm_version: string;
  explain_payload: Record<string, unknown>;
  updated_at: string | Date;
}

export interface AnomalyEventRow {
  target_id: string;
  signal_type: "volume" | "quality" | "keyword" | "driver";
  signal_key: string;
  observed_at: string | Date;
  window_start: string | Date | null;
  window_end: string | Date | null;
  anomaly_score: string | number;
  algorithm_version: string;
  explain_payload: Record<string, unknown>;
  updated_at: string | Date;
}

export interface PostSearchDocumentRow {
  content_id: string;
  target_id: string;
  canonical_subreddit: string;
  title: string;
  body_snippet: string | null;
  permalink: string;
  created_at_source: string | Date;
  match_score?: string | number;
}

export interface KeywordQuerySessionRow {
  id: string;
  query_text: string;
  normalized_query_text: string;
  canonical_subreddit: string | null;
  status: "queued" | "initial_ready" | "live_refreshing" | "degraded" | "completed";
  coverage_level: "low" | "medium" | "high";
  support_count: number;
  confidence_level: "low" | "medium" | "high";
  mention_rate: string | number;
  qualified_mention_rate: string | number;
  source_type_summary: Record<string, number>;
  degraded_reason: string | null;
  explain_payload: Record<string, unknown>;
  created_at: string | Date;
  updated_at: string | Date;
}

export interface KeywordQuerySamplePostRow {
  query_id: string;
  content_id: string;
  rank: number;
  match_score: string | number;
  source_type: "index" | "live" | "backfill";
  data_quality: "low" | "medium" | "high";
  canonical_subreddit: string;
  title: string;
  permalink: string;
  created_at_source: string | Date;
}

export interface KeywordPulsePoint5mRow {
  query_id: string;
  bucket_start: string | Date;
  bucket_end: string | Date;
  source_type: "index" | "live" | "backfill";
  mention_count: number;
  qualified_mention_count: number;
  mention_rate: string | number;
  qualified_mention_rate: string | number;
  data_quality: "low" | "medium" | "high";
  representative_samples: KeywordQuerySamplePostRow[] | null;
  updated_at: string | Date;
}

export interface ProviderHealthWindowRow {
  provider: string;
  target_id: string;
  mode: "live" | "backfill";
  window_start: string | Date;
  request_count: number;
  success_count: number;
  empty_response_count: number;
  fallback_count: number;
  candidate_count: number;
  accepted_count: number;
  filtered_out_count: number;
  duplicate_post_count: number;
  ingest_lag_seconds_sum: string | number;
  ingest_lag_sample_count: number;
  provider_diff_count: number;
  provider_diff_sample_count: number;
  error_count: number;
  rate_limit_count: number;
  timeout_count: number;
  circuit_open_count: number;
  last_status_code: number | null;
  last_error_code: string | null;
  last_error_message: string | null;
  updated_at: string | Date;
}

function toIso(value: string | Date | null | undefined): string | undefined {
  if (value == null) {
    return undefined;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}

export function mapMonitorTarget(row: MonitorTargetRow): MonitorTarget {
  return {
    id: row.id,
    source: "reddit",
    targetType: row.target_type,
    externalId: row.external_id ?? undefined,
    canonicalName: row.canonical_name,
    status: row.status,
    config: row.config_json ?? {},
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

export function mapAccount(row: AccountRow): Account {
  return {
    id: row.id,
    source: "reddit",
    externalId: row.external_id,
    username: row.username,
    isDeleted: row.is_deleted,
    createdAtSource: toIso(row.created_at_source),
    firstSeenAt: toIso(row.first_seen_at)!,
    lastSeenAt: toIso(row.last_seen_at)!,
  };
}

export function mapContent(row: ContentRow): Content {
  return {
    id: row.id,
    source: "reddit",
    targetId: row.target_id,
    accountId: row.account_id ?? undefined,
    externalId: row.external_id,
    kind: row.kind,
    title: row.title,
    bodyText: row.body_text ?? undefined,
    url: row.url ?? undefined,
    permalink: row.permalink,
    createdAtSource: toIso(row.created_at_source)!,
    firstSeenAt: toIso(row.first_seen_at)!,
    lastSeenAt: toIso(row.last_seen_at)!,
  };
}

export function mapMetricsSnapshot(row: MetricsSnapshotRow): MetricsSnapshot {
  return {
    id: row.id,
    snapshotAt: toIso(row.snapshot_at)!,
    source: "reddit",
    targetId: row.target_id,
    contentId: row.content_id ?? undefined,
    granularity: row.granularity,
    metricName: row.metric_name,
    metricValue: Number(row.metric_value),
    collectionJobId: row.collection_job_id,
    createdAt: toIso(row.created_at),
  };
}

export function mapCollectionJob(row: CollectionJobRow): CollectionJob {
  return {
    id: row.id,
    source: "reddit",
    targetId: row.target_id,
    jobType: row.job_type,
    crawlMode: row.crawl_mode ?? undefined,
    payload: row.payload ?? undefined,
    status: row.status,
    scheduledAt: toIso(row.scheduled_at)!,
    startedAt: toIso(row.started_at),
    finishedAt: toIso(row.finished_at),
    cursor: row.cursor ?? undefined,
    dedupeKey: row.dedupe_key,
    retryCount: row.retry_count,
    nextRunAt: toIso(row.next_run_at),
    deadLetteredAt: toIso(row.dead_lettered_at),
    errorMessage: row.error_message ?? undefined,
  };
}

export function mapCrawlCursor(row: CrawlCursorRow): CrawlCursor {
  return {
    provider: row.provider,
    targetId: row.target_id,
    mode: row.mode,
    cursor: row.cursor,
    rewindCursor: row.rewind_cursor ?? undefined,
    lastFetchedAt: toIso(row.last_fetched_at),
    updatedAt: toIso(row.updated_at)!,
  };
}

export function mapSubredditTrendPoint(row: SubredditTrendPointRow): SubredditTrendPoint {
  return {
    targetId: row.target_id,
    windowStart: toIso(row.window_start)!,
    windowEnd: toIso(row.window_end)!,
    granularity: row.granularity,
    newPosts: row.new_posts,
    activeUsers: row.active_users ?? undefined,
    subscribers: row.subscribers ?? undefined,
    scoreSum: row.score_sum,
    commentSum: row.comment_sum,
    highScorePostCount: row.high_score_post_count,
    sampledPostCount: row.sampled_post_count,
    activePostRatio: Number(row.active_post_ratio),
    deltaNewPostsVsPrevWindow: row.delta_new_posts_vs_prev_window,
    deltaActiveUsersVsPrevWindow: row.delta_active_users_vs_prev_window,
    heatChangePct: Number(row.heat_change_pct),
    heatIndex: Number(row.heat_index),
    surgeScore: Number(row.surge_score),
    dispersionScore: Number(row.dispersion_score),
    velocityScore: Number(row.velocity_score),
    accelerationScore: Number(row.acceleration_score),
    baselineDeviationScore: Number(row.baseline_deviation_score),
    changeScore: Number(row.change_score),
    anomalyScore: Number(row.anomaly_score),
    trendScore: Number(row.trend_score),
    algorithmVersion: row.algorithm_version,
    algorithmParams: row.algorithm_params,
    sampleCount: row.sample_count,
    windowComplete: row.window_complete,
    buildJobId: row.build_job_id ?? undefined,
    scoreComponents: row.score_components,
  };
}

export function mapKeywordTrendDaily(row: KeywordTrendDailyRow): KeywordTrendDaily {
  return {
    targetId: row.target_id,
    day: toIso(row.day)!.slice(0, 10),
    keyword: row.keyword,
    track: row.track,
    normalizedQueryText: row.normalized_query_text,
    queryScope: row.query_scope,
    sampledPosts: row.sampled_posts,
    matchedPosts: row.matched_posts,
    qualifiedMatchedPosts: row.qualified_matched_posts,
    mentionRate: Number(row.mention_rate),
    qualifiedMentionRate: Number(row.qualified_mention_rate),
    matchedScoreSum: row.matched_score_sum,
    matchedCommentSum: row.matched_comment_sum,
    keywordHeat: Number(row.keyword_heat),
    algorithmVersion: row.algorithm_version,
    explainPayload: row.explain_payload ?? {},
    sourceType: row.source_type,
    updatedAt: toIso(row.updated_at),
  };
}

export function mapSubredditDailyFact(row: SubredditDailyFactRow): SubredditDailyFact {
  return {
    targetId: row.target_id,
    day: toIso(row.day)!.slice(0, 10),
    postVolume: row.post_volume,
    qualifiedPostVolume: row.qualified_post_volume,
    sampledPostVolume: row.sampled_post_volume,
    scoreSum: row.score_sum,
    commentSum: row.comment_sum,
    subscriberCount: row.subscriber_count,
    activeUserCount: row.active_user_count,
    activePostRatio: Number(row.active_post_ratio),
    dispersionScore: Number(row.dispersion_score),
    impactScoreSum: Number(row.impact_score_sum),
    impactPostVolume: row.impact_post_volume,
    topImpactShare: Number(row.top_impact_share),
    heatPrice: Number(row.heat_price),
    heatChangePct: Number(row.heat_change_pct),
    ema7: Number(row.ema7),
    ema30: Number(row.ema30),
    subredditTier: row.subreddit_tier,
    qualityThresholdScore: row.quality_threshold_score,
    qualityThresholdComments: row.quality_threshold_comments,
    algorithmVersion: row.algorithm_version,
    explainPayload: row.explain_payload ?? {},
    updatedAt: toIso(row.updated_at),
  };
}

export function mapPostGrowthFact(row: PostGrowthFactRow): PostGrowthFact {
  return {
    targetId: row.target_id,
    contentId: row.content_id,
    ageBucket: row.age_bucket,
    observedAt: toIso(row.observed_at)!,
    ageMinutes: row.age_minutes,
    score: row.score,
    comments: row.comments,
    scoreVelocityPerHour: Number(row.score_velocity_per_hour),
    commentVelocityPerHour: Number(row.comment_velocity_per_hour),
    cohortPostCount: row.cohort_post_count,
    cohortMedianScoreVelocity: Number(row.cohort_median_score_velocity),
    cohortMedianCommentVelocity: Number(row.cohort_median_comment_velocity),
    velocityZScore: Number(row.velocity_z_score),
    driverScore: Number(row.driver_score),
    algorithmVersion: row.algorithm_version,
    explainPayload: row.explain_payload ?? {},
    updatedAt: toIso(row.updated_at),
  };
}

export function mapPostSearchDocument(row: PostSearchDocumentRow): PostSearchDocument {
  return {
    contentId: row.content_id,
    targetId: row.target_id,
    canonicalSubreddit: row.canonical_subreddit,
    title: row.title,
    bodySnippet: row.body_snippet ?? undefined,
    permalink: row.permalink,
    createdAtSource: toIso(row.created_at_source)!,
    matchScore:
      row.match_score === undefined ? undefined : Number(row.match_score),
  };
}

export function mapKeywordQuerySession(row: KeywordQuerySessionRow): KeywordQuerySession {
  return {
    id: row.id,
    queryText: row.query_text,
    normalizedQueryText: row.normalized_query_text,
    canonicalSubreddit: row.canonical_subreddit ?? undefined,
    status: row.status,
    coverageLevel: row.coverage_level,
    supportCount: row.support_count,
    confidenceLevel: row.confidence_level,
    mentionRate: Number(row.mention_rate),
    qualifiedMentionRate: Number(row.qualified_mention_rate),
    sourceTypeSummary: row.source_type_summary ?? {},
    degradedReason: row.degraded_reason ?? undefined,
    explainPayload: row.explain_payload ?? {},
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

export function mapAnomalyEvent(row: AnomalyEventRow): AnomalyEvent {
  return {
    targetId: row.target_id,
    signalType: row.signal_type,
    signalKey: row.signal_key,
    observedAt: toIso(row.observed_at)!,
    windowStart: row.window_start ? toIso(row.window_start)! : undefined,
    windowEnd: row.window_end ? toIso(row.window_end)! : undefined,
    anomalyScore: Number(row.anomaly_score),
    algorithmVersion: row.algorithm_version,
    explainPayload: row.explain_payload ?? {},
    updatedAt: toIso(row.updated_at)!,
  };
}

export function mapKeywordQuerySamplePost(
  row: KeywordQuerySamplePostRow,
): KeywordQuerySamplePost {
  return {
    queryId: row.query_id,
    contentId: row.content_id,
    rank: row.rank,
    matchScore: Number(row.match_score),
    sourceType: row.source_type,
    dataQuality: row.data_quality,
    canonicalSubreddit: row.canonical_subreddit,
    title: row.title,
    permalink: row.permalink,
    createdAtSource: toIso(row.created_at_source)!,
  };
}

export function mapKeywordPulsePoint5m(row: KeywordPulsePoint5mRow): KeywordPulsePoint5m {
  return {
    queryId: row.query_id,
    bucketStart: toIso(row.bucket_start)!,
    bucketEnd: toIso(row.bucket_end)!,
    sourceType: row.source_type,
    mentionCount: row.mention_count,
    qualifiedMentionCount: row.qualified_mention_count,
    mentionRate: Number(row.mention_rate),
    qualifiedMentionRate: Number(row.qualified_mention_rate),
    dataQuality: row.data_quality,
    representativeSamples: (row.representative_samples ?? []).map(mapKeywordQuerySamplePost),
    updatedAt: toIso(row.updated_at)!,
  };
}

export function mapProviderHealthWindow(row: ProviderHealthWindowRow): ProviderHealthWindow {
  return {
    provider: row.provider,
    targetId: row.target_id,
    mode: row.mode,
    windowStart: toIso(row.window_start)!,
    requestCount: row.request_count,
    successCount: row.success_count,
    emptyResponseCount: row.empty_response_count,
    fallbackCount: row.fallback_count,
    candidateCount: row.candidate_count,
    acceptedCount: row.accepted_count,
    filteredOutCount: row.filtered_out_count,
    duplicatePostCount: row.duplicate_post_count,
    ingestLagSecondsSum: Number(row.ingest_lag_seconds_sum),
    ingestLagSampleCount: row.ingest_lag_sample_count,
    providerDiffCount: row.provider_diff_count,
    providerDiffSampleCount: row.provider_diff_sample_count,
    errorCount: row.error_count,
    rateLimitCount: row.rate_limit_count,
    timeoutCount: row.timeout_count,
    circuitOpenCount: row.circuit_open_count,
    lastStatusCode: row.last_status_code ?? undefined,
    lastErrorCode: row.last_error_code ?? undefined,
    lastErrorMessage: row.last_error_message ?? undefined,
    updatedAt: toIso(row.updated_at)!,
  };
}
