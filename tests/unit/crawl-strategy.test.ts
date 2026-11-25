import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { buildXTimeSlices, twitterApis } from "../../src/connectors/x/twitterapis";
import { KaixContentConnector } from "../../src/connectors/reddit/kaix-content.connector";
import type { CollectionSource, JsonValue } from "../../packages/contracts/src/source-content";

const now = "2026-11-25T00:00:00.000Z";

function xSource(): CollectionSource {
  return {
    id: randomUUID(),
    platform: "x",
    primaryProvider: "twitterapis",
    fallbackProvider: null,
    tier: "T2",
    ownerEntityId: null,
    sourceGroup: null,
    tags: [],
    locale: null,
    fetchPolicy: {},
    health: {},
    deliveryMode: "pull",
    label: "X: tiktok",
    target: { type: "search", query: "tiktok" },
    contentKind: "post",
    state: "active",
    createdAt: now,
    updatedAt: now,
    revision: 1,
    coverage: "partial",
  };
}

function kaixSource(target: CollectionSource["target"]): CollectionSource {
  return {
    id: randomUUID(),
    platform: "reddit",
    primaryProvider: "kaix",
    fallbackProvider: null,
    tier: "T2",
    ownerEntityId: null,
    sourceGroup: null,
    tags: [],
    locale: null,
    fetchPolicy: {},
    health: {},
    deliveryMode: "pull",
    label: "REDDIT: tiktok",
    target,
    contentKind: "post",
    state: "active",
    createdAt: now,
    updatedAt: now,
    revision: 1,
    coverage: "partial",
  };
}

test("buildXTimeSlices keeps <=7d as 1 slice and splits 30d into 5 7-day slices", () => {
  const to = Date.parse("2026-11-25T00:00:00.000Z");
  const from7 = to - 7 * 86_400_000;
  const from30 = to - 30 * 86_400_000;
  assert.equal(buildXTimeSlices(from7, to).length, 1);
  const slices30 = buildXTimeSlices(from30, to);
  assert.equal(slices30.length, 5);
  assert.equal(slices30[0]!.to, to);
  assert.equal(slices30[slices30.length - 1]!.from, from30);
});

test("twitterApis auto-slices >7d windows across 7-day sub-queries via checkpoint", async () => {
  const seenQueries: string[] = [];
  const provider = twitterApis(
    { SOURCE_NETWORK_ENABLED: "true", TWITTERAPIS_API_KEY: "test-key" },
    async (raw) => {
      const url = new URL(String(raw));
      seenQueries.push(url.searchParams.get("query") ?? "");
      return Response.json({
        tweets: [
          {
            id: String(1900000000000000000 + seenQueries.length),
            text: "tiktok update",
            created_at: "2026-11-18T12:00:00.000Z",
            author: { userName: "alice" },
            likeCount: 100,
          },
        ],
        has_more: false,
      });
    },
  );

  const src = xSource();
  const from = "2026-11-01T00:00:00.000Z";
  const to = "2026-11-22T00:00:00.000Z"; // 21 days => 3 slices

  const p1 = await provider.collectPage({ source: src, from, to, limit: 20, checkpoint: null });
  assert.equal(p1.exhausted, false);
  assert.deepEqual(p1.nextCheckpoint, { sliceIndex: 1, slicePage: 0, cursor: null });

  const p2 = await provider.collectPage({ source: src, from, to, limit: 20, checkpoint: p1.nextCheckpoint });
  assert.equal(p2.exhausted, false);
  assert.deepEqual(p2.nextCheckpoint, { sliceIndex: 2, slicePage: 0, cursor: null });

  const p3 = await provider.collectPage({ source: src, from, to, limit: 20, checkpoint: p2.nextCheckpoint });
  assert.equal(p3.exhausted, true);
  assert.equal(p3.nextCheckpoint, null);

  assert.equal(seenQueries.length, 3);
  assert.notEqual(seenQueries[0], seenQueries[1]);
  assert.notEqual(seenQueries[1], seenQueries[2]);
});

test("Kaix defaults to new/all for bounded samples, independent of window length or end", async () => {
  const captureInput = async (
    target: CollectionSource["target"],
    from: string,
    to: string,
    checkpoint: JsonValue | null = null,
  ): Promise<Record<string, unknown>> => {
    let sent: Record<string, unknown> = {};
    const connector = new KaixContentConnector(
      { networkEnabled: true, apiToken: "tok" },
      async (_url, init) => {
        if (init?.body) sent = JSON.parse(String(init.body));
        return Response.json({
          data: { id: "run1", defaultDatasetId: "ds1", status: "RUNNING" },
        });
      },
      () => to,
    );
    let state: JsonValue = { phase: "starting" };
    await connector.collectPage({
      source: kaixSource(target),
      from,
      to,
      limit: 500,
      checkpoint,
      execution: { state, saveState: async (v) => { state = v; } },
    });
    return sent;
  };

  const search = { type: "search", query: "tiktok" } as const;
  const to = "2026-11-25T13:05:27.817Z";
  for (const [target, from, end] of [
    [search, "2026-11-18T13:05:27.817Z", to],
    [search, "2026-10-26T13:05:27.817Z", to],
    [search, "2026-08-27T13:05:27.817Z", to],
    [search, "2026-09-01T13:05:27.817Z", "2026-09-08T13:05:27.817Z"],
    [{ type: "community", community: "videos", query: "tiktok" }, "2026-08-27T13:05:27.817Z", to],
  ] as const) {
    const input = await captureInput(target, from, end);
    assert.equal(input.sort, "new");
    assert.equal(input.time, "all");
  }

  const from = "2026-10-26T13:05:27.817Z";
  for (const [hints, sort, time] of [
    [{ sort: "top", timeRange: "month" }, "top", "month"],
    [{ sort: "relevance" }, "relevance", "all"],
    [{ timeRange: "week" }, "new", "week"],
  ] as const) {
    const input = await captureInput({ ...search, ...hints }, from, to);
    assert.equal(input.sort, sort);
    assert.equal(input.time, time);
    const fanout = { phase: "fanout", subreddits: ["videos"], subIndex: 0, seenPostIds: ["t3_fixture"], candidates: [] };
    const supplemental = await captureInput({ ...search, ...hints }, "2026-08-27T13:05:27.817Z", to, fanout);
    assert.equal(supplemental.subreddit, "videos");
    assert.equal(supplemental.sort, sort);
    assert.equal(supplemental.time, time);
  }
});
