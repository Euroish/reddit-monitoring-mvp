import type {
  ConfidenceLevel,
  CoverageLevel,
  DataQualityLevel,
  KeywordQueryDataQuality,
  KeywordQuerySamplePost,
  KeywordQuerySourceType,
} from "../../domain/entities/keyword-query-session";
import type { PostSearchDocument } from "../../domain/entities/post-search-document";

export function isQualifiedMatch(title: string, bodySnippet?: string): boolean {
  return title.trim().length >= 20 && (bodySnippet?.trim().length ?? 0) >= 40;
}

export function resolveCoverageLevel(supportCount: number): CoverageLevel {
  if (supportCount >= 20) {
    return "high";
  }
  if (supportCount >= 5) {
    return "medium";
  }
  return "low";
}

export function resolveConfidenceLevel(args: {
  supportCount: number;
  mentionRate: number;
}): ConfidenceLevel {
  if (args.supportCount >= 20 || args.mentionRate >= 0.15) {
    return "high";
  }
  if (args.supportCount >= 5 || args.mentionRate >= 0.03) {
    return "medium";
  }
  return "low";
}

export function clampRate(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return Number(value.toFixed(6));
}

export function resolveAggregateDataQuality(args: {
  coverageLevel: CoverageLevel;
  confidenceLevel: ConfidenceLevel;
  qualifiedMentionRate: number;
  degradedReason?: string;
}): DataQualityLevel {
  if (args.degradedReason) {
    return "low";
  }
  if (
    args.confidenceLevel === "high" &&
    args.coverageLevel !== "low" &&
    args.qualifiedMentionRate >= 0.02
  ) {
    return "high";
  }
  if (
    args.confidenceLevel !== "low" ||
    args.coverageLevel !== "low" ||
    args.qualifiedMentionRate > 0
  ) {
    return "medium";
  }
  return "low";
}

export function resolveSampleDataQuality(args: {
  title: string;
  bodySnippet?: string;
  matchScore?: number;
}): DataQualityLevel {
  const qualified = isQualifiedMatch(args.title, args.bodySnippet);
  const matchScore = args.matchScore ?? 0;
  if (qualified && matchScore >= 2) {
    return "high";
  }
  if (qualified || matchScore >= 2) {
    return "medium";
  }
  return "low";
}

export function buildRepresentativeSamples(args: {
  queryId: string;
  documents: PostSearchDocument[];
  sourceType: KeywordQuerySourceType;
  limit: number;
}): KeywordQuerySamplePost[] {
  return args.documents.slice(0, args.limit).map((doc, index) => ({
    queryId: args.queryId,
    contentId: doc.contentId,
    rank: index + 1,
    matchScore: doc.matchScore ?? 0,
    sourceType: args.sourceType,
    dataQuality: resolveSampleDataQuality({
      title: doc.title,
      bodySnippet: doc.bodySnippet,
      matchScore: doc.matchScore,
    }),
    canonicalSubreddit: doc.canonicalSubreddit,
    title: doc.title,
    permalink: doc.permalink,
    createdAtSource: doc.createdAtSource,
  }));
}

export function mergeRepresentativeSamples(args: {
  current: KeywordQuerySamplePost[];
  incoming: KeywordQuerySamplePost[];
  limit: number;
}): KeywordQuerySamplePost[] {
  const merged = new Map<string, KeywordQuerySamplePost>();
  for (const sample of [...args.incoming, ...args.current]) {
    const existing = merged.get(sample.contentId);
    if (!existing) {
      merged.set(sample.contentId, sample);
      continue;
    }
    const existingRankScore = existing.matchScore;
    const nextRankScore = sample.matchScore;
    if (
      nextRankScore > existingRankScore ||
      (nextRankScore === existingRankScore &&
        sample.createdAtSource > existing.createdAtSource)
    ) {
      merged.set(sample.contentId, sample);
    }
  }
  return Array.from(merged.values())
    .sort((a, b) => {
      const byScore = b.matchScore - a.matchScore;
      if (byScore !== 0) {
        return byScore;
      }
      return b.createdAtSource.localeCompare(a.createdAtSource);
    })
    .slice(0, args.limit)
    .map((sample, index) => ({
      ...sample,
      rank: index + 1,
    }));
}

export function buildKeywordQueryDataQuality(args: {
  coverageLevel: CoverageLevel;
  confidenceLevel: ConfidenceLevel;
  supportCount: number;
  mentionRate: number;
  qualifiedMentionRate: number;
  degradedReason?: string;
}): KeywordQueryDataQuality {
  return {
    level: resolveAggregateDataQuality(args),
    coverageLevel: args.coverageLevel,
    confidenceLevel: args.confidenceLevel,
    supportCount: args.supportCount,
    mentionRate: args.mentionRate,
    qualifiedMentionRate: args.qualifiedMentionRate,
    degradedReason: args.degradedReason,
  };
}

export function toDominantSourceType(sourceTypeSummary: Record<string, number>): KeywordQuerySourceType {
  const ranked = (["live", "index", "backfill"] as const)
    .map((sourceType) => ({
      sourceType,
      value: Number(sourceTypeSummary[sourceType] ?? 0),
    }))
    .sort((a, b) => b.value - a.value);
  return ranked[0]?.value > 0 ? ranked[0].sourceType : "index";
}

export function floorIsoToMinuteBucket(iso: string, bucketMinutes: number): string {
  const date = new Date(iso);
  const minute = date.getUTCMinutes();
  const flooredMinute = Math.floor(minute / bucketMinutes) * bucketMinutes;
  date.setUTCMinutes(flooredMinute, 0, 0);
  return date.toISOString();
}

export function ceilIsoFromBucketStart(bucketStartIso: string, bucketMinutes: number, maxIso: string): string {
  const bucketEndMs = new Date(bucketStartIso).getTime() + bucketMinutes * 60 * 1000;
  const maxMs = new Date(maxIso).getTime();
  return new Date(Math.min(bucketEndMs, maxMs)).toISOString();
}
