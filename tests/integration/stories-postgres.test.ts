import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../../apps/api/src/app";
import { webSource } from "../../src/connectors/web/sources";
import { bootstrapOwner } from "../../src/modules/access/sql";
import { scheduleDueSourcesOnce } from "../../src/modules/collection/schedule";
import { workOnce } from "../../src/modules/collection/worker";
import { readStoryWindow, selectStoryFeed } from "../../src/modules/content/stories";
import { commitContentBatch, prepareContentBatch } from "../../src/modules/content/sql";
import { transaction } from "../../src/storage/db";
import { batchItem } from "../helpers/content-batch-fixtures";
import { testDatabase } from "../helpers/database";

test("Hacker News and Google Trends preview, schedule and publish stories with real discovery rows", async t => {
  const db = await testDatabase();
  t.after(db.close);
  await bootstrapOwner(db.pool, "fixture-password-123", "owner@example.test");
  const origin = "http://stories.test";
  const dated = new Date(Date.now() - 3_600_000).toUTCString();
  const connector = webSource("newsnow", { SOURCE_NETWORK_ENABLED: "true" }, async url => ({
    status: 200,
    body: url.hostname === "news.ycombinator.com"
      ? `<table><tr class="athing" id="123"><td class="titleline"><a href="item?id=123">A Hacker News story</a></td></tr></table>`
      : `<rss version="2.0"><channel><title>Trends</title><link>${url}</link><description>Trends</description>
        <item><title>Storm warning</title><link>${url}</link><pubDate>${dated}</pubDate></item>
        <item><title>Baseball finals</title><link>${url}</link><pubDate>${dated}</pubDate></item></channel></rss>`,
  }));
  const app = await buildApp({ pool: db.pool, origin, secureCookies: false, sessionSecret: "story-fixture".repeat(4), providers: [connector] });
  t.after(() => app.close());
  const login = await app.inject({ method: "POST", url: "/v1/auth/login", headers: { origin },
    payload: { email: "owner@example.test", password: "fixture-password-123" } });
  assert.equal(login.statusCode, 200, login.body);
  const headers = { origin, cookie: login.headers["set-cookie"]!.toString().split(";")[0] };
  const ids: string[] = [];
  for (const query of ["hackernews", "google-trends-us"]) {
    const payload = { label: query, platform: "web", primaryProvider: "newsnow", deliveryMode: "pull", contentKind: "article",
      target: { type: "search", query }, schedule: { enabled: true, pageSize: 20, cadenceSeconds: 900, maxPages: 1 } };
    const preview = await app.inject({ method: "POST", url: "/v1/sources/preview", headers, payload });
    assert.equal(preview.statusCode, 200, preview.body);
    assert.equal(preview.json().items.length, query === "hackernews" ? 1 : 2);
    if (query === "hackernews") assert.equal(preview.json().items[0].url, "https://news.ycombinator.com/item?id=123");
    const created = await app.inject({ method: "POST", url: "/v1/sources", headers, payload });
    assert.equal(created.statusCode, 200, created.body);
    assert.equal(created.json().source.tier, "T2");
    ids.push(created.json().source.id);
  }
  const changed = await app.inject({ method: "PATCH", url: `/v1/sources/${ids[0]}`, headers,
    payload: { revision: 1, tier: "T1_5", ownerEntityId: "fixture-owner" } });
  assert.equal(changed.statusCode, 200, changed.body);
  const listed = await app.inject({ url: "/v1/sources", headers });
  assert.equal(listed.json().sources.find((source: { id: string }) => source.id === ids[0]).ownerEntityId, "fixture-owner");
  await db.pool.query(`UPDATE source_provider_budget SET enabled=true,daily_requests=100,monthly_requests=100,
    daily_resources=1000,monthly_resources=1000 WHERE provider='newsnow'`);
  for (let i = 0; i < 2; i++) {
    await scheduleDueSourcesOnce(db.pool, [connector]);
    assert.equal(await workOnce(db.pool, [connector]), true);
  }
  const jobs = await db.pool.query("SELECT status,records_processed FROM source_collection_job ORDER BY records_processed");
  assert.deepEqual(jobs.rows, [{ status: "succeeded", records_processed: 1 }, { status: "succeeded", records_processed: 2 }]);
  let now = (Math.floor(Date.now() / 30_000) + 1) * 30_000 + 1_000;
  t.mock.method(Date, "now", () => now);
  const query = t.mock.method(db.pool, "query");
  const aggregations = () => query.mock.calls.filter(call => String(call.arguments[0]).includes("WITH candidates AS MATERIALIZED")).length;
  const [latest, hot, digest] = await Promise.all([
    app.inject({ url: "/v1/content/stories?view=latest", headers }),
    app.inject({ url: "/v1/content/stories?view=hot&limit=1", headers }),
    app.inject({ url: "/v1/content/stories?view=digest", headers }),
  ]);
  assert.equal(latest.statusCode, 200, latest.body);
  assert.equal(latest.json().items.length, 3);
  assert.equal(latest.json().items[0].representative.tier, "T1_5");
  assert.equal(hot.statusCode, 200, hot.body);
  assert.equal(hot.json().to, latest.json().to);
  assert.equal(hot.json().items.length, 1);
  assert.equal(digest.statusCode, 200, digest.body);
  assert.notEqual(digest.json().to, latest.json().to);
  assert.equal(latest.json().totalCount, 3);
  assert.equal(latest.json().nextOffset, null);
  assert.equal(hot.json().totalCount, 3);
  assert.equal(hot.json().nextOffset, 1);
  assert.equal(aggregations(), 3, "Latest, hot and digest each cache their own window");
  const larger = await app.inject({ url: "/v1/content/stories?limit=50", headers });
  assert.deepEqual(larger.json(), latest.json());
  assert.equal(aggregations(), 3);
  const filtered = await app.inject({ url: `/v1/content/stories?sourceId=${ids[0]}`, headers });
  assert.equal(filtered.statusCode, 200, filtered.body);
  assert.equal(filtered.json().items.length, 1);
  assert.equal(aggregations(), 4);
  const key = await app.inject({ method: "POST", url: "/v1/access/keys", headers,
    payload: { label: "Google-only reader", scopes: ["read"], allowedSourceIds: [ids[1]], expiresInDays: 1 } });
  assert.equal(key.statusCode, 200, key.body);
  const scoped = await app.inject({ url: "/v1/content/stories?view=latest",
    headers: { authorization: `Bearer ${key.json().token}` } });
  assert.equal(scoped.statusCode, 200, scoped.body);
  assert.equal(scoped.json().items.length, 2, "Scoped keys must not reuse the full-scope cached view");
  assert.equal(aggregations(), 5);
  now += 30_000;
  const refreshed = await app.inject({ url: "/v1/content/stories?view=hot", headers });
  assert.equal(refreshed.statusCode, 200, refreshed.body);
  assert.equal(refreshed.json().to, new Date(now).toISOString());
  assert.equal(aggregations(), 6);
  const hidden = await app.inject({ url: "/v1/content/stories" });
  assert.equal(hidden.statusCode, 401);
  assert.equal(aggregations(), 6);
});

test("visible story evidence selects the best tier, deduplicates owners and rolls over the morning edition", async t => {
  const db = await testDatabase();
  t.after(db.close);
  const at = Date.parse("2026-11-18T00:00:00Z");
  const h = 3600000;
  const ago = (hours: number) => new Date(at - hours * h).toISOString();
  const actor = { allowedSourceIds: null } as Parameters<typeof readStoryWindow>[1];
  const seed = async (label: string, tier: string, owner: string, story: { time: number; title: string; url: string; links?: string[] }[]) => {
    const result = await db.pool.query(`INSERT INTO collection_source(id,platform_id,primary_provider,label,target,content_kind,delivery_mode,
      created_at,updated_at,tier,owner_entity_id,source_group) SELECT gen_random_uuid(),id,'kaix',$1,jsonb_build_object('type','search','query',$1::text),
      'post','pull',$2,$2,$3,$4,CASE WHEN $3='T1' THEN 'ai-firsthand' ELSE 'tech-media' END FROM source WHERE code='reddit' RETURNING id,platform_id`, [label, ago(80), tier, owner]);
    const id: string = result.rows[0].id;
    const items = story.map((entry, index) => {
      const externalId = `t3_${label}${index}`;
      const item = batchItem(id, { externalId });
      item.title = entry.title;
      item.url = entry.url;
      item.publishedAt = ago(entry.time);
      item.fetchedAt = ago(entry.time - 0.1);
      item.observation.fetchedAt = item.fetchedAt;
      item.observation.sourceObservedAt = null;
      item.media = (entry.links ?? []).map(url => ({ type: "link", url, previewUrl: null, altText: null, durationSeconds: null }));
      return item;
    });
    await transaction(db.pool, client => commitContentBatch(client,
      { id, platformId: result.rows[0].platform_id, platform: "reddit", provider: "kaix", contentKinds: ["post"] },
      prepareContentBatch(items), ago(0)));
    return id;
  };
  const launch = "Acme releases Orbit 2 for local developers";
  const officialUrl = "https://acme.example/blog/orbit-2";
  await seed("official", "T1", "acme", [{ time: 9, title: launch, url: officialUrl }]);
  await seed("mirror", "T1_5", "acme", [{ time: 9, title: "For local developers, Acme releases Orbit 2", url: "https://mirror.example/orbit" }]);
  const media = await seed("media", "T2", "press", [
    { time: 2, title: "Acme 发布 Orbit 2", url: "https://press.example/news/orbit", links: [officialUrl + "?utm_source=feed"] },
    { time: 1, title: "Acme releases Atlas 9 for local developers", url: "https://press.example/news/atlas" },
    { time: 35, title: "A notebook from yesterday", url: "https://press.example/news/notebook" },
    { time: -1, title: "News after the edition cutoff", url: "https://press.example/news/late" },
    { time: 55, title: "Archived article that stays out of the latest window", url: "https://press.example/news/archive" },
  ]);
  const rolling = await readStoryWindow(db.pool, actor, { view: "hot" }, at);
  const hot = selectStoryFeed(rolling, "hot", 20);
  const event = hot.items[0];
  assert.equal(event.representative.title, launch);
  assert.equal(event.representative.tier, "T1");
  assert.equal(event.relatedCount, 2);
  assert.equal(event.sourceCount, 2);
  assert.deepEqual(event.tierBreakdown, { T1: 1, T1_5: 1, T2: 1 });
  assert.deepEqual(event.sparkline48h, [0, 0, 0, 0, 0, 0, 3 * 0.5 ** (3 / 24), 0.5 ** (2 / 24)]);
  assert.ok(Math.abs(event.heat48h - (3 * 0.5 ** (9 / 24) + 0.5 ** (2 / 24))) < 1e-8);
  assert.equal(event.trend, "up");
  assert.equal(hot.items.length, 3);
  const latest = selectStoryFeed(rolling, "latest", 1);
  assert.equal(latest.items[0].representative.title, "Acme releases Atlas 9 for local developers");
  const restricted = selectStoryFeed(await readStoryWindow(db.pool, { ...actor, allowedSourceIds: [media] }, { view: "hot" }, at), "hot", 20);
  assert.equal(restricted.items[0].representative.tier, "T2");
  const restrictedOrbit = restricted.items.find(item => item.representative.title === "Acme 发布 Orbit 2");
  assert.equal(restrictedOrbit?.sourceCount, 1);
  assert.ok(restricted.items.every(item => !item.relatedCount));
  assert.ok(restricted.items.every(item => item.tierBreakdown.T1 === 0 && item.tierBreakdown.T1_5 === 0));
  assert.deepEqual(restrictedOrbit?.sparkline48h, [0, 0, 0, 0, 0, 0, 0, 0.5 ** (2 / 24)]);
  const digest = selectStoryFeed(await readStoryWindow(db.pool, actor, { view: "digest" }, at + h), "digest", 20);
  assert.equal(digest.to, ago(0));
  assert.equal(digest.from, ago(24));
  assert.equal(digest.items.length, 2);
  assert.equal((await readStoryWindow(db.pool, actor, { view: "digest" }, at - 1)).to, ago(24));
});

test("stories and content endpoints filter cleanly by sourceGroup, tier and language", async t => {
  const db = await testDatabase();
  t.after(db.close);
  await bootstrapOwner(db.pool, "fixture-password-123", "owner@example.test");
  const feed = webSource("feed", { SOURCE_NETWORK_ENABLED: "true" });
  const app = await buildApp({
    pool: db.pool, sessionSecret: "stories-filter-secret".repeat(3), origin: "http://stories.test", secureCookies: false,
    providers: [feed],
  });
  await app.ready();
  t.after(() => app.close());
  const login = await app.inject({
    method: "POST", url: "/v1/auth/login", headers: { origin: "http://stories.test" },
    payload: { email: "owner@example.test", password: "fixture-password-123" },
  });
  const headers = { cookie: login.headers["set-cookie"]!.toString().split(";")[0], origin: "http://stories.test" };
  const s1 = await app.inject({
    method: "POST", url: "/v1/sources", headers,
    payload: {
      platform: "web", primaryProvider: "feed", deliveryMode: "pull", contentKind: "article",
      label: "AI Primary", tier: "T1", sourceGroup: "ai-firsthand", locale: "en",
      target: { type: "feed", url: "https://ai.example/rss" },
    },
  });
  const s2 = await app.inject({
    method: "POST", url: "/v1/sources", headers,
    payload: {
      platform: "web", primaryProvider: "feed", deliveryMode: "pull", contentKind: "article",
      label: "CN Life", tier: "T2", sourceGroup: "lifestyle", locale: "zh",
      target: { type: "feed", url: "https://life.example/rss" },
    },
  });
  assert.equal(s1.statusCode, 200);
  assert.equal(s2.statusCode, 200);
  const nowIso = new Date().toISOString();
  const recentIso = new Date(Date.now() - 3600_000).toISOString();
  await transaction(db.pool, async (client) => {
    const src1 = s1.json().source;
    const src2 = s2.json().source;
    const a1 = batchItem(src1.id, {
      platform: "web", kind: "article", externalId: "https://ai.example/1", title: "New Model Launch",
      text: "Full technical report", url: "https://ai.example/1", publishedAt: recentIso, fetchedAt: nowIso, language: null,
      media: [{ type: "image", url: "https://ai.example/1.png", previewUrl: null, altText: null, durationSeconds: null }],
      platformDetails: { platform: "web", publisher: "ai.example", canonicalUrl: "https://ai.example/1", feedUrl: "https://ai.example/rss" },
    });
    a1.observation.provider = "feed";
    const a2 = batchItem(src2.id, {
      platform: "web", kind: "article", externalId: "https://life.example/1", title: "家庭料理指南",
      text: "简单美味的家常菜谱", url: "https://life.example/1", publishedAt: recentIso, fetchedAt: nowIso, language: null,
      media: [],
      platformDetails: { platform: "web", publisher: "life.example", canonicalUrl: "https://life.example/1", feedUrl: "https://life.example/rss" },
    });
    a2.observation.provider = "feed";
    const platId = (await client.query("SELECT id FROM source WHERE code='web'")).rows[0].id;
    await commitContentBatch(client, { id: src1.id, platformId: platId, platform: "web", provider: "feed", contentKinds: ["article"] }, prepareContentBatch([a1]), nowIso);
    await commitContentBatch(client, { id: src2.id, platformId: platId, platform: "web", provider: "feed", contentKinds: ["article"] }, prepareContentBatch([a2]), nowIso);
  });
  const aiStories = await app.inject({ url: "/v1/content/stories?sourceGroup=ai-firsthand&tier=T1&language=en", headers });
  assert.equal(aiStories.statusCode, 200, aiStories.body);
  assert.deepEqual(aiStories.json().items.map((x: { representative: { title: string } }) => x.representative.title), ["New Model Launch"]);
  assert.deepEqual(aiStories.json().items[0].tierBreakdown, { T1: 1, T1_5: 0, T2: 0 });
  assert.equal(aiStories.json().items[0].sparkline48h.length, 8);
  assert.equal(aiStories.json().items[0].representative.thumbnail, "https://ai.example/1.png");
  const zhMedia = await app.inject({ url: "/v1/content?sourceGroup=lifestyle&language=zh&hasMedia=false", headers });
  assert.equal(zhMedia.statusCode, 200, zhMedia.body);
  assert.deepEqual(zhMedia.json().items.map((x: { title: string; language: string }) => [x.title, x.language]), [["家庭料理指南", "zh"]]);
});


test("stories support pagination, diversity mixing, 7d latest window, social-trends isolation and thumbnails", async t => {
  const db = await testDatabase();
  t.after(db.close);
  await bootstrapOwner(db.pool, "fixture-password-123", "owner@example.test");
  const feed = webSource("feed", { SOURCE_NETWORK_ENABLED: "true" });
  const app = await buildApp({
    pool: db.pool, sessionSecret: "stories-diverse-secret".repeat(3), origin: "http://stories.test", secureCookies: false,
    providers: [feed],
  });
  await app.ready();
  t.after(() => app.close());
  const login = await app.inject({
    method: "POST", url: "/v1/auth/login", headers: { origin: "http://stories.test" },
    payload: { email: "owner@example.test", password: "fixture-password-123" },
  });
  const headers = { cookie: login.headers["set-cookie"]!.toString().split(";")[0], origin: "http://stories.test" };
  const createSource = async (label: string, tier: "T1" | "T1_5" | "T2", sourceGroup: string, slug: string) => {
    const res = await app.inject({
      method: "POST", url: "/v1/sources", headers,
      payload: {
        platform: "web", primaryProvider: "feed", deliveryMode: "pull", contentKind: "article",
        label, tier, sourceGroup, locale: "en",
        target: { type: "feed", url: `https://${slug}.example/rss` },
      },
    });
    assert.equal(res.statusCode, 200, res.body);
    return res.json().source.id as string;
  };
  const noisyId = await createSource("Noisy Wire", "T2", "tech-media", "noisy");
  const researchId = await createSource("Deep Research", "T1", "ai-firsthand", "research");
  const kernelId = await createSource("Kernel Notes", "T1_5", "dev-tools", "kernel");
  const cloudId = await createSource("Cloud Journal", "T2", "tech-media", "cloud");
  const archiveId = await createSource("Science Archive", "T1", "ai-firsthand", "archive");
  const trendsId = await createSource("Hot Board", "T2", "social-trends", "trends");

  const now = Date.now();
  const agoMs = (ms: number) => new Date(now - ms).toISOString();
  const min = 60_000;
  const hr = 3_600_000;
  const noisyTitles = [
    "Copper turbine cooling update", "Harbor freight crane schedule", "Subway signal relay test",
    "Solar inverter firmware note", "Fiber conduit trench report", "Bridge sensor battery check",
    "Airport baggage belt audit", "Water pump pressure metric", "Grid transformer oil sample",
    "Rail depot switch inspection",
  ];
  await transaction(db.pool, async client => {
    const platId = (await client.query("SELECT id FROM source WHERE code='web'")).rows[0].id as string;
    const commit = async (
      sourceId: string,
      slug: string,
      entries: { title: string; ago: number; image?: string }[],
    ) => {
      const items = entries.map((entry, idx) => {
        const url = `https://${slug}.example/post-${idx}`;
        const publishedAt = agoMs(entry.ago);
        const fetchedAt = agoMs(Math.max(1_000, entry.ago - 10_000));
        const item = batchItem(sourceId, {
          platform: "web", kind: "article", externalId: url, title: entry.title,
          text: `Summary for ${entry.title}`, url, publishedAt, fetchedAt, language: "en",
          media: entry.image
            ? [{ type: "image", url: entry.image, previewUrl: null, altText: null, durationSeconds: null }]
            : [],
          platformDetails: { platform: "web", publisher: `${slug}.example`, canonicalUrl: url, feedUrl: `https://${slug}.example/rss` },
        });
        item.observation.provider = "feed";
        item.observation.fetchedAt = fetchedAt;
        return item;
      });
      await commitContentBatch(
        client,
        { id: sourceId, platformId: platId, platform: "web", provider: "feed", contentKinds: ["article"] },
        prepareContentBatch(items),
        agoMs(0),
      );
    };
    await commit(noisyId, "noisy", noisyTitles.map((title, idx) => ({ title, ago: (idx + 1) * min })));
    await commit(researchId, "research", [{ title: "Quantum error correction threshold", ago: 20 * min, image: "https://research.example/thumb.webp" }]);
    await commit(kernelId, "kernel", [{ title: "Rust compiler borrow checker benchmark", ago: 25 * min }]);
    await commit(cloudId, "cloud", [{ title: "Postgres vacuum memory optimization", ago: 30 * min }]);
    await commit(archiveId, "archive", [{ title: "Five day old genomics breakthrough", ago: 120 * hr }]);
    await commit(trendsId, "trends", [{ title: "Viral celebrity gossip headline", ago: 15 * min }]);
  });

  // 1. Diversity mixing vs raw recency + thumbnail surface
  const mixedRes = await app.inject({ url: "/v1/content/stories?view=latest&limit=6&diverse=true", headers });
  assert.equal(mixedRes.statusCode, 200, mixedRes.body);
  const mixed = mixedRes.json();
  assert.equal(mixed.totalCount, 14);
  assert.equal(mixed.nextOffset, 6);
  const mixedSources = new Set(mixed.items.map((x: { representative: { sourceId: string } }) => x.representative.sourceId));
  assert.ok(mixedSources.has(researchId), "Page 1 must surface Deep Research");
  assert.ok(mixedSources.has(kernelId), "Page 1 must surface Kernel Notes");
  assert.ok(mixedSources.has(cloudId), "Page 1 must surface Cloud Journal");
  const researchStory = mixed.items.find((x: { representative: { sourceId: string } }) => x.representative.sourceId === researchId);
  const kernelStory = mixed.items.find((x: { representative: { sourceId: string } }) => x.representative.sourceId === kernelId);
  assert.equal(researchStory.representative.thumbnail, "https://research.example/thumb.webp");
  assert.equal(kernelStory.representative.thumbnail, null);

  const rawRes = await app.inject({ url: "/v1/content/stories?view=latest&limit=6&diverse=false", headers });
  assert.equal(rawRes.statusCode, 200, rawRes.body);
  assert.ok(
    rawRes.json().items.every((x: { representative: { sourceId: string } }) => x.representative.sourceId === noisyId),
    "diverse=false must preserve strict raw recency",
  );

  // 2. Pagination returns disjoint slices, accurate totalCount, and null nextOffset on final page
  const p1 = (await app.inject({ url: "/v1/content/stories?view=latest&limit=5&offset=0", headers })).json();
  const p2 = (await app.inject({ url: "/v1/content/stories?view=latest&limit=5&offset=5", headers })).json();
  const p3 = (await app.inject({ url: "/v1/content/stories?view=latest&limit=5&offset=10", headers })).json();
  assert.equal(p1.items.length, 5);
  assert.equal(p1.totalCount, 14);
  assert.equal(p1.nextOffset, 5);
  assert.equal(p2.items.length, 5);
  assert.equal(p2.totalCount, 14);
  assert.equal(p2.nextOffset, 10);
  assert.equal(p3.items.length, 4);
  assert.equal(p3.totalCount, 14);
  assert.equal(p3.nextOffset, null);
  const allKeys = [...p1.items, ...p2.items, ...p3.items].map((x: { storyKey: string }) => x.storyKey);
  assert.equal(new Set(allKeys).size, 14, "Paginated slices must be disjoint and retain every story");

  // 3. 7d latest surfaces 5-day-old T1 article while hot stays strictly within 48h
  const latestAll = (await app.inject({ url: "/v1/content/stories?view=latest&limit=30", headers })).json();
  const hotAll = (await app.inject({ url: "/v1/content/stories?view=hot&limit=30", headers })).json();
  const titlesOf = (feed: { items: { representative: { title: string } }[] }) => feed.items.map(x => x.representative.title);
  assert.ok(titlesOf(latestAll).includes("Five day old genomics breakthrough"));
  assert.ok(!titlesOf(hotAll).includes("Five day old genomics breakthrough"));
  assert.equal(latestAll.totalCount, 14);
  assert.equal(hotAll.totalCount, 13);

  // 4. Default social-trends exclusion vs explicit sourceGroup / includeTrends / sourceId
  assert.ok(!titlesOf(latestAll).includes("Viral celebrity gossip headline"));
  assert.ok(!titlesOf(hotAll).includes("Viral celebrity gossip headline"));
  const onlyTrends = (await app.inject({ url: "/v1/content/stories?view=latest&sourceGroup=social-trends", headers })).json();
  assert.deepEqual(titlesOf(onlyTrends), ["Viral celebrity gossip headline"]);
  const withTrends = (await app.inject({ url: "/v1/content/stories?view=latest&includeTrends=true&limit=30", headers })).json();
  assert.equal(withTrends.totalCount, 15);
  assert.ok(titlesOf(withTrends).includes("Viral celebrity gossip headline"));
  const byTrendsSource = (await app.inject({ url: `/v1/content/stories?view=latest&sourceId=${trendsId}`, headers })).json();
  assert.deepEqual(titlesOf(byTrendsSource), ["Viral celebrity gossip headline"]);
});
