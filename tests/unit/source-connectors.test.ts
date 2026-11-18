import assert from "node:assert/strict";
import test from "node:test";
import type { CollectionSource } from "../../packages/contracts/src/source-content";
import { redCrawler } from "../../src/connectors/reddit/red-crawler";
import { webSource } from "../../src/connectors/web/sources";
import { scrapeBadger } from "../../src/connectors/x/scrapebadger";

const from = "2026-11-15T00:00:00.000Z";
const to = "2026-11-16T00:00:00.000Z";
const later = "2026-11-17T00:00:00.000Z";
const request = { from, to, limit: 2, checkpoint: null };
const env = { SOURCE_NETWORK_ENABLED: "true" };
const source = (target: CollectionSource["target"], contentKind: CollectionSource["contentKind"]) =>
  ({ id: "00000000-0000-4000-8000-000000000001", target, contentKind }) as CollectionSource;

test("feed revalidates a moving window and reloads a truncated snapshot", async () => {
  const url = "https://fixture.example/feed";
  const xml = `<rss version="2.0"><channel><title>Fixture</title><link>${url}</link><description>Test</description>
    <item><title>First</title><link>https://fixture.example/first</link><pubDate>Sun, 15 Nov 2026 12:00:00 GMT</pubDate></item>
    <item><title>Second</title><link>https://fixture.example/second</link><pubDate>Sun, 15 Nov 2026 13:00:00 GMT</pubDate></item>
    <item><title>Future</title><link>https://fixture.example/future</link><pubDate>Mon, 16 Nov 2026 12:00:00 GMT</pubDate></item>
    </channel></rss>`;
  const calls: (string | undefined)[] = [];
  const feed = webSource("feed", { ...env, FEED_ALLOWED_URLS: url }, async (_, __, headers) => {
    const tag = headers?.["If-None-Match"];
    calls.push(tag);
    return tag ? { status: 304, body: "", etag: '"fixture"' } : { status: 200, body: xml, etag: '"fixture"' };
  });
  const input = { ...request, source: source({ type: "feed", url }, "article") };
  const partial = await feed.collectPage({ ...input, limit: 1 });
  assert.equal(partial.items.length, 1);
  const full = await feed.collectPage({ ...input, checkpoint: partial.nextCheckpoint });
  assert.equal(full.items.length, 2);
  const unchanged = await feed.collectPage({
    ...input, from: "2026-11-15T01:00:00.000Z", to: "2026-11-16T01:00:00.000Z", checkpoint: full.nextCheckpoint,
  });
  assert.equal(unchanged.notModified, true);
  const advanced = await feed.collectPage({ ...input, from: to, to: later, checkpoint: unchanged.nextCheckpoint });
  assert.deepEqual(advanced.items.map((item) => item.title), ["Future"]);
  assert.deepEqual(calls, [undefined, undefined, '"fixture"', undefined]);
});

test("red_crawler accepts bare IDs for comments, parents and roots", async () => {
  const reddit = redCrawler({ ...env, APIFY_API_TOKEN: "fixture" }, async (url, init) => {
    if (String(url).includes("datasets/")) return Response.json([
      { id: "comment1", parent_id: "root1", depth: 0, createdAt: from, subreddit: { prefixedName: "r/fixture" } },
      { id: "comment2", post_id: "root1", parent_id: "comment1", depth: 1, createdAt: from, subreddit: { prefixedName: "r/fixture" } },
    ]);
    assert.equal(JSON.parse(String(init?.body)).post_comments_post, "root1");
    return Response.json({ data: { id: "run1", defaultDatasetId: "data1", status: "SUCCEEDED" } });
  });
  const page = await reddit.collectPage({
    ...request, source: source({ type: "post", postId: "t3_root1" }, "comment"),
    execution: { state: {}, saveState: async () => {} },
  });
  assert.deepEqual(page.items.map((item) => [item.externalId, ...item.references.map((ref) => ref.externalId)]), [
    ["t1_comment1", "t3_root1", "t3_root1"],
    ["t1_comment2", "t3_root1", "t1_comment1"],
  ]);
});

test("ScrapeBadger scopes account searches upstream and records refresh credits", async () => {
  const connector = scrapeBadger({ ...env, SCRAPEBADGER_API_KEY: "fixture" }, async (raw) => {
    const url = new URL(String(raw));
    if (url.pathname.endsWith("/advanced_search")) {
      assert.match(url.searchParams.get("query")!, /^from:fixture since_time:\d+ until_time:\d+$/);
      assert.equal(url.searchParams.get("count"), "2");
    } else {
      assert.equal(url.searchParams.get("tweets"), "123456");
    }
    return Response.json({
      data: [{ id: "123456", created_at: from, text: "Example", username: "fixture" }],
    }, { headers: { "X-Credits-Used": "2" } });
  });
  const account = source({ type: "account", account: "@Fixture" }, "post");
  const collected = await connector.collectPage({ ...request, source: account });
  assert.equal(collected.items[0].externalId, "123456");
  const refreshed = await connector.refreshIds!({ source: account, externalIds: ["123456"] });
  assert.equal(refreshed.creditsUsed, 2);
  assert.equal(refreshed.items.length, 1);
});
