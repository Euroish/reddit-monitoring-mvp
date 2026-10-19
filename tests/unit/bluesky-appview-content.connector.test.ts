import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { BlueskyAppViewContentConnector } from "../../src/connectors/bluesky/bluesky-appview-content.connector";
import { ContentProviderError } from "../../src/connectors/shared/content-provider.interface";
import { InMemorySourceContentRepository } from "../../src/storage/repositories/in-memory/source-content.repository";
import { blueskyFixture, BLUESKY_NOW, verifyBlueskyPipeline } from "../helpers/bluesky-content-fixtures";

test("Bluesky account pages use shared bounded jobs, identity/observation storage and public reads", async () => {
  await verifyBlueskyPipeline(new InMemorySourceContentRepository());
});

test("Bluesky rejects disabled access and changed checkpoint scope without sending a request", async () => {
  const fixture = blueskyFixture(), repository = new InMemorySourceContentRepository();
  const source = await repository.createSource({ id: randomUUID(), platform: "bluesky", provider: "bluesky_appview", contentKind: "post", target: { type: "account", account: "fixture.bsky.social" }, label: "Fixture", createdAt: BLUESKY_NOW });
  const request = { source, from: "2026-10-10", to: BLUESKY_NOW, limit: 5, checkpoint: null };
  await assert.rejects(new BlueskyAppViewContentConnector({ fetcher: async () => { throw Error("Unexpected network"); } }).collectPage(request), /disabled/);
  assert.throws(() => fixture.connector.normalizeTarget({ type: "account", account: "https://localhost" }, "post"), /not a URL/);
  assert.throws(() => fixture.connector.normalizeTarget({ type: "account", account: "fixture.bsky.social", query: "text" }, "post"), /without query/);
  const page = await fixture.connector.collectPage(request);
  await assert.rejects(fixture.connector.collectPage({ ...request, from: "2026-10-11", checkpoint: page.nextCheckpoint }), /changed scope/);
  assert.equal(fixture.urls.length, 1);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(fixture.connector.collectPage({ ...request, signal: abort.signal }));
  assert.equal(fixture.urls.length, 1);
});

test("Bluesky retains stalled cursors and classifies explicit HTTP failures without inventing an empty page", async () => {
  const repository = new InMemorySourceContentRepository();
  const source = await repository.createSource({ id: randomUUID(), platform: "bluesky", provider: "bluesky_appview", contentKind: "post", target: { type: "account", account: "fixture.bsky.social" }, label: "Fixture", createdAt: BLUESKY_NOW });
  const request = { source, from: "2026-10-10", to: BLUESKY_NOW, limit: 5, checkpoint: null };
  const connector = new BlueskyAppViewContentConnector({ networkEnabled: true, fetcher: async () => Response.json({ feed: [], cursor: "stalled" }) });
  const page = await connector.collectPage(request);
  assert.equal(page.exhausted, false);
  await assert.rejects(connector.collectPage({ ...request, checkpoint: page.nextCheckpoint }), error => error instanceof ContentProviderError && error.retryable && /did not advance/.test(error.message));
  for (const [status, retryable] of [[429, true], [403, false]] as const) {
    const failure = new BlueskyAppViewContentConnector({ networkEnabled: true, fetcher: async () => new Response("blocked", { status, headers: { "retry-after": "60" } }) });
    await assert.rejects(failure.collectPage(request), error => error instanceof ContentProviderError && error.httpStatus === status && error.retryable === retryable && error.retryAfterSeconds === 60);
  }
});
