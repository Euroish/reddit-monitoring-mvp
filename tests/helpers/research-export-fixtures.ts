import { randomUUID } from "node:crypto";
import type { CollectionSource } from "../../packages/contracts/src/source-content";
import type { CollectedContent } from "../../src/connectors/shared/content-provider.interface";
import type { SourceContentRepository } from "../../src/domain/repositories/source-content-repository";
import { stableUuidFromString } from "../../src/shared/ids/stable-id";

export const RESEARCH_NOW = "2026-10-13T01:00:00.000Z";
export function researchItem(source: CollectionSource, index: number, overrides: Partial<CollectedContent> = {}): CollectedContent {
  const externalId = index === 0 ? "900719925474099312345" : `research_${index}`;
  return { id: stableUuidFromString(`reddit:content:research-fixture:${externalId}`), platform: "reddit", kind: "post", externalId, title: index === 0 ? "=SUM(A1:A2)" : index === 1 ? null : `Research 人工智能 ${index}`, text: index % 2 ? null : `Stored research body ${index}`, url: index === 1 ? null : `https://example.test/research/${externalId}`, language: index === 1 ? null : "en", author: index === 1 ? null : { externalId: "author_1", handle: "researcher", displayName: null, url: null }, publishedAt: index === 1 ? null : new Date(Date.parse("2026-10-10T00:00:00.000Z") + index * 1000).toISOString(), fetchedAt: RESEARCH_NOW, availability: "available", references: [], media: [], platformDetails: { platform: "reddit", community: "research_fixture", flair: null, nsfw: false, extensions: { "reddit.locked": false, "provider.raw_payload": "NEVER_FREEZE_RAW", "provider.token": "NEVER_FREEZE_TOKEN" } }, observation: { sourceId: source.id, provider: source.provider, sourceObservedAt: RESEARCH_NOW, fetchedAt: RESEARCH_NOW, timeBasis: "archive_initial", maturity: "initial", metrics: { "reddit.score": 0, "reddit.comments": null }, evidenceKey: `fixture:${externalId}:old` }, ...overrides };
}
export async function createResearchSource(repository: SourceContentRepository): Promise<CollectionSource> {
  return repository.createSource({ id: randomUUID(), platform: "reddit", provider: "demo_reddit", contentKind: "post", target: { type: "community", community: "research_fixture" }, label: "Original research label", createdAt: RESEARCH_NOW });
}
export async function commitResearchItems(repository: SourceContentRepository, source: CollectionSource, items: CollectedContent[], now = RESEARCH_NOW) {
  const job = await repository.enqueue({ id: randomUUID(), sourceId: source.id, from: "2026-10-10T00:00:00.000Z", to: RESEARCH_NOW, pageSize: 100, maxPages: Math.max(1, Math.min(20, Math.ceil(items.length / 100))), now });
  const claim = await repository.claim(now); if (!claim || claim.job.id !== job.id) throw new Error("Research fixture job could not be claimed");
  await repository.commitPage(claim, { items, nextCheckpoint: null, exhausted: true, coverage: "unknown", warning: null }, now);
}
