import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Value } from "@sinclair/typebox/value";
import { kaixCollectionBudget, providerResourceReservation, viewerCollectionDemand } from "../../packages/contracts/src/collection-budget";
import { SourceUpdate } from "../../packages/contracts/src/source-content";

describe("source configuration and collection budget contracts", () => {
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

  it("keeps provider reservation units distinct from viewer requests and item counts", () => {
    assert.equal(providerResourceReservation({ provider: "feed", targetType: "feed", pageSize: 10 }), 11);
    assert.equal(providerResourceReservation({ provider: "twitterapis", targetType: "account", pageSize: 3, requestResourceUpperBound: 20 }), 20);
    assert.equal(viewerCollectionDemand("twitterapis", "account", 3, {}).resources, 3);
    assert.equal(providerResourceReservation({ provider: "scrapebadger", targetType: "account", pageSize: 3, requestResourceUpperBound: 100, refresh: true }), 3);
    assert.equal(providerResourceReservation({ provider: "kaix", targetType: "post", pageSize: 10 }), 11);
    assert.equal(viewerCollectionDemand("kaix", "search", 10, { includeComments: true, maxCommentsPerPost: 2 }, true).resources, 30);
    assert.equal(viewerCollectionDemand("kaix", "search", 10, { includeComments: true, maxCommentsPerPost: 2 }).resources, 40);
    assert.equal(providerResourceReservation({ provider: "kaix", targetType: "search", pageSize: 10, includeComments: true, maxCommentsPerPost: 2 }), 31);
    assert.equal(providerResourceReservation({ provider: "kaix", targetType: "community", pageSize: 10000, includeComments: true, maxCommentsPerPost: 100 }), 1010001);
    assert.deepEqual(kaixCollectionBudget("search", 10000, { includeComments: true }), {
      fanoutPages: 5, hydratePosts: 50, requests: 8, systemResources: 12058, personalResources: 12050,
    });
    assert.deepEqual(kaixCollectionBudget("community", 10000, { includeComments: true, maxCommentsPerPost: 100 }), {
      fanoutPages: 0, hydratePosts: 50, requests: 3, systemResources: 15053, personalResources: 15050,
    });
    assert.equal(kaixCollectionBudget("search", 250, {}).requests, 1);
    assert.equal(kaixCollectionBudget("search", 251, {}).requests, 6);
    assert.equal(kaixCollectionBudget("account", 10000, { includeComments: true }).requests, 1);
  });
});
