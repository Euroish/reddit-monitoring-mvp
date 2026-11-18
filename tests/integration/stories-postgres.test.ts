import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../../apps/api/src/app";
import { webSource } from "../../src/connectors/web/sources";
import { bootstrapOwner } from "../../src/modules/access/sql";
import { scheduleDueSourcesOnce } from "../../src/modules/collection/schedule";
import { workOnce } from "../../src/modules/collection/worker";
import { contentStories } from "../../src/modules/content/stories";
import { commitContentBatch, prepareContentBatch } from "../../src/modules/content/sql";
import { transaction } from "../../src/storage/db";
import { batchItem } from "../helpers/content-batch-fixtures";
import { testDatabase } from "../helpers/database";

test("new boards preview, schedule and publish stories with real discovery rows", async t => {
  const db = await testDatabase();
  t.after(db.close);
  await bootstrapOwner(db.pool, "fixture-password-123", "owner@example.test");
  const origin = "http://stories.test";
  const dated = new Date(Date.now() - 3_600_000).toUTCString();
  const connector = webSource("newsnow", { SOURCE_NETWORK_ENABLED: "true" }, async url => ({
    status: 200,
    body: url.hostname === "api.zhihu.com"
      ? JSON.stringify({ data: [{ target: { url: "https://api.zhihu.com/questions/2105702944855287688", title: "一个很热的话题" } }] })
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
  for (const query of ["zhihu-hot", "google-trends-us"]) {
    const payload = { label: query, platform: "web", primaryProvider: "newsnow", deliveryMode: "pull", contentKind: "article",
      target: { type: "search", query }, schedule: { enabled: true, pageSize: 20, cadenceSeconds: 900, maxPages: 1 } };
    const preview = await app.inject({ method: "POST", url: "/v1/sources/preview", headers, payload });
    assert.equal(preview.statusCode, 200, preview.body);
    assert.equal(preview.json().items.length, query === "zhihu-hot" ? 1 : 2);
    if (query === "zhihu-hot") assert.equal(preview.json().items[0].url, "https://www.zhihu.com/question/2105702944855287688");
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
  const latest = await app.inject({ url: "/v1/content/stories?view=latest", headers });
  assert.equal(latest.statusCode, 200, latest.body);
  assert.equal(latest.json().items.length, 3);
  assert.equal(latest.json().items[0].representative.tier, "T1_5");
  const key = await app.inject({ method: "POST", url: "/v1/access/keys", headers,
    payload: { label: "Google-only reader", scopes: ["read"], allowedSourceIds: [ids[1]], expiresInDays: 1 } });
  assert.equal(key.statusCode, 200, key.body);
  const scoped = await app.inject({ url: "/v1/content/stories?view=latest",
    headers: { authorization: `Bearer ${key.json().token}` } });
  assert.equal(scoped.statusCode, 200, scoped.body);
  assert.equal(scoped.json().items.length, 2, "Scoped keys must not reuse the full-scope cached view");
  const hidden = await app.inject({ url: "/v1/content/stories" });
  assert.equal(hidden.statusCode, 401);
});

test("visible story evidence selects the best tier, deduplicates owners and rolls over the morning edition", async t => {
  const db = await testDatabase();
  t.after(db.close);
  const at = Date.parse("2026-11-18T00:00:00Z");
  const h = 3600000;
  const ago = (hours: number) => new Date(at - hours * h).toISOString();
  const actor = { allowedSourceIds: null } as Parameters<typeof contentStories>[1];
  const seed = async (label: string, tier: string, owner: string, story: { time: number; title: string; url: string; links?: string[] }[]) => {
    const result = await db.pool.query(`INSERT INTO collection_source(id,platform_id,provider,primary_provider,label,target,content_kind,delivery_mode,
      created_at,updated_at,tier,owner_entity_id) SELECT gen_random_uuid(),id,'kaix','kaix',$1,jsonb_build_object('type','search','query',$1::text),
      'post','pull',$2,$2,$3,$4 FROM source WHERE code='reddit' RETURNING id,platform_id`, [label, ago(80), tier, owner]);
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
  const hot = await contentStories(db.pool, actor, { view: "hot" }, at);
  const event = hot.items[0];
  assert.equal(event.representative.title, launch);
  assert.equal(event.representative.tier, "T1");
  assert.equal(event.relatedCount, 2);
  assert.equal(event.sourceCount, 2);
  assert.ok(Math.abs(event.heat48h - (3 * 0.5 ** (9 / 24) + 0.5 ** (2 / 24))) < 1e-8);
  assert.equal(event.trend, "up");
  assert.equal(hot.items.length, 3);
  const restricted = await contentStories(db.pool, { ...actor, allowedSourceIds: [media] }, { view: "hot" }, at);
  assert.equal(restricted.items[0].representative.tier, "T2");
  assert.equal(restricted.items.find(item => item.representative.title === "Acme 发布 Orbit 2")?.sourceCount, 1);
  assert.ok(restricted.items.every(item => !item.relatedCount));
  const digest = await contentStories(db.pool, actor, { view: "digest" }, at + h);
  assert.equal(digest.to, ago(0));
  assert.equal(digest.from, ago(24));
  assert.equal(digest.items.length, 2);
  assert.equal((await contentStories(db.pool, actor, { view: "digest" }, at - 1)).to, ago(24));
});
