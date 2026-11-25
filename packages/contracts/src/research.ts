import { Type, type Static } from "@sinclair/typebox";
import { DateTime, Id, Kind, Platform, SourceLocalePattern } from "./common";

export const ResearchTimeBasis = Type.Union([
  Type.Literal("published"),
  Type.Literal("collected"),
]);

export const ResearchBucket = Type.Union([
  Type.Literal("6h"),
  Type.Literal("day"),
]);

export const AnalysisScopeInput = Type.Object(
  {
    targetKeys: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { maxItems: 100 })),
    sourceIds: Type.Optional(Type.Array(Id, { maxItems: 100 })),
    batchIds: Type.Optional(Type.Array(Id, { maxItems: 200 })),
    from: Type.Optional(DateTime),
    to: Type.Optional(DateTime),
    timeBasis: Type.Optional(ResearchTimeBasis),
    platforms: Type.Optional(Type.Array(Platform, { maxItems: 10 })),
    kinds: Type.Optional(Type.Array(Kind, { maxItems: 10 })),
    communities: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 120 }), { maxItems: 50 })),
    languages: Type.Optional(Type.Array(Type.String({ pattern: SourceLocalePattern }), { maxItems: 20 })),
    signal: Type.Optional(Type.Union([Type.Literal("discussion"), Type.Literal("pain")])),
    threadAware: Type.Optional(Type.Boolean()),
    bucket: Type.Optional(ResearchBucket),
    includeUndated: Type.Optional(Type.Boolean()),
    lang: Type.Optional(Type.Union([Type.Literal("zh"), Type.Literal("en")])),
  },
  { additionalProperties: false },
);

export type AnalysisScopeRequest = Static<typeof AnalysisScopeInput>;

export interface ResearchBatchNode {
  batchId: string;
  jobId: string | null;
  sourceId: string;
  sourceLabel: string;
  platform: "reddit" | "x" | "bluesky" | "web";
  provider: string;
  deliveryMode: string;
  label: string;
  itemCount: number;
  visibility: "private" | "shared";
  status: "enabled" | "disabled" | "removed" | "source_linked";
  createdAt: string;
}

export interface ResearchTargetGroup {
  key: string;
  label: string;
  targetType: string;
  platforms: Array<"reddit" | "x" | "bluesky" | "web">;
  sourceIds: string[];
  batchCount: number;
  totalBatchItems: number;
  batches: ResearchBatchNode[];
}

export interface ResearchScopeTreeResponse {
  project: {
    id: string;
    name: string;
    description: string | null;
    datasetMode: "batch" | "source_filter";
    visibility: "private" | "shared";
    revision: number;
    threadAware: boolean;
    includePushInTrends: boolean;
    canEdit: boolean;
  };
  dataVersion: string;
  targetGroups: ResearchTargetGroup[];
  availablePlatforms: Array<{ platform: "reddit" | "x" | "bluesky" | "web"; count: number }>;
  availableKinds: Array<{ kind: "post" | "comment" | "article"; count: number }>;
  availableCommunities: Array<{ community: string; count: number }>;
  availableLanguages: Array<{ language: string; count: number }>;
  dateBounds: {
    minPublishedAt: string | null;
    maxPublishedAt: string | null;
    minCollectedAt: string | null;
    maxCollectedAt: string | null;
    totalCount: number;
    undatedCount: number;
  };
}

export interface NormalizedAnalysisScope {
  emptySelection: boolean;
  selectedTargetKeys: string[];
  selectedSourceIds: string[];
  selectedBatchIds: string[];
  from: string | null;
  to: string | null;
  timeBasis: "published" | "collected";
  platforms: Array<"reddit" | "x" | "bluesky" | "web">;
  kinds: Array<"post" | "comment" | "article">;
  communities: string[];
  languages: string[];
  signal: "discussion" | "pain" | null;
  threadAware: boolean;
  bucket: "6h" | "day";
  includeUndated: boolean;
}

export interface AnalysisMethodology {
  dedupBasis: "canonical_content_id" | "thread_root_anchor";
  groupingBasis:
    | "none"
    | "time_bucket"
    | "collection_target"
    | "platform"
    | "community"
    | "kind"
    | "engagement"
    | "term"
    | "matrix"
    | "sentiment"
    | "topic";
  denominatorLabel: string;
  denominatorValue: number;
  multiMembershipAllowed: boolean;
  notes: string[];
}

export interface AnalysisCoverage {
  model: "stored_sample" | "partial_sample" | "empty_scope";
  label: string;
  datedCount: number;
  undatedCount: number;
  isCompleteScope: boolean;
}

export interface AnalysisEvidenceRef {
  filterPatch: Record<string, unknown>;
  label: string;
}

export interface AnalysisBlock<TData = unknown> {
  analysisId: string;
  methodVersion: string;
  projectId: string;
  scope: NormalizedAnalysisScope;
  dataVersion: string;
  sampleCount: number;
  coverage: AnalysisCoverage;
  methodology: AnalysisMethodology;
  summaryText: string;
  summaryBullets: string[];
  data: TData;
  evidence?: AnalysisEvidenceRef;
  generatedAt: string;
  status: "ok" | "empty" | "error";
}

export interface L1ScaleData {
  deduplicatedContentCount: number;
  threadAnchorCount: number;
  postsCount: number;
  commentsCount: number;
  articlesCount: number;
  sourcesCount: number;
  communitiesCount: number;
  authorsCount: number;
  reportedPlatformCommentsSum: number;
  undatedCount: number;
  multiTargetOverlapCount: number;
}

export interface L1TrendPoint {
  bucket: string;
  totalCount: number;
  postsCount: number;
  commentsCount: number;
  articlesCount: number;
  byPlatform: Array<{ platform: "reddit" | "x" | "bluesky" | "web"; count: number }>;
}

export interface L1KeywordRow {
  targetKey: string;
  label: string;
  targetType: string;
  platforms: Array<"reddit" | "x" | "bluesky" | "web">;
  contentCount: number;
  postsCount: number;
  commentsCount: number;
  articlesCount: number;
  sharePct: number;
  exclusiveCount: number;
  overlapCount: number;
}

export interface L1PlatformRow {
  platform: "reddit" | "x" | "bluesky" | "web";
  contentCount: number;
  postsCount: number;
  commentsCount: number;
  articlesCount: number;
  sharePct: number;
}

export interface L1SourceRankingItem {
  key: string;
  label: string;
  kind: "community" | "source";
  platform: "reddit" | "x" | "bluesky" | "web" | "mixed";
  contentCount: number;
  postsCount: number;
  commentsCount: number;
  sharePct: number;
  avgEngagementScore: number;
}

export interface L1KindRow {
  platform: "reddit" | "x" | "bluesky" | "web";
  postsCount: number;
  commentsCount: number;
  articlesCount: number;
  totalCount: number;
}

export interface L1PlatformEngagementSummary {
  platform: "reddit" | "x" | "bluesky" | "web";
  sampleCount: number;
  postCount: number;
  primaryMetricLabel: string;
  totalPrimaryMetric: number;
  avgPrimaryMetric: number;
  reportedRepliesSum: number;
  collectedCommentsCount: number;
  totalViews: number | null;
  totalReposts: number | null;
  avgEngagementScore: number;
  avgDiscussionRatio: number;
}

export interface L1RepresentativeItem {
  id: string;
  platform: "reddit" | "x" | "bluesky" | "web";
  kind: "post" | "comment" | "article";
  externalId: string;
  title: string | null;
  cleanExcerpt: string | null;
  url: string | null;
  authorHandle: string | null;
  communityName: string | null;
  publishedAt: string | null;
  metricScore: number | null;
  metricLikes: number | null;
  metricComments: number | null;
  metricViews: number | null;
  metricReposts: number | null;
  engagementScore: number;
  intentTag: string | null;
  targetLabels: string[];
}

export interface L1OverviewResponse {
  projectId: string;
  projectName: string;
  dataVersion: string;
  generatedAt: string;
  scope: NormalizedAnalysisScope;
  analyses: {
    scale: AnalysisBlock<L1ScaleData>;
    trend: AnalysisBlock<{ points: L1TrendPoint[]; bucket: "6h" | "day"; undatedCount: number }>;
    keywords: AnalysisBlock<{ rows: L1KeywordRow[]; deduplicatedTotal: number; overlapTotal: number }>;
    platforms: AnalysisBlock<{ rows: L1PlatformRow[]; deduplicatedTotal: number }>;
    sources: AnalysisBlock<{
      communities: L1SourceRankingItem[];
      collectionSources: L1SourceRankingItem[];
      deduplicatedTotal: number;
    }>;
    kinds: AnalysisBlock<{
      byPlatform: L1KindRow[];
      totals: { posts: number; comments: number; articles: number; total: number };
    }>;
    engagement: AnalysisBlock<{
      platforms: L1PlatformEngagementSummary[];
      reportedVsCollected: { reportedPlatformComments: number; collectedComments: number };
    }>;
    topContent: AnalysisBlock<{ items: L1RepresentativeItem[]; totalInScope: number }>;
  };
}

// ============================================================================
// Phase 2: L2 (Topics & Comparison) & L3 (Deep Research Tasks & Cache)
// ============================================================================

export const L2ComparisonInput = Type.Object(
  {
    ...(AnalysisScopeInput.properties),
    compareMode: Type.Optional(Type.Union([Type.Literal("target"), Type.Literal("batch")])),
    topN: Type.Optional(Type.Integer({ minimum: 5, maximum: 50 })),
    windowSplitAt: Type.Optional(Type.String({ format: "date-time" })),
    anomalySensitivity: Type.Optional(
      Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]),
    ),
  },
  { additionalProperties: false },
);
export type L2ComparisonRequest = Static<typeof L2ComparisonInput>;

export interface L2TermItem {
  term: string;
  termCount: number;
  docCount: number;
  sharePct: number;
  avgScore?: number;
}

export interface L2CooccurrenceData {
  terms: string[];
  cells: Array<{ termA: string; termB: string; coCount: number; lift: number }>;
  topPairs: Array<{ termA: string; termB: string; coCount: number; lift: number }>;
}

export interface L2ObjectComparisonRow {
  objectKey: string;
  label: string;
  objectType: string;
  contentCount: number;
  postsCount: number;
  commentsCount: number;
  sharePct: number;
  exclusiveCount: number;
  overlapCount: number;
  avgEngagementScore: number;
  reportedCommentsSum: number;
}

export interface L2MultiSeriesTrendPoint {
  bucket: string;
  series: Array<{ objectKey: string; label: string; count: number; sharePct: number }>;
  totalCount: number;
}

export interface L2MatrixCell {
  objectKey: string;
  objectLabel: string;
  colKey: string;
  colLabel: string;
  count: number;
  sharePct: number;
}

export interface L2GroupDistinctiveItem {
  objectKey: string;
  label: string;
  contentCount: number;
  distinctiveTerms: Array<{ term: string; score: number; docCount: number; inGroupPct: number; restPct: number }>;
}

export interface L2OverlapCell {
  rowKey: string;
  rowLabel: string;
  colKey: string;
  colLabel: string;
  intersectionCount: number;
  unionCount: number;
  jaccardPct: number;
}

export interface L2WindowCompareRow {
  metric: string;
  label: string;
  previousValue: number;
  currentValue: number;
  delta: number | null;
  deltaPct: number | null;
  status: "up" | "down" | "flat" | "new" | "unknown";
}

export interface L2HotTermSeries {
  term: string;
  totalDocCount: number;
  growthPct: number | null;
  points: Array<{ bucket: string; count: number }>;
}

export interface L2AnomalyPoint {
  bucket: string;
  count: number;
  baselineAvg: number;
  zScore: number;
  isAnomaly: boolean;
  direction: "spike" | "drop" | "normal";
  topTerms: string[];
  topItemIds: string[];
}

export interface L2WindowTermShift {
  term: string;
  beforeCount: number;
  afterCount: number;
  beforeSharePct: number;
  afterSharePct: number;
  deltaPctPoints: number;
  direction: "rising" | "falling";
}

export interface L2ComparisonResponse {
  projectId: string;
  projectName: string;
  dataVersion: string;
  cacheStatus: "hit" | "miss";
  sampledCount: number;
  totalInScope: number;
  isSampled: boolean;
  generatedAt: string;
  scope: NormalizedAnalysisScope;
  compareMode: "target" | "batch";
  analyses: {
    unigrams: AnalysisBlock<{ items: L2TermItem[] }>;
    bigrams: AnalysisBlock<{ items: L2TermItem[] }>;
    trigrams: AnalysisBlock<{ items: L2TermItem[] }>;
    tfidf: AnalysisBlock<{ items: L2TermItem[] }>;
    cooccurrence: AnalysisBlock<L2CooccurrenceData>;
    objectCounts: AnalysisBlock<{ rows: L2ObjectComparisonRow[]; deduplicatedTotal: number }>;
    objectTrends: AnalysisBlock<{ points: L2MultiSeriesTrendPoint[]; objects: Array<{ key: string; label: string }> }>;
    objectPlatformMatrix: AnalysisBlock<{ rows: Array<{ key: string; label: string }>; cols: Array<{ key: string; label: string }>; cells: L2MatrixCell[] }>;
    objectCommunityMatrix: AnalysisBlock<{ rows: Array<{ key: string; label: string }>; cols: Array<{ key: string; label: string }>; cells: L2MatrixCell[] }>;
    objectDistinctiveTerms: AnalysisBlock<{ groups: L2GroupDistinctiveItem[] }>;
    overlapMatrix: AnalysisBlock<{ objects: Array<{ key: string; label: string; count: number }>; cells: L2OverlapCell[] }>;
    windowComparison: AnalysisBlock<{
      splitAt: string;
      beforeLabel: string;
      afterLabel: string;
      beforeCount: number;
      afterCount: number;
      metrics: L2WindowCompareRow[];
    }>;
    hotTermTrends: AnalysisBlock<{ buckets: string[]; series: L2HotTermSeries[] }>;
    anomalyDetection: AnalysisBlock<{
      sensitivity: "low" | "medium" | "high";
      thresholdZ: number;
      anomalyCount: number;
      points: L2AnomalyPoint[];
    }>;
    windowTermShifts: AnalysisBlock<{
      splitAt: string;
      rising: L2WindowTermShift[];
      falling: L2WindowTermShift[];
    }>;
  };
}

export const ResearchTaskType = Type.Union([
  Type.Literal("sentiment"),
  Type.Literal("topic_modeling"),
]);
export type ResearchTaskTypeValue = Static<typeof ResearchTaskType>;

export const ResearchTaskStatus = Type.Union([
  Type.Literal("queued"),
  Type.Literal("running"),
  Type.Literal("succeeded"),
  Type.Literal("failed"),
  Type.Literal("cancelled"),
]);
export type ResearchTaskStatusValue = Static<typeof ResearchTaskStatus>;

export const CreateResearchTaskInput = Type.Object(
  {
    taskType: ResearchTaskType,
    scope: AnalysisScopeInput,
    config: Type.Optional(
      Type.Object(
        {
          sampleLimit: Type.Optional(Type.Integer({ minimum: 20, maximum: 20000 })),
          numTopics: Type.Optional(Type.Integer({ minimum: 2, maximum: 12 })),
          maxVocab: Type.Optional(Type.Integer({ minimum: 50, maximum: 1500 })),
          languageMode: Type.Optional(Type.Union([Type.Literal("auto"), Type.Literal("zh"), Type.Literal("en")])),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
export type CreateResearchTaskRequest = Static<typeof CreateResearchTaskInput>;

export interface L3SentimentDistribution {
  label: "positive" | "neutral" | "negative" | "unclassified";
  count: number;
  sharePct: number;
}

export interface L3SentimentSummary {
  taskType: "sentiment";
  algorithmVersion: string;
  sampleCount: number;
  classifiedCount: number;
  unclassifiedCount: number;
  counts: L3SentimentDistribution[];
  trend: Array<{
    bucket: string;
    positive: number;
    neutral: number;
    negative: number;
    unclassified: number;
  }>;
  byPlatform: Array<{
    platform: "reddit" | "x" | "bluesky" | "web";
    positive: number;
    neutral: number;
    negative: number;
    unclassified: number;
    total: number;
  }>;
  byTarget: Array<{
    targetKey: string;
    targetLabel: string;
    positive: number;
    neutral: number;
    negative: number;
    unclassified: number;
    total: number;
  }>;
  exemplars: Array<{
    contentId: string;
    label: "positive" | "neutral" | "negative";
    score: number;
    title: string | null;
    excerpt: string;
    platform: "reddit" | "x" | "bluesky" | "web";
  }>;
  summaryText: string;
  summaryBullets: string[];
}

export interface L3TopicItem {
  topicIndex: number;
  label: string;
  topTerms: Array<{ term: string; weight: number }>;
  docCount: number;
  sharePct: number;
  avgScore: number;
  representativeIds: string[];
  representativeExcerpts: Array<{ contentId: string; title: string | null; excerpt: string; platform: string }>;
}

export interface L3TopicSummary {
  taskType: "topic_modeling";
  algorithmVersion: string;
  sampleCount: number;
  vocabularySize: number;
  numTopics: number;
  unassignedCount: number;
  topics: L3TopicItem[];
  byTarget: Array<{
    targetKey: string;
    targetLabel: string;
    topicCounts: Array<{ topicIndex: number; count: number; sharePct: number }>;
  }>;
  summaryText: string;
  summaryBullets: string[];
}

export interface L3ResearchTaskRecord {
  id: string;
  projectId: string;
  taskType: ResearchTaskTypeValue;
  status: ResearchTaskStatusValue;
  dataVersion: string;
  isStale: boolean;
  algorithmVersion: string;
  sampleLimit: number;
  sampleCount: number;
  progressPct: number;
  progressStage: string;
  scope: NormalizedAnalysisScope;
  config: Record<string, unknown>;
  summary: L3SentimentSummary | L3TopicSummary | null;
  errorMessage: string | null;
  retryCount: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export const ResearchTaskParams = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    taskId: Type.String({ format: "uuid" }),
  },
  { additionalProperties: false },
);

export const ResearchTaskEvidenceQuery = Type.Object(
  {
    sentiment: Type.Optional(
      Type.Union([
        Type.Literal("positive"),
        Type.Literal("neutral"),
        Type.Literal("negative"),
        Type.Literal("unclassified"),
      ]),
    ),
    topicIndex: Type.Optional(Type.Integer({ minimum: 0, maximum: 20 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 5000 })),
  },
  { additionalProperties: false },
);
