const SUBREDDIT_SCOPE_PATTERN = /^r\/([a-z0-9_]{3,21})\s*:\s*/i;
const GLOBAL_SCOPE_PATTERN = /^global\s*:\s*/i;
const MAX_QUERY_LENGTH = 160;

const QUERY_ALIAS_VARIANTS: Record<string, string[]> = {
  ai: ["ai", "artificial intelligence"],
  llm: ["llm", "large language model", "large language models"],
  ml: ["ml", "machine learning"],
};

const ALIAS_CANONICAL_BY_VARIANT = new Map<string, string>(
  Object.entries(QUERY_ALIAS_VARIANTS).flatMap(([canonical, variants]) =>
    variants.map((variant) => [normalizeTerm(variant), canonical] as const),
  ),
);

export type QueryScope = "subreddit" | "global";
export type QueryMatchGroupType = "token" | "phrase";

export interface QueryMatchGroupV2 {
  type: QueryMatchGroupType;
  canonicalTerm: string;
  variants: string[];
}

export interface NormalizedQueryV2 {
  rawQuery: string;
  normalizedQueryText: string;
  displayQueryText: string;
  queryScope: QueryScope;
  scopeCanonicalSubreddit?: string;
  searchTokens: string[];
  groups: QueryMatchGroupV2[];
  plannerVersion: "query_normalization_v2";
}

export function normalizeQueryV2(
  rawQuery: string,
  defaultScopeCanonicalSubreddit?: string,
): NormalizedQueryV2 {
  const trimmed = rawQuery.trim();
  if (trimmed.length < 2) {
    throw new Error("query must contain at least 2 characters");
  }
  if (trimmed.length > MAX_QUERY_LENGTH) {
    throw new Error(`query must be <= ${MAX_QUERY_LENGTH} characters`);
  }

  const { body, queryScope, scopeCanonicalSubreddit } = parseScope(
    trimmed,
    defaultScopeCanonicalSubreddit,
  );
  const loweredBody = collapseWhitespace(body.toLowerCase());
  const quotedPhrases = Array.from(loweredBody.matchAll(/"([^"]+)"/g))
    .map((match) => collapseWhitespace(match[1] ?? ""))
    .filter((value) => value.length >= 2);
  const remainder = collapseWhitespace(loweredBody.replace(/"([^"]+)"/g, " "));
  const rawTokens = remainder.match(/[a-z0-9_]{2,}/g) ?? [];

  const groups: QueryMatchGroupV2[] = [];
  const seenCanonical = new Set<string>();

  for (const phrase of quotedPhrases) {
    const canonical = canonicalizeTerm(phrase);
    if (seenCanonical.has(canonical)) {
      continue;
    }
    seenCanonical.add(canonical);
    groups.push({
      type: "phrase",
      canonicalTerm: canonical,
      variants: resolveVariants(canonical),
    });
  }

  for (const token of rawTokens) {
    const canonical = canonicalizeTerm(token);
    if (seenCanonical.has(canonical)) {
      continue;
    }
    seenCanonical.add(canonical);
    groups.push({
      type: "token",
      canonicalTerm: canonical,
      variants: resolveVariants(canonical),
    });
  }

  const searchTokens = Array.from(
    new Set(
      groups.flatMap((group) =>
        group.variants.flatMap((variant) => variant.match(/[a-z0-9_]{2,}/g) ?? []),
      ),
    ),
  );
  const displayQueryText = collapseWhitespace(
    groups
      .map((group) => group.canonicalTerm)
      .filter((value) => value.length > 0)
      .join(" "),
  );
  if (displayQueryText.length < 2) {
    throw new Error("query must contain at least 2 characters");
  }

  return {
    rawQuery,
    normalizedQueryText: displayQueryText,
    displayQueryText,
    queryScope,
    scopeCanonicalSubreddit,
    searchTokens,
    groups,
    plannerVersion: "query_normalization_v2",
  };
}

export function matchesNormalizedQueryV2(text: string, query: NormalizedQueryV2): boolean {
  if (query.groups.length === 0) {
    return false;
  }
  const haystack = collapseWhitespace(text.toLowerCase());
  return query.groups.every((group) => {
    return group.variants.some((variant) => containsWithBoundary(haystack, variant));
  });
}

function parseScope(
  raw: string,
  defaultScopeCanonicalSubreddit?: string,
): {
  body: string;
  queryScope: QueryScope;
  scopeCanonicalSubreddit?: string;
} {
  const defaultCanonical = normalizeCanonicalSubreddit(defaultScopeCanonicalSubreddit);
  if (GLOBAL_SCOPE_PATTERN.test(raw)) {
    return {
      body: raw.replace(GLOBAL_SCOPE_PATTERN, ""),
      queryScope: "global",
    };
  }

  const subredditMatch = raw.match(SUBREDDIT_SCOPE_PATTERN);
  if (subredditMatch?.[1]) {
    return {
      body: raw.replace(SUBREDDIT_SCOPE_PATTERN, ""),
      queryScope: "subreddit",
      scopeCanonicalSubreddit: `r/${subredditMatch[1].toLowerCase()}`,
    };
  }

  return {
    body: raw,
    queryScope: "subreddit",
    scopeCanonicalSubreddit: defaultCanonical,
  };
}

function containsWithBoundary(text: string, variant: string): boolean {
  const escaped = escapeRegExp(variant).replace(/\\ /g, "\\s+");
  const pattern = new RegExp(`(?:^|[^a-z0-9_])${escaped}(?:$|[^a-z0-9_])`, "i");
  return pattern.test(text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveVariants(canonical: string): string[] {
  const aliases = QUERY_ALIAS_VARIANTS[canonical];
  if (!aliases) {
    return [canonical];
  }
  return Array.from(new Set(aliases.map((value) => normalizeTerm(value)).filter(Boolean)));
}

function canonicalizeTerm(rawTerm: string): string {
  const normalized = normalizeTerm(rawTerm);
  return ALIAS_CANONICAL_BY_VARIANT.get(normalized) ?? normalized;
}

function normalizeTerm(raw: string): string {
  return collapseWhitespace(raw.toLowerCase().replace(/[^a-z0-9_\s]/g, " "));
}

function normalizeCanonicalSubreddit(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().replace(/^r\//i, "").toLowerCase();
  if (!normalized) {
    return undefined;
  }
  return `r/${normalized}`;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
