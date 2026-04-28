export interface ApiHealthResponse {
  ok: boolean;
  requestId: string;
  service: "reddit-monitoring-mvp";
  nowIso: string;
}

export type AppUserRole = "owner" | "admin" | "viewer";
export type AppUserStatus = "pending" | "active" | "disabled";

export interface AuthUserView {
  id: string;
  email: string;
  displayName?: string;
  role: AppUserRole;
  status: AppUserStatus;
}

export interface AuthLoginRequest {
  email: string;
  password: string;
}

export interface AuthLoginResponse {
  ok: true;
  requestId: string;
  user: AuthUserView;
}

export interface AuthMeResponse {
  ok: true;
  requestId: string;
  user: AuthUserView;
}

export interface AuthLogoutResponse {
  ok: true;
  requestId: string;
}

export interface CreateInviteRequest {
  roleOnAccept?: AppUserRole;
  maxUses?: number;
  expiresAt?: string;
}

export interface CreateInviteResponse {
  ok: true;
  requestId: string;
  invite: {
    id: string;
    roleOnAccept: AppUserRole;
    maxUses: number;
    usedCount: number;
    expiresAt?: string;
    createdAt: string;
  };
  code: string;
}

export interface RegisterAppUserRequest {
  email: string;
  password: string;
  inviteCode: string;
  displayName?: string;
}

export interface RegisterAppUserResponse {
  ok: true;
  requestId: string;
  user: AuthUserView;
}

export type CrawlMode = "live" | "backfill";

export interface ApiReadinessQueueBucket {
  backlog: number;
  scheduled: number;
  running: number;
  deadLetter: number;
}

export interface ApiReadinessResponse {
  ok: boolean;
  requestId: string;
  service: "reddit-monitoring-mvp";
  nowIso: string;
  status: "ready" | "degraded" | "not_ready";
  checks: {
    storage: "ok" | "error";
    queue: "ok" | "degraded" | "error";
  };
  queue: ApiReadinessQueueBucket & {
    byMode: {
      live: ApiReadinessQueueBucket;
      backfill: ApiReadinessQueueBucket;
      default: ApiReadinessQueueBucket;
    };
  };
  observability: {
    fetchSuccessRate: number | null;
    fallbackRate: number | null;
    emptyWindowRate: number | null;
    duplicatePostRate: number | null;
    ingestLagSeconds: number | null;
    providerDiffRate: number | null;
    errorRate: number | null;
    rateLimitRate: number | null;
    timeoutRate: number | null;
    circuitOpenRate: number | null;
    providerSwitchShare: number | null;
    cursorStallRate: number | null;
    cursorLagSecondsMax: number | null;
    dailyFactCoverageRate: number | null;
    dailyFactLagDaysMax: number | null;
    scraplingEvidence: {
      requestCount: number;
      sessionKeyObservedRate: number | null;
      sessionKeyReuseRate: number | null;
      byProfile: Array<{
        profile: "http" | "dynamic" | "stealth";
        requestCount: number;
      }>;
    };
    routingPolicy: {
      defaultLiveProvider: "http" | "scrapling" | null;
      targetCount: number;
      promotedScraplingTargetCount: number;
      demotedHttpTargetCount: number;
      byProvider: Array<{
        provider: string;
        targetCount: number;
      }>;
      byScraplingProfile: Array<{
        profile: "http" | "dynamic" | "stealth";
        targetCount: number;
      }>;
    };
    byProvider: Array<{
      provider: string;
      mode: CrawlMode;
      fetchSuccessRate: number | null;
      fallbackRate: number | null;
      emptyWindowRate: number | null;
      duplicatePostRate: number | null;
      ingestLagSeconds: number | null;
      providerDiffRate: number | null;
      errorRate: number | null;
      rateLimitRate: number | null;
      timeoutRate: number | null;
      circuitOpenRate: number | null;
      providerSwitchShare: number | null;
      cursorStallRate: number | null;
      cursorLagSecondsMax: number | null;
    }>;
  };
  activeSessions: number;
  activeTargets: number;
  degradedReasons: string[];
}

export interface ApiStorageTableStatResponse {
  tableName: string;
  rowEstimate: number;
  tableBytes: number;
  indexBytes: number;
  totalBytes: number;
}

export interface ApiStorageObservabilityResponse {
  ok: true;
  requestId: string;
  service: "reddit-monitoring-mvp";
  capturedAtIso: string;
  databaseSizeBytes: number;
  tables: ApiStorageTableStatResponse[];
}

export interface CreateSubredditTargetRequest {
  subreddit: string;
}

export interface CreateSubredditTargetResponse {
  ok: boolean;
  requestId: string;
  targetId: string;
  canonicalName: string;
}

export type RunMode = "mock" | "live";

export interface TriggerPhase1RunRequest {
  subreddit?: string;
  mode?: RunMode;
  crawlMode?: CrawlMode;
  async?: boolean;
  postLimit?: number;
  backfillPostLimit?: number;
  backfillMaxIterationsPerTarget?: number;
  backfillTargetDays?: number;
}

export interface TriggerPhase1RunResponse {
  ok: boolean;
  requestId: string;
  mode: RunMode;
  crawlMode: CrawlMode;
  nowIso: string;
  subreddit?: string;
  requestedCanonicalNames: string[];
  processedCanonicalNames: string[];
}

export type KeywordQueryStatus =
  | "queued"
  | "initial_ready"
  | "live_refreshing"
  | "degraded"
  | "completed";

export type CoverageLevel = "low" | "medium" | "high";
export type ConfidenceLevel = "low" | "medium" | "high";
export type KeywordQuerySourceType = "index" | "live" | "backfill";
export type DataQualityLevel = "low" | "medium" | "high";

export interface KeywordQuerySamplePostView {
  rank: number;
  contentId: string;
  sourceType: KeywordQuerySourceType;
  dataQuality: DataQualityLevel;
  canonicalSubreddit: string;
  title: string;
  permalink: string;
  createdAtSource: string;
  matchScore: number;
}

export interface KeywordQueryDataQualityView {
  level: DataQualityLevel;
  coverageLevel: CoverageLevel;
  confidenceLevel: ConfidenceLevel;
  supportCount: number;
  mentionRate: number;
  qualifiedMentionRate: number;
  degradedReason?: string;
}

export interface KeywordQueryPulsePoint5mView {
  bucketStart: string;
  bucketEnd: string;
  sourceType: KeywordQuerySourceType;
  mentionCount: number;
  qualifiedMentionCount: number;
  mentionRate: number;
  qualifiedMentionRate: number;
  dataQuality: DataQualityLevel;
  representativeSamples: KeywordQuerySamplePostView[];
  updatedAt: string;
}

export interface KeywordQueryView {
  queryId: string;
  queryText: string;
  normalizedQueryText: string;
  canonicalSubreddit?: string;
  status: KeywordQueryStatus;
  coverageLevel: CoverageLevel;
  supportCount: number;
  confidenceLevel: ConfidenceLevel;
  mentionRate: number;
  qualifiedMentionRate: number;
  sourceType: {
    primary: KeywordQuerySourceType;
    breakdown: Record<string, number>;
  };
  dataQuality: KeywordQueryDataQualityView;
  sourceTypeSummary: Record<string, number>;
  coverage: {
    scope: "observed_corpus";
    label: string;
    description: string;
    observedDocumentCount: number;
    matchedDocumentCount: number;
    seededDocumentCount: number;
  };
  degradedReason?: string;
  explainPayload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  samplePosts: KeywordQuerySamplePostView[];
  pulsePoints5m: KeywordQueryPulsePoint5mView[];
}

export interface CreateKeywordQueryRequest {
  query: string;
  subreddit?: string;
  limit?: number;
}

export interface CreateKeywordQueryResponse {
  ok: true;
  requestId: string;
  result: KeywordQueryView;
}

export interface GetKeywordQueryResponse {
  ok: true;
  requestId: string;
  result: KeywordQueryView;
}

export interface SubredditTrendResponse {
  ok: boolean;
  requestId: string;
  generatedAtIso: string;
  targetId: string;
  canonicalName: string;
  fromIso: string;
  toIso: string;
  timeline: {
    granularity: "6h";
    windowMinutes: 360;
    comparison: "previous_window";
    pointCount: number;
  };
  summary: {
    pointCount: number;
    latestWindowStart: string | null;
    latestWindowEnd: string | null;
    latestTrendScore: number | null;
    latestHeatIndex: number | null;
    latestSurgeScore: number | null;
    latestDispersionScore: number | null;
    latestTrendDirection: "rising" | "flat" | "falling" | "unknown";
  };
  topMovers: Array<{
    windowStart: string;
    windowEnd: string;
    deltaNewPostsVsPrevWindow: number;
    heatChangePct: number;
    heatIndex: number;
    surgeScore: number;
    trendScore: number;
  }>;
  recentAnomalies: Array<{
    windowStart: string;
    windowEnd: string;
    heatIndex: number;
    surgeScore: number;
    anomalyScore: number;
    trendScore: number;
  }>;
  points: Array<{
    windowStart: string;
    windowEnd: string;
    newPosts: number;
    scoreSum?: number;
    commentSum?: number;
    highScorePostCount?: number;
    sampledPostCount?: number;
    activePostRatio?: number;
    deltaNewPostsVsPrevWindow: number;
    deltaActiveUsersVsPrevWindow: number;
    heatChangePct?: number;
    heatIndex?: number;
    surgeScore?: number;
    dispersionScore?: number;
    trendScore: number;
    velocityScore?: number;
    accelerationScore?: number;
    baselineDeviationScore?: number;
    changeScore?: number;
    anomalyScore?: number;
    algorithmVersion?: string;
    sampleCount?: number;
    windowComplete?: boolean;
    scoreComponents?: Record<string, unknown>;
  }>;
  recentPosts: Array<{
    id: string;
    externalId: string;
    title: string;
    permalink: string;
    createdAtSource: string;
    url?: string;
    bodySnippet?: string;
  }>;
}

export interface MarketTrendRankItem {
  targetId: string;
  canonicalName: string;
  windowStart: string;
  windowEnd: string;
  newPosts: number;
  sampledPostCount: number;
  heatIndex: number;
  heatChangePct: number;
  surgeScore: number;
  dispersionScore: number;
  trendScore: number;
}

export interface MarketTrendResponse {
  ok: true;
  requestId: string;
  generatedAtIso: string;
  fromIso: string;
  toIso: string;
  targetCount: number;
  coverage: {
    scope: "monitored_targets";
    label: string;
    description: string;
    monitoredTargetCount: number;
  };
  rankings: {
    byHeat: MarketTrendRankItem[];
    bySurge: MarketTrendRankItem[];
    byDispersion: MarketTrendRankItem[];
  };
}

export interface MarketWorkbenchBreakoutItem {
  targetId: string;
  canonicalName: string;
  observedAt: string;
  ageBucket: "1h" | "6h" | "24h";
  driverScore: number;
  velocityZScore: number;
  title: string;
  permalink: string;
  createdAtSource: string;
  labels: string[];
}

export interface MarketWorkbenchAnomalyItem {
  targetId: string;
  canonicalName: string;
  eventId: string;
  signalType: AnomalySignalType;
  signalKey: string;
  observedAt: string;
  anomalyScore: number;
  severity: AnomalySeverity;
}

export interface MarketWorkbenchTargetStatusItem {
  targetId: string;
  canonicalName: string;
  status: "active" | "paused";
  latestObservedDay?: string;
  latestObservedPosts?: number;
  latestQualifiedPosts?: number;
  latestHeatIndex?: number;
  latestTrendScore?: number;
  latestCoverageDay?: string;
  latestCoverageStatus?: "complete" | "partial" | "source_limited" | "unknown";
  latestCoverageBasis?:
    | "live_continuous"
    | "backfill_reached_day_start"
    | "terminal_eof_reached"
    | "iteration_budget_exhausted"
    | "cursor_saturated"
    | "missed_live_window"
    | "rate_limited"
    | "observed_without_proof"
    | "no_collection_evidence";
  lastLiveFetchedAt?: string;
  lastBackfillFetchedAt?: string;
  stale: boolean;
  live: {
    status: "missing" | "partial" | "complete" | "source_limited";
    provider?: string;
    requestedFromIso?: string;
    oldestObservedAt?: string;
    newestObservedAt?: string;
    listingHorizonHit?: boolean;
    observedHourSpan?: number;
    updatedAt?: string;
  };
  backfill: {
    status:
      | "missing"
      | "progressing"
      | "covered"
      | "source_limited"
      | "saturated_before_15d";
    stopReason?:
      | "awaiting_progress"
      | "coverage_reached"
      | "terminal_eof"
      | "cursor_saturated"
      | "iteration_budget_exhausted";
    provider?: string;
    targetFromIso?: string;
    oldestObservedAt?: string;
    newestObservedAt?: string;
    observedDaySpan?: number;
    updatedAt?: string;
  };
  reliability: {
    provider: string | null;
    mode: CrawlMode | null;
    requestCount: number;
    successCount: number;
    errorCount: number;
    timeoutCount: number;
    circuitOpenCount: number;
    duplicatePostRate: number | null;
    ingestLagSecondsAvg: number | null;
    updatedAt?: string;
  };
}

export interface MarketWorkbenchResponse {
  ok: true;
  requestId: string;
  generatedAtIso: string;
  fromIso: string;
  toIso: string;
  coverage: {
    scope: "monitored_targets";
    label: string;
    description: string;
    monitoredTargetCount: number;
  };
  summary: {
    rankedTargetCount: number;
    breakoutCount: number;
    anomalyCount: number;
  };
  leaders: {
    byHeat: MarketTrendRankItem[];
    bySurge: MarketTrendRankItem[];
    byDispersion: MarketTrendRankItem[];
  };
  targets: MarketWorkbenchTargetStatusItem[];
  breakouts: MarketWorkbenchBreakoutItem[];
  anomalies: MarketWorkbenchAnomalyItem[];
}

export interface SubredditDailyTrendResponse {
  ok: true;
  requestId: string;
  generatedAtIso: string;
  targetId: string;
  canonicalName: string;
  fromIso: string;
  toIso: string;
  dayCount: number;
  daily: Array<{
    day: string;
    observedNewPosts: number;
    observedQualifiedPosts: number;
    totalNewPosts: number | null;
    totalQualifiedPosts: number | null;
    coverageStatus: "complete" | "partial" | "source_limited" | "unknown";
    coverageBasis?:
      | "live_continuous"
      | "backfill_reached_day_start"
      | "terminal_eof_reached"
      | "iteration_budget_exhausted"
      | "cursor_saturated"
      | "missed_live_window"
      | "rate_limited"
      | "observed_without_proof"
      | "no_collection_evidence";
    valueSemantics: "complete_total" | "observed_total" | "missing";
    totalDiscussion: number;
    postChangePct: number;
    discussionChangePct: number;
    postSpikeScore: number;
    isPostSpike: boolean;
    postVolume: number;
    qualifiedPostVolume: number;
    heatPrice: number;
    heatChangePct: number;
    ema7: number;
    ema30: number;
    subscriberCount: number;
    activeUserCount: number;
    subredditTier: "micro" | "small" | "mid" | "large";
    qualityThresholdScore: number;
    qualityThresholdComments: number;
    algorithmVersion?: string;
    explainPayload?: Record<string, unknown>;
  }>;
  keywordHeat: Array<{
    keyword: string;
    track?: "auto_keyword" | "explicit_query";
    queryScope?: "subreddit" | "global";
    totalMentions: number;
    latestDayMentions: number;
    previousDayMentions: number;
    dayChangePct: number;
    spikeScore: number;
    isHot: boolean;
    source?: "materialized_keyword_trend_daily" | "content_fallback";
    algorithmVersion?: string;
    explainPayload?: Record<string, unknown>;
    daily: Array<{
      day: string;
      mentions: number;
    }>;
  }>;
}

export interface GlobalKeywordDailyTrendResponse {
  ok: true;
  requestId: string;
  generatedAtIso: string;
  queryText: string;
  normalizedQueryText: string;
  queryScope: "global";
  fromIso: string;
  toIso: string;
  dayCount: number;
  days: Array<{
    day: string;
    matchedPosts: number;
    qualifiedMatchedPosts: number;
    sampledPosts: number;
    mentionRate: number;
    qualifiedMentionRate: number;
    keywordHeat: number;
    breakoutScore: number;
    isBreakout: boolean;
    matchedSubredditCount: number;
    sourceTypes: Array<"live" | "backfill">;
    algorithmVersion: string | null;
    explainPayload: Record<string, unknown>;
  }>;
}

export interface SubredditDriverPostsResponse {
  ok: true;
  requestId: string;
  generatedAtIso: string;
  targetId: string;
  canonicalName: string;
  fromIso: string;
  toIso: string;
  ageBuckets: Array<"1h" | "6h" | "24h">;
  drivers: Array<{
    id: string;
    externalId: string;
    title: string;
    permalink: string;
    createdAtSource: string;
    url?: string;
    bodySnippet?: string;
    observedAt: string;
    ageBucket: "1h" | "6h" | "24h";
    ageMinutes: number;
    score: number;
    comments: number;
    scoreVelocityPerHour: number;
    commentVelocityPerHour: number;
    velocityZScore: number;
    driverScore: number;
    labels: string[];
    matchedQueries?: string[];
    algorithmVersion: string;
    explainPayload: Record<string, unknown>;
  }>;
}

export interface SubredditAnomalyFeedResponse {
  ok: true;
  requestId: string;
  generatedAtIso: string;
  targetId: string;
  canonicalName: string;
  fromIso: string;
  toIso: string;
  signalTypes: Array<AnomalySignalType>;
  events: Array<{
    eventId: string;
    signalType: AnomalySignalType;
    signalKey: string;
    observedAt: string;
    windowStart?: string;
    windowEnd?: string;
    anomalyScore: number;
    severity: AnomalySeverity;
    algorithmVersion: string;
    explainPayload: SubredditAnomalyFeedExplainPayload;
  }>;
}

export interface SubredditAnomalyIncidentFeedResponse {
  ok: true;
  requestId: string;
  generatedAtIso: string;
  targetId: string;
  canonicalName: string;
  fromIso: string;
  toIso: string;
  signalTypes: Array<AnomalySignalType>;
  incidents: Array<{
    incidentId: string;
    windowStart: string;
    windowEnd: string;
    observedAt: string;
    mergedScore: number;
    severity: AnomalySeverity;
    dominantSignalType: AnomalySignalType;
    signalTypes: Array<AnomalySignalType>;
    signalCount: number;
    algorithmVersion: string;
    explainPayload: SubredditAnomalyIncidentExplainPayload;
  }>;
}

export interface TargetWorkbenchResponse {
  ok: true;
  requestId: string;
  generatedAtIso: string;
  target: {
    targetId: string;
    canonicalName: string;
    displayName: string;
    targetType: "subreddit";
  };
  range: {
    fromIso: string;
    toIso: string;
    grain: "day";
    dayCount: number;
    timeframe: "1d";
    rangePreset?: "7d" | "30d" | "90d";
  };
  availableTimeframes: Array<{
    id: "1d" | "6h" | "1h";
    label: string;
    grain: "day" | "hour";
    enabled: boolean;
    reason?: string;
  }>;
  availableRanges: Array<{
    id: "7d" | "30d" | "90d";
    label: string;
    dayCount: number;
    defaultSelected: boolean;
  }>;
  indicators: Array<{
    id:
      | "heat_price"
      | "ema_7"
      | "ema_30"
      | "activity_index"
      | "qualified_activity_index"
      | "activity_confidence"
      | "observed_new_posts"
      | "observed_qualified_posts"
      | "total_new_posts"
      | "qualified_post_count";
    label: string;
    family: "trend" | "activity";
    unit: "score" | "count";
    defaultVisible: boolean;
    chartType: "line" | "bar";
    axis: "primary" | "secondary";
    description: string;
    algorithmVersion?: string;
  }>;
  series: Array<{
    id:
      | "heat_price"
      | "ema_7"
      | "ema_30"
      | "activity_index"
      | "qualified_activity_index"
      | "activity_confidence"
      | "observed_new_posts"
      | "observed_qualified_posts"
      | "total_new_posts"
      | "qualified_post_count";
    label: string;
    family: "trend" | "activity";
    unit: "score" | "count";
    points: Array<{
      at: string;
      value: number | null;
      quality: "observed" | "observed_zero" | "missing";
      coverageStatus: "complete" | "partial" | "source_limited" | "unknown";
      coverageBasis?:
        | "live_continuous"
        | "backfill_reached_day_start"
        | "terminal_eof_reached"
        | "iteration_budget_exhausted"
        | "cursor_saturated"
        | "missed_live_window"
        | "rate_limited"
        | "observed_without_proof"
        | "no_collection_evidence";
      valueSemantics: "complete_total" | "observed_total" | "missing";
    }>;
  }>;
  overlays: Array<{
    id: string;
    label: string;
    kind: "keyword_heat";
    queryScope: "subreddit" | "global";
    points: Array<{
      at: string;
      value: number;
    }>;
  }>;
  queryContext: {
    requested: Array<{
      raw: string;
      normalizedQueryText: string;
      queryScope: "subreddit" | "global";
      scopeCanonicalSubreddit?: string;
      overlayId?: string;
      hasOverlay: boolean;
      matchedDriverCount: number;
    }>;
  };
  panels: Array<{
    id: "drivers" | "keyword_heat" | "reliability";
    title: string;
    kind: "driver_posts" | "keyword_table" | "provider_reliability";
    defaultOpen: boolean;
  }>;
  annotations: Array<{
    id: string;
    at: string;
    label: string;
    kind: "anomaly";
    severity: AnomalySeverity;
    score: number;
    sourceId: string;
  }>;
  drivers: SubredditDriverPostsResponse["drivers"];
  anomalies: SubredditAnomalyFeedResponse["events"];
  keywordHeat: SubredditDailyTrendResponse["keywordHeat"];
  reliability: {
    provider: string | null;
    mode: CrawlMode | null;
    requestCount: number;
    successCount: number;
    errorCount: number;
    timeoutCount: number;
    circuitOpenCount: number;
    duplicatePostRate: number | null;
    ingestLagSecondsAvg: number | null;
    lastStatusCode?: number;
    lastErrorCode?: string;
    lastErrorMessage?: string;
    updatedAt?: string;
  };
  dataQuality: {
    status: "complete" | "partial" | "empty";
    pointCount: number;
    expectedPointCount: number;
    live: {
      status: "missing" | "partial" | "complete" | "source_limited";
      provider?: string;
      requestedFromIso?: string;
      oldestObservedAt?: string;
      newestObservedAt?: string;
      listingHorizonHit?: boolean;
      observedHourSpan?: number;
      updatedAt?: string;
    };
    backfill: {
      status:
        | "missing"
        | "progressing"
        | "covered"
        | "source_limited"
        | "saturated_before_15d";
      stopReason?:
        | "awaiting_progress"
        | "coverage_reached"
        | "terminal_eof"
        | "cursor_saturated"
        | "iteration_budget_exhausted";
      provider?: string;
      targetFromIso?: string;
      oldestObservedAt?: string;
      newestObservedAt?: string;
      observedDaySpan?: number;
      updatedAt?: string;
    };
    coverage: {
      scope: "materialized_observed_days" | "collection_coverage_days";
      status: "complete" | "partial" | "empty";
      expectedDayCount: number;
      materializedDayCount: number;
      observedPostDayCount: number;
      sampledPostDayCount: number;
      lowObservedPostDayCount: number;
      minObservedPostsPerDay: number;
      observedPostTotal: number;
      observedPostMedian: number;
      firstThirdObservedPostShare: number;
      zeroPostFactDayCount: number;
      zeroSampleFactDayCount: number;
      completeCoverageDayCount?: number;
      partialCoverageDayCount?: number;
      sourceLimitedDayCount?: number;
      unknownCoverageDayCount?: number;
      degradedReasons: string[];
    };
    stale: boolean;
    latestPointAt?: string;
    generatedAtIso: string;
    notes: string[];
  };
}

export type WorkbenchComparableSeriesId =
  | "heat_price"
  | "ema_7"
  | "ema_30"
  | "activity_index"
  | "qualified_activity_index"
  | "activity_confidence"
  | "observed_new_posts"
  | "observed_qualified_posts"
  | "total_new_posts"
  | "qualified_post_count";

export interface TargetComparisonWorkbenchResponse {
  ok: true;
  requestId: string;
  generatedAtIso: string;
  range: {
    fromIso: string;
    toIso: string;
    grain: "day";
    dayCount: number;
    timeframe: "1d";
    rangePreset?: "7d" | "30d" | "90d";
  };
  series: Array<{
    id: WorkbenchComparableSeriesId;
    label: string;
    unit: "score" | "count";
  }>;
  targets: Array<{
    targetId: string;
    canonicalName: string;
    displayName: string;
    targetType: "subreddit";
  }>;
  comparisons: Array<{
    targetId: string;
    canonicalName: string;
    seriesId: WorkbenchComparableSeriesId;
    baselineValue: number | null;
    latestValue: number | null;
    latestNormalizedValue: number | null;
    points: Array<{
      at: string;
      value: number | null;
      normalizedValue: number | null;
      coverageStatus?: "complete" | "partial" | "source_limited" | "unknown";
      coverageBasis?:
        | "live_continuous"
        | "backfill_reached_day_start"
        | "terminal_eof_reached"
        | "iteration_budget_exhausted"
        | "cursor_saturated"
        | "missed_live_window"
        | "rate_limited"
        | "observed_without_proof"
        | "no_collection_evidence";
      valueSemantics?: "complete_total" | "observed_total" | "missing";
    }>;
  }>;
  summary: Array<{
    targetId: string;
    canonicalName: string;
    latestHeatPrice: number | null;
    latestTotalNewPosts: number | null;
    latestQualifiedPostCount: number | null;
  }>;
}

export type SavedWorkbenchViewKind = "target" | "comparison";

export interface SavedWorkbenchViewResponseItem {
  id: string;
  name: string;
  viewKind: SavedWorkbenchViewKind;
  primaryTarget: string;
  compareTargets: string[];
  keywords: string[];
  seriesIds: WorkbenchComparableSeriesId[];
  routePath: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSavedWorkbenchViewRequest {
  name: string;
  viewKind: SavedWorkbenchViewKind;
  primaryTarget: string;
  compareTargets?: string[];
  keywords?: string[];
  seriesIds?: WorkbenchComparableSeriesId[];
  routePath: string;
}

export interface CreateSavedWorkbenchViewResponse {
  ok: true;
  requestId: string;
  view: SavedWorkbenchViewResponseItem;
}

export interface ListSavedWorkbenchViewsResponse {
  ok: true;
  requestId: string;
  views: SavedWorkbenchViewResponseItem[];
}

export type AnomalySignalType = "volume" | "quality" | "keyword" | "driver";
export type AnomalySeverity = "low" | "medium" | "high";

export interface SubredditAnomalyFeedExplainPayload {
  contractVersion: "anomaly_feed_explain_v1";
  signalType: AnomalySignalType;
  signalKey: string;
  observedAt: string;
  windowStart?: string;
  windowEnd?: string;
  anomalyScore: number;
  severity: AnomalySeverity;
  algorithmVersion: string;
  details: Record<string, unknown>;
}

export interface SubredditAnomalyIncidentExplainPayload {
  mergedFromEvents: number;
  signalBreakdown: Record<AnomalySignalType, number>;
  mergeBoostBySignalType: Record<AnomalySignalType, number>;
  maxSourceScore: number;
  mergeBoost: number;
  sourceEvents: Array<{
    eventId: string;
    signalType: AnomalySignalType;
    signalKey: string;
    anomalyScore: number;
    observedAt: string;
    severity: AnomalySeverity;
    algorithmVersion: string;
  }>;
  contractVersion: "anomaly_incident_explain_v1";
  mergeStrategy: "weighted_signal_boost_v1";
}

export interface ApiErrorResponse {
  ok: false;
  requestId: string;
  error: string;
  errorCode: string;
}
