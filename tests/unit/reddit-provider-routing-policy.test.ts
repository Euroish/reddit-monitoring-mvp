import assert from "node:assert/strict";
import test from "node:test";
import { stableUuidFromString } from "../../src/shared/ids/stable-id";
import {
  InMemoryCrawlCursorRepository,
  InMemoryProviderHealthWindowRepository,
} from "../../src/storage/repositories/in-memory/in-memory.repositories";
import {
  resolveRedditTargetExecutionRoute,
  type RedditProviderRoutingPolicyContext,
} from "../../src/runtime/reddit-provider-routing-policy";

const nowIso = "2026-04-18T12:00:00.000Z";
const targetId = stableUuidFromString("reddit:target:r/datascience");
const policyContext: RedditProviderRoutingPolicyContext = {
  defaultLiveProvider: "http",
  defaultScraplingProfile: "http",
  scraplingPrimaryCanonicalNames: ["r/datascience"],
  providerHealthLookbackMinutes: 30,
};

test("provider routing promotes configured targets to scrapling by default", async () => {
  const route = await resolveRedditTargetExecutionRoute({
    targetId,
    canonicalName: "r/datascience",
    crawlMode: "live",
    nowIso,
    defaultProviderHint: "http",
    policyContext,
  });

  assert.equal(route.providerHint, "scrapling");
  assert.equal(route.scraplingProfile, "http");
  assert.equal(route.routingClass, "scrapling_promoted");
});

test("provider routing escalates promoted scrapling targets to dynamic profile on stale-head evidence", async () => {
  const providerHealthWindowRepository = new InMemoryProviderHealthWindowRepository();
  await providerHealthWindowRepository.record({
    provider: "scrapling",
    targetId,
    mode: "live",
    windowStart: "2026-04-18T11:55:00.000Z",
    requestCountDelta: 4,
    successCountDelta: 4,
    emptyResponseCountDelta: 0,
    fallbackCountDelta: 0,
    candidateCountDelta: 40,
    acceptedCountDelta: 40,
    filteredOutCountDelta: 0,
    duplicatePostCountDelta: 30,
    ingestLagSecondsSumDelta: 30_000,
    ingestLagSampleCountDelta: 4,
    providerDiffCountDelta: 0,
    providerDiffSampleCountDelta: 0,
    errorCountDelta: 0,
    rateLimitCountDelta: 0,
    timeoutCountDelta: 0,
    circuitOpenCountDelta: 0,
    scraplingHttpProfileCountDelta: 4,
    scraplingDynamicProfileCountDelta: 0,
    scraplingSessionKeyCountDelta: 4,
    scraplingSessionKeyReuseCountDelta: 3,
    updatedAt: nowIso,
  });

  const route = await resolveRedditTargetExecutionRoute({
    targetId,
    canonicalName: "r/datascience",
    crawlMode: "live",
    nowIso,
    defaultProviderHint: "http",
    providerHealthWindowRepository,
    policyContext,
  });

  assert.equal(route.providerHint, "scrapling");
  assert.equal(route.scraplingProfile, "dynamic");
  assert.equal(route.routingClass, "scrapling_dynamic_escalation");
  assert.equal(route.reasons.includes("scrapling_stale_head_elevated"), true);
  assert.equal(route.reasons.includes("scrapling_session_key_evidence_ready"), true);
});

test("provider routing falls back promoted scrapling targets to http on transport degradation", async () => {
  const providerHealthWindowRepository = new InMemoryProviderHealthWindowRepository();
  const crawlCursorRepository = new InMemoryCrawlCursorRepository();
  await providerHealthWindowRepository.record({
    provider: "scrapling",
    targetId,
    mode: "live",
    windowStart: "2026-04-18T11:55:00.000Z",
    requestCountDelta: 10,
    successCountDelta: 8,
    emptyResponseCountDelta: 0,
    fallbackCountDelta: 0,
    candidateCountDelta: 24,
    acceptedCountDelta: 24,
    filteredOutCountDelta: 0,
    duplicatePostCountDelta: 0,
    ingestLagSecondsSumDelta: 0,
    ingestLagSampleCountDelta: 0,
    providerDiffCountDelta: 0,
    providerDiffSampleCountDelta: 0,
    errorCountDelta: 2,
    rateLimitCountDelta: 0,
    timeoutCountDelta: 2,
    circuitOpenCountDelta: 0,
    updatedAt: nowIso,
  });
  await crawlCursorRepository.upsert({
    provider: "scrapling",
    targetId,
    mode: "live",
    cursor: "t3_scrapling_cursor",
    lastFetchedAt: "2026-04-18T11:40:00.000Z",
    updatedAt: "2026-04-18T11:40:00.000Z",
  });

  const route = await resolveRedditTargetExecutionRoute({
    targetId,
    canonicalName: "r/datascience",
    crawlMode: "live",
    nowIso,
    defaultProviderHint: "http",
    providerHealthWindowRepository,
    crawlCursorRepository,
    policyContext,
  });

  assert.equal(route.providerHint, "http");
  assert.equal(route.scraplingProfile, null);
  assert.equal(route.routingClass, "scrapling_http_fallback");
  assert.equal(route.reasons.includes("scrapling_timeout_elevated"), true);
});

test("provider routing uses scrapling recovery probe when transport is degraded and cursor is long-stalled", async () => {
  const providerHealthWindowRepository = new InMemoryProviderHealthWindowRepository();
  const crawlCursorRepository = new InMemoryCrawlCursorRepository();
  await providerHealthWindowRepository.record({
    provider: "scrapling",
    targetId,
    mode: "live",
    windowStart: "2026-04-18T11:55:00.000Z",
    requestCountDelta: 10,
    successCountDelta: 6,
    emptyResponseCountDelta: 0,
    fallbackCountDelta: 0,
    candidateCountDelta: 24,
    acceptedCountDelta: 24,
    filteredOutCountDelta: 0,
    duplicatePostCountDelta: 0,
    ingestLagSecondsSumDelta: 0,
    ingestLagSampleCountDelta: 0,
    providerDiffCountDelta: 0,
    providerDiffSampleCountDelta: 0,
    errorCountDelta: 4,
    rateLimitCountDelta: 0,
    timeoutCountDelta: 3,
    circuitOpenCountDelta: 0,
    updatedAt: nowIso,
  });
  await crawlCursorRepository.upsert({
    provider: "scrapling",
    targetId,
    mode: "live",
    cursor: "t3_scrapling_long_stalled_cursor",
    lastFetchedAt: "2026-04-18T11:00:00.000Z",
    updatedAt: "2026-04-18T11:00:00.000Z",
  });

  const route = await resolveRedditTargetExecutionRoute({
    targetId,
    canonicalName: "r/datascience",
    crawlMode: "live",
    nowIso,
    defaultProviderHint: "http",
    providerHealthWindowRepository,
    crawlCursorRepository,
    policyContext,
  });

  assert.equal(route.providerHint, "scrapling");
  assert.equal(route.scraplingProfile, "dynamic");
  assert.equal(route.routingClass, "scrapling_promoted");
  assert.equal(route.reasons.includes("scrapling_recovery_probe_dynamic_profile"), true);
  assert.equal(route.reasons.includes("scrapling_recovery_probe"), true);
});

test("provider routing keeps promoted scrapling when recent transport window is healthy", async () => {
  const providerHealthWindowRepository = new InMemoryProviderHealthWindowRepository();
  await providerHealthWindowRepository.record({
    provider: "scrapling",
    targetId,
    mode: "live",
    windowStart: "2026-04-18T11:36:00.000Z",
    requestCountDelta: 10,
    successCountDelta: 6,
    emptyResponseCountDelta: 0,
    fallbackCountDelta: 0,
    candidateCountDelta: 24,
    acceptedCountDelta: 24,
    filteredOutCountDelta: 0,
    duplicatePostCountDelta: 0,
    ingestLagSecondsSumDelta: 0,
    ingestLagSampleCountDelta: 0,
    providerDiffCountDelta: 0,
    providerDiffSampleCountDelta: 0,
    errorCountDelta: 4,
    rateLimitCountDelta: 0,
    timeoutCountDelta: 0,
    circuitOpenCountDelta: 0,
    updatedAt: nowIso,
  });
  await providerHealthWindowRepository.record({
    provider: "scrapling",
    targetId,
    mode: "live",
    windowStart: "2026-04-18T11:58:00.000Z",
    requestCountDelta: 3,
    successCountDelta: 3,
    emptyResponseCountDelta: 0,
    fallbackCountDelta: 0,
    candidateCountDelta: 9,
    acceptedCountDelta: 9,
    filteredOutCountDelta: 0,
    duplicatePostCountDelta: 0,
    ingestLagSecondsSumDelta: 0,
    ingestLagSampleCountDelta: 0,
    providerDiffCountDelta: 0,
    providerDiffSampleCountDelta: 0,
    errorCountDelta: 0,
    rateLimitCountDelta: 0,
    timeoutCountDelta: 0,
    circuitOpenCountDelta: 0,
    updatedAt: nowIso,
  });

  const route = await resolveRedditTargetExecutionRoute({
    targetId,
    canonicalName: "r/datascience",
    crawlMode: "live",
    nowIso,
    defaultProviderHint: "http",
    providerHealthWindowRepository,
    policyContext,
  });

  assert.equal(route.providerHint, "scrapling");
  assert.equal(route.scraplingProfile, "http");
  assert.equal(route.routingClass, "scrapling_promoted");
  assert.equal(route.reasons.includes("scrapling_transport_recently_recovered"), true);
});

test("provider routing keeps fallback when healthy recovery sample is too small", async () => {
  const providerHealthWindowRepository = new InMemoryProviderHealthWindowRepository();
  await providerHealthWindowRepository.record({
    provider: "scrapling",
    targetId,
    mode: "live",
    windowStart: "2026-04-18T11:36:00.000Z",
    requestCountDelta: 10,
    successCountDelta: 6,
    emptyResponseCountDelta: 0,
    fallbackCountDelta: 0,
    candidateCountDelta: 24,
    acceptedCountDelta: 24,
    filteredOutCountDelta: 0,
    duplicatePostCountDelta: 0,
    ingestLagSecondsSumDelta: 0,
    ingestLagSampleCountDelta: 0,
    providerDiffCountDelta: 0,
    providerDiffSampleCountDelta: 0,
    errorCountDelta: 4,
    rateLimitCountDelta: 0,
    timeoutCountDelta: 0,
    circuitOpenCountDelta: 0,
    updatedAt: nowIso,
  });
  await providerHealthWindowRepository.record({
    provider: "scrapling",
    targetId,
    mode: "live",
    windowStart: "2026-04-18T11:58:00.000Z",
    requestCountDelta: 1,
    successCountDelta: 1,
    emptyResponseCountDelta: 0,
    fallbackCountDelta: 0,
    candidateCountDelta: 3,
    acceptedCountDelta: 3,
    filteredOutCountDelta: 0,
    duplicatePostCountDelta: 0,
    ingestLagSecondsSumDelta: 0,
    ingestLagSampleCountDelta: 0,
    providerDiffCountDelta: 0,
    providerDiffSampleCountDelta: 0,
    errorCountDelta: 0,
    rateLimitCountDelta: 0,
    timeoutCountDelta: 0,
    circuitOpenCountDelta: 0,
    updatedAt: nowIso,
  });

  const route = await resolveRedditTargetExecutionRoute({
    targetId,
    canonicalName: "r/datascience",
    crawlMode: "live",
    nowIso,
    defaultProviderHint: "http",
    providerHealthWindowRepository,
    policyContext,
  });

  assert.equal(route.providerHint, "http");
  assert.equal(route.scraplingProfile, null);
  assert.equal(route.routingClass, "scrapling_http_fallback");
});

test("provider routing uses recovery probe when degraded transport has no recent scrapling samples", async () => {
  const providerHealthWindowRepository = new InMemoryProviderHealthWindowRepository();
  await providerHealthWindowRepository.record({
    provider: "scrapling",
    targetId,
    mode: "live",
    windowStart: "2026-04-18T11:40:00.000Z",
    requestCountDelta: 6,
    successCountDelta: 3,
    emptyResponseCountDelta: 0,
    fallbackCountDelta: 0,
    candidateCountDelta: 18,
    acceptedCountDelta: 18,
    filteredOutCountDelta: 0,
    duplicatePostCountDelta: 0,
    ingestLagSecondsSumDelta: 0,
    ingestLagSampleCountDelta: 0,
    providerDiffCountDelta: 0,
    providerDiffSampleCountDelta: 0,
    errorCountDelta: 3,
    rateLimitCountDelta: 0,
    timeoutCountDelta: 0,
    circuitOpenCountDelta: 0,
    updatedAt: nowIso,
  });

  const route = await resolveRedditTargetExecutionRoute({
    targetId,
    canonicalName: "r/datascience",
    crawlMode: "live",
    nowIso,
    defaultProviderHint: "http",
    providerHealthWindowRepository,
    policyContext,
  });

  assert.equal(route.providerHint, "scrapling");
  assert.equal(route.scraplingProfile, "dynamic");
  assert.equal(route.routingClass, "scrapling_promoted");
  assert.equal(route.reasons.includes("scrapling_recovery_probe_dynamic_profile"), true);
  assert.equal(
    route.reasons.includes("scrapling_recovery_probe_no_recent_transport_samples"),
    true,
  );
});

test("provider routing does not fall back promoted scrapling targets on sparse transport errors", async () => {
  const nowIso = "2026-04-16T06:05:00.000Z";
  const providerHealthWindowRepository = new InMemoryProviderHealthWindowRepository();
  const crawlCursorRepository = new InMemoryCrawlCursorRepository();
  const targetId = "target-sparse-transport-errors";
  await providerHealthWindowRepository.record({
    provider: "scrapling",
    targetId,
    mode: "live",
    windowStart: "2026-04-16T06:00:00.000Z",
    requestCountDelta: 1,
    successCountDelta: 0,
    emptyResponseCountDelta: 0,
    fallbackCountDelta: 0,
    candidateCountDelta: 0,
    acceptedCountDelta: 0,
    filteredOutCountDelta: 0,
    duplicatePostCountDelta: 0,
    ingestLagSecondsSumDelta: 0,
    ingestLagSampleCountDelta: 0,
    providerDiffCountDelta: 0,
    providerDiffSampleCountDelta: 0,
    errorCountDelta: 1,
    rateLimitCountDelta: 0,
    timeoutCountDelta: 1,
    circuitOpenCountDelta: 0,
    updatedAt: nowIso,
  });
  await crawlCursorRepository.upsert({
    provider: "scrapling",
    targetId,
    mode: "live",
    cursor: "t3_sparse_error_cursor",
    lastFetchedAt: nowIso,
    updatedAt: nowIso,
  });

  const route = await resolveRedditTargetExecutionRoute({
    targetId,
    canonicalName: "r/datascience",
    crawlMode: "live",
    nowIso,
    defaultProviderHint: "http",
    providerHealthWindowRepository,
    crawlCursorRepository,
    policyContext,
  });

  assert.equal(route.providerHint, "scrapling");
  assert.equal(route.scraplingProfile, "http");
  assert.equal(route.routingClass, "scrapling_promoted");
  assert.equal(route.reasons.includes("scrapling_transport_degraded"), false);
});

test("provider routing does not fall back on stale scrapling cursor without recent scrapling evidence", async () => {
  const crawlCursorRepository = new InMemoryCrawlCursorRepository();
  await crawlCursorRepository.upsert({
    provider: "scrapling",
    targetId,
    mode: "live",
    cursor: "t3_legacy_scrapling_cursor",
    lastFetchedAt: "2026-04-18T10:00:00.000Z",
    updatedAt: "2026-04-18T10:00:00.000Z",
  });

  const route = await resolveRedditTargetExecutionRoute({
    targetId,
    canonicalName: "r/datascience",
    crawlMode: "live",
    nowIso,
    defaultProviderHint: "http",
    crawlCursorRepository,
    policyContext,
  });

  assert.equal(route.providerHint, "scrapling");
  assert.equal(route.scraplingProfile, "http");
  assert.equal(route.routingClass, "scrapling_promoted");
  assert.equal(route.reasons.includes("scrapling_cursor_stalled"), false);
});

test("provider routing does not demote to http on cursor stall alone when transport metrics are healthy", async () => {
  const providerHealthWindowRepository = new InMemoryProviderHealthWindowRepository();
  const crawlCursorRepository = new InMemoryCrawlCursorRepository();
  await providerHealthWindowRepository.record({
    provider: "scrapling",
    targetId,
    mode: "live",
    windowStart: "2026-04-18T11:55:00.000Z",
    requestCountDelta: 4,
    successCountDelta: 4,
    emptyResponseCountDelta: 0,
    fallbackCountDelta: 0,
    candidateCountDelta: 12,
    acceptedCountDelta: 12,
    filteredOutCountDelta: 0,
    duplicatePostCountDelta: 0,
    ingestLagSecondsSumDelta: 0,
    ingestLagSampleCountDelta: 0,
    providerDiffCountDelta: 0,
    providerDiffSampleCountDelta: 0,
    errorCountDelta: 0,
    rateLimitCountDelta: 0,
    timeoutCountDelta: 0,
    circuitOpenCountDelta: 0,
    updatedAt: nowIso,
  });
  await crawlCursorRepository.upsert({
    provider: "scrapling",
    targetId,
    mode: "live",
    cursor: "t3_stale_scrapling_cursor",
    lastFetchedAt: "2026-04-18T10:00:00.000Z",
    updatedAt: "2026-04-18T10:00:00.000Z",
  });

  const route = await resolveRedditTargetExecutionRoute({
    targetId,
    canonicalName: "r/datascience",
    crawlMode: "live",
    nowIso,
    defaultProviderHint: "http",
    providerHealthWindowRepository,
    crawlCursorRepository,
    policyContext,
  });

  assert.equal(route.providerHint, "scrapling");
  assert.equal(route.scraplingProfile, "http");
  assert.equal(route.routingClass, "scrapling_promoted");
});

test("provider routing does not escalate to dynamic without sufficient session-key evidence", async () => {
  const providerHealthWindowRepository = new InMemoryProviderHealthWindowRepository();
  await providerHealthWindowRepository.record({
    provider: "scrapling",
    targetId,
    mode: "live",
    windowStart: "2026-04-18T11:55:00.000Z",
    requestCountDelta: 4,
    successCountDelta: 4,
    emptyResponseCountDelta: 0,
    fallbackCountDelta: 0,
    candidateCountDelta: 40,
    acceptedCountDelta: 40,
    filteredOutCountDelta: 0,
    duplicatePostCountDelta: 30,
    ingestLagSecondsSumDelta: 30_000,
    ingestLagSampleCountDelta: 4,
    providerDiffCountDelta: 0,
    providerDiffSampleCountDelta: 0,
    errorCountDelta: 0,
    rateLimitCountDelta: 0,
    timeoutCountDelta: 0,
    circuitOpenCountDelta: 0,
    scraplingHttpProfileCountDelta: 4,
    scraplingDynamicProfileCountDelta: 0,
    scraplingSessionKeyCountDelta: 1,
    scraplingSessionKeyReuseCountDelta: 0,
    updatedAt: nowIso,
  });

  const route = await resolveRedditTargetExecutionRoute({
    targetId,
    canonicalName: "r/datascience",
    crawlMode: "live",
    nowIso,
    defaultProviderHint: "http",
    providerHealthWindowRepository,
    policyContext,
  });

  assert.equal(route.providerHint, "scrapling");
  assert.equal(route.scraplingProfile, "http");
  assert.equal(route.routingClass, "scrapling_promoted");
});

test("provider routing falls back to http when dynamic profile evidence is healthy but empty-window persists", async () => {
  const providerHealthWindowRepository = new InMemoryProviderHealthWindowRepository();
  await providerHealthWindowRepository.record({
    provider: "scrapling",
    targetId,
    mode: "live",
    windowStart: "2026-04-18T11:55:00.000Z",
    requestCountDelta: 6,
    successCountDelta: 6,
    emptyResponseCountDelta: 6,
    fallbackCountDelta: 0,
    candidateCountDelta: 60,
    acceptedCountDelta: 60,
    filteredOutCountDelta: 0,
    duplicatePostCountDelta: 60,
    ingestLagSecondsSumDelta: 60_000,
    ingestLagSampleCountDelta: 6,
    providerDiffCountDelta: 0,
    providerDiffSampleCountDelta: 0,
    errorCountDelta: 0,
    rateLimitCountDelta: 0,
    timeoutCountDelta: 0,
    circuitOpenCountDelta: 0,
    scraplingHttpProfileCountDelta: 1,
    scraplingDynamicProfileCountDelta: 5,
    scraplingSessionKeyCountDelta: 6,
    scraplingSessionKeyReuseCountDelta: 5,
    updatedAt: nowIso,
  });

  const route = await resolveRedditTargetExecutionRoute({
    targetId,
    canonicalName: "r/datascience",
    crawlMode: "live",
    nowIso,
    defaultProviderHint: "http",
    providerHealthWindowRepository,
    policyContext,
  });

  assert.equal(route.providerHint, "http");
  assert.equal(route.scraplingProfile, null);
  assert.equal(route.routingClass, "scrapling_http_fallback");
  assert.equal(
    route.reasons.includes("scrapling_dynamic_exhausted_http_fallback"),
    true,
  );
  assert.equal(route.reasons.includes("scrapling_empty_window_elevated"), true);
});

test("provider routing does not apply dynamic-exhausted fallback on sparse stale-head samples", async () => {
  const providerHealthWindowRepository = new InMemoryProviderHealthWindowRepository();
  await providerHealthWindowRepository.record({
    provider: "scrapling",
    targetId,
    mode: "live",
    windowStart: "2026-04-18T11:55:00.000Z",
    requestCountDelta: 2,
    successCountDelta: 2,
    emptyResponseCountDelta: 0,
    fallbackCountDelta: 0,
    candidateCountDelta: 20,
    acceptedCountDelta: 20,
    filteredOutCountDelta: 0,
    duplicatePostCountDelta: 12,
    ingestLagSecondsSumDelta: 20_000,
    ingestLagSampleCountDelta: 2,
    providerDiffCountDelta: 0,
    providerDiffSampleCountDelta: 0,
    errorCountDelta: 0,
    rateLimitCountDelta: 0,
    timeoutCountDelta: 0,
    circuitOpenCountDelta: 0,
    scraplingHttpProfileCountDelta: 0,
    scraplingDynamicProfileCountDelta: 2,
    scraplingSessionKeyCountDelta: 2,
    scraplingSessionKeyReuseCountDelta: 2,
    updatedAt: nowIso,
  });

  const route = await resolveRedditTargetExecutionRoute({
    targetId,
    canonicalName: "r/datascience",
    crawlMode: "live",
    nowIso,
    defaultProviderHint: "http",
    providerHealthWindowRepository,
    policyContext,
  });

  assert.equal(route.providerHint, "scrapling");
  assert.equal(route.scraplingProfile, "dynamic");
  assert.equal(route.routingClass, "scrapling_dynamic_escalation");
  assert.equal(
    route.reasons.includes("scrapling_dynamic_exhausted_http_fallback"),
    false,
  );
  assert.equal(route.reasons.includes("scrapling_dynamic_steady_state"), true);
});

test("provider routing keeps dynamic steady-state when dynamic profile evidence is ready and healthy", async () => {
  const providerHealthWindowRepository = new InMemoryProviderHealthWindowRepository();
  await providerHealthWindowRepository.record({
    provider: "scrapling",
    targetId,
    mode: "live",
    windowStart: "2026-04-18T11:55:00.000Z",
    requestCountDelta: 6,
    successCountDelta: 6,
    emptyResponseCountDelta: 0,
    fallbackCountDelta: 0,
    candidateCountDelta: 24,
    acceptedCountDelta: 24,
    filteredOutCountDelta: 0,
    duplicatePostCountDelta: 0,
    ingestLagSecondsSumDelta: 0,
    ingestLagSampleCountDelta: 0,
    providerDiffCountDelta: 0,
    providerDiffSampleCountDelta: 0,
    errorCountDelta: 0,
    rateLimitCountDelta: 0,
    timeoutCountDelta: 0,
    circuitOpenCountDelta: 0,
    scraplingHttpProfileCountDelta: 0,
    scraplingDynamicProfileCountDelta: 6,
    scraplingSessionKeyCountDelta: 6,
    scraplingSessionKeyReuseCountDelta: 5,
    updatedAt: nowIso,
  });

  const route = await resolveRedditTargetExecutionRoute({
    targetId,
    canonicalName: "r/datascience",
    crawlMode: "live",
    nowIso,
    defaultProviderHint: "http",
    providerHealthWindowRepository,
    policyContext,
  });

  assert.equal(route.providerHint, "scrapling");
  assert.equal(route.scraplingProfile, "dynamic");
  assert.equal(route.routingClass, "scrapling_dynamic_escalation");
  assert.equal(route.reasons.includes("scrapling_dynamic_steady_state"), true);
});

test("provider routing does not apply dynamic-exhausted fallback below dedicated sample threshold", async () => {
  const providerHealthWindowRepository = new InMemoryProviderHealthWindowRepository();
  await providerHealthWindowRepository.record({
    provider: "scrapling",
    targetId,
    mode: "live",
    windowStart: "2026-04-18T11:55:00.000Z",
    requestCountDelta: 5,
    successCountDelta: 5,
    emptyResponseCountDelta: 5,
    fallbackCountDelta: 0,
    candidateCountDelta: 50,
    acceptedCountDelta: 50,
    filteredOutCountDelta: 0,
    duplicatePostCountDelta: 35,
    ingestLagSecondsSumDelta: 40_000,
    ingestLagSampleCountDelta: 5,
    providerDiffCountDelta: 0,
    providerDiffSampleCountDelta: 0,
    errorCountDelta: 0,
    rateLimitCountDelta: 0,
    timeoutCountDelta: 0,
    circuitOpenCountDelta: 0,
    scraplingHttpProfileCountDelta: 0,
    scraplingDynamicProfileCountDelta: 5,
    scraplingSessionKeyCountDelta: 5,
    scraplingSessionKeyReuseCountDelta: 5,
    updatedAt: nowIso,
  });

  const route = await resolveRedditTargetExecutionRoute({
    targetId,
    canonicalName: "r/datascience",
    crawlMode: "live",
    nowIso,
    defaultProviderHint: "http",
    providerHealthWindowRepository,
    policyContext,
  });

  assert.equal(route.providerHint, "scrapling");
  assert.equal(route.scraplingProfile, "dynamic");
  assert.equal(route.routingClass, "scrapling_dynamic_escalation");
  assert.equal(
    route.reasons.includes("scrapling_dynamic_exhausted_http_fallback"),
    false,
  );
});

test("provider routing defers dynamic-exhausted fallback when recovery window is healthy", async () => {
  const providerHealthWindowRepository = new InMemoryProviderHealthWindowRepository();
  await providerHealthWindowRepository.record({
    provider: "scrapling",
    targetId,
    mode: "live",
    windowStart: "2026-04-18T11:40:00.000Z",
    requestCountDelta: 20,
    successCountDelta: 20,
    emptyResponseCountDelta: 20,
    fallbackCountDelta: 0,
    candidateCountDelta: 200,
    acceptedCountDelta: 200,
    filteredOutCountDelta: 0,
    duplicatePostCountDelta: 0,
    ingestLagSecondsSumDelta: 0,
    ingestLagSampleCountDelta: 20,
    providerDiffCountDelta: 0,
    providerDiffSampleCountDelta: 0,
    errorCountDelta: 0,
    rateLimitCountDelta: 0,
    timeoutCountDelta: 0,
    circuitOpenCountDelta: 0,
    scraplingHttpProfileCountDelta: 0,
    scraplingDynamicProfileCountDelta: 20,
    scraplingSessionKeyCountDelta: 20,
    scraplingSessionKeyReuseCountDelta: 18,
    updatedAt: nowIso,
  });
  await providerHealthWindowRepository.record({
    provider: "scrapling",
    targetId,
    mode: "live",
    windowStart: "2026-04-18T11:58:00.000Z",
    requestCountDelta: 3,
    successCountDelta: 3,
    emptyResponseCountDelta: 0,
    fallbackCountDelta: 0,
    candidateCountDelta: 30,
    acceptedCountDelta: 30,
    filteredOutCountDelta: 0,
    duplicatePostCountDelta: 0,
    ingestLagSecondsSumDelta: 0,
    ingestLagSampleCountDelta: 3,
    providerDiffCountDelta: 0,
    providerDiffSampleCountDelta: 0,
    errorCountDelta: 0,
    rateLimitCountDelta: 0,
    timeoutCountDelta: 0,
    circuitOpenCountDelta: 0,
    scraplingHttpProfileCountDelta: 0,
    scraplingDynamicProfileCountDelta: 3,
    scraplingSessionKeyCountDelta: 3,
    scraplingSessionKeyReuseCountDelta: 3,
    updatedAt: nowIso,
  });

  const route = await resolveRedditTargetExecutionRoute({
    targetId,
    canonicalName: "r/datascience",
    crawlMode: "live",
    nowIso,
    defaultProviderHint: "http",
    providerHealthWindowRepository,
    policyContext,
  });

  assert.equal(route.providerHint, "scrapling");
  assert.equal(route.scraplingProfile, "dynamic");
  assert.equal(route.routingClass, "scrapling_dynamic_escalation");
  assert.equal(
    route.reasons.includes("scrapling_dynamic_exhausted_http_fallback"),
    false,
  );
  assert.equal(
    route.reasons.includes("scrapling_dynamic_exhausted_deferred_recovery_window"),
    true,
  );
});
