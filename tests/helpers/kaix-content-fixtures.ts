import assert from "node:assert/strict";
import { KaixContentConnector } from "../../src/connectors/reddit/kaix-content.connector";
import { SourceContentService } from "../../src/application/services/source-content.service";
import { contentExport, contentWorkbench } from "../../src/application/services/content-workbench.service";
import type { SourceContentRepository } from "../../src/domain/repositories/source-content-repository";

export const KAIX_NOW = "2026-11-13T12:00:00.000Z";
export function kaixPost(overrides: Record<string, unknown> = {}) {
  return { type: "post", id: "kaix123", fullName: "t3_kaix123", subreddit: "testcommunity", title: "Synthetic AI tool", selftext: "Fixture body 中文", author: "fixture_author", createdUtc: Date.parse("2026-11-13T08:00:00Z") / 1000, score: -2, numComments: 0, upvoteRatio: 0.75, permalink: "https://www.reddit.com/r/testcommunity/comments/kaix123/fixture/", scrapedAt: KAIX_NOW, ...overrides };
}
export function kaixFixture(rows: unknown[] = [kaixPost()]) {
  const requests: { url: URL; init: RequestInit | undefined }[] = [];
  const connector = new KaixContentConnector({ networkEnabled: true, apiToken: "synthetic-token" }, async (input, init) => {
    const url = new URL(String(input)); requests.push({ url, init });
    assert.equal(url.origin, "https://api.apify.com");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic-token");
    assert.equal(url.searchParams.has("token"), false);
    return Response.json(init?.method === "POST" ? { data: { id: "fixtureRun", status: "SUCCEEDED", defaultDatasetId: "fixtureDataset" } } : rows);
  }, () => KAIX_NOW);
  return { connector, requests };
}

export async function verifyKaixPipeline(repository: SourceContentRepository) {
  const fixture = kaixFixture(), service = new SourceContentService(repository, fixture.connector, () => KAIX_NOW);
  const source = await service.createSource({ platform: "reddit", provider: "kaix", contentKind: "post", target: { type: "community", community: "r/TestCommunity", query: "AI tool" } });
  const window = { from: "2026-11-13T00:00:00Z", to: KAIX_NOW, pageSize: 5, maxPages: 5 };
  const job = await service.enqueue(source.id, window); await service.workOnce();
  assert.equal(fixture.requests.length, 0, "Default paid budget must block all requests");
  await service.setProviderBudget("kaix", { enabled: true, dailyRequests: 2, monthlyRequests: 2, dailyResources: 202, monthlyResources: 202 });
  await service.workOnce();
  const done = await service.getJob(job.id);
  assert.equal(done.status, "succeeded"); assert.equal(done.coverage, "partial"); assert.equal(done.pagesCommitted, 1); assert.equal(done.checkpoint, null);
  const query = service.normalizeQuery({ sourceId: source.id, provider: "kaix", query: "AI tool" });
  const list = await repository.listContent(query);
  assert.equal(list.items.length, 1);
  const item = list.items[0]; assert.equal(item.externalId, "t3_kaix123"); assert.equal(item.observations[0].sourceObservedAt, null);
  assert.equal(item.observations[0].timeBasis, "provider_snapshot"); assert.equal(item.observations[0].metrics["reddit.score"], -2); assert.equal(item.observations[0].metrics["reddit.num_comments"], 0);
  await service.enqueue(source.id, window); await service.workOnce();
  assert.equal((await repository.listContent(query)).items.length, 1, "Explicit repeated collection preserves stable identity");
  assert.equal((await contentWorkbench(service, query)).stats.total, 1);
  assert.equal((await contentExport(service, query, 10)).exportedCount, 1);
  const usage = (await repository.providerUsage(KAIX_NOW)).find(row => row.provider === "kaix")!;
  assert.equal(usage.dailyRequests, 2); assert.equal(usage.dailyResources, 202);
  assert.equal(fixture.requests.length, 4, "Two operations each make one POST and one dataset GET");
  return { service, source };
}
