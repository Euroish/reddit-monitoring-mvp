import { normalizeAsciiLexeme } from "../../shared/text/normalized-lexemes";
import { normalizeQueryV2 } from "./query-normalization-v2.service";

export interface QueryPlan {
  rawQuery: string;
  normalizedQuery: string;
  positiveTokens: string[];
  negativeTokens: string[];
  plannerVersion: string;
}

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "to",
  "with",
]);

export function buildQueryPlan(rawQuery: string): QueryPlan {
  const normalizedQueryV2 = normalizeQueryV2(rawQuery);
  const normalizedQuery = normalizedQueryV2.normalizedQueryText;
  const rawTokens = rawQuery
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const positiveTokens: string[] = normalizedQueryV2.searchTokens
    .map((token) => normalizeAsciiLexeme(token))
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token))
    .slice(0, 8);
  const negativeTokens: string[] = [];
  const seenNegative = new Set<string>();

  for (const token of rawTokens) {
    if (token.startsWith("-")) {
      const normalized = normalizeAsciiLexeme(token.slice(1));
      if (!normalized || normalized.length < 2 || STOPWORDS.has(normalized)) {
        continue;
      }
      if (!seenNegative.has(normalized)) {
        seenNegative.add(normalized);
        negativeTokens.push(normalized);
      }
    }
  }

  return {
    rawQuery,
    normalizedQuery,
    positiveTokens: positiveTokens.slice(0, 8),
    negativeTokens: negativeTokens.slice(0, 8),
    plannerVersion: "query_planner_v2",
  };
}
