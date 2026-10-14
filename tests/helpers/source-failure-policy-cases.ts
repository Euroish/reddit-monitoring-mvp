import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { SourceContentRepository } from "../../src/domain/repositories/source-content-repository";
import { SourceContentService, SourceContentError } from "../../src/application/services/source-content.service";
import { DemoContentProvider } from "../../src/connectors/demo/demo-content.connector";
import { ContentProviderError, type ContentProvider } from "../../src/connectors/shared/content-provider.interface";
import { FIXED_CONTENT_NOW } from "./source-content-fixtures";
import { fixtureConnector, syntheticRedditPost } from "./source-content-fixtures";

export const sourceFailurePolicyCases: { name: string; run: (repository: SourceContentRepository) => Promise<void> }[] = [
  { name: "permanent scheduled failure blocks every automatic purpose until explicit Retry succeeds", run: async repository => {
    let now = FIXED_CONTENT_NOW, calls = 0, broken = true;
    const base = new DemoContentProvider("reddit", () => now);
    const provider: ContentProvider = { capability: base.capability, normalizeTarget: base.normalizeTarget.bind(base), collectPage: async request => {
      calls++;
      if (broken) throw new ContentProviderError("Synthetic HTTP 403", false, 30, 403);
      return base.collectPage(request);
    } };
    const service = new SourceContentService(repository, provider, () => now);
    const source = await service.createSource({ platform: "reddit", provider: "demo_reddit", contentKind: "post", target: { type: "community", community: "failure_scheduled" } });
    await service.updateSource(source.id, { schedule: { enabled: true, cadenceSeconds: 60, recheckLookbackHours: 12, initialLookbackHours: 6, maxCatchupHours: 6 } });
    // The overdue scheduled job must precede the new retrospective job deterministically.
    await repository.enqueue({ id: randomUUID(), sourceId: source.id, now: new Date(Date.parse(now) - 1000).toISOString(), from: new Date(Date.parse(now) - 21_600_000).toISOString(), to: now, pageSize: 25, maxPages: 5, purpose: "scheduled" });
    const revision = (await repository.getSource(source.id))!.revision;
    await service.workOnce();
    const failed = (await repository.listJobs({ sourceId: source.id })).find(job => job.status === "failed")!;
    assert.ok(failed);
    assert.equal(failed.purpose, "scheduled");
    now = new Date(Date.parse(now) + 61_000).toISOString();
    assert.equal(await service.workOnce(), false, "Existing queued recheck and later cadences must stay blocked");
    assert.equal(calls, 1, "A permanent error cannot create another automatic request");
    assert.equal((await repository.getSource(source.id))!.automaticCollectionBlocked, true);
    assert.equal((await repository.getSource(source.id))!.revision, revision, "Operational fencing does not change configuration revision");
    assert.equal((await repository.getJob(failed.id))!.failureKind, "permanent");
    assert.equal((await service.ops()).sources.find(item => item.sourceId === source.id)!.oldestPendingAt, FIXED_CONTENT_NOW);
    await assert.rejects(service.enqueue(source.id), (error: unknown) => error instanceof SourceContentError && error.status === 409);
    broken = false;
    const retried = await service.retryJob(failed.id);
    assert.equal(retried.id, failed.id);
    assert.equal((await repository.getSource(source.id))!.automaticCollectionBlocked, false);
    await service.workOnce();
    await service.workOnce();
    assert.equal(calls, 3, "Retry releases the failed job and the previously fenced recheck");
    assert.equal((await repository.getJob(failed.id))!.status, "succeeded");
  } },
  { name: "failed refresh rounds count actual attempts, respect cooldown/max rounds, and retain three transient requests per round", run: async repository => {
    let now = FIXED_CONTENT_NOW, refreshCalls = 0;
    const base = fixtureConnector([{ rows: [syntheticRedditPost({ _meta: {} })] }]);
    const provider: ContentProvider = { capability: base.capability, normalizeTarget: base.normalizeTarget.bind(base), collectPage: base.collectPage.bind(base), refreshIds: async () => {
      refreshCalls++;
      throw new ContentProviderError("Synthetic temporary refresh failure", true, 5, 429);
    } };
    const service = new SourceContentService(repository, provider, () => now);
    const source = await service.createSource({ platform: "reddit", provider: "arctic_shift", contentKind: "post", target: { type: "community", community: "testcommunity" } });
    await service.enqueue(source.id, { from: "2026-10-09", to: now });
    await service.workOnce();
    await service.updateSource(source.id, { refresh: { enabled: true, maxAttempts: 2, minIntervalHours: 1 } });
    await service.setProviderBudget("arctic_shift", { enabled: false, dailyRequests: 0, monthlyRequests: 0, dailyResources: 0, monthlyResources: 0 });
    await service.workOnce();
    assert.equal(refreshCalls, 0, "Budget rejection cannot spend a refresh round");
    await service.setProviderBudget("arctic_shift", { enabled: true, dailyRequests: 100, monthlyRequests: 100, dailyResources: 10_000, monthlyResources: 10_000 });
    for (let attempt = 0; attempt < 3; attempt++) { await service.workOnce(); now = new Date(Date.parse(now) + 6_000).toISOString(); }
    assert.equal(refreshCalls, 3);
    assert.equal(await service.workOnce(), false, "A failed round must not be recreated before its one-hour cooldown");
    assert.equal((await repository.getSource(source.id))!.automaticCollectionBlocked, false, "Exhausted transient retries remain recoverable");
    now = new Date(Date.parse(FIXED_CONTENT_NOW) + 3_600_000).toISOString();
    for (let attempt = 0; attempt < 3; attempt++) { await service.workOnce(); now = new Date(Date.parse(now) + 6_000).toISOString(); }
    assert.equal(refreshCalls, 6, "The second round remains eligible because the budget denial did not spend a round");
    now = new Date(Date.parse(FIXED_CONTENT_NOW) + 7_200_000).toISOString();
    assert.equal(await service.workOnce(), false, "Two failed automatic rounds exhaust maxAttempts=2");
    assert.equal((await repository.listJobs({ sourceId: source.id })).filter(job => job.purpose === "refresh").length, 2);
    assert.equal((await repository.providerUsage(now)).find(item => item.provider === "arctic_shift")!.dailyRequests, 7, "Each actual request, including retries, keeps its reservation");
  } },
  { name: "budget deferral and wake-up cannot reset the three-request transient page limit", run: async repository => {
    let now = "2026-10-12T10:00:00.000Z", calls = 0;
    const base = new DemoContentProvider("reddit", () => now);
    const provider: ContentProvider = { capability: base.capability, normalizeTarget: base.normalizeTarget.bind(base), collectPage: async () => {
      calls++; throw new ContentProviderError("Synthetic temporary page failure", true, 5, 429);
    } };
    const service = new SourceContentService(repository, provider, () => now);
    const source = await service.createSource({ platform: "reddit", provider: "demo_reddit", contentKind: "post", target: { type: "community", community: "failure_budget" } });
    await service.setProviderBudget("demo_reddit", { enabled: true, dailyRequests: 1, monthlyRequests: 10, dailyResources: 25, monthlyResources: 250 });
    const job = await service.enqueue(source.id, { pageSize: 25 });
    for (let day = 12; day <= 14; day++) {
      now = `2026-10-${day}T10:00:00.000Z`;
      await service.workOnce();
      if (day < 14) {
        now = new Date(Date.parse(now) + 6_000).toISOString();
        await service.workOnce();
        assert.equal((await repository.getJob(job.id))!.status, "retrying");
        assert.equal((await repository.getJob(job.id))!.attempts, 0);
      }
    }
    assert.equal(calls, 3);
    assert.equal((await repository.getJob(job.id))!.status, "failed", "Three actual transient requests terminate even when daily budget denials reset claim attempts");
    assert.equal((await repository.getJob(job.id))!.failureKind, "transient");
    now = "2026-10-15T10:00:00.000Z";
    assert.equal(await service.workOnce(), false);
    assert.equal(calls, 3);
  } },
  { name: "permanent refresh failure stops polling and explicit Retry authorizes one extra bounded round", run: async repository => {
    let now = FIXED_CONTENT_NOW, refreshCalls = 0, broken = true;
    const base = fixtureConnector([{ rows: [syntheticRedditPost({ _meta: {} })] }]);
    const provider: ContentProvider = { capability: base.capability, normalizeTarget: base.normalizeTarget.bind(base), collectPage: base.collectPage.bind(base), refreshIds: async () => {
      refreshCalls++;
      if (broken) throw new ContentProviderError("Synthetic HTTP 403", false, 30, 403);
      return { items: [], nextCheckpoint: null, exhausted: true, coverage: "partial", warning: "Requested ID unavailable; absence is not deletion" };
    } };
    const service = new SourceContentService(repository, provider, () => now);
    const source = await service.createSource({ platform: "reddit", provider: "arctic_shift", contentKind: "post", target: { type: "community", community: "testcommunity" } });
    await service.enqueue(source.id, { from: "2026-10-09", to: now }); await service.workOnce();
    await service.updateSource(source.id, { refresh: { enabled: true, maxAttempts: 1, minIntervalHours: 12 } });
    await service.workOnce();
    const failed = (await repository.listJobs({ sourceId: source.id })).find(job => job.purpose === "refresh")!;
    assert.equal(failed.status, "failed"); assert.equal(failed.failureKind, "permanent");
    for (let tick = 0; tick < 3; tick++) { now = new Date(Date.parse(now) + 60_000).toISOString(); assert.equal(await service.workOnce(), false); }
    assert.equal(refreshCalls, 1);
    broken = false; await service.retryJob(failed.id); await service.workOnce();
    assert.equal(refreshCalls, 2, "Explicit Retry allows an extra round beyond the automatic limit/cooldown");
    assert.equal((await repository.getJob(failed.id))!.status, "succeeded");
    assert.equal((await repository.getJob(failed.id))!.coverage, "partial");
    now = new Date(Date.parse(now) + 86_400_000).toISOString();
    assert.equal(await service.workOnce(), false); assert.equal(refreshCalls, 2);
  } },
  { name: "blocked source cannot resume via Continue, new collection, lifecycle resume, or source settings", run: async repository => {
    const now = FIXED_CONTENT_NOW; let broken = false;
    const base = new DemoContentProvider("reddit", () => now);
    const provider: ContentProvider = { capability: base.capability, normalizeTarget: base.normalizeTarget.bind(base), collectPage: async request => {
      if (broken) throw new ContentProviderError("Synthetic permanent failure", false);
      return base.collectPage(request);
    } };
    const service = new SourceContentService(repository, provider, () => now);
    const source = await service.createSource({ platform: "reddit", provider: "demo_reddit", contentKind: "post", target: { type: "community", community: "failure_continue" } });
    const bounded = await service.enqueue(source.id, { pageSize: 1, maxPages: 1 }); await service.workOnce();
    assert.ok((await repository.getJob(bounded.id))!.checkpoint);
    broken = true;
    const failed = await service.enqueue(source.id, { from: new Date(Date.parse(now) - 21_600_000).toISOString(), to: now }); await service.workOnce();
    await service.setSourceState(source.id, "active");
    await service.updateSource(source.id, { label: "Updated while blocked" });
    assert.equal((await repository.getSource(source.id))!.automaticCollectionBlocked, true);
    await assert.rejects(service.continueJob(bounded.id), (error: unknown) => error instanceof SourceContentError && error.status === 409);
    assert.equal(await repository.continueJob(bounded.id, randomUUID(), now), null);
    await assert.rejects(repository.enqueue({ id: randomUUID(), sourceId: source.id, now, from: "2026-10-09", to: now, pageSize: 25, maxPages: 1 }), (error: unknown) => error instanceof SourceContentError && error.status === 409);
    assert.equal(await service.workOnce(), false);
    broken = false; await service.retryJob(failed.id); await service.workOnce();
    assert.ok(await service.continueJob(bounded.id), "Explicit Retry releases the fence for retained bounded checkpoints");
  } },
  { name: "lease recovery after a third interrupted request cannot send a fourth request or lose its checkpoint", run: async repository => {
    let now = FIXED_CONTENT_NOW, calls = 0;
    const base = new DemoContentProvider("reddit", () => now);
    const provider: ContentProvider = { capability: base.capability, normalizeTarget: base.normalizeTarget.bind(base), collectPage: async request => {
      calls++;
      if (calls > 1) throw new ContentProviderError("Synthetic interrupted temporary request", true, 5, 429);
      return base.collectPage(request);
    } };
    const service = new SourceContentService(repository, provider, () => now);
    const source = await service.createSource({ platform: "reddit", provider: "demo_reddit", contentKind: "post", target: { type: "community", community: "failure_lease_limit" } });
    const job = await service.enqueue(source.id, { pageSize: 2, maxPages: 5 });
    await service.workOnce();
    for (let attempt = 0; attempt < 2; attempt++) { now = new Date(Date.parse(now) + 6_000).toISOString(); await service.workOnce(); }
    const checkpoint = (await repository.getJob(job.id))!.checkpoint; assert.ok(checkpoint);
    now = new Date(Date.parse(now) + 6_000).toISOString();
    const abandoned = await repository.claim(now); assert.ok(abandoned);
    assert.equal((await repository.reserveUsage(source.provider, 2, now)).allowed, true);
    assert.equal(await repository.beginRequestAttempt(abandoned, now), 3);
    await assert.rejects(provider.collectPage({ source, from: job.from, to: job.to, limit: job.pageSize, checkpoint, signal: undefined }), /Synthetic interrupted/);
    // Simulate process loss after upstream failure, before timing/failJob are persisted.
    now = new Date(Date.parse(now) + 121_000).toISOString(); await service.workOnce();
    assert.equal(calls, 4, "Initial successful page + three failed page requests only");
    assert.equal((await repository.getJob(job.id))!.status, "failed");
    assert.equal((await repository.getJob(job.id))!.failureKind, "transient");
    assert.deepEqual((await repository.getJob(job.id))!.checkpoint, checkpoint);
    assert.equal((await repository.providerUsage(now)).find(item => item.provider === "demo_reddit")!.dailyRequests, 4, "Recovery rejection must not reserve another request");
  } },
];
