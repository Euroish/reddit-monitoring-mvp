import assert from "node:assert/strict";
import type { SourceContentRepository } from "../../src/domain/repositories/source-content-repository";
import { BlueskyAppViewContentConnector } from "../../src/connectors/bluesky/bluesky-appview-content.connector";
import { SourceContentService } from "../../src/application/services/source-content.service";
import { contentWorkbench, contentExport } from "../../src/application/services/content-workbench.service";

export const BLUESKY_NOW = "2026-10-19T12:00:00.000Z";
export const BLUESKY_DID = "did:plc:syntheticfixture";
export const blueskyUri = (key: string) => `at://${BLUESKY_DID}/app.bsky.feed.post/${key}`;
export function blueskyPost(key: string, likes: number | null = 0) {
  return { uri: blueskyUri(key), cid: `synthetic-cid-${key}`, author: { did: BLUESKY_DID, handle: "fixture.bsky.social", displayName: "Synthetic fixture" },
    record: { $type: "app.bsky.feed.post", text: "Bluesky fixture 中文 " + key, createdAt: "2026-10-18T08:00:00.000Z", langs: ["en"] },
    likeCount: likes, replyCount: 0, repostCount: 1, indexedAt: "2026-10-18T08:01:00.000Z" };
}
export function blueskyFixture() {
  const root = { ...blueskyPost("root"), record: { ...blueskyPost("root").record,
    embed: { $type: "app.bsky.embed.recordWithMedia", record: { $type: "app.bsky.embed.record", record: { uri: blueskyUri("quoted") } } } },
    embed: { $type: "app.bsky.embed.recordWithMedia#view", media: { images: [{ fullsize: "https://example.test/fixture.png", thumb: "https://example.test/thumb.png", alt: "Synthetic image" }] } } };
  const reply = { ...blueskyPost("reply", null), record: { ...blueskyPost("reply").record, reply: { parent: { uri: root.uri }, root: { uri: root.uri } } } };
  const repost = { post: { ...blueskyPost("other"), author: { did: "did:plc:otherfixture", handle: "other.bsky.social" } }, reason: { $type: "app.bsky.feed.defs#reasonRepost" } };
  const pages = [{ feed: [{ post: root }, repost, { post: reply }], cursor: "next-1" }, { feed: [{ post: reply }, { post: blueskyPost("last", 7) }] }];
  const urls: URL[] = [];
  const connector = new BlueskyAppViewContentConnector({ networkEnabled: true, now: () => BLUESKY_NOW, fetcher: async input => {
    const url = new URL(String(input)); urls.push(url);
    assert.equal(url.origin, "https://public.api.bsky.app");
    assert.equal(url.searchParams.get("actor"), "fixture.bsky.social");
    return Response.json(pages[url.searchParams.has("cursor") ? 1 : 0]);
  } });
  return { connector, urls, pages };
}

/** The same provider -> worker -> repository -> read-model assertions run in memory and native SQL. */
export async function verifyBlueskyPipeline(repository: SourceContentRepository) {
  const fixture = blueskyFixture(), service = new SourceContentService(repository, fixture.connector, () => BLUESKY_NOW);
  const source = await service.createSource({ platform: "bluesky", provider: "bluesky_appview", contentKind: "post", target: { type: "account", account: "@Fixture.Bsky.Social" } });
  const window = { from: "2026-10-10T00:00:00.000Z", to: BLUESKY_NOW, pageSize: 5, maxPages: 1 };
  await service.setProviderBudget("bluesky_appview", { enabled: true, dailyRequests: 3, monthlyRequests: 3, dailyResources: 15, monthlyResources: 15 });
  const first = await service.enqueue(source.id, window); await service.workOnce();
  assert.equal((await service.getJob(first.id)).status, "succeeded");
  assert.ok((await service.getJob(first.id)).checkpoint, "A bounded page retains its opaque continuation");
  const next = await service.continueJob(first.id); await service.workOnce();
  assert.equal((await service.getJob(next.id)).exhausted, true);
  await service.enqueue(source.id, window); await service.workOnce();
  const query = service.normalizeQuery({ platform: "bluesky", sourceId: source.id, query: "fixture 中文" });
  const list = await repository.listContent(query);
  assert.equal(list.items.length, 3, "Page overlap and replay do not duplicate content; reposts are excluded");
  assert.ok(list.items.every(item => item.externalId.startsWith(`at://${BLUESKY_DID}/`)));
  const root = list.items.find(item => item.externalId === blueskyUri("root"))!;
  assert.equal(root.title, null); assert.equal(root.observations[0].metrics["bluesky.likes"], 0);
  assert.deepEqual(root.references, [{ kind: "post", externalId: blueskyUri("quoted"), relation: "quote" }]);
  assert.equal(root.media[0].type, "image"); assert.equal(root.media[0].url, "https://example.test/fixture.png");
  assert.equal(root.observations[0].sourceObservedAt, null, "indexedAt must not become metric observation time");
  assert.equal(list.items.find(item => item.externalId === blueskyUri("reply"))!.observations[0].metrics["bluesky.likes"], null);
  const workbench = await contentWorkbench(service, query);
  assert.deepEqual(workbench.byPlatform, [{ platform: "bluesky", count: 3 }]);
  assert.equal(workbench.byProvider[0].provider, "bluesky_appview");
  const exported = await contentExport(service, query, 10); assert.equal(exported.exportedCount, 3);
  assert.equal((await repository.contentStats(service.normalizeQuery({ platform: "bluesky", metricKey: "bluesky.likes", minMetric: 0, maxMetric: 0 }))).total, 1);
  assert.equal((await repository.providerUsage(BLUESKY_NOW))[0].monthlyRequests, 3);
  assert.equal(fixture.urls.length, 3);
  return { service, source, root, query };
}
