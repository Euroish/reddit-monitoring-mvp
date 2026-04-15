import type {
  KeywordPulsePoint5m,
  KeywordQuerySamplePost,
  KeywordQuerySession,
} from "../../../domain/entities/keyword-query-session";
import type {
  FindReusableKeywordQuerySessionInput,
  KeywordPulsePoint5mUpsertInput,
  KeywordQueryResultSummary,
  KeywordQueryResultSummaryTotals,
  KeywordQuerySessionRecord,
  KeywordQuerySessionRepository,
  UpdateKeywordQuerySessionLiveRefreshInput,
} from "../../../domain/repositories/keyword-query-session-repository";

export class InMemoryKeywordQuerySessionRepository implements KeywordQuerySessionRepository {
  private readonly sessionById = new Map<string, KeywordQuerySession>();
  private readonly samplesByQueryId = new Map<string, KeywordQuerySamplePost[]>();
  private readonly summaryByBucketKey = new Map<string, KeywordQueryResultSummary>();
  private readonly pulsePointsByKey = new Map<string, KeywordPulsePoint5m>();

  public async createWithSamples(
    session: KeywordQuerySession,
    samples: KeywordQuerySamplePost[],
  ): Promise<void> {
    this.sessionById.set(session.id, session);
    this.samplesByQueryId.set(session.id, [...samples]);
  }

  public async findById(
    queryId: string,
    sampleLimit: number,
    pulsePointLimit = 24,
  ): Promise<KeywordQuerySessionRecord | null> {
    const session = this.sessionById.get(queryId);
    if (!session) {
      return null;
    }
    const samples = this.samplesByQueryId.get(queryId) ?? [];
    return {
      session,
      samples: [...samples]
        .sort((a, b) => a.rank - b.rank || b.createdAtSource.localeCompare(a.createdAtSource))
        .slice(0, sampleLimit),
      pulsePoints5m: this.listPulsePoints(queryId, pulsePointLimit),
    };
  }

  public async findReusableSession(
    input: FindReusableKeywordQuerySessionInput,
  ): Promise<KeywordQuerySessionRecord | null> {
    const matched = Array.from(this.sessionById.values())
      .filter((session) => {
        return (
          session.normalizedQueryText === input.normalizedQueryText &&
          session.canonicalSubreddit === input.canonicalSubreddit &&
          session.updatedAt >= input.minUpdatedAt &&
          session.status !== "degraded"
        );
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const latest = matched[0];
    if (!latest) {
      return null;
    }
    return this.findById(latest.id, input.sampleLimit, input.pulsePointLimit);
  }

  public async replaceSamples(queryId: string, samples: KeywordQuerySamplePost[]): Promise<void> {
    if (!this.sessionById.has(queryId)) {
      return;
    }
    this.samplesByQueryId.set(
      queryId,
      [...samples].sort((a, b) => a.rank - b.rank || b.createdAtSource.localeCompare(a.createdAtSource)),
    );
  }

  public async listLiveRefreshCandidates(args: {
    statuses: KeywordQuerySession["status"][];
    limit: number;
  }): Promise<KeywordQuerySession[]> {
    const statusSet = new Set(args.statuses);
    return Array.from(this.sessionById.values())
      .filter((session) => statusSet.has(session.status))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, args.limit);
  }

  public async upsertResultSummary(summary: KeywordQueryResultSummary): Promise<void> {
    this.summaryByBucketKey.set(`${summary.queryId}|${summary.bucketStart}`, summary);
  }

  public async upsertPulsePoint(input: KeywordPulsePoint5mUpsertInput): Promise<void> {
    this.pulsePointsByKey.set(`${input.queryId}|${input.bucketStart}|${input.sourceType}`, {
      queryId: input.queryId,
      bucketStart: input.bucketStart,
      bucketEnd: input.bucketEnd,
      sourceType: input.sourceType,
      mentionCount: input.mentionCount,
      qualifiedMentionCount: input.qualifiedMentionCount,
      mentionRate: input.mentionRate,
      qualifiedMentionRate: input.qualifiedMentionRate,
      dataQuality: input.dataQuality,
      representativeSamples: input.representativeSamples.map((sample) => ({ ...sample })),
      updatedAt: input.updatedAt,
    });
  }

  public async getResultSummaryTotals(queryId: string): Promise<KeywordQueryResultSummaryTotals> {
    let mentionCount = 0;
    let qualifiedMentionCount = 0;
    for (const row of this.summaryByBucketKey.values()) {
      if (row.queryId !== queryId) {
        continue;
      }
      mentionCount += row.mentionCount;
      qualifiedMentionCount += row.qualifiedMentionCount;
    }
    return {
      mentionCount,
      qualifiedMentionCount,
    };
  }

  public async updateLiveRefresh(input: UpdateKeywordQuerySessionLiveRefreshInput): Promise<void> {
    const current = this.sessionById.get(input.queryId);
    if (!current) {
      return;
    }
    this.sessionById.set(input.queryId, {
      ...current,
      status: input.status,
      coverageLevel: input.coverageLevel,
      supportCount: input.supportCount,
      confidenceLevel: input.confidenceLevel,
      mentionRate: input.mentionRate,
      qualifiedMentionRate: input.qualifiedMentionRate,
      sourceTypeSummary: { ...input.sourceTypeSummary },
      degradedReason: input.degradedReason,
      explainPayload: { ...input.explainPayload },
      updatedAt: input.updatedAt,
    });
  }

  public async countActiveSessions(args: {
    statuses: KeywordQuerySession["status"][];
    updatedSinceIso: string;
  }): Promise<number> {
    const statusSet = new Set(args.statuses);
    let count = 0;
    for (const session of this.sessionById.values()) {
      if (!statusSet.has(session.status)) {
        continue;
      }
      if (session.updatedAt < args.updatedSinceIso) {
        continue;
      }
      count += 1;
    }
    return count;
  }

  private listPulsePoints(queryId: string, limit: number): KeywordPulsePoint5m[] {
    return Array.from(this.pulsePointsByKey.values())
      .filter((point) => point.queryId === queryId)
      .sort((a, b) => b.bucketStart.localeCompare(a.bucketStart))
      .slice(0, limit)
      .map((point) => ({
        ...point,
        representativeSamples: point.representativeSamples.map((sample) => ({ ...sample })),
      }));
  }
}
