import test from "node:test";
import assert from "node:assert/strict";
import {
  BadRequestError,
  normalizeKeywordQueryText,
  normalizeSubredditName,
  parseOptionalIntegerParam,
  resolveDailyRange,
  resolveRunMode,
  resolveTrendRange,
} from "../../apps/api/src/api-validation";

test("normalizeSubredditName accepts valid formats", () => {
  assert.equal(normalizeSubredditName("r/MachineLearning"), "machinelearning");
  assert.equal(normalizeSubredditName("data_science"), "data_science");
});

test("normalizeSubredditName rejects invalid subreddit", () => {
  assert.throws(() => normalizeSubredditName("a"), BadRequestError);
  assert.throws(() => normalizeSubredditName("data-science"), BadRequestError);
});

test("resolveRunMode keeps only supported values", () => {
  assert.equal(resolveRunMode(undefined), "live");
  assert.equal(resolveRunMode("live"), "live");
  assert.equal(resolveRunMode("mock"), "mock");
  assert.equal(resolveRunMode("invalid"), null);
});

test("resolveTrendRange aligns to 6-hour windows", () => {
  const params = new URLSearchParams({
    from: "2026-04-10T12:01:00.000Z",
    to: "2026-04-10T13:14:00.000Z",
  });
  const range = resolveTrendRange(params, "2026-04-10T13:20:00.000Z");
  assert.equal(range.fromIso, "2026-04-10T12:00:00.000Z");
  assert.equal(range.toIso, "2026-04-10T12:00:00.000Z");
});

test("resolveTrendRange rejects oversized ranges", () => {
  const params = new URLSearchParams({
    from: "2026-02-01T00:00:00.000Z",
    to: "2026-04-10T12:00:00.000Z",
  });
  assert.throws(() => resolveTrendRange(params, "2026-04-10T12:00:00.000Z"), BadRequestError);
});

test("resolveDailyRange keeps raw ISO boundaries", () => {
  const params = new URLSearchParams({
    from: "2026-04-01T06:00:00.000Z",
    to: "2026-04-10T18:30:00.000Z",
  });
  const range = resolveDailyRange(params, "2026-04-10T20:00:00.000Z");
  assert.equal(range.fromIso, "2026-04-01T06:00:00.000Z");
  assert.equal(range.toIso, "2026-04-10T18:30:00.000Z");
});

test("resolveDailyRange rejects oversized ranges", () => {
  const params = new URLSearchParams({
    from: "2026-01-01T00:00:00.000Z",
    to: "2026-04-10T00:00:00.000Z",
  });
  assert.throws(() => resolveDailyRange(params, "2026-04-10T00:00:00.000Z"), BadRequestError);
});

test("parseOptionalIntegerParam validates range and integer", () => {
  assert.equal(
    parseOptionalIntegerParam({
      value: "12",
      name: "recentPostsLimit",
      min: 1,
      max: 50,
    }),
    12,
  );
  assert.equal(
    parseOptionalIntegerParam({
      value: null,
      name: "recentPostsLimit",
      min: 1,
      max: 50,
    }),
    undefined,
  );
  assert.throws(
    () =>
      parseOptionalIntegerParam({
        value: "2.5",
        name: "recentPostsLimit",
        min: 1,
        max: 50,
      }),
    BadRequestError,
  );
  assert.throws(
    () =>
      parseOptionalIntegerParam({
        value: "99",
        name: "recentPostsLimit",
        min: 1,
        max: 50,
      }),
    BadRequestError,
  );
});

test("normalizeKeywordQueryText trims and validates boundaries", () => {
  assert.equal(normalizeKeywordQueryText("  LLM   agent  "), "llm agent");
  assert.equal(
    normalizeKeywordQueryText("global: artificial intelligence"),
    "artificial intelligence",
  );
  assert.throws(() => normalizeKeywordQueryText("a"), BadRequestError);
  assert.throws(() => normalizeKeywordQueryText("x".repeat(161)), BadRequestError);
});
