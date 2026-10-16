import assert from "node:assert/strict";
import test from "node:test";
import type { Content } from "../../src/domain/entities/content";
import type { PostEngagementLatest } from "../../src/domain/entities/post-engagement";
import type { SubredditDailyFact } from "../../src/domain/entities/subreddit-daily-fact";
import { buildTargetWorkbenchReadModel } from "../../src/application/services/target-workbench-read-model.service";
import { buildTargetWorkbenchFromRefreshContract } from "../../src/application/services/workbench-refresh-contract.service";
import { createApiTestRepositories } from "../integration/api-server.helpers";

const fromIso = "2026-04-23T00:00:00.000Z";
const toIso = "2026-04-24T23:59:59.000Z";
const target = {
  id: "capture-target", source: "reddit" as const, targetType: "subreddit" as const,
  canonicalName: "r/capture", status: "active" as const, config: {},
  createdAt: fromIso, updatedAt: toIso,
};

function content(id: string, overrides: Partial<Content> = {}): Content {
  return { id, targetId: target.id, source: "reddit", externalId: id, kind: "post", title: id,
    permalink: `https://www.reddit.com/r/capture/comments/${id}/`,
    createdAtSource: "2026-04-20T12:00:00.000Z", firstSeenAt: "2026-04-24T12:00:00.000Z",
    lastSeenAt: toIso, firstListing: "new", ...overrides };
}

function engagement(id: string, score?: number, numComments?: number): PostEngagementLatest {
  return { contentId: id, targetId: target.id, source: "reddit", observedAt: toIso,
    score, numComments, collectionJobId: "capture-job" };
}

function fact(day: string, overrides: Partial<SubredditDailyFact> = {}): SubredditDailyFact {
  return { targetId: target.id, day, postVolume: 12, qualifiedPostVolume: 4, sampledPostVolume: 12,
    scoreSum: 60, commentSum: 24, subscriberCount: 50_000, activeUserCount: 100,
    activePostRatio: 0.3, dispersionScore: 0.5, impactScoreSum: 10, impactPostVolume: 2,
    topImpactShare: 0.4, heatPrice: 20, heatChangePct: 0, ema7: 20, ema30: 20,
    subredditTier: "small", qualityThresholdScore: 15, qualityThresholdComments: 5,
    algorithmVersion: "capture-semantics-test", explainPayload: {},
    ...overrides };
}

function model(overrides: Partial<Parameters<typeof buildTargetWorkbenchReadModel>[0]> = {}) {
  return buildTargetWorkbenchReadModel({ requestId: "capture-semantics", generatedAtIso: toIso,
    target, fromIso, toIso, dailyFacts: [fact("2026-04-24")], trendPoints: [], keywordDailyRows: [],
    postGrowthFacts: [], contents: [], anomalyEvents: [], providerHealthWindows: [], ...overrides });
}

test("omitted capture input stays unavailable while a supplied empty window is a real zero", () => {
  const omitted = model();
  assert.equal(omitted.composition.scope.availability, "unavailable");
  assert.equal(omitted.composition.fetchedPostCount, null);
  assert.equal(omitted.composition.qualifiedPostCount, null);
  assert.equal(omitted.composition.knownQualifiedPostCount, null);
  assert.equal(omitted.composition.qualificationUnknownPostCount, null);
  const empty = model({ capturedContents: [] });
  assert.equal(empty.composition.scope.availability, "available");
  assert.equal(empty.composition.fetchedPostCount, 0);
  assert.equal(empty.composition.qualifiedPostCount, 0);
  assert.equal(empty.composition.qualificationEvaluatedPostCount, 0);
  assert.equal(empty.series.find((series) => series.id === "total_new_posts")?.points.at(-1)?.value, 12);
  assert.equal(empty.series.find((series) => series.id === "qualified_post_count")?.points.at(-1)?.value, 4);
});

test("known zero engagement gives zero qualified captures without replacing publication-day facts", () => {
  const response = model({ capturedContents: [content("zero")], capturedLatestEngagements: [engagement("zero", 0, 0)] });
  assert.equal(response.composition.fetchedPostCount, 1);
  assert.equal(response.composition.qualifiedPostCount, 0);
  assert.equal(response.composition.qualificationUnknownPostCount, 0);
  assert.deepEqual(response.composition.engagementMix, [{ id: "quiet", label: "Quiet", count: 1 }]);
  assert.equal(response.series.find((series) => series.id === "total_new_posts")?.points.at(-1)?.value, 12);
  assert.equal(response.series.find((series) => series.id === "qualified_post_count")?.points.at(-1)?.value, 4);
});

test("missing, partial and out-of-window engagement stay unknown in the same capture denominator", () => {
  const future = { ...engagement("future", 100, 50), observedAt: "2026-04-25T00:00:00.000Z" };
  const response = model({ capturedContents: [content("qualified"), content("partial"), content("missing"), content("future")],
    capturedLatestEngagements: [engagement("qualified", 30, 8), engagement("partial", 0), future] });
  assert.equal(response.composition.fetchedPostCount, 4);
  assert.equal(response.composition.qualifiedPostCount, null);
  assert.equal(response.composition.knownQualifiedPostCount, 1);
  assert.equal(response.composition.qualificationEvaluatedPostCount, 1);
  assert.equal(response.composition.qualificationUnknownPostCount, 3);
  assert.equal(response.composition.engagementMix.find((segment) => segment.id === "unknown")?.count, 3);
  assert.equal(response.composition.engagementMix.some((segment) => segment.id === "quiet"), false);
  assert.equal(response.composition.classificationMix.find((segment) => segment.id === "unknown")?.count, 3);
  assert.equal(response.composition.classificationMix.reduce((sum, segment) => sum + segment.count, 0), 4);
});

test("first-discovery boundaries and thresholds do not use the different publication day", () => {
  const captured = [content("from", { firstSeenAt: fromIso }), content("to", { firstSeenAt: toIso, createdAtSource: fromIso }),
    content("outside", { firstSeenAt: "2026-04-25T00:00:00.000Z" })];
  const response = model({ capturedContents: captured, capturedLatestEngagements: [engagement("from", 30, 0), engagement("to", 30, 0)],
    dailyFacts: [fact("2026-04-23", { qualityThresholdScore: 15 }), fact("2026-04-24", { qualityThresholdScore: 50 })] });
  assert.equal(response.composition.fetchedPostCount, 2);
  assert.equal(response.composition.qualifiedPostCount, 1);
  assert.equal(response.composition.scope.timeBasis, "first_seen_at");
  assert.equal(response.composition.scope.boundary, "inclusive");
  assert.equal(response.composition.scope.engagementAsOfIso, toIso);
  assert.deepEqual(response.series.find((series) => series.id === "total_new_posts")?.points.map((point) => point.value), [12, 12]);
});

test("refresh contract detects 20,000-row truncation with a sentinel without overstating all captures", async () => {
  const repos = createApiTestRepositories();
  await repos.monitorTargetRepository.upsert(target);
  await repos.contentRepository.upsertMany(Array.from({ length: 20_001 }, (_, index) => content(`sample-${index}`)));
  const response = await buildTargetWorkbenchFromRefreshContract(repos, { requestId: "capture-sentinel", generatedAtIso: toIso,
    canonicalName: target.canonicalName, fromIso, toIso, keywordLimit: 10, driverLimit: 10, anomalyLimit: 10, normalizedQueries: [] });
  assert.equal("ok" in response, true);
  if (!("ok" in response)) throw new Error("target fixture missing");
  assert.equal(response.composition.scope.truncated, true);
  assert.equal(response.composition.scope.limit, 20_000);
  assert.equal(response.composition.fetchedPostCount, 20_000);
  assert.equal(response.composition.qualifiedPostCount, null);
  assert.equal(response.composition.qualificationUnknownPostCount, 20_000);
});
