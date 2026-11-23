import assert from "node:assert/strict";
import test from "node:test";
import {
  computeEngagementRate,
  computePeriodDelta,
  computeShareOfVoice,
  extractCooccurringTerms,
  mergeTopDomains,
  packXAccountBatches,
} from "../../src/modules/intelligence/index";

test("computePeriodDelta, computeEngagementRate, and ShareOfVoice handle zero/missing edges honestly", () => {
  assert.equal(computePeriodDelta(10, null).status, "unknown");
  assert.deepEqual(computePeriodDelta(15, 0), { current: 15, previous: 0, delta: 15, deltaPct: null, status: "new" });
  assert.deepEqual(computePeriodDelta(120, 100), { current: 120, previous: 100, delta: 20, deltaPct: 0.2, status: "up" });

  assert.deepEqual(computeEngagementRate({ likes: 10, comments: 5, views: null, followers: null }), { rate: null, basis: "unavailable" });
  assert.deepEqual(computeEngagementRate({ likes: 50, comments: 10, reposts: 5, views: 2000 }), { rate: 0.04, basis: "by_views" });
  assert.deepEqual(computeEngagementRate({ likes: 50, comments: 5, followers: 1000 }), { rate: 0.06, basis: "by_followers" });

  const sov = computeShareOfVoice([
    { label: "cursor", role: "primary", mentions: 30, engagement: 300 },
    { label: "windsurf", role: "competitor", mentions: 10, engagement: 100 },
  ]);
  assert.equal(sov[0].volumeShare, 0.75);
  assert.equal(sov[1].weightedShare, 0.25);
});

test("packXAccountBatches, mergeTopDomains, and extractCooccurringTerms behave deterministically", () => {
  const handles = Array.from({ length: 17 }, (_, i) => i === 0 ? "@Karpathy" : `user_${i}`);
  handles.push("karpathy", "invalid handle with space");
  const batches = packXAccountBatches(handles, 15);
  assert.equal(batches.length, 2);
  assert.equal(batches[0].length, 15);
  assert.equal(batches[1].length, 2);
  assert.equal(batches[0][0], "karpathy");

  const domains = mergeTopDomains([
    [{ domain: "github.com", count: 3, totalEngagement: 25.5 }, { domain: "arxiv.org", count: 2, totalEngagement: 10 }],
    [{ domain: "github.com", count: 2, totalEngagement: 14.5 }],
  ]);
  assert.equal(domains[0].domain, "github.com");
  assert.equal(domains[0].count, 5);
  assert.equal(domains[0].totalEngagement, 40);

  const terms = extractCooccurringTerms(
    [
      { title: "Cursor composer vs copilot performance", excerpt: "Using typescript monorepo indexing", hashtags: ["TypeScript", "AI"] },
      { title: "Cursor indexing speed on typescript", excerpt: "Works great with eslint", hashtags: ["TypeScript"] },
    ],
    ["cursor"],
    5,
  );
  assert.ok(terms.some((t) => t.term === "typescript" && t.count === 2));
  assert.ok(!terms.some((t) => t.term === "cursor"));
});
