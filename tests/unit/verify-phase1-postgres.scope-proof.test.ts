import assert from "node:assert/strict";
import test from "node:test";
import {
  buildKeywordExplicitScopeByQuery,
  resolveScopeProofQueries,
  type ExplicitQueryScopeDistributionRow,
} from "../../scripts/verify-phase1-postgres.scope-proof";

test("resolveScopeProofQueries keeps default llm when env is missing", () => {
  assert.deepEqual(resolveScopeProofQueries(undefined), ["llm"]);
});

test("resolveScopeProofQueries dedupes and filters invalid tokens", () => {
  const resolved = resolveScopeProofQueries("  LLM, ai, llm, a,  , AI  ");
  assert.deepEqual(resolved, ["llm", "ai"]);
});

test("resolveScopeProofQueries falls back to default when all tokens are invalid", () => {
  const resolved = resolveScopeProofQueries(" , a,  , x ");
  assert.deepEqual(resolved, ["llm"]);
});

test("buildKeywordExplicitScopeByQuery returns stable output shape with zero-filled scopes", () => {
  const rows: ExplicitQueryScopeDistributionRow[] = [
    { normalized_query_text: "llm", query_scope: "subreddit", count: "16" },
    { normalized_query_text: "llm", query_scope: "global", count: "16" },
    { normalized_query_text: "ai", query_scope: "global", count: "3" },
    { normalized_query_text: "unused", query_scope: "global", count: "99" },
  ];

  const output = buildKeywordExplicitScopeByQuery(["llm", "ai", "vision"], rows);

  assert.deepEqual(output, [
    {
      normalizedQueryText: "llm",
      byScope: {
        subreddit: 16,
        global: 16,
      },
      total: 32,
    },
    {
      normalizedQueryText: "ai",
      byScope: {
        subreddit: 0,
        global: 3,
      },
      total: 3,
    },
    {
      normalizedQueryText: "vision",
      byScope: {
        subreddit: 0,
        global: 0,
      },
      total: 0,
    },
  ]);
});
