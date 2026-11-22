import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Value } from "@sinclair/typebox/value";
import { providerResourceReservation, viewerCollectionDemand } from "../../packages/contracts/src/collection-budget";
import { SourceUpdate, REDDIT_ARCHIVE_SOURCE_TAG, type CollectionSource } from "../../packages/contracts/src/source-content";
import { collectionLimits, isRedditArchiveSource } from "../../apps/web/src/lib/collectionLimits.js";
import type { QuotasSummaryResponse } from "../../apps/web/src/contracts/api.js";
import { KaixContentConnector } from "../../src/connectors/reddit/kaix-content.connector";
import {
  SOURCE_GROUPS,
  TIER_SHORT,
  decodeHtmlEntities,
  formatExactTime,
  formatRelativeTime,
  safeHttpUrl,
  shiftUtcDate,
  toSafeUtcIso,
  toUtcDatetimeLocal,
} from "../../apps/web/src/lib/sourceLabels.js";

describe("source configuration and collection controls", () => {
  const source: CollectionSource = {
    id: "00000000-0000-4000-8000-000000000001", label: "Fixture", platform: "reddit", primaryProvider: "kaix",
    fallbackProvider: null, deliveryMode: "pull", state: "active", target: { type: "community", community: "local" },
    contentKind: "post", revision: 1, createdAt: "2026-11-22T00:00:00.000Z", updatedAt: "2026-11-22T00:00:00.000Z",
    tier: "T2", sourceGroup: null, ownerEntityId: null, locale: null, tags: [], fetchPolicy: {}, health: {}, coverage: "unknown",
  };

  it("accepts source metadata and optimistic revision while keeping target identity immutable", () => {
    const patch = {
      revision: 2, label: "Feed", schedule: { enabled: true, cadenceSeconds: 3600 },
      sourceGroup: "ai-firsthand", tier: "T1", locale: "en-US", ownerEntityId: "vendor",
      tags: ["official"], fetchPolicy: { maxItems: 20, stripTrackingParams: false }, fallbackProvider: null,
    };
    assert.ok(Value.Check(SourceUpdate, patch));
    assert.equal(Value.Check(SourceUpdate, { ...patch, target: { type: "feed", url: "https://fixture.example" } }), false);
    assert.equal(Value.Check(SourceUpdate, { ...patch, revision: 0 }), false);
  });

  it("requires reported provider readiness and limits Viewer collection by resolved remaining quota", () => {
    const live = new KaixContentConnector({ networkEnabled: true, apiToken: "fixture" }).capability;
    const personal: QuotasSummaryResponse = {
      scope: "personal", resetsAtUtc: "2026-11-23T00:00:00.000Z",
      effectivePolicy: {
        planTier: "pro", manualCollectEnabled: true, allowedProviders: ["kaix"], allowedSourceIds: [source.id],
        dailyRequests: 3, dailyResources: 100, maxBatchLimit: 20, maxCommentsPerPost: 4, hasOverride: true,
      },
      myUsage: { requestsReserved: 1, requestsExecuted: 1, resourcesReserved: 75, byProvider: [] },
    };
    assert.equal(collectionLimits(source, undefined, personal, true, false, 0).maxLimit, 0);
    assert.equal(collectionLimits(source, { ...live, enabled: false }, personal, true, false, 0).maxLimit, 0);
    assert.equal(collectionLimits(source, live, undefined, false, false, 0).maxLimit, 0);
    assert.deepEqual(collectionLimits(source, live, personal, false, true, 30), {
      maxLimit: 5, optionalComments: true, maxComments: 4, comments: 4,
    });
    assert.equal(collectionLimits({ ...source, id: "another" }, live, personal, false, false, 0).maxLimit, 0);
    assert.equal(collectionLimits({ ...source, target: { type: "post", postId: "post" } }, live, personal, false, false, 0).maxLimit, 4);
    assert.equal(collectionLimits(source, live, personal, true, true, 50).maxLimit, 39);
    assert.equal(collectionLimits(source, { ...live, provider: "twitterapis" }, personal, true, false, 0).maxLimit, 20);
  });

  it("identifies only explicitly tagged Reddit archive Push sources", () => {
    const push: CollectionSource = { ...source, deliveryMode: "push", primaryProvider: "external_ingest" };
    assert.equal(isRedditArchiveSource(push), false);
    assert.equal(isRedditArchiveSource({ ...source, tags: [REDDIT_ARCHIVE_SOURCE_TAG] }), false);
    assert.equal(isRedditArchiveSource({ ...push, platform: "web", tags: [REDDIT_ARCHIVE_SOURCE_TAG] }), false);
    assert.equal(isRedditArchiveSource({ ...push, tags: [REDDIT_ARCHIVE_SOURCE_TAG] }), true);
  });
});

describe("sourceLabels utilities", () => {
  it("exposes all 8 source groups and tier labels", () => {
    assert.equal(Object.keys(SOURCE_GROUPS).length, 8);
    assert.equal(TIER_SHORT.T1, "T1");
    assert.equal(TIER_SHORT.T1_5, "T1.5");
    assert.equal(TIER_SHORT.T2, "T2");
  });

  it("validates external http/https URLs strictly", () => {
    assert.equal(safeHttpUrl("https://example.com/a"), "https://example.com/a");
    assert.equal(safeHttpUrl("http://example.com/b"), "http://example.com/b");
    assert.equal(safeHttpUrl("javascript:alert(1)"), null);
    assert.equal(safeHttpUrl("data:text/html,hi"), null);
    assert.equal(safeHttpUrl(null), null);
  });

  it("decodes named and numeric HTML entities safely", () => {
    assert.equal(
      decodeHtmlEntities("AT&amp;T &mdash; &ldquo;AI&rdquo; &#39;ok&#39; &#x2192;"),
      "AT&T — “AI” 'ok' →",
    );
    assert.equal(decodeHtmlEntities(null), "");
  });

  it("formats and parses UTC dates safely", () => {
    assert.equal(shiftUtcDate("2026-04-10", -1), "2026-04-09");
    assert.equal(shiftUtcDate("2026-04-10", 2), "2026-04-12");
    assert.equal(toUtcDatetimeLocal("2026-04-10T08:30"), "2026-04-10T08:30");
    assert.equal(toUtcDatetimeLocal("not-a-date"), "");
    assert.equal(toSafeUtcIso("2026-04-10T08:30"), "2026-04-10T08:30:00.000Z");
    assert.equal(toSafeUtcIso("invalid"), null);
    assert.equal(formatExactTime("invalid"), "时间未知");
    assert.equal(formatRelativeTime(null), "时间未知");
  });
});

it("keeps provider reservation units distinct from viewer requests and item counts", () => {
  assert.equal(providerResourceReservation({ provider: "feed", targetType: "feed", pageSize: 10 }), 11);
  assert.equal(providerResourceReservation({ provider: "twitterapis", targetType: "account", pageSize: 3, requestResourceUpperBound: 20 }), 20);
  assert.equal(viewerCollectionDemand("twitterapis", "account", 3, {}).resources, 3);
  assert.equal(providerResourceReservation({ provider: "scrapebadger", targetType: "account", pageSize: 3, requestResourceUpperBound: 100, refresh: true }), 3);
  assert.equal(providerResourceReservation({ provider: "kaix", targetType: "post", pageSize: 10 }), 11);
  assert.equal(viewerCollectionDemand("kaix", "search", 10, { includeComments: true, maxCommentsPerPost: 2 }).resources, 30);
  assert.equal(providerResourceReservation({ provider: "kaix", targetType: "search", pageSize: 10, includeComments: true, maxCommentsPerPost: 2 }), 31);
});
