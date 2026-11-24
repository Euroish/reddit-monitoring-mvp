import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { buildApp } from "../../apps/api/src/app";
import { KaixContentConnector } from "../../src/connectors/reddit/kaix-content.connector";
import type { CollectedContent } from "../../src/connectors/shared/content-provider.interface";
import { bootstrapOwner } from "../../src/modules/access/index";
import { createSession } from "../../src/modules/access/sql";
import { recordCommittedBatch } from "../../src/modules/collection/batches";
import { commitContentBatch, prepareContentBatch } from "../../src/modules/content/index";
import { refreshRollupsForSource } from "../../src/modules/intelligence/index";
import { transaction } from "../../src/storage/db";
import { testDatabase } from "../helpers/database";

async function loginAs(
  app: Awaited<ReturnType<typeof buildApp>>,
  origin: string,
  email: string,
  password: string,
) {
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    headers: { origin },
    payload: { email, password },
  });
  assert.equal(res.statusCode, 200, res.body);
  return { origin, cookie: res.headers["set-cookie"]!.toString().split(";")[0] };
}

function makePost(
  sourceId: string,
  nowIso: string,
  publishedIso: string,
  opts: {
    externalId: string;
    title: string;
    text: string;
    author: string;
    community: string;
    domain: string;
    score?: number;
    comments?: number;
    flair?: string;
  },
): CollectedContent {
  return {
    id: randomUUID(),
    platform: "reddit",
    kind: "post",
    externalId: opts.externalId,
    title: opts.title,
    text: opts.text,
    url: `https://www.reddit.com/r/${opts.community}/comments/${opts.externalId}/`,
    language: "en",
    publishedAt: publishedIso,
    fetchedAt: nowIso,
    availability: "available",
    author: {
      externalId: `t2_${opts.author}`,
      handle: opts.author,
      displayName: opts.author,
      url: `https://www.reddit.com/u/${opts.author}`,
    },
    references: [],
    media: [],
    platformDetails: {
      platform: "reddit",
      community: opts.community,
      flair: opts.flair ?? "Discussion",
      nsfw: false,
      domain: opts.domain,
      subredditSubscribers: 12000,
    },
    observation: {
      sourceId,
      provider: "kaix",
      sourceObservedAt: nowIso,
      fetchedAt: nowIso,
      timeBasis: "provider_snapshot",
      maturity: "initial",
      metrics: {
        "reddit.score": opts.score ?? 50,
        "reddit.num_comments": opts.comments ?? 5,
        "reddit.upvote_ratio": 0.9,
      },
      evidenceKey: `ev-${opts.externalId}-${randomUUID().slice(0, 8)}`,
    },
  };
}

test("PG16 X01 content/feed/intelligence isolation across private batches and A08 disabled monitor collect guard", async (t) => {
  const db = await testDatabase();
  t.after(db.close);
  await bootstrapOwner(db.pool, "fixture-password-123", "owner@example.test");

  const origin = "http://visibility.test";
  const providers = [new KaixContentConnector({ networkEnabled: true, apiToken: "tok" })];
  const app = await buildApp({
    pool: db.pool,
    origin,
    secureCookies: false,
    sessionSecret: "visibility-secret".repeat(4),
    providers,
    publicRead: true,
    publicRegistration: true,
  });
  t.after(() => app.close());

  const ownerHeaders = await loginAs(app, origin, "owner@example.test", "fixture-password-123");
  for (const email of ["viewer-a@example.test", "viewer-b@example.test"]) {
    const reg = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      headers: { origin },
      payload: { email, password: "viewer-password-123" },
    });
    assert.equal(reg.statusCode, 200, reg.body);
  }
  const viewerAHeaders = await loginAs(app, origin, "viewer-a@example.test", "viewer-password-123");
  const viewerBHeaders = await loginAs(app, origin, "viewer-b@example.test", "viewer-password-123");

  const users = (
    await db.pool.query<{ id: string; email: string }>(
      "SELECT id, email FROM app_user WHERE email = ANY($1::text[])",
      [["owner@example.test", "viewer-a@example.test", "viewer-b@example.test"]],
    )
  ).rows;
  const userIdByEmail = new Map(users.map((u) => [u.email, u.id]));
  const ownerId = userIdByEmail.get("owner@example.test")!;
  const viewerAId = userIdByEmail.get("viewer-a@example.test")!;
  const viewerBId = userIdByEmail.get("viewer-b@example.test")!;

  await db.pool.query(
    `UPDATE plan_collection_policy
     SET export_enabled = true,
         manual_collect_enabled = true,
         allowed_providers = '{kaix}',
         max_lookback_days = 7,
         max_batch_limit = 50,
         max_comments_per_post = 5,
         daily_requests = 50,
         daily_resources = 5000
     WHERE plan_tier = 'free'`,
  );

  const createSource = async (body: Record<string, unknown>) => {
    const res = await app.inject({ method: "POST", url: "/v1/sources", headers: ownerHeaders, payload: body });
    assert.equal(res.statusCode, 200, res.body);
    return res.json().source.id as string;
  };
  const sharedSourceId = await createSource({
    label: "Shared Research Discussion",
    platform: "reddit",
    primaryProvider: "kaix",
    deliveryMode: "pull",
    contentKind: "post",
    feedLane: "discussion",
    target: { type: "community", community: "sharedsub" },
  });
  const otherSourceId = await createSource({
    label: "Other Shared Discussion",
    platform: "reddit",
    primaryProvider: "kaix",
    deliveryMode: "pull",
    contentKind: "post",
    feedLane: "discussion",
    target: { type: "community", community: "othersub" },
  });
  const monOnlySourceId = await createSource({
    label: "Monitor Only Source",
    platform: "reddit",
    primaryProvider: "kaix",
    deliveryMode: "pull",
    contentKind: "post",
    feedLane: "monitor_only",
    target: { type: "community", community: "mononlysub" },
  });

  const redditPlat = (await db.pool.query<{ id: string }>("SELECT id FROM source WHERE code='reddit'")).rows[0].id;
  const pubIso = new Date(Date.now() - 4 * 3_600_000).toISOString();
  const nowIso = new Date().toISOString();

  const pPrivA = makePost(sharedSourceId, nowIso, pubIso, {
    externalId: "t3_priva",
    title: "alphasecret private analysis xyzzsecret",
    text: "alphasecret confidential notes https://secret-a.example/report",
    author: "author_priv_a",
    community: "privsub_a",
    domain: "secret-a.example",
    score: 900,
    comments: 80,
    flair: "PrivAFlair",
  });
  const pPrivB = makePost(sharedSourceId, nowIso, pubIso, {
    externalId: "t3_privb",
    title: "sharedtopic viewer B private note",
    text: "viewer B private analysis https://secret-b.example/doc",
    author: "author_priv_b",
    community: "privsub_b",
    domain: "secret-b.example",
    score: 120,
    comments: 10,
  });
  const pPrivAdmin = makePost(sharedSourceId, nowIso, pubIso, {
    externalId: "t3_privadm",
    title: "Admin internal brief",
    text: "Admin private notes https://secret-admin.example/internal",
    author: "author_priv_admin",
    community: "privsub_admin",
    domain: "secret-admin.example",
    score: 800,
    comments: 40,
  });
  const pShared = makePost(sharedSourceId, nowIso, pubIso, {
    externalId: "t3_shared",
    title: "sharedtopic public benchmark discussion",
    text: "Public findings https://shared.example/bench",
    author: "author_shared",
    community: "sharedsub",
    domain: "shared.example",
    score: 400,
    comments: 30,
    flair: "SharedFlair",
  });
  const pCrossSame = makePost(sharedSourceId, nowIso, pubIso, {
    externalId: "t3_crosssame",
    title: "sharedtopic cross discovery on same source",
    text: "Cross discovered post https://cross.example/same",
    author: "author_cross",
    community: "sharedsub",
    domain: "cross.example",
    score: 300,
    comments: 20,
  });
  const pCrossDiffOnShared = makePost(sharedSourceId, nowIso, pubIso, {
    externalId: "t3_crossdiff",
    title: "sharedtopic cross discovery across sources",
    text: "Cross source post https://cross-diff.example/post",
    author: "author_cross_diff",
    community: "sharedsub",
    domain: "cross-diff.example",
    score: 250,
    comments: 12,
  });
  const pCrossDiffOnOther = makePost(otherSourceId, nowIso, pubIso, {
    externalId: "t3_crossdiff",
    title: "sharedtopic cross discovery across sources",
    text: "Cross source post https://cross-diff.example/post",
    author: "author_cross_diff",
    community: "sharedsub",
    domain: "cross-diff.example",
    score: 250,
    comments: 12,
  });
  const cPrivA: CollectedContent = {
    id: randomUUID(),
    platform: "reddit",
    kind: "comment",
    externalId: "t1_privacmt",
    title: null,
    text: "Private comment on shared post https://comment-secret-a.example/ref",
    url: "https://www.reddit.com/r/sharedsub/comments/t3_shared/comment/t1_privacmt/",
    language: "en",
    publishedAt: pubIso,
    fetchedAt: nowIso,
    availability: "available",
    author: {
      externalId: "t2_author_priv_a",
      handle: "author_priv_a",
      displayName: "author_priv_a",
      url: "https://www.reddit.com/u/author_priv_a",
    },
    references: [
      { kind: "post", externalId: "t3_shared", relation: "thread_root" },
      { kind: "post", externalId: "t3_shared", relation: "reply_to" },
    ],
    media: [],
    platformDetails: { platform: "reddit", community: "sharedsub", flair: null, nsfw: false },
    observation: {
      sourceId: sharedSourceId,
      provider: "kaix",
      sourceObservedAt: nowIso,
      fetchedAt: nowIso,
      timeBasis: "provider_snapshot",
      maturity: "initial",
      metrics: { "reddit.score": 999 },
      evidenceKey: "ev-c-priv-a",
    },
  };
  const pMonOnly = makePost(monOnlySourceId, nowIso, pubIso, {
    externalId: "t3_mononly",
    title: "Monitor only shared item",
    text: "Should stay out of feed https://mon-only.example/post",
    author: "author_mon_only",
    community: "mononlysub",
    domain: "mon-only.example",
    score: 700,
    comments: 25,
  });

  const commitBatch = async (
    sourceId: string,
    sourceLabel: string,
    userId: string,
    visibility: "private" | "shared",
    items: CollectedContent[],
  ) => {
    const jobId = randomUUID();
    await transaction(db.pool, async (client) => {
      await client.query(
        `INSERT INTO source_collection_job(
           id, collection_source_id, status, purpose, operation, provider, from_at, to_at, page_size, max_pages, next_run_at, created_at, requested_by_user_id
         ) VALUES($1,$2,'succeeded','collect','radar','kaix',NOW()-interval '1 hour',NOW(),50,1,NOW(),NOW(),$3)`,
        [jobId, sourceId, userId],
      );
      const res = await commitContentBatch(
        client,
        { id: sourceId, platformId: redditPlat, platform: "reddit", provider: "kaix", contentKinds: ["post", "comment"] },
        prepareContentBatch(items),
        nowIso,
      );
      await recordCommittedBatch(client, {
        jobId,
        sourceId,
        sourceLabel,
        userId,
        contentIds: res.contentIds,
        visibility,
      });
    });
  };

  await commitBatch(sharedSourceId, "Shared Research Discussion", viewerAId, "private", [
    pPrivA,
    cPrivA,
    pCrossSame,
    pCrossDiffOnShared,
  ]);
  await commitBatch(sharedSourceId, "Shared Research Discussion", viewerBId, "private", [pPrivB]);
  await commitBatch(sharedSourceId, "Shared Research Discussion", ownerId, "private", [pPrivAdmin]);
  await commitBatch(sharedSourceId, "Shared Research Discussion", ownerId, "shared", [pShared, pCrossSame]);
  await commitBatch(otherSourceId, "Other Shared Discussion", ownerId, "shared", [pCrossDiffOnOther]);
  await commitBatch(monOnlySourceId, "Monitor Only Source", ownerId, "shared", [pMonOnly]);

  const contentRows = (
    await db.pool.query<{ id: string; external_id: string }>(
      "SELECT id, external_id FROM content WHERE external_id = ANY($1::text[])",
      [["t3_priva", "t3_privb", "t3_privadm", "t3_shared", "t3_crosssame", "t3_crossdiff", "t1_privacmt", "t3_mononly"]],
    )
  ).rows;
  const contentIdOf = (extId: string) => contentRows.find((r) => r.external_id === extId)!.id;

  const mkEmpty = await app.inject({
    method: "POST",
    url: "/v1/access/keys",
    headers: ownerHeaders,
    payload: { label: "empty-scope", scopes: ["read"], allowedSourceIds: [], expiresInDays: 7 },
  });
  assert.equal(mkEmpty.statusCode, 200, mkEmpty.body);
  const emptyKeyHeaders = { authorization: `Bearer ${mkEmpty.json().token}` };

  const mkShared = await createSession(
    db.pool,
    viewerBId,
    "machine",
    ["read", "export"],
    [sharedSourceId],
    7,
    "viewer-b-shared-only",
  );
  const sharedKeyHeaders = { authorization: `Bearer ${mkShared.token}` };

  // 1. Content listing, detail, thread, facets, export, stories, source_filter project, and cursor scope
  const extIdsOf = (items: Array<{ externalId: string }>) => items.map((i) => i.externalId).sort();
  const listAsA = await app.inject({ url: "/v1/content?limit=50", headers: viewerAHeaders });
  assert.equal(listAsA.statusCode, 200, listAsA.body);
  const aExts = extIdsOf(listAsA.json().items);
  assert.ok(aExts.includes("t3_priva"));
  assert.ok(aExts.includes("t1_privacmt"));
  assert.ok(aExts.includes("t3_shared"));
  assert.ok(!aExts.includes("t3_privb"));
  assert.ok(!aExts.includes("t3_privadm"));

  const listAsB = await app.inject({ url: "/v1/content?limit=50", headers: viewerBHeaders });
  assert.equal(listAsB.statusCode, 200, listAsB.body);
  const bExts = extIdsOf(listAsB.json().items);
  assert.ok(bExts.includes("t3_privb"));
  assert.ok(bExts.includes("t3_shared"));
  assert.ok(bExts.includes("t3_crosssame"));
  assert.ok(bExts.includes("t3_crossdiff"));
  assert.ok(!bExts.includes("t3_priva"));
  assert.ok(!bExts.includes("t1_privacmt"));
  assert.ok(!bExts.includes("t3_privadm"));

  const listAsBFilteredToShared = await app.inject({
    url: `/v1/content?sourceId=${sharedSourceId}&limit=50`,
    headers: viewerBHeaders,
  });
  assert.equal(listAsBFilteredToShared.statusCode, 200, listAsBFilteredToShared.body);
  assert.ok(!extIdsOf(listAsBFilteredToShared.json().items).includes("t3_crossdiff"));

  const listAsGuest = await app.inject({ url: "/v1/content?limit=50" });
  assert.equal(listAsGuest.statusCode, 200, listAsGuest.body);
  assert.deepEqual(extIdsOf(listAsGuest.json().items), ["t3_crossdiff", "t3_crosssame", "t3_mononly", "t3_shared"]);

  const listAsSharedKey = await app.inject({ url: "/v1/content?limit=50", headers: sharedKeyHeaders });
  assert.equal(listAsSharedKey.statusCode, 200, listAsSharedKey.body);
  assert.deepEqual(extIdsOf(listAsSharedKey.json().items), ["t3_crosssame", "t3_privb", "t3_shared"]);

  const listAsEmptyKey = await app.inject({ url: "/v1/content?limit=50", headers: emptyKeyHeaders });
  assert.equal(listAsEmptyKey.statusCode, 200, listAsEmptyKey.body);
  assert.deepEqual(listAsEmptyKey.json().items, []);

  // Cursor isolation across viewers
  const pageA = await app.inject({ url: "/v1/content?limit=1", headers: viewerAHeaders });
  assert.ok(pageA.json().nextCursor);
  const crossCursor = await app.inject({
    url: `/v1/content?limit=1&cursor=${encodeURIComponent(pageA.json().nextCursor)}`,
    headers: viewerBHeaders,
  });
  assert.equal(crossCursor.statusCode, 409, crossCursor.body);

  // Direct ID, thread, facets, export, workspace annotation
  assert.equal((await app.inject({ url: `/v1/content/${contentIdOf("t3_priva")}`, headers: viewerBHeaders })).statusCode, 404);
  assert.equal((await app.inject({ url: `/v1/content/${contentIdOf("t3_privadm")}`, headers: viewerBHeaders })).statusCode, 404);
  assert.equal((await app.inject({ url: `/v1/content/${contentIdOf("t3_priva")}` })).statusCode, 404);
  assert.equal((await app.inject({ url: `/v1/content/${contentIdOf("t3_priva")}`, headers: viewerAHeaders })).statusCode, 200);

  const threadAsB = await app.inject({ url: `/v1/content/${contentIdOf("t3_shared")}/thread`, headers: viewerBHeaders });
  assert.equal(threadAsB.statusCode, 200, threadAsB.body);
  assert.equal(threadAsB.json().nodes.length, 0);
  const threadAsA = await app.inject({ url: `/v1/content/${contentIdOf("t3_shared")}/thread`, headers: viewerAHeaders });
  assert.equal(threadAsA.statusCode, 200, threadAsA.body);
  assert.equal(threadAsA.json().nodes.length, 1);

  const fromIso = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const toIso = new Date(Date.now() + 3_600_000).toISOString();
  const facetsB = await app.inject({
    url: `/v1/content/facets?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`,
    headers: viewerBHeaders,
  });
  assert.equal(facetsB.statusCode, 200, facetsB.body);
  assert.equal(facetsB.json().matchedContentCount, 5);

  const exportB = await app.inject({ url: "/v1/content/export?format=json", headers: viewerBHeaders });
  assert.equal(exportB.statusCode, 200, exportB.body);
  const exportBExts = extIdsOf(exportB.json().items);
  assert.ok(!exportBExts.includes("t3_priva"));
  assert.ok(!exportBExts.includes("t3_privadm"));
  assert.ok(!exportBExts.includes("t1_privacmt"));

  const exportSharedKey = await app.inject({ url: "/v1/content/export?format=json", headers: sharedKeyHeaders });
  assert.equal(exportSharedKey.statusCode, 200, exportSharedKey.body);
  assert.deepEqual(extIdsOf(exportSharedKey.json().items), ["t3_crosssame", "t3_privb", "t3_shared"]);

  // Stories cache populated by Viewer A must not leak private batches to Viewer B or Guest
  const storiesA = await app.inject({ url: "/v1/content/stories?view=latest", headers: viewerAHeaders });
  assert.equal(storiesA.statusCode, 200, storiesA.body);
  const storiesGuest = await app.inject({ url: "/v1/content/stories?view=latest" });
  assert.equal(storiesGuest.statusCode, 200, storiesGuest.body);
  for (const res of [storiesA, storiesGuest]) {
    const titles = res.json().items.map((item: { representative: { title: string } }) => item.representative.title);
    assert.ok(!titles.some((title: string) => title.includes("alphasecret") || title.includes("Admin internal")));
    assert.ok(titles.some((title: string) => title.includes("sharedtopic public benchmark")));
  }

  // source_filter project owned by Viewer B pointing at sharedSource must not leak Viewer A's private batch
  const sfProj = await app.inject({
    method: "POST",
    url: "/v1/projects",
    headers: viewerBHeaders,
    payload: { name: "Viewer B Source Filter", datasetMode: "source_filter", sourceIds: [sharedSourceId], filter: {} },
  });
  assert.equal(sfProj.statusCode, 200, sfProj.body);
  const sfProjId = sfProj.json().id as string;
  const sfContent = await app.inject({ url: `/v1/projects/${sfProjId}/content?limit=50`, headers: viewerBHeaders });
  assert.equal(sfContent.statusCode, 200, sfContent.body);
  assert.deepEqual(extIdsOf(sfContent.json().items), ["t3_crosssame", "t3_privb", "t3_shared"]);
  const sfOverview = await app.inject({ url: `/v1/projects/${sfProjId}/overview`, headers: viewerBHeaders });
  assert.equal(sfOverview.statusCode, 200, sfOverview.body);
  assert.equal(sfOverview.json().matchedContentCount, 3);

  // Workspace annotation denied on private content
  const annotatePriv = await app.inject({
    method: "PUT",
    url: `/v1/workspace/annotations/${contentIdOf("t3_priva")}`,
    headers: viewerBHeaders,
    payload: { favorite: true, note: "probe", revision: 0 },
  });
  assert.equal(annotatePriv.statusCode, 404, annotatePriv.body);

  // 2. Feed stream, hot board, comment preview, and event feedback isolation
  for (const [label, headers] of [
    ["guest", undefined],
    ["viewerA", viewerAHeaders],
    ["viewerB", viewerBHeaders],
    ["owner", ownerHeaders],
  ] as const) {
    const stream = await app.inject({ url: "/v1/feed/stream?limit=40", headers });
    assert.equal(stream.statusCode, 200, `${label}: ${stream.body}`);
    const streamIds = stream.json().items.map((item: { id: string }) => item.id);
    assert.ok(!streamIds.includes(contentIdOf("t3_priva")), `${label} leaked P_priv_a`);
    assert.ok(!streamIds.includes(contentIdOf("t3_privb")), `${label} leaked P_priv_b`);
    assert.ok(!streamIds.includes(contentIdOf("t3_privadm")), `${label} leaked P_priv_admin`);
    assert.ok(!streamIds.includes(contentIdOf("t3_mononly")), `${label} leaked monitor_only`);
    const sharedCard = stream.json().items.find((item: { id: string }) => item.id === contentIdOf("t3_shared"));
    assert.ok(sharedCard, `${label} missing shared card`);
    assert.equal(sharedCard.topCommentsPreview.length, 0, `${label} leaked private comment preview`);

    const hot = await app.inject({ url: "/v1/feed/hot?window=24h&limit=40", headers });
    assert.equal(hot.statusCode, 200, `${label}: ${hot.body}`);
    const hotIds = hot.json().items.map((entry: { card: { id: string } }) => entry.card.id);
    assert.ok(!hotIds.includes(contentIdOf("t3_priva")));
    assert.ok(!hotIds.includes(contentIdOf("t3_privb")));
    assert.ok(!hotIds.includes(contentIdOf("t3_privadm")));
    assert.ok(!hotIds.includes(contentIdOf("t3_mononly")));
  }

  const feedEmptyKey = await app.inject({ url: "/v1/feed/stream?limit=10", headers: emptyKeyHeaders });
  assert.equal(feedEmptyKey.statusCode, 200, feedEmptyKey.body);
  assert.deepEqual(feedEmptyKey.json().items, []);

  const feedEventProbe = await app.inject({
    method: "POST",
    url: "/v1/feed/events",
    headers: viewerBHeaders,
    payload: { events: [{ contentId: contentIdOf("t3_priva"), eventType: "open" }] },
  });
  assert.equal(feedEventProbe.statusCode, 404, feedEventProbe.body);

  // 3. Intelligence monitors, rollups, SoV, GEO, authors & communities scope isolation
  const monitorAId = randomUUID();
  const monitorBId = randomUUID();
  await transaction(db.pool, async (client) => {
    for (const [monId, ownerUserId, name] of [
      [monitorAId, viewerAId, "Monitor A"],
      [monitorBId, viewerBId, "Monitor B"],
    ] as const) {
      await client.query(
        `INSERT INTO intel_monitor(id, owner_user_id, kind, name, config, schedule_interval_hours, daily_item_budget, enabled)
         VALUES($1,$2,'keyword',$3,$4,6,1000,true)`,
        [monId, ownerUserId, name, { platforms: ["reddit"], keywords: ["alphasecret", "sharedtopic"] }],
      );
      await client.query(
        "INSERT INTO intel_monitor_source(monitor_id, collection_source_id, role, target_label) VALUES($1,$2,'primary','shared')",
        [monId, sharedSourceId],
      );
      await client.query(
        `INSERT INTO intel_monitor_target(id, monitor_id, target_kind, target_value, platform)
         VALUES($1,$2,'keyword','alphasecret','reddit'),
               ($3,$2,'keyword','sharedtopic','reddit')`,
        [randomUUID(), monId, randomUUID()],
      );
    }
  });

  await refreshRollupsForSource(db.pool, sharedSourceId);

  const ovB = await app.inject({ url: `/v1/intelligence/monitors/${monitorBId}/overview?days=14`, headers: viewerBHeaders });
  assert.equal(ovB.statusCode, 200, ovB.body);
  const ovBJson = ovB.json();
  assert.equal(ovBJson.kpis.posts.current, 3);
  const alphaSov = ovBJson.shareOfVoice.find((s: { label: string }) => s.label === "alphasecret");
  assert.equal(alphaSov?.mentions ?? 0, 0);
  const geoDomainsB = ovBJson.geoCitedDomains.map((d: { domain: string }) => d.domain);
  assert.ok(!geoDomainsB.includes("secret-a.example"));
  assert.ok(!geoDomainsB.includes("comment-secret-a.example"));
  assert.ok(!geoDomainsB.includes("secret-admin.example"));
  assert.ok(!ovBJson.cooccurringTerms.some((term: { term: string }) => term.term === "xyzzsecret"));
  assert.ok(!ovBJson.topAuthors.some((a: { handle: string }) => a.handle === "author_priv_a" || a.handle === "author_priv_admin"));

  const postsB = await app.inject({ url: `/v1/intelligence/monitors/${monitorBId}/posts`, headers: viewerBHeaders });
  assert.equal(postsB.statusCode, 200, postsB.body);
  assert.equal(postsB.json().totalCount, 3);
  assert.ok(!postsB.json().items.some((p: { externalId: string }) => p.externalId === "t3_priva" || p.externalId === "t3_privadm"));

  // Authors & communities: global & monitorId-scoped checks
  const authorsB = await app.inject({ url: "/v1/intelligence/authors?search=author_priv_a", headers: viewerBHeaders });
  assert.equal(authorsB.statusCode, 200, authorsB.body);
  assert.equal(authorsB.json().items.length, 0);
  assert.equal((await app.inject({ url: "/v1/intelligence/authors/reddit/author_priv_a", headers: viewerBHeaders })).statusCode, 404);
  assert.equal(
    (await app.inject({ url: `/v1/intelligence/authors/reddit/author_shared?monitorId=${monitorAId}`, headers: viewerBHeaders })).statusCode,
    404,
  );
  const authorScopedB = await app.inject({
    url: `/v1/intelligence/authors/reddit/author_shared?monitorId=${monitorBId}`,
    headers: viewerBHeaders,
  });
  assert.equal(authorScopedB.statusCode, 200, authorScopedB.body);
  assert.equal(authorScopedB.json().topPosts.length, 1);

  const commsB = await app.inject({ url: "/v1/intelligence/communities?days=14", headers: viewerBHeaders });
  assert.equal(commsB.statusCode, 200, commsB.body);
  assert.ok(!commsB.json().items.some((c: { subreddit: string }) => c.subreddit === "privsub_a" || c.subreddit === "privsub_admin"));
  assert.equal((await app.inject({ url: "/v1/intelligence/communities/privsub_a", headers: viewerBHeaders })).statusCode, 404);
  assert.equal(
    (await app.inject({ url: `/v1/intelligence/communities/sharedsub?monitorId=${monitorAId}`, headers: viewerBHeaders })).statusCode,
    404,
  );
  const commScopedB = await app.inject({
    url: `/v1/intelligence/communities/sharedsub?monitorId=${monitorBId}&days=14`,
    headers: viewerBHeaders,
  });
  assert.equal(commScopedB.statusCode, 200, commScopedB.body);
  assert.equal(commScopedB.json().summary.postCount, 2);
  assert.ok(!commScopedB.json().topAuthors.some((a: { handle: string }) => a.handle === "author_priv_a"));

  // Empty machine key must see 0 across all intelligence lists
  for (const url of ["/v1/intelligence/monitors", "/v1/intelligence/authors", "/v1/intelligence/communities"]) {
    const emptyRes = await app.inject({ url, headers: emptyKeyHeaders });
    assert.equal(emptyRes.statusCode, 200, `${url}: ${emptyRes.body}`);
    const list = emptyRes.json().monitors ?? emptyRes.json().items;
    assert.deepEqual(list, []);
  }

  // 4. A08: Disabled monitor rejects new collect atomically while preserving Q-A05 revision check & historical replays
  const collectPayload = { lookbackHours: 24, limitPerSource: 20, includeComments: false };
  const initialCollect = await app.inject({
    method: "POST",
    url: `/v1/intelligence/monitors/${monitorBId}/collect`,
    headers: { ...viewerBHeaders, "idempotency-key": "vis-mon-k1" },
    payload: collectPayload,
  });
  assert.equal(initialCollect.statusCode, 200, initialCollect.body);
  const createdJobIds = initialCollect.json().jobIds as string[];
  assert.equal(createdJobIds.length, 1);

  const disableMon = await app.inject({
    method: "PATCH",
    url: `/v1/intelligence/monitors/${monitorBId}`,
    headers: viewerBHeaders,
    payload: { revision: 1, enabled: false },
  });
  assert.equal(disableMon.statusCode, 200, disableMon.body);

  const jobCountBefore = Number((await db.pool.query("SELECT COUNT(*)::int AS cnt FROM source_collection_job WHERE request_key LIKE $1", ["vis-mon-%"])).rows[0].cnt);
  const newCollectDisabled = await app.inject({
    method: "POST",
    url: `/v1/intelligence/monitors/${monitorBId}/collect`,
    headers: { ...viewerBHeaders, "idempotency-key": "vis-mon-k2" },
    payload: collectPayload,
  });
  assert.equal(newCollectDisabled.statusCode, 409, newCollectDisabled.body);
  assert.match(newCollectDisabled.json().error.message, /disabled/i);

  // Old key from revision 1 still enforces Q-A05 revision mismatch (409) with 0 new jobs
  const replayCrossRev = await app.inject({
    method: "POST",
    url: `/v1/intelligence/monitors/${monitorBId}/collect`,
    headers: { ...viewerBHeaders, "idempotency-key": "vis-mon-k1" },
    payload: collectPayload,
  });
  assert.equal(replayCrossRev.statusCode, 409, replayCrossRev.body);

  // When a monitor is disabled without a revision bump, matching historical replays remain retrievable (200) while new keys fail closed (409)
  await db.pool.query("UPDATE source_collection_job SET status='succeeded', finished_at=NOW() WHERE id=$1", [createdJobIds[0]]);
  await db.pool.query("UPDATE intel_monitor SET enabled=true WHERE id=$1", [monitorBId]);
  const rev2Collect = await app.inject({
    method: "POST",
    url: `/v1/intelligence/monitors/${monitorBId}/collect`,
    headers: { ...viewerBHeaders, "idempotency-key": "vis-mon-k3" },
    payload: collectPayload,
  });
  assert.equal(rev2Collect.statusCode, 200, rev2Collect.body);
  const rev2JobIds = rev2Collect.json().jobIds as string[];
  await db.pool.query("UPDATE intel_monitor SET enabled=false WHERE id=$1", [monitorBId]);

  const newCollectSameRevDisabled = await app.inject({
    method: "POST",
    url: `/v1/intelligence/monitors/${monitorBId}/collect`,
    headers: { ...viewerBHeaders, "idempotency-key": "vis-mon-k4" },
    payload: collectPayload,
  });
  assert.equal(newCollectSameRevDisabled.statusCode, 409, newCollectSameRevDisabled.body);
  assert.match(newCollectSameRevDisabled.json().error.message, /disabled/i);

  const replaySameRevDisabled = await app.inject({
    method: "POST",
    url: `/v1/intelligence/monitors/${monitorBId}/collect`,
    headers: { ...viewerBHeaders, "idempotency-key": "vis-mon-k3" },
    payload: collectPayload,
  });
  assert.equal(replaySameRevDisabled.statusCode, 200, replaySameRevDisabled.body);
  assert.deepEqual(replaySameRevDisabled.json().jobIds, rev2JobIds);

  const jobCountAfter = Number((await db.pool.query("SELECT COUNT(*)::int AS cnt FROM source_collection_job WHERE request_key LIKE $1", ["vis-mon-%"])).rows[0].cnt);
  assert.equal(jobCountAfter, jobCountBefore + 1);
});
