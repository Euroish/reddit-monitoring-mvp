import type { KeywordQuerySessionStatus } from "../../domain/entities/keyword-query-session";
import type { KeywordQuerySessionRepository } from "../../domain/repositories/keyword-query-session-repository";
import type { PostSearchDocumentRepository } from "../../domain/repositories/post-search-document-repository";
import { buildQueryPlan } from "./query-planner.service";
import {
  buildRepresentativeSamples,
  ceilIsoFromBucketStart,
  clampRate,
  floorIsoToMinuteBucket,
  mergeRepresentativeSamples,
  resolveConfidenceLevel,
  resolveCoverageLevel,
  resolveAggregateDataQuality,
} from "./keyword-query-metrics";

export interface RunKeywordQueryLiveRefreshCycleInput {
  nowIso: string;
  keywordQuerySessionRepository: KeywordQuerySessionRepository;
  postSearchDocumentRepository: PostSearchDocumentRepository;
  liveWindowMinutes?: number;
  bucketMinutes?: number;
  candidateLimit?: number;
  bucketSearchLimit?: number;
}

export interface RunKeywordQueryLiveRefreshCycleOutput {
  processed: number;
  transitionedToLiveRefreshing: number;
  transitionedToCompleted: number;
  transitionedToDegraded: number;
}

export async function runKeywordQueryLiveRefreshCycle(
  input: RunKeywordQueryLiveRefreshCycleInput,
): Promise<RunKeywordQueryLiveRefreshCycleOutput> {
  const liveWindowMinutes = Math.max(1, input.liveWindowMinutes ?? 20);
  const bucketMinutes = Math.max(1, input.bucketMinutes ?? 5);
  const candidateLimit = Math.max(1, input.candidateLimit ?? 50);
  const bucketSearchLimit = Math.max(1, input.bucketSearchLimit ?? 200);
  const representativeSampleLimit = 10;

  const sessions = await input.keywordQuerySessionRepository.listLiveRefreshCandidates({
    statuses: ["initial_ready", "live_refreshing"],
    limit: candidateLimit,
  });

  let transitionedToLiveRefreshing = 0;
  let transitionedToCompleted = 0;
  let transitionedToDegraded = 0;

  const bucketStart = floorIsoToMinuteBucket(input.nowIso, bucketMinutes);
  const bucketEnd = input.nowIso;

  for (const session of sessions) {
    const planner = buildQueryPlan(session.queryText);
    if (planner.positiveTokens.length === 0) {
      await input.keywordQuerySessionRepository.updateLiveRefresh({
        queryId: session.id,
        status: "degraded",
        coverageLevel: session.coverageLevel,
        supportCount: session.supportCount,
        confidenceLevel: session.confidenceLevel,
        mentionRate: session.mentionRate,
        qualifiedMentionRate: session.qualifiedMentionRate,
        sourceTypeSummary: session.sourceTypeSummary,
        degradedReason: "query_tokens_empty",
        explainPayload: {
          ...session.explainPayload,
          liveRefresh: {
            refreshedAt: input.nowIso,
            reason: "query_tokens_empty",
          },
        },
        updatedAt: input.nowIso,
      });
      transitionedToDegraded += 1;
      continue;
    }

    const summary = await input.postSearchDocumentRepository.summarizeSearch({
      tokens: planner.positiveTokens,
      negativeTokens: planner.negativeTokens,
      canonicalSubreddit: session.canonicalSubreddit,
      sampleLimit: bucketSearchLimit,
      createdAtFrom: bucketStart > session.createdAt ? bucketStart : session.createdAt,
      createdAtTo: bucketEnd,
    });
    const scopeSummary = await input.postSearchDocumentRepository.summarizeSearch({
      tokens: planner.positiveTokens,
      negativeTokens: planner.negativeTokens,
      canonicalSubreddit: session.canonicalSubreddit,
      sampleLimit: representativeSampleLimit,
      createdAtTo: bucketEnd,
    });
    const filteredDocuments = summary.documents;
    const mentionCount = summary.supportCount;
    const qualifiedMentionCount = summary.qualifiedCount;
    const denominator = Math.max(1, scopeSummary.totalScopeDocs);
    const bucketDenominator = Math.max(1, summary.totalScopeDocs);
    const bucketMentionRate = clampRate(mentionCount / bucketDenominator);
    const bucketQualifiedMentionRate = clampRate(qualifiedMentionCount / bucketDenominator);
    const pulseSamples = buildRepresentativeSamples({
      queryId: session.id,
      documents: filteredDocuments,
      sourceType: "live",
      limit: Math.min(representativeSampleLimit, filteredDocuments.length),
    });

    await input.keywordQuerySessionRepository.upsertResultSummary({
      queryId: session.id,
      bucketStart,
      mentionCount,
      qualifiedMentionCount,
      mentionRate: bucketMentionRate,
      qualifiedMentionRate: bucketQualifiedMentionRate,
      sourceType: "live",
      updatedAt: input.nowIso,
    });

    const summaryTotals = await input.keywordQuerySessionRepository.getResultSummaryTotals(session.id);
    const indexMentionCount = Number(session.sourceTypeSummary.index ?? session.supportCount);
    const supportCount = scopeSummary.supportCount;
    const qualifiedCount = scopeSummary.qualifiedCount;
    const mentionRate = clampRate(supportCount / denominator);
    const qualifiedMentionRate = clampRate(qualifiedCount / denominator);
    const coverageLevel = resolveCoverageLevel(supportCount);
    const confidenceLevel = resolveConfidenceLevel({ supportCount, mentionRate });

    const sourceTypeSummary = {
      index: indexMentionCount,
      live: summaryTotals.mentionCount,
      backfill: Number(session.sourceTypeSummary.backfill ?? 0),
    };

    const targetStatus = resolveLiveRefreshStatus({
      sessionCreatedAtIso: session.createdAt,
      nowIso: input.nowIso,
      liveWindowMinutes,
      supportCount,
    });
    const degradedReason = targetStatus === "degraded" ? "live_refresh_no_support" : undefined;
    const sessionDataQuality = resolveAggregateDataQuality({
      coverageLevel,
      confidenceLevel,
      qualifiedMentionRate,
      degradedReason,
    });
    const record = await input.keywordQuerySessionRepository.findById(
      session.id,
      representativeSampleLimit,
      24,
    );
    const mergedSamples = mergeRepresentativeSamples({
      current: record?.samples ?? [],
      incoming: pulseSamples,
      limit: representativeSampleLimit,
    });

    await input.keywordQuerySessionRepository.replaceSamples(session.id, mergedSamples);
    await input.keywordQuerySessionRepository.upsertPulsePoint({
      queryId: session.id,
      bucketStart,
      bucketEnd: ceilIsoFromBucketStart(bucketStart, bucketMinutes, bucketEnd),
      sourceType: "live",
      mentionCount,
      qualifiedMentionCount,
      mentionRate: bucketMentionRate,
      qualifiedMentionRate: bucketQualifiedMentionRate,
      dataQuality: resolveAggregateDataQuality({
        coverageLevel: resolveCoverageLevel(mentionCount),
        confidenceLevel: resolveConfidenceLevel({
          supportCount: mentionCount,
          mentionRate: bucketMentionRate,
        }),
        qualifiedMentionRate: bucketQualifiedMentionRate,
      }),
      representativeSamples: pulseSamples,
      updatedAt: input.nowIso,
    });

    await input.keywordQuerySessionRepository.updateLiveRefresh({
      queryId: session.id,
      status: targetStatus,
      coverageLevel,
      supportCount,
      confidenceLevel,
      mentionRate,
      qualifiedMentionRate,
      sourceTypeSummary,
      degradedReason,
      explainPayload: {
        ...session.explainPayload,
        dataQuality: sessionDataQuality,
        statisticsVersion: "stored_scope_exact_v1",
        totalScopeDocs: scopeSummary.totalScopeDocs,
        filteredCount: supportCount,
        qualifiedCount,
        statisticsTo: bucketEnd,
        liveRefresh: {
          refreshedAt: input.nowIso,
          bucketStart,
          bucketEnd,
          mentionCount,
          qualifiedMentionCount,
          pollutionFilteredCount: Math.max(0, summary.candidateCount - mentionCount),
          bucketScopeDocs: summary.totalScopeDocs,
          totalLiveMentionCount: summaryTotals.mentionCount,
          totalLiveQualifiedMentionCount: summaryTotals.qualifiedMentionCount,
          representativeSampleCount: pulseSamples.length,
        },
      },
      updatedAt: input.nowIso,
    });

    if (targetStatus === "live_refreshing" && session.status !== "live_refreshing") {
      transitionedToLiveRefreshing += 1;
    } else if (targetStatus === "completed" && session.status !== "completed") {
      transitionedToCompleted += 1;
    } else if (targetStatus === "degraded" && session.status !== "degraded") {
      transitionedToDegraded += 1;
    }
  }

  return {
    processed: sessions.length,
    transitionedToLiveRefreshing,
    transitionedToCompleted,
    transitionedToDegraded,
  };
}

function resolveLiveRefreshStatus(args: {
  sessionCreatedAtIso: string;
  nowIso: string;
  liveWindowMinutes: number;
  supportCount: number;
}): KeywordQuerySessionStatus {
  if (args.supportCount <= 0) {
    return "degraded";
  }
  const elapsedMs = new Date(args.nowIso).getTime() - new Date(args.sessionCreatedAtIso).getTime();
  if (elapsedMs >= args.liveWindowMinutes * 60 * 1000) {
    return "completed";
  }
  return "live_refreshing";
}
