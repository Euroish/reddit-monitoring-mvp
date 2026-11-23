import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { JsonValue } from "../../packages/contracts/src/common";
import type { CollectionSource } from "../../packages/contracts/src/collection";
import { KaixContentConnector } from "../../src/connectors/reddit/kaix-content.connector";
import { redCrawler } from "../../src/connectors/reddit/red-crawler";
import { twitterApis } from "../../src/connectors/x/twitterapis";
import { scrapeBadger } from "../../src/connectors/x/scrapebadger";
import { heuristicV1Enricher } from "../../src/modules/content/index";

const now = "2026-11-22T12:00:00.000Z";

test("heuristicV1Enricher cleans markdown/URLs, classifies intent, selects layout, and scores discussion", () => {
  const enriched = heuristicV1Enricher.enrich({
    id: randomUUID(),
    platform: "reddit",
    kind: "post",
    externalId: "t3_demo1",
    title: "Cursor vs Windsurf — which is better for large TypeScript monorepos?",
    text: "See [benchmark](https://example.com/bench?utm_source=x) and `pnpm tsc` output:\n```ts\nconst a = 1;\n```\nWhy does indexing slow down after 50k files?",
    url: "https://www.reddit.com/r/typescript/comments/demo1/",
    language: "en",
    publishedAt: "2026-11-22T10:00:00.000Z",
    fetchedAt: now,
    availability: "available",
    author: { externalId: "t2_1", handle: "DevLead", displayName: "Dev Lead", url: "https://reddit.com/u/DevLead" },
    references: [],
    media: [{ type: "image", url: "https://img.example/shot.png", previewUrl: "https://img.example/shot.png", altText: null, durationSeconds: null }],
    platformDetails: { platform: "reddit", community: "TypeScript", flair: "Discussion", nsfw: false, domain: "github.com", awards: 3 },
    observation: {
      sourceId: randomUUID(),
      provider: "kaix",
      sourceObservedAt: null,
      fetchedAt: now,
      timeBasis: "provider_snapshot",
      maturity: "unknown",
      metrics: { "reddit.score": 120, "reddit.num_comments": 48, "reddit.upvote_ratio": 0.94 },
      evidenceKey: "ev1",
    },
  });

  assert.equal(enriched.authorHandle, "devlead");
  assert.equal(enriched.communityName, "typescript");
  assert.equal(enriched.externalDomain, "github.com");
  assert.equal(enriched.hasMedia, true);
  assert.equal(enriched.primaryMediaUrl, "https://img.example/shot.png");
  assert.equal(enriched.cardLayout, "hero_media");
  assert.equal(enriched.intentTag, "comparison");
  assert.ok(enriched.cleanExcerpt && !enriched.cleanExcerpt.includes("https://"));
  assert.ok(!enriched.cleanExcerpt!.includes("const a = 1"));
  assert.equal(enriched.metricScore, 120);
  assert.equal(enriched.metricComments, 48);
  assert.ok(enriched.engagementScore > 10);
  assert.equal(enriched.discussionRatio, 0.4);
});

test("Reddit kaix & red_crawler extract media, metadata, sort=top and enforce minLikes/minComments", async () => {
  const source: CollectionSource = {
    id: randomUUID(),
    platform: "reddit",
    primaryProvider: "kaix",
    fallbackProvider: "red_crawler",
    deliveryMode: "pull",
    label: "Top Search",
    target: { type: "search", query: "local llm", sort: "top", timeRange: "week", minLikes: 50, minComments: 10 },
    contentKind: "post",
    state: "active",
    createdAt: now,
    updatedAt: now,
    revision: 1,
    schedule: { enabled: false },
    tier: "T2",
    ownerEntityId: null,
    sourceGroup: null,
    tags: [],
    locale: null,
    fetchPolicy: {},
    health: {},
    coverage: "partial",
  };

  let capturedInput: Record<string, unknown> | undefined;
  const kaix = new KaixContentConnector(
    { networkEnabled: true, apiToken: "tok" },
    async (_url, init) => {
      if (init?.body) {
        capturedInput = JSON.parse(String(init.body));
        return Response.json({ data: { id: "run1", defaultDatasetId: "ds1", status: "SUCCEEDED" } });
      }
      return Response.json([
        {
          type: "post", id: "low1", fullName: "t3_low1", subreddit: "LocalLLaMA", title: "Low post",
          score: 5, numComments: 1, createdUtc: Date.parse("2026-11-22T09:00:00Z") / 1000,
        },
        {
          type: "post", id: "hi1", fullName: "t3_hi1", subreddit: "LocalLLaMA", title: "High post",
          score: 320, numComments: 84, upvoteRatio: 0.96, createdUtc: Date.parse("2026-11-22T09:00:00Z") / 1000,
          thumbnail: "https://i.redd.it/thumb.jpg", galleryImages: ["https://i.redd.it/1.png"],
          url: "https://huggingface.co/papers/2501.0001", totalAwardsReceived: 2, authorFlairText: "Maintainer",
          subredditSubscribers: 450000,
        },
      ]);
    },
    () => now,
  );
  let state: JsonValue = { phase: "starting" };
  const page = await kaix.collectPage({
    source,
    from: "2026-11-21T00:00:00Z",
    to: now,
    limit: 50,
    checkpoint: null,
    execution: { state, saveState: async (v) => { state = v; } },
  });
  assert.equal(capturedInput?.sort, "top");
  assert.equal(capturedInput?.time, "week");
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].externalId, "t3_hi1");
  assert.ok(page.items[0].media.some((m) => m.type === "image" && m.url === "https://i.redd.it/1.png"));
  assert.equal(page.items[0].platformDetails.platform, "reddit");
  if (page.items[0].platformDetails.platform === "reddit") {
    assert.equal(page.items[0].platformDetails.domain, "huggingface.co");
    assert.equal(page.items[0].platformDetails.awards, 2);
    assert.equal(page.items[0].platformDetails.subredditSubscribers, 450000);
  }

  const rc = redCrawler({ SOURCE_NETWORK_ENABLED: "true", APIFY_API_TOKEN: "tok" }, async (url, init) => {
    if (String(url).includes("datasets/")) {
      return Response.json([{
        id: "rc1", createdAt: "2026-11-22T09:00:00Z", subreddit: { prefixedName: "r/LocalLLaMA" },
        title: "RC Top", score: 180, commentCount: 25,
        preview: { images: [{ source: { url: "https://preview.redd.it/a.jpg" } }] },
      }]);
    }
    assert.equal(JSON.parse(String(init?.body)).search_sort, "top");
    return Response.json({ data: { id: "r1", defaultDatasetId: "d1", status: "SUCCEEDED" } });
  });
  const rcPage = await rc.collectPage({
    source: { ...source, primaryProvider: "red_crawler" },
    from: "2026-11-21T00:00:00Z",
    to: now,
    limit: 20,
    checkpoint: null,
    execution: { state: {}, saveState: async () => {} },
  });
  assert.equal(rcPage.items.length, 1);
  assert.equal(rcPage.items[0].media[0]?.type, "image");
});

test("X connectors support Top sort, native min_faves/min_replies operators, batch accounts & rich profile extraction", async () => {
  const tw = twitterApis({ SOURCE_NETWORK_ENABLED: "true", TWITTERAPIS_API_KEY: "tok" }, async (raw) => {
    const url = new URL(String(raw));
    assert.equal(url.searchParams.get("product"), "Top");
    const q = url.searchParams.get("query")!;
    assert.match(q, /\(from:karpathy OR from:simonw\)/);
    assert.match(q, /-is:retweet/);
    return Response.json({
      tweets: [{
        id: "999",
        created_at: "2026-11-22T10:00:00Z",
        full_text: "Testing #agents and tool benchmarks",
        lang: "en",
        favorite_count: 540,
        retweet_count: 90,
        reply_count: 42,
        view_count: 85000,
        bookmark_count: 110,
        author: {
          id: "11",
          username: "karpathy",
          name: "Andrej Karpathy",
          profilePicture: "https://pbs.twimg.com/profile_images/k.jpg",
          description: "Building Eureka Labs",
          isBlueVerified: true,
          followers: 1200000,
          following: 250,
          statusesCount: 4200,
        },
        entities: {
          hashtags: [{ text: "Agents" }],
          user_mentions: [{ screen_name: "OpenAI" }],
          symbols: [{ text: "NVDA" }],
          urls: [{ expanded_url: "https://karpathy.ai/notes" }],
        },
      }],
    });
  });

  const page = await tw.collectPage({
    source: {
      id: randomUUID(), platform: "x", primaryProvider: "twitterapis", fallbackProvider: null,
      deliveryMode: "pull", label: "KOL Batch", contentKind: "post", state: "active",
      createdAt: now, updatedAt: now, revision: 1, schedule: { enabled: false },
      tier: "T1", ownerEntityId: null, sourceGroup: null, tags: [], locale: null,
      fetchPolicy: {}, health: {}, coverage: "partial",
      target: { type: "account", account: "karpathy", accounts: ["karpathy", "simonw"], sort: "top", excludeReposts: true },
    },
    from: "2026-11-21T00:00:00Z",
    to: now,
    limit: 20,
    checkpoint: null,
  });
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].author?.followersCount, 1200000);
  assert.equal(page.items[0].author?.verified, true);
  assert.equal(page.items[0].author?.avatarUrl, "https://pbs.twimg.com/profile_images/k.jpg");
  if (page.items[0].platformDetails.platform === "x") {
    assert.deepEqual(page.items[0].platformDetails.hashtags, ["agents"]);
    assert.deepEqual(page.items[0].platformDetails.mentions, ["openai"]);
    assert.equal(page.items[0].platformDetails.externalDomain, "karpathy.ai");
  }

  const sb = scrapeBadger({ SOURCE_NETWORK_ENABLED: "true", SCRAPEBADGER_API_KEY: "tok" }, async (raw) => {
    const url = new URL(String(raw));
    assert.equal(url.searchParams.get("query_type"), "Top");
    assert.match(url.searchParams.get("query")!, /min_faves:25 min_replies:5 lang:en -is:retweet/);
    return Response.json({ data: [] });
  });
  await sb.collectPage({
    source: {
      id: randomUUID(), platform: "x", primaryProvider: "scrapebadger", fallbackProvider: null,
      deliveryMode: "pull", label: "KW Top", contentKind: "post", state: "active",
      createdAt: now, updatedAt: now, revision: 1, schedule: { enabled: false },
      tier: "T2", ownerEntityId: null, sourceGroup: null, tags: [], locale: null,
      fetchPolicy: {}, health: {}, coverage: "partial",
      target: { type: "search", query: "cursor ai", sort: "top", minLikes: 25, minComments: 5, excludeReposts: true, language: "en" },
    },
    from: "2026-11-21T00:00:00Z",
    to: now,
    limit: 20,
    checkpoint: null,
  });
});
