import { randomUUID } from "node:crypto";
import type {
  KeywordQuerySamplePost,
  KeywordQuerySession,
  KeywordQuerySessionStatus,
} from "../../domain/entities/keyword-query-session";
import type { KeywordQuerySessionRepository } from "../../domain/repositories/keyword-query-session-repository";
import type { PostSearchDocumentRepository } from "../../domain/repositories/post-search-document-repository";
import { hasAnyAsciiLexemeMatch } from "../../shared/text/normalized-lexemes";
import { buildQueryPlan } from "./query-planner.service";
import {
  buildRepresentativeSamples,
  ceilIsoFromBucketStart,
  clampRate,
  floorIsoToMinuteBucket,
  isQualifiedMatch,
  resolveAggregateDataQuality,
  resolveConfidenceLevel,
  resolveCoverageLevel,
} from "./keyword-query-metrics";

export interface RunKeywordPulseQueryInput {
  queryText: string;
  canonicalSubreddit?: string;
  limit: number;
  nowIso: string;
  searchLimit?: number;
  reuseWindowMinutes?: number;
  pulsePointLimit?: number;
  bucketMinutes?: number;
  representativeSampleLimit?: number;
}

export interface RunKeywordPulseQueryOutput {
  session: KeywordQuerySession;
  samples: KeywordQuerySamplePost[];
  pulsePoints5m: import("../../domain/entities/keyword-query-session").KeywordPulsePoint5m[];
  cacheStatus: "hit" | "miss";
}

export async function runKeywordPulseQuery(args: {
  input: RunKeywordPulseQueryInput;
  postSearchDocumentRepository: PostSearchDocumentRepository;
  keywordQuerySessionRepository: KeywordQuerySessionRepository;
  idGenerator?: () => string;
}): Promise<RunKeywordPulseQueryOutput> {
  const planner = buildQueryPlan(args.input.queryText);
  if (planner.positiveTokens.length === 0) {
    throw new Error("query has no searchable tokens after normalization");
  }

  const reuseWindowMinutes = Math.max(1, args.input.reuseWindowMinutes ?? 15);
  const pulsePointLimit = Math.max(1, args.input.pulsePointLimit ?? 24);
  const bucketMinutes = Math.max(1, args.input.bucketMinutes ?? 5);
  const representativeSampleLimit = Math.max(
    1,
    args.input.representativeSampleLimit ?? args.input.limit,
  );
  const searchLimit = Math.max(
    representativeSampleLimit,
    args.input.searchLimit ?? Math.max(args.input.limit, 200),
  );
  const minUpdatedAtIso = new Date(
    new Date(args.input.nowIso).getTime() - reuseWindowMinutes * 60 * 1000,
  ).toISOString();

  const reusable = await args.keywordQuerySessionRepository.findReusableSession({
    normalizedQueryText: planner.normalizedQuery,
    canonicalSubreddit: args.input.canonicalSubreddit,
    minUpdatedAt: minUpdatedAtIso,
    sampleLimit: args.input.limit,
    pulsePointLimit,
  });
  if (reusable) {
    return {
      session: reusable.session,
      samples: reusable.samples,
      pulsePoints5m: reusable.pulsePoints5m,
      cacheStatus: "hit",
    };
  }

  const seededRows = await args.postSearchDocumentRepository.seedFromContent(2000);
  const totalScopeDocs = await args.postSearchDocumentRepository.countByScope({
    canonicalSubreddit: args.input.canonicalSubreddit,
  });

  const documents = await args.postSearchDocumentRepository.search({
    tokens: planner.positiveTokens,
    canonicalSubreddit: args.input.canonicalSubreddit,
    limit: searchLimit,
  });

  const filteredDocuments = documents.filter((doc) => {
    const haystack = `${doc.title} ${doc.bodySnippet ?? ""}`;
    if (!hasAnyAsciiLexemeMatch(haystack, planner.positiveTokens)) {
      return false;
    }
    if (planner.negativeTokens.length === 0) {
      return true;
    }
    return !hasAnyAsciiLexemeMatch(haystack, planner.negativeTokens);
  });

  const supportCount = filteredDocuments.length;
  const qualifiedCount = filteredDocuments.filter((doc) => isQualifiedMatch(doc.title, doc.bodySnippet)).length;
  const denominator = Math.max(1, totalScopeDocs);
  const mentionRate = clampRate(supportCount / denominator);
  const qualifiedMentionRate = clampRate(qualifiedCount / denominator);
  const coverageLevel = resolveCoverageLevel(supportCount);
  const confidenceLevel = resolveConfidenceLevel({
    supportCount,
    mentionRate,
  });
  const status: KeywordQuerySessionStatus = supportCount > 0 ? "initial_ready" : "degraded";
  const degradedReason =
    supportCount > 0
      ? undefined
      : totalScopeDocs > 0
        ? "index_no_match"
        : "index_empty";

  const queryId = args.idGenerator?.() ?? randomUUID();
  const samples = buildRepresentativeSamples({
    queryId,
    documents: filteredDocuments,
    sourceType: "index",
    limit: Math.min(args.input.limit, representativeSampleLimit),
  });

  const session: KeywordQuerySession = {
    id: queryId,
    queryText: args.input.queryText,
    normalizedQueryText: planner.normalizedQuery,
    canonicalSubreddit: args.input.canonicalSubreddit,
    status,
    coverageLevel,
    supportCount,
    confidenceLevel,
    mentionRate,
    qualifiedMentionRate,
    sourceTypeSummary: {
      index: supportCount,
      live: 0,
      backfill: 0,
    },
    degradedReason,
    explainPayload: {
      plannerVersion: planner.plannerVersion,
      positiveTokens: planner.positiveTokens,
      negativeTokens: planner.negativeTokens,
      seededRows,
      totalScopeDocs,
      searchLimit,
      pollutionFilteredCount: Math.max(0, documents.length - filteredDocuments.length),
      filteredCount: supportCount,
      qualifiedCount,
      cacheStatus: "miss",
    },
    createdAt: args.input.nowIso,
    updatedAt: args.input.nowIso,
  };

  await args.keywordQuerySessionRepository.createWithSamples(session, samples);
  const bucketStart = floorIsoToMinuteBucket(args.input.nowIso, bucketMinutes);
  const bucketEnd = ceilIsoFromBucketStart(bucketStart, bucketMinutes, args.input.nowIso);
  const initialDataQuality = resolveAggregateDataQuality({
    coverageLevel,
    confidenceLevel,
    qualifiedMentionRate,
    degradedReason,
  });
  await args.keywordQuerySessionRepository.upsertPulsePoint({
    queryId,
    bucketStart,
    bucketEnd,
    sourceType: "index",
    mentionCount: supportCount,
    qualifiedMentionCount: qualifiedCount,
    mentionRate,
    qualifiedMentionRate,
    dataQuality: initialDataQuality,
    representativeSamples: samples,
    updatedAt: args.input.nowIso,
  });

  const record = await args.keywordQuerySessionRepository.findById(
    queryId,
    args.input.limit,
    pulsePointLimit,
  );
  return {
    session: record?.session ?? session,
    samples: record?.samples ?? samples,
    pulsePoints5m: record?.pulsePoints5m ?? [],
    cacheStatus: "miss",
  };
}
