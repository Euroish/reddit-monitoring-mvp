import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { buildApp } from "../../apps/api/src/app";
import { bootstrapOwner } from "../../src/modules/access/index";
import { KaixContentConnector } from "../../src/connectors/reddit/kaix-content.connector";
import { redCrawler } from "../../src/connectors/reddit/red-crawler";
import { scrapeBadger } from "../../src/connectors/x/scrapebadger";
import { twitterApis } from "../../src/connectors/x/twitterapis";
import {
  commitContentBatch,
  prepareContentBatch,
  upgradeContentEnrichment,
} from "../../src/modules/content/index";
import type { CollectedContent, ContentProvider } from "../../src/connectors/shared/content-provider.interface";
import { workOnce } from "../../src/modules/collection/worker";
import { hydrateHotCommunityPost } from "../../src/modules/intelligence/index";
import { transaction } from "../../src/storage/db";
import { testDatabase } from "../helpers/database";

function makeRedditBatchItem(
  sourceId: string,
  nowIso: string,
  publishedIso: string,
  overrides: Partial<CollectedContent> = {},
): CollectedContent {
  return {
    id: randomUUID(),
    platform: "reddit",
    kind: "post",
    externalId: `t3_${randomUUID().slice(0, 8)}`,
    title: "Cursor vs Windsurf comparison in production monorepo",
    text: "Evaluating indexing speed and benchmarks at https://benchmark.dev/report",
    url: "https://www.reddit.com/r/LocalLLaMA/comments/abc123/",
    language: "en",
    publishedAt: publishedIso,
    fetchedAt: nowIso,
    availability: "available",
    author: {
      externalId: "t2_author1",
      handle: "builder_one",
      displayName: "Builder One",
      url: "https://reddit.com/u/builder_one",
    },
    references: [],
    media: [
      {
        type: "image",
        url: "https://img.example/chart.png",
        previewUrl: "https://img.example/chart.png",
        altText: null,
        durationSeconds: null,
      },
    ],
    platformDetails: {
      platform: "reddit",
      community: "localllama",
      flair: "Benchmark",
      nsfw: false,
      domain: "benchmark.dev",
      awards: 2,
      subredditSubscribers: 320000,
    },
    observation: {
      sourceId,
      provider: "kaix",
      sourceObservedAt: null,
      fetchedAt: nowIso,
      timeBasis: "provider_snapshot",
      maturity: "initial",
      metrics: {
        "reddit.score": 180,
        "reddit.num_comments": 45,
        "reddit.upvote_ratio": 0.94,
      },
      evidenceKey: `ev-${randomUUID()}`,
    },
    ...overrides,
  };
}

test("PG16 V2 end-to-end: 059-062 schemas, enricher monotonicity, DELETE source, feed anti-repeat, and intelligence rollups", async (t) => {
  const db = await testDatabase();
  t.after(db.close);
  await bootstrapOwner(db.pool, "fixture-password-123", "owner@example.test");

  const origin = "http://v2.test";
  const providers = [
    new KaixContentConnector({ networkEnabled: true, apiToken: "tok" }),
    redCrawler({ SOURCE_NETWORK_ENABLED: "true", APIFY_API_TOKEN: "tok" }),
    twitterApis({ SOURCE_NETWORK_ENABLED: "true", TWITTERAPIS_API_KEY: "tok" }),
    scrapeBadger({ SOURCE_NETWORK_ENABLED: "true", SCRAPEBADGER_API_KEY: "tok" }),
  ];
  const app = await buildApp({
    pool: db.pool,
    origin,
    secureCookies: false,
    sessionSecret: "v2-fixture".repeat(4),
    providers,
    publicRead: true,
  });
  t.after(() => app.close());

  const login = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    headers: { origin },
    payload: { email: "owner@example.test", password: "fixture-password-123" },
  });
  assert.equal(login.statusCode, 200, login.body);
  const cookie = login.headers["set-cookie"]!.toString().split(";")[0];
  const headers = { origin, cookie };

  // Create a machine read key to verify write boundaries on /v1/feed/*
  const mkKey = await app.inject({
    method: "POST",
    url: "/v1/access/keys",
    headers,
    payload: { label: "read-key", scopes: ["read"], allowedSourceIds: [], expiresInDays: 7 },
  });
  assert.equal(mkKey.statusCode, 200, mkKey.body);
  const readBearer = { authorization: `Bearer ${mkKey.json().token}` };

  // 1. Source DELETE (hard-delete unused)
  const unusedSrc = await app.inject({
    method: "POST",
    url: "/v1/sources",
    headers,
    payload: {
      label: "Unused Temp Feed",
      platform: "reddit",
      primaryProvider: "kaix",
      deliveryMode: "pull",
      contentKind: "post",
      feedLane: "discussion",
      target: { type: "community", community: "rust" },
    },
  });
  assert.equal(unusedSrc.statusCode, 200, unusedSrc.body);
  const unusedId = unusedSrc.json().source.id as string;
  const delUnused = await app.inject({
    method: "DELETE",
    url: `/v1/sources/${unusedId}`,
    headers,
  });
  assert.equal(delUnused.statusCode, 200, delUnused.body);
  assert.equal(delUnused.json().mode, "deleted");

  // 2. Discussion source + promoted scalars, comment preview, velocity & enricher monotonicity
  const discSrc = await app.inject({
    method: "POST",
    url: "/v1/sources",
    headers,
    payload: {
      label: "LocalLLaMA Discussion",
      platform: "reddit",
      primaryProvider: "kaix",
      deliveryMode: "pull",
      contentKind: "post",
      tier: "T1",
      sourceGroup: "dev-infra",
      feedLane: "discussion",
      target: { type: "community", community: "localllama" },
    },
  });
  assert.equal(discSrc.statusCode, 200, discSrc.body);
  const discSrcId = discSrc.json().source.id as string;

  const redditPlat = (
    await db.pool.query<{ id: string }>("SELECT id FROM source WHERE code='reddit'")
  ).rows[0].id;
  const xPlat = (
    await db.pool.query<{ id: string }>("SELECT id FROM source WHERE code='x'")
  ).rows[0].id;

  const t1 = new Date(Date.now() - 7 * 3_600_000).toISOString();
  const t2 = new Date().toISOString();
  const pubIso = new Date(Date.now() - 8 * 3_600_000).toISOString();

  const postItem = makeRedditBatchItem(discSrcId, t1, pubIso, {
    externalId: "t3_mainpost1",
  });
  const commentItem = makeRedditBatchItem(discSrcId, t1, pubIso, {
    kind: "comment",
    externalId: "t1_topcmt1",
    title: null,
    text: "Great benchmark numbers on Q4 quantization!",
    media: [],
    references: [
      { kind: "post", externalId: "t3_mainpost1", relation: "thread_root" },
      { kind: "post", externalId: "t3_mainpost1", relation: "reply_to" },
    ],
    observation: {
      ...postItem.observation,
      metrics: { "reddit.score": 95 },
      evidenceKey: "ev-comment-1",
    },
  });

  await transaction(db.pool, async (client) => {
    const batch = prepareContentBatch([postItem, commentItem]);
    await commitContentBatch(
      client,
      {
        id: discSrcId,
        platformId: redditPlat,
        platform: "reddit",
        provider: "kaix",
        contentKinds: ["post", "comment"],
      },
      batch,
      t1,
    );
  });

  const postContentId = (
    await db.pool.query<{ id: string }>("SELECT id FROM content WHERE external_id='t3_mainpost1'")
  ).rows[0].id;

  // Upgrade to v2 and verify v1 re-ingest preserves v2 enrichment while updating metrics & velocity
  const upgraded = await upgradeContentEnrichment(db.pool, [
    {
      contentId: postContentId,
      cleanExcerpt: "LLM curated summary: Cursor leads monorepo indexing speed.",
      intentTag: "comparison",
      intentConfidence: 0.95,
      enrichmentVersion: 2,
      enrichmentSource: "llm_v2",
    },
  ]);
  assert.equal(upgraded, 1);

  const postV2 = makeRedditBatchItem(discSrcId, t2, pubIso, {
    id: postItem.id,
    externalId: "t3_mainpost1",
    observation: {
      ...postItem.observation,
      fetchedAt: t2,
      metrics: {
        "reddit.score": 420,
        "reddit.num_comments": 110,
        "reddit.upvote_ratio": 0.96,
      },
      evidenceKey: "ev-post-v2",
    },
  });
  await transaction(db.pool, async (client) => {
    await commitContentBatch(
      client,
      {
        id: discSrcId,
        platformId: redditPlat,
        platform: "reddit",
        provider: "kaix",
        contentKinds: ["post", "comment"],
      },
      prepareContentBatch([postV2]),
      t2,
    );
  });

  const storedPost = (
    await db.pool.query(
      "SELECT clean_excerpt, enrichment_version, velocity_score, metric_score FROM content WHERE id=$1",
      [postContentId],
    )
  ).rows[0];
  assert.equal(storedPost.enrichment_version, 2);
  assert.match(storedPost.clean_excerpt, /^LLM curated summary/);
  assert.equal(storedPost.metric_score, 420);
  assert.ok(Number(storedPost.velocity_score) > 0);

  // 3. /v1/feed/* anonymous mix, excludeIds, auth boundaries, anti-repeat, preferences & hot board
  const anonStream = await app.inject({ url: "/v1/feed/stream?limit=10" });
  assert.equal(anonStream.statusCode, 200, anonStream.body);
  assert.equal(anonStream.json().personalized, false);
  assert.equal(anonStream.json().items.length, 1);
  assert.equal(anonStream.json().items[0].topCommentsPreview.length, 1);

  const anonExcluded = await app.inject({
    url: `/v1/feed/stream?excludeIds=${postContentId}`,
  });
  assert.equal(anonExcluded.statusCode, 200);
  assert.equal(anonExcluded.json().items.length, 0);

  const authStream = await app.inject({
    url: "/v1/feed/stream?limit=10",
    headers,
  });
  assert.equal(authStream.statusCode, 200);
  assert.equal(authStream.json().personalized, true);
  assert.equal(authStream.json().items.length, 1);

  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/feed/events",
        headers: { ...readBearer },
        payload: {
          events: [{ contentId: postContentId, eventType: "impression" }],
        },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/feed/events",
        headers: { origin },
        payload: {
          events: [{ contentId: postContentId, eventType: "impression" }],
        },
      })
    ).statusCode,
    401,
  );

  const evRes = await app.inject({
    method: "POST",
    url: "/v1/feed/events",
    headers,
    payload: {
      events: [
        { contentId: postContentId, eventType: "impression" },
        { contentId: postContentId, eventType: "bookmark" },
      ],
    },
  });
  assert.equal(evRes.statusCode, 200, evRes.body);

  const duplicateSignals = () => app.inject({
    method: "POST",
    url: "/v1/feed/events",
    headers,
    payload: {
      events: [
        { contentId: postContentId, eventType: "bookmark" },
        { contentId: postContentId, eventType: "useful" },
        { contentId: postContentId, eventType: "useful" },
      ],
    },
  });
  const concurrent = await Promise.all([duplicateSignals(), duplicateSignals()]);
  for (const response of concurrent) assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(concurrent.map((response) => response.json().accepted).sort(), [0, 1]);
  assert.deepEqual((await db.pool.query(
    "SELECT positive_count, exposure_count FROM feed_user_affinity WHERE dim_type='platform' AND dim_key='reddit'",
  )).rows[0], { positive_count: 2, exposure_count: 1 });

  // Seen post never repeats in swipe stream
  const afterSwipe = await app.inject({
    url: "/v1/feed/stream?limit=10",
    headers,
  });
  assert.equal(afterSwipe.json().items.length, 0);

  const prefGet = await app.inject({ url: "/v1/feed/preferences", headers });
  assert.equal(prefGet.statusCode, 200);
  const prefPatch = await app.inject({
    method: "PATCH",
    url: "/v1/feed/preferences",
    headers,
    payload: { exploreRatio: 0.35, followedTopics: ["dev-infra"] },
  });
  assert.equal(prefPatch.statusCode, 200, prefPatch.body);
  assert.equal(prefPatch.json().exploreRatio, 0.35);

  const hotBoard = await app.inject({
    url: "/v1/feed/hot?window=24h&limit=10",
    headers,
  });
  assert.equal(hotBoard.statusCode, 200, hotBoard.body);
  assert.equal(hotBoard.json().items.length, 1);
  assert.equal(hotBoard.json().items[0].card.viewerState.bookmarked, true);
  assert.deepEqual(hotBoard.json().items[0].sparkline, [
    Number((Math.log1p(180) + 1.6 * Math.log1p(45)).toFixed(4)),
    Number((Math.log1p(420) + 1.6 * Math.log1p(110)).toFixed(4)),
  ]);
  assert.equal(hotBoard.json().items[0].corroborationCount, 1);

  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/feed/preferences/reset",
        headers,
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await app.inject({ url: "/v1/feed/stream?limit=10", headers })).json()
      .items.length,
    1,
  );

  const secondSource = await app.inject({
    method: "POST",
    url: "/v1/sources",
    headers,
    payload: {
      label: "Corroborating discussion",
      platform: "reddit",
      primaryProvider: "kaix",
      deliveryMode: "pull",
      contentKind: "post",
      feedLane: "discussion",
      target: { type: "community", community: "othersub" },
    },
  });
  assert.equal(secondSource.statusCode, 200, secondSource.body);
  const secondSourceId = secondSource.json().source.id as string;
  await transaction(db.pool, (client) => commitContentBatch(
    client,
    { id: secondSourceId, platformId: redditPlat, platform: "reddit", provider: "kaix", contentKinds: ["post"] },
    prepareContentBatch([makeRedditBatchItem(secondSourceId, t2, pubIso, {
      url: "https://www.reddit.com/r/othersub/comments/xyz123/",
    })]),
    t2,
  ));
  const corroborated = await app.inject({ url: "/v1/feed/hot?window=24h&limit=10", headers });
  assert.equal(corroborated.statusCode, 200, corroborated.body);
  assert.deepEqual(corroborated.json().items.map((item: { corroborationCount: number }) => item.corroborationCount), [2, 2]);
  assert.deepEqual(corroborated.json().items.map((item: { sparkline: number[] }) => item.sparkline.length).sort(), [1, 2]);

  // 4. Archiving used source + seamless reactivation on re-POST
  const archRes = await app.inject({
    method: "DELETE",
    url: `/v1/sources/${discSrcId}`,
    headers,
  });
  assert.equal(archRes.statusCode, 200);
  assert.equal(archRes.json().mode, "archived");
  const reactivated = await app.inject({
    method: "POST",
    url: "/v1/sources",
    headers,
    payload: {
      label: "LocalLLaMA Restored",
      platform: "reddit",
      primaryProvider: "kaix",
      deliveryMode: "pull",
      contentKind: "post",
      feedLane: "discussion",
      target: { type: "community", community: "localllama" },
    },
  });
  assert.equal(reactivated.statusCode, 200, reactivated.body);
  assert.equal(reactivated.json().source.id, discSrcId);
  assert.equal(reactivated.json().source.state, "active");

  // 5. /v1/intelligence/* monitors (keyword, author_list 16-KOL batch, community_bundle), estimate, overview, posts, authors, communities
  const kwMon = await app.inject({
    method: "POST",
    url: "/v1/intelligence/monitors",
    headers,
    payload: {
      kind: "keyword",
      name: "IDE Comparison GEO",
      config: {
        platforms: ["reddit", "x"],
        keywords: ["cursor"],
        competitorKeywords: ["windsurf"],
        sort: "top",
        minLikes: 20,
      },
      dailyItemBudget: 2000,
    },
  });
  assert.equal(kwMon.statusCode, 200, kwMon.body);
  const kwMonId = kwMon.json().monitor.id as string;
  assert.equal(kwMon.json().monitor.sourceCount, 4);

  const est = await app.inject({
    method: "POST",
    url: `/v1/intelligence/monitors/${kwMonId}/estimate`,
    headers,
    payload: { limitPerSource: 50 },
  });
  assert.equal(est.statusCode, 200, est.body);
  assert.equal(est.json().systemDailyCeiling, 20000);
  assert.equal(est.json().estimatedRequests, 4);

  const monSources = (
    await db.pool.query<{ collection_source_id: string }>(
      "SELECT collection_source_id FROM intel_monitor_source WHERE monitor_id=$1 ORDER BY collection_source_id",
      [kwMonId],
    )
  ).rows.map((r) => r.collection_source_id);
  const srcsMeta = (
    await db.pool.query<{ id: string; code: string }>(
      "SELECT cs.id, s.code FROM collection_source cs JOIN source s ON s.id=cs.platform_id WHERE cs.id=ANY($1::uuid[])",
      [monSources],
    )
  ).rows;
  const redditMonSrc = srcsMeta.find((s) => s.code === "reddit")!.id;
  const xMonSrc = srcsMeta.find((s) => s.code === "x")!.id;

  const kwRedItem = makeRedditBatchItem(redditMonSrc, t2, pubIso, {
    title: "Cursor AI coding workflow benchmarks",
    text: "Great productivity vs windsurf; read https://cursor.com/docs",
    platformDetails: {
      platform: "reddit",
      community: "vibecoding",
      flair: "Review",
      nsfw: false,
      domain: "cursor.com",
      subredditSubscribers: 90000,
    },
  });
  const kwXItem: CollectedContent = {
    id: randomUUID(),
    platform: "x",
    kind: "post",
    externalId: "1899999999999",
    title: null,
    text: "Migrated from windsurf to #cursor today — speed is wild https://cursor.com/blog",
    url: "https://x.com/i/status/1899999999999",
    language: "en",
    publishedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    fetchedAt: t2,
    availability: "available",
    author: {
      externalId: "x_42",
      handle: "topdev_kol",
      displayName: "Top Dev",
      url: "https://x.com/topdev_kol",
      avatarUrl: "https://pbs.twimg.com/avatar.jpg",
      verified: true,
      followersCount: 150000,
      bio: "AI tooling",
    },
    references: [],
    media: [
      {
        type: "link",
        url: "https://cursor.com/blog",
        previewUrl: null,
        altText: null,
        durationSeconds: null,
      },
    ],
    platformDetails: {
      platform: "x",
      conversationId: "1899999999999",
      isReply: false,
      isRepost: false,
      isQuote: false,
      sensitive: false,
      hashtags: ["cursor"],
      externalDomain: "cursor.com",
    },
    observation: {
      sourceId: xMonSrc,
      provider: "twitterapis",
      sourceObservedAt: null,
      fetchedAt: t2,
      timeBasis: "provider_snapshot",
      maturity: "unknown",
      metrics: {
        "x.likes": 310,
        "x.replies": 28,
        "x.reposts": 44,
        "x.views": 24000,
        "x.bookmarks": 65,
      },
      evidenceKey: "ev-x-1",
    },
  };

  const citedComment = makeRedditBatchItem(redditMonSrc, t2, pubIso, {
    externalId: "t1_cite001",
    kind: "comment",
    title: null,
    text: "See [the study](https://www.study.example/report), https://study.example/appendix and https://reddit.com/r/foo",
    media: [],
    references: [{ kind: "post", externalId: kwRedItem.externalId, relation: "thread_root" }],
    observation: { ...kwRedItem.observation, metrics: { "reddit.score": 42 }, evidenceKey: "ev-citation" },
  });
  await transaction(db.pool, async (client) => {
    await commitContentBatch(
      client,
      {
        id: redditMonSrc,
        platformId: redditPlat,
        platform: "reddit",
        provider: "kaix",
        contentKinds: ["post", "comment"],
      },
      prepareContentBatch([kwRedItem, citedComment]),
      t2,
    );
    await commitContentBatch(
      client,
      {
        id: xMonSrc,
        platformId: xPlat,
        platform: "x",
        provider: "twitterapis",
        contentKinds: ["post"],
      },
      prepareContentBatch([kwXItem]),
      t2,
    );
  });

  const overview = await app.inject({
    url: `/v1/intelligence/monitors/${kwMonId}/overview?days=14`,
    headers,
  });
  assert.equal(overview.statusCode, 200, overview.body);
  const ov = overview.json();
  assert.equal(ov.kpis.posts.current, 2);
  assert.equal(ov.shareOfVoice.length, 2);
  assert.ok(
    ov.geoCitedDomains.some(
      (d: { domain: string }) => d.domain === "cursor.com",
    ),
  );
  assert.deepEqual(ov.geoCitedDomains.find((d: { domain: string }) => d.domain === "study.example"), {
    domain: "study.example", count: 1, totalEngagement: Number(Math.log1p(42).toFixed(2)),
  });
  assert.ok(!ov.geoCitedDomains.some((d: { domain: string }) => d.domain === "reddit.com"));
  const rollupCount = (
    await db.pool.query<{ cnt: number }>(
      "SELECT COUNT(*)::int AS cnt FROM intel_rollup_bucket WHERE scope_id=$1",
      [kwMonId],
    )
  ).rows[0].cnt;
  assert.ok(rollupCount > 0);

  const postsList = await app.inject({
    url: `/v1/intelligence/monitors/${kwMonId}/posts?sort=score`,
    headers,
  });
  assert.equal(postsList.statusCode, 200, postsList.body);
  assert.equal(postsList.json().totalCount, 2);

  // Author directory & KOL profile
  const authDir = await app.inject({
    url: "/v1/intelligence/authors?platform=x",
    headers,
  });
  assert.equal(authDir.statusCode, 200, authDir.body);
  assert.equal(authDir.json().items[0].handle, "topdev_kol");
  assert.equal(authDir.json().items[0].followersCount, 150000);

  const kolProfile = await app.inject({
    url: "/v1/intelligence/authors/x/topdev_kol",
    headers,
  });
  assert.equal(kolProfile.statusCode, 200, kolProfile.body);
  assert.deepEqual(kolProfile.json().er, { basis: "by_views", rate: 0.027 });

  // Author list batching: 16 X handles -> 2 batched X sources + 1 Reddit
  const kolMon = await app.inject({
    method: "POST",
    url: "/v1/intelligence/monitors",
    headers,
    payload: {
      kind: "author_list",
      name: "AI Founders Batch",
      config: {
        platforms: ["x", "reddit"],
        handles: [
          ...Array.from({ length: 16 }, (_, i) => ({
            platform: "x" as const,
            handle: `founder_${i}`,
          })),
          { platform: "reddit" as const, handle: "builder_one" },
        ],
      },
    },
  });
  assert.equal(kolMon.statusCode, 200, kolMon.body);
  assert.equal(kolMon.json().monitor.sourceCount, 3);

  // Community bundle monitor create + patch + delete CRUD
  const bundleMon = await app.inject({
    method: "POST",
    url: "/v1/intelligence/monitors",
    headers,
    payload: {
      kind: "community_bundle",
      name: "Core AI Communities",
      config: {
        platforms: ["reddit"],
        subreddits: ["localllama", "vibecoding"],
        sort: "hot",
      },
    },
  });
  assert.equal(bundleMon.statusCode, 200, bundleMon.body);
  const bundleMonId = bundleMon.json().monitor.id as string;
  assert.equal(bundleMon.json().monitor.sourceCount, 2);

  const { rows: [communitySource] } = await db.pool.query<{ id: string }>(
    `SELECT cs.id FROM intel_monitor_source ms JOIN collection_source cs ON cs.id=ms.collection_source_id
     WHERE ms.monitor_id=$1 AND cs.target->>'community'='vibecoding'`,
    [bundleMonId],
  );
  await transaction(db.pool, (client) => commitContentBatch(
    client,
    { id: communitySource.id, platformId: redditPlat, platform: "reddit", provider: "kaix", contentKinds: ["post"] },
    prepareContentBatch([2, 4, 6, 8, 10, 30, 90].map((count, index) => {
      const post = makeRedditBatchItem(communitySource.id, t2, pubIso, { externalId: `t3_vibe${index}` });
      if (post.platformDetails.platform === "reddit") post.platformDetails.community = "vibecoding";
      post.observation.metrics["reddit.num_comments"] = count;
      return post;
    })),
    t2,
  ));
  await db.pool.query(
    "UPDATE source_provider_budget SET enabled=true,daily_requests=100,monthly_requests=100,daily_resources=1000,monthly_resources=1000,minimum_interval_ms=0 WHERE provider='kaix'",
  );
  const queuedHydrations = () => db.pool.query(
    `SELECT status, provider, request_json FROM source_collection_job
     WHERE operation='hydrate' AND collection_source_id=$1 ORDER BY created_at,id`,
    [communitySource.id],
  );
  await db.pool.query(
    `INSERT INTO source_provider_usage(provider,day,requests,resources_reserved)
     VALUES('twitterapis',(now() AT TIME ZONE 'UTC')::date,1,19999)`,
  );
  await hydrateHotCommunityPost(db.pool, providers, communitySource.id);
  assert.equal((await queuedHydrations()).rowCount, 0, "System reservations leave insufficient headroom");
  await db.pool.query("DELETE FROM source_provider_usage WHERE provider='twitterapis'");

  await Promise.all([
    hydrateHotCommunityPost(db.pool, providers, communitySource.id),
    hydrateHotCommunityPost(db.pool, providers, communitySource.id),
  ]);
  assert.deepEqual((await queuedHydrations()).rows, [{
    status: "queued", provider: "kaix",
    request_json: { autoMonitorId: bundleMonId, postId: "t3_vibe6", includeComments: true, maxCommentsPerPost: 15 },
  }]);
  const fakeKaix: ContentProvider = {
    capability: providers[0].capability,
    normalizeTarget: providers[0].normalizeTarget.bind(providers[0]),
    async collectPage(request) {
      assert.deepEqual(request.source.target, { type: "post", postId: "t3_vibe6" });
      assert.equal(request.commentSort, "top");
      assert.equal(request.limit, 15);
      return { items: [], exhausted: true, nextCheckpoint: null, coverage: "partial", warning: null };
    },
  };
  assert.equal(await workOnce(db.pool, [fakeKaix]), true);
  assert.equal((await queuedHydrations()).rows[0].status, "succeeded");
  assert.equal((await db.pool.query("SELECT resources_reserved FROM source_provider_usage WHERE provider='kaix'")).rows[0].resources_reserved, 16);

  await hydrateHotCommunityPost(db.pool, providers, communitySource.id);
  assert.equal((await queuedHydrations()).rows[1].request_json.postId, "t3_vibe5");

  const patchedBundle = await app.inject({
    method: "PATCH",
    url: `/v1/intelligence/monitors/${bundleMonId}`,
    headers,
    payload: { revision: 1, name: "Core AI Communities v2" },
  });
  assert.equal(patchedBundle.statusCode, 200, patchedBundle.body);
  assert.equal(patchedBundle.json().monitor.revision, 2);

  const deletedBundle = await app.inject({
    method: "DELETE",
    url: `/v1/intelligence/monitors/${bundleMonId}`,
    headers,
    payload: { revision: 2 },
  });
  assert.equal(deletedBundle.statusCode, 200, deletedBundle.body);
  assert.equal(deletedBundle.json().deleted, true);
  assert.equal((await queuedHydrations()).rows[1].status, "cancelled");
  await hydrateHotCommunityPost(db.pool, providers, communitySource.id);
  assert.equal((await queuedHydrations()).rowCount, 2);

  // Subreddit communities matrix & deep-dive
  const commMatrix = await app.inject({
    url: "/v1/intelligence/communities?days=14",
    headers,
  });
  assert.equal(commMatrix.statusCode, 200, commMatrix.body);
  assert.ok(
    commMatrix.json().items.some(
      (c: { subreddit: string }) => c.subreddit === "vibecoding",
    ),
  );

  const commDeep = await app.inject({
    url: "/v1/intelligence/communities/vibecoding?days=14",
    headers,
  });
  assert.equal(commDeep.statusCode, 200, commDeep.body);
  assert.ok(
    commDeep.json().flairs.some((f: { flair: string }) => f.flair === "Review"),
  );
  assert.ok(commDeep.json().postingHeatmap.length >= 1);

  // Auth isolation: unauthenticated denied on /v1/intelligence/*
  assert.equal(
    (await app.inject({ url: "/v1/intelligence/monitors" })).statusCode,
    401,
  );
});
