import test from "node:test";
import assert from "node:assert/strict";
import {
  matchesNormalizedQueryV2,
  normalizeQueryV2,
} from "../../src/application/services/query-normalization-v2.service";

test("normalizeQueryV2 lowercases and keeps phrase groups", () => {
  const normalized = normalizeQueryV2('  "Large Language Model" Agent  ', "r/datascience");

  assert.equal(normalized.normalizedQueryText, "llm agent");
  assert.equal(normalized.queryScope, "subreddit");
  assert.equal(normalized.scopeCanonicalSubreddit, "r/datascience");
  assert.equal(normalized.groups.length, 2);
  assert.equal(normalized.groups[0]?.type, "phrase");
  assert.equal(normalized.groups[0]?.canonicalTerm, "llm");
});

test("normalizeQueryV2 supports global and subreddit-prefixed query scopes", () => {
  const globalQuery = normalizeQueryV2("global: ai infra", "r/datascience");
  const scopedQuery = normalizeQueryV2("r/machinelearning: llm eval", "r/datascience");

  assert.equal(globalQuery.queryScope, "global");
  assert.equal(globalQuery.scopeCanonicalSubreddit, undefined);
  assert.equal(scopedQuery.queryScope, "subreddit");
  assert.equal(scopedQuery.scopeCanonicalSubreddit, "r/machinelearning");
});

test("normalizeQueryV2 rejects scope-only query text", () => {
  assert.throws(() => normalizeQueryV2("global:"), /at least 2 characters/);
  assert.throws(() => normalizeQueryV2("r/machinelearning:"), /at least 2 characters/);
});

test("matchesNormalizedQueryV2 enforces alias boundary matching", () => {
  const ai = normalizeQueryV2("ai");
  const llmAgent = normalizeQueryV2("llm agent");

  assert.equal(matchesNormalizedQueryV2("Airflow scheduler tuning", ai), false);
  assert.equal(matchesNormalizedQueryV2("Artificial intelligence roadmap", ai), true);
  assert.equal(matchesNormalizedQueryV2("large language model agent toolkit", llmAgent), true);
  assert.equal(matchesNormalizedQueryV2("large language model toolkit", llmAgent), false);
});
