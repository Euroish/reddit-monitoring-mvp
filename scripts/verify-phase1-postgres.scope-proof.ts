export interface ExplicitQueryScopeDistributionRow {
  normalized_query_text: string;
  query_scope: "subreddit" | "global";
  count: string | number;
}

interface KeywordScopeCount {
  subreddit: number;
  global: number;
}

export interface KeywordExplicitScopeProof {
  normalizedQueryText: string;
  byScope: KeywordScopeCount;
  total: number;
}

export function resolveScopeProofQueries(raw: string | undefined): string[] {
  const queries = (raw ?? "llm")
    .split(",")
    .map((query) => query.trim().toLowerCase())
    .filter((query) => query.length >= 2);
  const deduped = Array.from(new Set(queries));
  return deduped.length > 0 ? deduped : ["llm"];
}

export function buildKeywordExplicitScopeByQuery(
  scopeProofQueries: readonly string[],
  explicitScopeDistributionRows: readonly ExplicitQueryScopeDistributionRow[],
): KeywordExplicitScopeProof[] {
  const querySet = new Set(scopeProofQueries);
  const countsByQuery = new Map<string, KeywordScopeCount>();
  for (const row of explicitScopeDistributionRows) {
    if (!querySet.has(row.normalized_query_text)) {
      continue;
    }
    const next = countsByQuery.get(row.normalized_query_text) ?? {
      subreddit: 0,
      global: 0,
    };
    next[row.query_scope] = Number(row.count);
    countsByQuery.set(row.normalized_query_text, next);
  }

  return scopeProofQueries.map((query) => {
    const byScope = countsByQuery.get(query) ?? {
      subreddit: 0,
      global: 0,
    };
    return {
      normalizedQueryText: query,
      byScope: {
        subreddit: byScope.subreddit,
        global: byScope.global,
      },
      total: byScope.subreddit + byScope.global,
    };
  });
}
