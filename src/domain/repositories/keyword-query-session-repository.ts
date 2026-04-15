import type {
  ConfidenceLevel,
  CoverageLevel,
  KeywordPulsePoint5m,
  KeywordQuerySamplePost,
  KeywordQuerySession,
  KeywordQuerySessionStatus,
  KeywordQuerySourceType,
  DataQualityLevel,
} from "../entities/keyword-query-session";

export interface KeywordQuerySessionRecord {
  session: KeywordQuerySession;
  samples: KeywordQuerySamplePost[];
  pulsePoints5m: KeywordPulsePoint5m[];
}

export interface KeywordQueryResultSummary {
  queryId: string;
  bucketStart: string;
  mentionCount: number;
  qualifiedMentionCount: number;
  mentionRate: number;
  qualifiedMentionRate: number;
  sourceType: "index" | "live" | "backfill";
  updatedAt: string;
}

export interface FindReusableKeywordQuerySessionInput {
  normalizedQueryText: string;
  canonicalSubreddit?: string;
  minUpdatedAt: string;
  sampleLimit: number;
  pulsePointLimit: number;
}

export interface KeywordPulsePoint5mUpsertInput {
  queryId: string;
  bucketStart: string;
  bucketEnd: string;
  sourceType: KeywordQuerySourceType;
  mentionCount: number;
  qualifiedMentionCount: number;
  mentionRate: number;
  qualifiedMentionRate: number;
  dataQuality: DataQualityLevel;
  representativeSamples: KeywordQuerySamplePost[];
  updatedAt: string;
}

export interface KeywordQueryResultSummaryTotals {
  mentionCount: number;
  qualifiedMentionCount: number;
}

export interface UpdateKeywordQuerySessionLiveRefreshInput {
  queryId: string;
  status: KeywordQuerySessionStatus;
  coverageLevel: CoverageLevel;
  supportCount: number;
  confidenceLevel: ConfidenceLevel;
  mentionRate: number;
  qualifiedMentionRate: number;
  sourceTypeSummary: Record<string, number>;
  degradedReason?: string;
  explainPayload: Record<string, unknown>;
  updatedAt: string;
}

export interface KeywordQuerySessionRepository {
  createWithSamples(
    session: KeywordQuerySession,
    samples: KeywordQuerySamplePost[],
  ): Promise<void>;
  findById(
    queryId: string,
    sampleLimit: number,
    pulsePointLimit?: number,
  ): Promise<KeywordQuerySessionRecord | null>;
  findReusableSession(
    input: FindReusableKeywordQuerySessionInput,
  ): Promise<KeywordQuerySessionRecord | null>;
  replaceSamples(queryId: string, samples: KeywordQuerySamplePost[]): Promise<void>;
  listLiveRefreshCandidates(args: {
    statuses: KeywordQuerySessionStatus[];
    limit: number;
  }): Promise<KeywordQuerySession[]>;
  upsertResultSummary(summary: KeywordQueryResultSummary): Promise<void>;
  upsertPulsePoint(input: KeywordPulsePoint5mUpsertInput): Promise<void>;
  getResultSummaryTotals(queryId: string): Promise<KeywordQueryResultSummaryTotals>;
  updateLiveRefresh(input: UpdateKeywordQuerySessionLiveRefreshInput): Promise<void>;
  countActiveSessions(args: {
    statuses: KeywordQuerySessionStatus[];
    updatedSinceIso: string;
  }): Promise<number>;
}
