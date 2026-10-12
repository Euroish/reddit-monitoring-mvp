import assert from "node:assert/strict";
import test from "node:test";
import type { CollectionSourceResponse, ContentListResponse, SourceJobResponse } from "../../packages/contracts/src/http";
import { createApiServer } from "../../apps/api/src/create-api-server";
import { TwitterApiIoContentConnector } from "../../src/connectors/x/twitterapi-io-content.connector";
import { SourceContentService } from "../../src/application/services/source-content.service";
import { InMemorySourceContentRepository } from "../../src/storage/repositories/in-memory/source-content.repository";
import { RedditMockConnector } from "../../src/connectors/reddit/reddit-mock.connector";
import { createApiTestRepositories, startServer, stopServer } from "./api-server.helpers";

test("X account/search configured adapters traverse budget-gated collection, deduplicated storage and authenticated local API queries using offline fixtures", async () => {
  const now = "2026-10-12T10:00:00.000Z", calls: URL[] = [];
  const adapter = new TwitterApiIoContentConnector({ networkEnabled: true, apiKey: "fake-offline-key", now: () => now, fetcher: (async (url) => {
    calls.push(new URL(String(url)));
    return Response.json({ status: "success", tweets: [{ id: "18446744073709551615", text: "中文智能体 X fixture", createdAt: "2026-10-11T10:00:00Z", author: { id: "18446744073709551614", userName: "sample", name: "Fixture author" }, likeCount: 0 }], has_next_page: false, next_cursor: "" });
  }) as typeof fetch });
  const repository = new InMemorySourceContentRepository(), service = new SourceContentService(repository, adapter, () => now);
  const server = createApiServer({ repositories: createApiTestRepositories(), createConnector: () => new RedditMockConnector(), sourceContent: service, auth: { bearerToken: "offline-x-token" }, logger: () => {} });
  const base = await startServer(server), headers = { authorization: "Bearer offline-x-token", "content-type": "application/json" };
  try {
    const create = async (target: unknown) => {
      const response = await fetch(`${base}/v1/sources`, { method: "POST", headers, body: JSON.stringify({ platform: "x", provider: "twitterapi_io", contentKind: "post", target }) });
      assert.equal(response.status, 201);
      return (await response.json() as CollectionSourceResponse).source;
    };
    const account = await create({ type: "account", account: "@Sample" });
    const queued = await fetch(`${base}/v1/sources/${account.id}/collect`, { method: "POST", headers, body: JSON.stringify({ from: "2026-10-11", to: "2026-10-12", pageSize: 1, maxPages: 1 }) });
    assert.equal(queued.status, 202);
    const job = (await queued.json() as SourceJobResponse).job;
    await service.workOnce();
    assert.equal(calls.length, 0, "paid provider has a zero disabled budget even with configured transport");
    assert.match((await service.getJob(job.id)).error!, /budget disabled or exhausted/);
    const budget = await fetch(`${base}/v1/source-provider-budgets/twitterapi_io`, { method: "PUT", headers, body: JSON.stringify({ enabled: true, dailyRequests: 2, monthlyRequests: 2, dailyResources: 40, monthlyResources: 40 }) });
    assert.equal(budget.status, 200);
    await service.workOnce();
    assert.equal(calls.length, 1);
    assert.equal((await service.getJob(job.id)).status, "succeeded");
    const search = await create({ type: "search", query: "智能体" });
    await service.enqueue(search.id, { from: "2026-10-11", to: "2026-10-12", pageSize: 1, maxPages: 1 });
    await service.workOnce();
    assert.equal(calls.length, 2);
    const response = await fetch(`${base}/v1/content?platform=x&provider=twitterapi_io&query=${encodeURIComponent("智能体")}`, { headers });
    assert.equal(response.status, 200);
    const result = await response.json() as ContentListResponse;
    assert.equal(result.items.length, 1, "same X identity from account and keyword sources is shared");
    assert.equal(result.items[0]?.externalId, "18446744073709551615");
    assert.equal(result.items[0]?.observations.length, 2);
    assert.equal(result.items[0]?.observations[0]?.metrics["x.likes"], 0);
    assert.equal(result.items[0]?.observations[0]?.metrics["x.views"], null);
    assert.equal(result.items[0]?.observations[0]?.sourceObservedAt, null);
    const usage = (await service.ops()).providers.find((row) => row.provider === "twitterapi_io")!;
    assert.equal(usage.dailyRequests, 2);
    assert.equal(usage.dailyResources, 40, "two pageSize=1 requests each reserve fixed upstream bound 20");
    await service.enqueue(account.id, { from: "2026-10-11", to: "2026-10-12", pageSize: 1, maxPages: 1 });
    await service.workOnce();
    assert.equal(calls.length, 2, "exhausted budget blocks another paid request");
    assert.equal((await fetch(`${base}/v1/content?platform=x`, { headers })).status, 200, "stored queries stay available after budget exhaustion");
    assert.equal((await fetch(`${base}/v1/content?platform=x`)).status, 401);
  } finally { await stopServer(server); }
});
