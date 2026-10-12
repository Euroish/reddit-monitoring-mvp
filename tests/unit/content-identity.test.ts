import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { canonicalWebIdentityNamespace, webContentIdentity } from "../../src/shared/ids/content-identity";
import { stableUuidFromString } from "../../src/shared/ids/stable-id";
import { InMemorySourceContentRepository } from "../../src/storage/repositories/in-memory/source-content.repository";
import type { CollectedContent } from "../../src/connectors/shared/content-provider.interface";

test("web GUID identities are scoped by canonical namespace and kind and preserve existing Reddit/X identities", () => {
  const a = webContentIdentity({ namespace: "https://one.example.test/feed.xml", externalId: "same-guid", kind: "article" });
  const b = webContentIdentity({ namespace: "https://two.example.test/feed.xml", externalId: "same-guid", kind: "article" });
  assert.notEqual(a.externalId, b.externalId);
  assert.notEqual(a.id, b.id);
  assert.deepEqual(a, webContentIdentity({ namespace: "HTTPS://ONE.EXAMPLE.TEST:443/feed.xml#section", externalId: "same-guid", kind: "article" }));
  assert.notEqual(a.id, webContentIdentity({ namespace: "https://one.example.test/feed.xml", externalId: "same-guid", kind: "post" }).id);
  assert.notEqual(a.externalId, webContentIdentity({ namespace: "https://one.example.test/feed.xml", externalId: "same-guid", kind: "post" }).externalId);
  assert.equal(a.extensions["web.raw_external_id"], "same-guid");
  assert.equal(a.extensions["web.identity_namespace"], "https://one.example.test/feed.xml");
  assert.equal(a.extensions["web.identity_version"], "web_content_identity_v1");
  assert.match(a.externalId, /^web:article:[0-9a-f]{64}$/);
  assert.equal(stableUuidFromString("reddit:content:t3_sample"), "3f2eebaf-31de-2f85-87f2-3e799798a3c0");
  assert.equal(stableUuidFromString("x:content:18446744073709551615"), "0e585bad-7447-e11d-f7ce-e3f2291268ab");
});

test("web namespace preserves path/query semantics by default and supports explicit stable query-key sorting", () => {
  assert.equal(canonicalWebIdentityNamespace("https://example.test/feed/?b=2&a=1#fragment"), "https://example.test/feed/?b=2&a=1");
  assert.notEqual(webContentIdentity({ namespace: "https://example.test/feed", externalId: "1", kind: "article" }).id, webContentIdentity({ namespace: "https://example.test/feed/", externalId: "1", kind: "article" }).id);
  assert.notEqual(webContentIdentity({ namespace: "https://example.test/feed?a=1&b=2", externalId: "1", kind: "article" }).id, webContentIdentity({ namespace: "https://example.test/feed?b=2&a=1", externalId: "1", kind: "article" }).id);
  assert.equal(webContentIdentity({ namespace: "https://example.test/feed?a=1&b=2", externalId: "1", kind: "article", sortQueryParameters: true }).id, webContentIdentity({ namespace: "https://example.test/feed?b=2&a=1#x", externalId: "1", kind: "article", sortQueryParameters: true }).id);
  assert.equal(canonicalWebIdentityNamespace("https://example.test/feed?b=2&a=one&a=two", true), "https://example.test/feed?a=one&a=two&b=2");
  assert.notEqual(canonicalWebIdentityNamespace("https://example.test/feed?a=one&a=two", true), canonicalWebIdentityNamespace("https://example.test/feed?a=two&a=one", true));
});

test("web identity rejects malformed, credential-bearing, control and oversized inputs without rewriting opaque GUIDs", () => {
  for (const namespace of ["not-a-url", "/feed", "file:///feed.xml", "https:example.test/feed", "https://user:pass@example.test/feed", "https://@example.test/feed", "https://example.test/feed\n", "https://example.test/fi le", "https:\\example.test\\feed", `https://example.test/${"x".repeat(2048)}`]) assert.throws(() => webContentIdentity({ namespace, externalId: "guid", kind: "article" }));
  for (const externalId of ["", "   ", "guid\u0000", "x".repeat(2049), "https://user:pass@example.test/guid"]) assert.throws(() => webContentIdentity({ namespace: "https://example.test/feed", externalId, kind: "article" }));
  assert.throws(() => webContentIdentity({ namespace: "https://example.test", externalId: "guid", kind: "unknown" } as never));
  assert.throws(() => webContentIdentity({ namespace: "https://example.test", externalId: "guid", kind: "article", sortQueryParameters: "yes" } as never));
  const raw = " urn:uuid:guid-1 ";
  assert.equal(webContentIdentity({ namespace: "https://example.test/feed", externalId: raw, kind: "article" }).extensions["web.raw_external_id"], raw);
  assert.notEqual(webContentIdentity({ namespace: "https://example.test/feed", externalId: raw, kind: "article" }).id, webContentIdentity({ namespace: "https://example.test/feed", externalId: raw.trim(), kind: "article" }).id);
});

test("offline web pages with the same upstream GUID persist as distinct content identities across namespaces and replay idempotently", async () => {
  const repo = new InMemorySourceContentRepository(), now = "2026-10-12T10:00:00.000Z";
  for (const namespace of ["https://one.example.test/feed", "https://two.example.test/feed"]) {
    const source = await repo.createSource({ id: randomUUID(), platform: "web", provider: "synthetic_web_identity", label: "Synthetic identity fixture", target: { type: "feed", url: namespace }, contentKind: "article", createdAt: now });
    const identity = webContentIdentity({ namespace, externalId: "same-guid", kind: "article" });
    const item: CollectedContent = { id: identity.id, externalId: identity.externalId, platform: "web", kind: "article", title: "Synthetic article", text: "Identity fixture only", url: null, language: null, author: null, publishedAt: null, fetchedAt: now, availability: "unknown", references: [], media: [], platformDetails: { platform: "web", publisher: null, canonicalUrl: null, feedUrl: namespace, extensions: identity.extensions }, observation: { provider: source.provider, sourceId: source.id, sourceObservedAt: null, fetchedAt: now, timeBasis: "unknown", maturity: "unknown", metrics: {}, evidenceKey: "synthetic-guid" } };
    for (let replay = 0; replay < 2; replay++) {
      await repo.enqueue({ id: randomUUID(), sourceId: source.id, now, from: "2026-10-11T00:00:00Z", to: now, pageSize: 1, maxPages: 1 });
      const claim = await repo.claim(now); assert.ok(claim);
      await repo.commitPage(claim, { items: [item], nextCheckpoint: null, exhausted: true, coverage: "unknown", warning: null }, now);
    }
  }
  const result = await repo.listContent({ platform: "web" });
  assert.equal(result.items.length, 2);
  assert.equal(new Set(result.items.map((item) => item.externalId)).size, 2);
  assert.equal((await repo.contentStats({ platform: "web" })).total, 2);
});
