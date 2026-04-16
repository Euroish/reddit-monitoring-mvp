export interface ApiHealthResponse {
  ok: boolean;
  requestId: string;
  service: "reddit-monitoring-mvp";
  nowIso: string;
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
  rankings: {
    byHeat: MarketTrendRankItem[];
    bySurge: MarketTrendRankItem[];
    byDispersion: MarketTrendRankItem[];
  };
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
    totalNewPosts: number;
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

export interface ApiErrorResponse {
  ok: false;
  requestId: string;
  error: string;
  errorCode: string;
}
