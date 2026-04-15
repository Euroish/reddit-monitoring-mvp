import { normalizeAsciiLexeme } from "../../shared/text/normalized-lexemes";

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
  const normalizedQuery = rawQuery.trim().replace(/\s+/g, " ").toLowerCase();
  const rawTokens = normalizedQuery.split(" ").filter(Boolean);
  const positiveTokens: string[] = [];
  const negativeTokens: string[] = [];
  const seenPositive = new Set<string>();
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
      continue;
    }

    const normalized = normalizeAsciiLexeme(token);
    if (!normalized || normalized.length < 2 || STOPWORDS.has(normalized)) {
      continue;
    }
    if (seenPositive.has(normalized)) {
      continue;
    }
    seenPositive.add(normalized);
    positiveTokens.push(normalized);
  }

  return {
    rawQuery,
    normalizedQuery,
    positiveTokens: positiveTokens.slice(0, 8),
    negativeTokens: negativeTokens.slice(0, 8),
    plannerVersion: "query_planner_v1",
  };
}
