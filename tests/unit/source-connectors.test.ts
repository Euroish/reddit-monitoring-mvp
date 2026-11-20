import assert from "node:assert/strict";
import test from "node:test";
import type { CollectionSource } from "../../packages/contracts/src/source-content";
import { redCrawler } from "../../src/connectors/reddit/red-crawler";
import { canonicalizeUrl, isPublicIp } from "../../src/connectors/web/http";
import { webSource } from "../../src/connectors/web/sources";
import { detectLanguage, detectWebChannel } from "../../src/shared/text/language";
import { twitterApis } from "../../src/connectors/x/twitterapis";
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

test("TwitterAPIs queries an account window and preserves attached media and links", async () => {
  const connector = twitterApis({ ...env, TWITTERAPIS_API_KEY: "fixture" }, async (raw) => {
    const url = new URL(String(raw));
    assert.equal(url.pathname, "/twitter/tweet/advanced_search");
    assert.match(url.searchParams.get("query")!, /^from:fixture since_time:\d+ until_time:\d+$/);
    return Response.json({ tweets: [{
      id: "123456", created_at: from, text: "Example", author: { username: "Fixture" },
      media: [{
        type: "video", media_url_https: "https://example.com/preview.jpg",
        video_info: { duration_millis: 1500, variants: [{ content_type: "video/mp4", url: "https://example.com/video.mp4" }] },
      }],
      entities: { urls: [{ expanded_url: "https://example.com/release" }] },
    }] });
  });
  const account = source({ type: "account", account: "@Fixture" }, "post");
  const page = await connector.collectPage({ ...request, source: account, limit: 25 });
  assert.deepEqual(page.items[0]?.media.map(({ type, durationSeconds }) => [type, durationSeconds]), [["video", 1.5], ["link", null]]);
});

test("web helper canonicalizes tracking params, validates public IPs, detects language/channel and supports dynamic feeds up to 100", async () => {
  assert.equal(
    canonicalizeUrl("https://example.com/post?b=2&utm_source=hn&fbclid=xyz&a=1#frag")?.href,
    "https://example.com/post?a=1&b=2",
  );
  assert.equal(isPublicIp("93.184.216.34"), true);
  assert.equal(isPublicIp("127.0.0.1"), false);
  assert.equal(isPublicIp("10.0.0.1"), false);
  assert.equal(isPublicIp("::1"), false);
  assert.equal(detectLanguage("开源算力工具", null), "zh");
  assert.equal(detectLanguage("東京アート展示", null), "ja");
  assert.equal(detectLanguage("OpenAI Codex", null), "en");
  assert.equal(detectWebChannel(new URL("https://www.youtube.com/feeds/videos.xml?channel_id=1")), "youtube");

  const dynUrl = "https://open.example/rss.xml";
  const itemsXml = Array.from({ length: 45 }, (_, i) =>
    `<item><title>Story ${i}</title><link>https://open.example/p/${i}?utm_medium=rss</link><pubDate>Sun, 15 Nov 2026 12:${String(i % 60).padStart(2, "0")}:00 GMT</pubDate></item>`,
  ).join("");
  const rss = `<rss version="2.0"><channel><title>Open</title>${itemsXml}</channel></rss>`;
  const calls: (string | undefined)[] = [];
  const dynamicFeed = webSource(
    "feed",
    { SOURCE_NETWORK_ENABLED: "true" },
    async (_u, _s, headers) => {
      const tag = headers?.["If-None-Match"];
      calls.push(tag);
      return tag ? { status: 304, body: "", etag: '"v1"' } : { status: 200, body: rss, etag: '"v1"' };
    },
  );
  const src = {
    ...source({ type: "feed", url: dynUrl }, "article"),
    fetchPolicy: { maxItems: 40 },
  };
  const first = await dynamicFeed.collectPage({ from, to, limit: 100, checkpoint: null, source: src });
  assert.equal(first.items.length, 40);
  assert.equal(first.truncated, true);
  assert.equal(first.items[0]?.url, "https://open.example/p/44");
  assert.equal(first.items[0]?.language, "en");
  assert.equal((first.items[0]?.platformDetails as { channel?: string }).channel, "rss");

  // Forward-moving window with same limit <= prior.limit revalidates via 304 even after truncation
  const second = await dynamicFeed.collectPage({
    from: "2026-11-15T01:00:00.000Z", to, limit: 40, checkpoint: first.nextCheckpoint,
    httpEtag: first.httpEtag, source: src,
  });
  assert.equal(second.notModified, true);
  // Expanding limit > prior.limit bypasses 304 so truncated items can be recovered
  const expanded = await dynamicFeed.collectPage({
    from: "2026-11-15T01:00:00.000Z", to, limit: 50, checkpoint: first.nextCheckpoint,
    httpEtag: first.httpEtag, source: { ...src, fetchPolicy: { maxItems: 50 } },
  });
  assert.equal(expanded.items.length, 45);
  assert.deepEqual(calls, [undefined, '"v1"', undefined]);
});

test("google-trends-us prefers ht:news_item source URL and preserves thumbnail, Trends link, and fallback", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0" xmlns:ht="https://trends.google.com/trending/rss">
      <channel><title>Daily Search Trends</title>
        <item>
          <title>Nvidia earnings</title>
          <ht:approx_traffic>200,000+</ht:approx_traffic>
          <pubDate>Sun, 15 Nov 2026 12:00:00 GMT</pubDate>
          <ht:picture>https://encrypted-tbn0.gstatic.com/images?q=trend</ht:picture>
          <ht:news_item>
            <ht:news_item_title>Nvidia beats Q3 expectations</ht:news_item_title>
            <ht:news_item_snippet>Chipmaker reports strong AI demand.</ht:news_item_snippet>
            <ht:news_item_url>https://reuters.com/tech/nvidia-q3?utm_source=google</ht:news_item_url>
            <ht:news_item_picture>https://reuters.com/img/nvidia.jpg</ht:news_item_picture>
            <ht:news_item_source>Reuters</ht:news_item_source>
          </ht:news_item>
        </item>
        <item>
          <title>Solar eclipse</title>
          <ht:approx_traffic>50,000+</ht:approx_traffic>
          <pubDate>Sun, 15 Nov 2026 13:00:00 GMT</pubDate>
        </item>
      </channel>
    </rss>`;
  const trends = webSource("newsnow", env, async () => ({ status: 200, body: xml }));
  const page = await trends.collectPage({
    from, to, limit: 10, checkpoint: null,
    source: source({ type: "search", query: "google-trends-us" }, "article"),
  });
  assert.equal(page.items.length, 2);
  const [withNews, fallback] = page.items;
  assert.equal(withNews.url, "https://reuters.com/tech/nvidia-q3");
  assert.equal(withNews.title, "Nvidia beats Q3 expectations");
  assert.equal(withNews.author?.displayName, "Reuters");
  assert.match(withNews.text ?? "", /Chipmaker reports strong AI demand\. — 热搜词：Nvidia earnings · 200,000\+/);
  assert.deepEqual(
    withNews.media.map((m) => [m.type, m.url]),
    [
      ["image", "https://reuters.com/img/nvidia.jpg"],
      ["link", "https://trends.google.com/trends/explore?geo=US&q=Nvidia+earnings&date=2026-11-15+2026-11-15"],
    ],
  );
  assert.equal(
    fallback.url,
    "https://trends.google.com/trends/explore?geo=US&q=Solar+eclipse&date=2026-11-15+2026-11-15",
  );
  assert.equal(fallback.title, "Solar eclipse");
  assert.equal(fallback.text, "热搜词：Solar eclipse · 50,000+");
});

test("fetchPolicy.excludeTitlePatterns drops matching titles case-insensitively on feed and newsnow", async () => {
  const rss = `<rss version="2.0"><channel><title>Deals</title>
    <item><title>SPONSORED: Buy Widget Now</title><link>https://deals.example/1</link><pubDate>Sun, 15 Nov 2026 12:00:00 GMT</pubDate></item>
    <item><title>Daily Promo Roundup</title><link>https://deals.example/2</link><pubDate>Sun, 15 Nov 2026 12:10:00 GMT</pubDate></item>
    <item><title>Kernel 7.0 Released</title><link>https://deals.example/3</link><pubDate>Sun, 15 Nov 2026 12:20:00 GMT</pubDate></item>
  </channel></rss>`;
  const feed = webSource("feed", env, async () => ({ status: 200, body: rss }));
  const feedPage = await feed.collectPage({
    from, to, limit: 10, checkpoint: null,
    source: {
      ...source({ type: "feed", url: "https://deals.example/rss.xml" }, "article"),
      fetchPolicy: { excludeTitlePatterns: ["sponsored:", "promo"] },
    },
  });
  assert.deepEqual(feedPage.items.map((item) => item.title), ["Kernel 7.0 Released"]);

  const hnHtml = `<table>
    <tr class="athing" id="101"><td class="title"><span class="titleline"><a href="https://a.example">Sponsor: Try Cloud</a></span></td></tr>
    <tr class="athing" id="102"><td class="title"><span class="titleline"><a href="https://b.example">Postgres 18 Indexing Notes</a></span></td></tr>
  </table>`;
  const board = webSource("newsnow", env, async () => ({ status: 200, body: hnHtml }));
  const boardPage = await board.collectPage({
    from, to, limit: 10, checkpoint: null,
    source: {
      ...source({ type: "search", query: "hackernews" }, "article"),
      fetchPolicy: { excludeTitlePatterns: ["sponsor:"] },
    },
  });
  assert.deepEqual(boardPage.items.map((item) => item.title), ["Postgres 18 Indexing Notes"]);
});
