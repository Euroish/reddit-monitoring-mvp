import assert from "node:assert/strict";
import test from "node:test";
import { KaixContentConnector } from "../../src/connectors/reddit/kaix-content.connector";
import { resolveKaixConfig } from "../../src/connectors/reddit/kaix.config";
import { SourceContentService } from "../../src/application/services/source-content.service";
import { ContentProviderError } from "../../src/connectors/shared/content-provider.interface";
import { InMemorySourceContentRepository } from "../../src/storage/repositories/in-memory/source-content.repository";
import { KAIX_NOW, kaixFixture, kaixPost, verifyKaixPipeline } from "../helpers/kaix-content-fixtures";
import { syntheticSource } from "../helpers/source-content-fixtures";

const source = syntheticSource({ provider: "kaix", target: { type: "search", query: "AI tool" } });
const request = { source, from: "2026-11-13T00:00:00Z", to: KAIX_NOW, limit: 5, checkpoint: null };
test("kaix flows through paid budgets, jobs, storage, statistics and export", async () => { await verifyKaixPipeline(new InMemorySourceContentRepository()); });

test("kaix uses bounded pinned runs and filters irrelevant/out-of-window rows without claiming complete coverage", async () => {
  const fixture = kaixFixture([kaixPost(), kaixPost({ id: "wrong1", fullName: "t3_wrong1", title: "Unrelated" }), kaixPost({ id: "old123", fullName: "t3_old123", createdUtc: 1 })]);
  const page = await fixture.connector.collectPage(request);
  assert.equal(page.items.length, 1); assert.equal(page.coverage, "partial"); assert.equal(page.exhausted, true);
  const { url, init } = fixture.requests[0], input = JSON.parse(String(init?.body));
  assert.equal(url.searchParams.get("build"), "0.2.25"); assert.equal(url.searchParams.get("timeout"), "45"); assert.equal(url.searchParams.get("maxTotalChargeUsd"), "0.01");
  assert.equal(input.maxItems, 5); assert.equal(input.includeComments, false); assert.equal(input.sort, "new"); assert.deepEqual(input.proxyConfiguration, { useApifyProxy: false });
  assert.match(page.warning!, /no continuation/);
});

test("kaix comments retain long string identities, parents and deletion markers", async () => {
  const id = "19riqx8r047lt", row = { type: "comment", id, fullName: `t1_${id}`, parentId: "t1_parent123", linkId: "t3_abc123", subreddit: "testcommunity", createdUtc: kaixPost().createdUtc, body: "[deleted]", score: null };
  const fixture = kaixFixture([kaixPost({ id: "abc123", fullName: "t3_abc123" }), row]);
  const page = await fixture.connector.collectPage({ ...request, source: syntheticSource({ provider: "kaix", contentKind: "comment", target: { type: "post", postId: "abc123" } }), limit: 1 });
  assert.equal(page.items.length, 1); assert.equal(page.items[0].externalId, `t1_${id}`); assert.equal(page.items[0].availability, "deleted"); assert.equal(page.items[0].text, null);
  assert.deepEqual(page.items[0].references.map(ref => ref.relation), ["reply_to", "thread_root"]);
  const input = JSON.parse(String(fixture.requests[0].init?.body)); assert.equal(input.maxCommentsPerPost, 1); assert.equal(input.maxItems, 1);
});

test("kaix rejects unsupported targets, missing credentials, checkpoints and invalid limits before network", async () => {
  const fixture = kaixFixture();
  assert.throws(() => fixture.connector.normalizeTarget({ type: "community", community: "testcommunity" }, "comment"), /community targets/);
  assert.throws(() => fixture.connector.normalizeTarget({ type: "search", query: "x" }, "comment"), /posts only/);
  assert.throws(() => fixture.connector.normalizeTarget({ type: "account", account: "https://localhost" }, "post"), /identifier/);
  assert.throws(() => resolveKaixConfig({ APIFY_API_TOKEN: "bad\nvalue" }), /header/);
  await assert.rejects(new KaixContentConnector({ networkEnabled: true }).collectPage(request), /disabled/);
  await assert.rejects(fixture.connector.collectPage({ ...request, checkpoint: "cursor" }), /continuation/);
  await assert.rejects(fixture.connector.collectPage({ ...request, limit: 0 }), /1–100/);
  const controller = new AbortController(); controller.abort(); await assert.rejects(fixture.connector.collectPage({ ...request, signal: controller.signal }));
  assert.equal(fixture.requests.length, 0);
});

test("kaix never turns failed/ambiguous paid runs into automatic retries or empty successful pages", async () => {
  for (const response of [new Response("secret-upstream-error", { status: 429 }), Response.json({ data: { id: "fixtureRun", status: "RUNNING" } }), Response.json({ data: { id: "fixtureRun", status: "FAILED" } }), new Response("not-json")]) {
    const connector = new KaixContentConnector({ networkEnabled: true, apiToken: "synthetic-token" }, async () => response);
    await assert.rejects(connector.collectPage(request), error => error instanceof ContentProviderError && !error.retryable && !error.message.includes("secret-upstream-error"));
  }
});

test("paid replay fence survives a worker interruption; explicit Retry permits a new operation", async () => {
  const repository = new InMemorySourceContentRepository(), fixture = kaixFixture();
  let now = KAIX_NOW;
  const service = new SourceContentService(repository, fixture.connector, () => now);
  const created = await service.createSource({ platform: "reddit", provider: "kaix", contentKind: "post", target: { type: "search", query: "AI tool" } });
  await service.setProviderBudget("kaix", { enabled: true, dailyRequests: 3, monthlyRequests: 3, dailyResources: 303, monthlyResources: 303 });
  const job = await service.enqueue(created.id, { from: request.from, to: request.to, pageSize: 5, maxPages: 1 });
  const claim = (await repository.claim(now))!; await repository.beginRequestAttempt(claim, now);
  now = "2026-11-13T12:03:00Z"; await service.workOnce();
  assert.equal((await service.getJob(job.id)).status, "failed"); assert.equal(fixture.requests.length, 0);
  assert.equal((await repository.getSource(created.id))?.automaticCollectionBlocked, true);
  await service.retryJob(job.id); await service.workOnce(); assert.equal((await service.getJob(job.id)).status, "succeeded");
  assert.equal(fixture.requests.length, 2);
});

test("shutdown after a paid POST blocks resubmission even when the worker signal is aborted", async () => {
  const repository = new InMemorySourceContentRepository(), controller = new AbortController(); let calls = 0;
  const connector = new KaixContentConnector({ networkEnabled: true, apiToken: "synthetic-token" }, async () => { calls++; controller.abort(); throw Error("synthetic network interruption"); });
  const service = new SourceContentService(repository, connector, () => KAIX_NOW);
  const created = await service.createSource({ platform: "reddit", provider: "kaix", contentKind: "post", target: { type: "search", query: "AI tool" } });
  await service.setProviderBudget("kaix", { enabled: true, dailyRequests: 3, monthlyRequests: 3, dailyResources: 303, monthlyResources: 303 });
  const job = await service.enqueue(created.id, { from: request.from, to: request.to, pageSize: 5, maxPages: 1 });
  await service.workOnce(controller.signal); await service.workOnce();
  assert.equal((await service.getJob(job.id)).status, "failed"); assert.equal((await service.getJob(job.id)).failureKind, "permanent"); assert.equal(calls, 1);
});
