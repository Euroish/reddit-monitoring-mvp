import { randomUUID } from "node:crypto";
import type { CollectedContent } from "../../src/connectors/shared/content-provider.interface";
import { stableUuidFromString } from "../../src/shared/ids/stable-id";

export const BATCH_NOW = "2026-11-16T12:00:00.000Z";
export function batchItem(
  sourceId: string,
  overrides: Partial<CollectedContent> = {},
): CollectedContent {
  const externalId = overrides.externalId ?? "t3_19riqx8r047lt";
  return {
    id: stableUuidFromString(`reddit:content:${overrides.kind ?? "post"}:${externalId}`),
    platform: "reddit",
    kind: "post",
    externalId,
    title: "Known title",
    text: "Known body 中文",
    url: "https://www.reddit.com/comments/19riqx8r047lt/",
    language: null,
    author: null,
    publishedAt: null,
    fetchedAt: BATCH_NOW,
    availability: "available",
    references: [],
    media: [],
    platformDetails: {
      platform: "reddit",
      community: "fixture",
      flair: null,
      nsfw: false,
    },
    observation: {
      sourceId,
      provider: "kaix",
      sourceObservedAt: BATCH_NOW,
      fetchedAt: BATCH_NOW,
      timeBasis: "provider_snapshot",
      maturity: "unknown",
      metrics: { "reddit.score": 1 },
      evidenceKey: randomUUID(),
    },
    ...overrides,
  };
}
