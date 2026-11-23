import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { Actor } from "../../packages/contracts/src/access";
import { batchMembership } from "../../src/modules/collection/index";
import { countSourceSamples } from "../../src/modules/content/index";
import { buildApp } from "../../apps/api/src/app";
import { bootstrapOwner } from "../../src/modules/access/sql";
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

test("empty batch projects, viewer ownership isolation, and batch enable/disable/remove/reuse", async (t) => {
  const db = await testDatabase();
  t.after(db.close);
  await bootstrapOwner(db.pool, "fixture-password-123", "owner@example.test");
  const origin = "http://batches.test";
  const app = await buildApp({
    pool: db.pool,
    origin,
    secureCookies: false,
    sessionSecret: "batches-fixture".repeat(4),
    providers: [],
    publicRead: true,
    publicRegistration: true,
  });
  t.after(() => app.close());

  const ownerHeaders = await loginAs(app, origin, "owner@example.test", "fixture-password-123");

  // Register two viewers
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

  // 1. Owner creates a push source and ingests 2 posts -> automatically creates a collection_batch
  const srcRes = await app.inject({
    method: "POST",
    url: "/v1/sources",
    headers: ownerHeaders,
    payload: {
      label: "R4 Archive Batch Test",
      platform: "reddit",
      deliveryMode: "push",
      primaryProvider: "external_ingest",
      contentKind: "post",
      target: { type: "search", query: "llm" },
      tags: ["reddit-archive-r4"],
    },
  });
  assert.equal(srcRes.statusCode, 200, srcRes.body);
  const sourceId = srcRes.json().source.id as string;

  const nowIso = new Date().toISOString();
  const ingest1 = await app.inject({
    method: "POST",
    url: `/v1/sources/${sourceId}/ingest`,
    headers: { ...ownerHeaders, "idempotency-key": "batch-ingest-1" },
    payload: {
      items: [
        {
          platform: "reddit",
          kind: "post",
          externalId: "t3_batcha1",
          title: "Batch Post One",
          text: "First sample post for batch project testing.",
          url: "https://reddit.com/r/test/comments/batch_a1",
          language: "en",
          author: null,
          publishedAt: nowIso,
          fetchedAt: nowIso,
          availability: "available",
          references: [],
          media: [],
          platformDetails: { platform: "reddit", community: "test", flair: null, nsfw: false },
          observation: {
            provider: "external_ingest",
            sourceId,
            sourceObservedAt: nowIso,
            fetchedAt: nowIso,
            timeBasis: "provider_snapshot",
            maturity: "unknown",
            metrics: { "reddit.score": 42, "reddit.num_comments": 7 },
            evidenceKey: "ev-batch-a1",
          },
        },
        {
          platform: "reddit",
          kind: "post",
          externalId: "t3_batcha2",
          title: "Batch Post Two",
          text: "Second sample post for batch project testing.",
          url: "https://reddit.com/r/test/comments/batch_a2",
          language: "en",
          author: null,
          publishedAt: nowIso,
          fetchedAt: nowIso,
          availability: "available",
          references: [],
          media: [],
          platformDetails: { platform: "reddit", community: "test", flair: null, nsfw: false },
          observation: {
            provider: "external_ingest",
            sourceId,
            sourceObservedAt: nowIso,
            fetchedAt: nowIso,
            timeBasis: "provider_snapshot",
            maturity: "unknown",
            metrics: { "reddit.score": 15, "reddit.num_comments": 2 },
            evidenceKey: "ev-batch-a2",
          },
        },
      ],
    },
  });
  assert.equal(ingest1.statusCode, 201, ingest1.body);
  const batch1Id = ingest1.json().batchId as string;
  assert.ok(batch1Id, "ingest must return created batchId");

  // Second ingest overlapping t3_batch_a1 + adding t3_batch_a3
  const ingest2 = await app.inject({
    method: "POST",
    url: `/v1/sources/${sourceId}/ingest`,
    headers: { ...ownerHeaders, "idempotency-key": "batch-ingest-2" },
    payload: {
      items: [
        {
          platform: "reddit",
          kind: "post",
          externalId: "t3_batcha1",
          title: "Batch Post One",
          text: "First sample post for batch project testing.",
          url: "https://reddit.com/r/test/comments/batch_a1",
          language: "en",
          author: null,
          publishedAt: nowIso,
          fetchedAt: nowIso,
          availability: "available",
          references: [],
          media: [],
          platformDetails: { platform: "reddit", community: "test", flair: null, nsfw: false },
          observation: {
            provider: "external_ingest",
            sourceId,
            sourceObservedAt: nowIso,
            fetchedAt: nowIso,
            timeBasis: "provider_snapshot",
            maturity: "unknown",
            metrics: { "reddit.score": 42, "reddit.num_comments": 7 },
            evidenceKey: "ev-batch-a1",
          },
        },
        {
          platform: "reddit",
          kind: "post",
          externalId: "t3_batcha3",
          title: "Batch Post Three",
          text: "Third sample post for dedup check.",
          url: "https://reddit.com/r/test/comments/batch_a3",
          language: "en",
          author: null,
          publishedAt: nowIso,
          fetchedAt: nowIso,
          availability: "available",
          references: [],
          media: [],
          platformDetails: { platform: "reddit", community: "test", flair: null, nsfw: false },
          observation: {
            provider: "external_ingest",
            sourceId,
            sourceObservedAt: nowIso,
            fetchedAt: nowIso,
            timeBasis: "provider_snapshot",
            maturity: "unknown",
            metrics: { "reddit.score": 88, "reddit.num_comments": 19 },
            evidenceKey: "ev-batch-a3",
          },
        },
      ],
    },
  });
  assert.equal(ingest2.statusCode, 201, ingest2.body);
  const batch2Id = ingest2.json().batchId as string;

  // 2. Viewer A creates an empty batch project (0 sources!) -> overview MUST be 0 despite global DB having 3 posts
  const projARes = await app.inject({
    method: "POST",
    url: "/v1/projects",
    headers: viewerAHeaders,
    payload: { name: "Viewer A Empty Project", description: "Starts strictly empty", datasetMode: "batch", sourceIds: [] },
  });
  assert.equal(projARes.statusCode, 200, projARes.body);
  const projA = projARes.json();
  assert.equal(projA.dataset_mode, "batch");
  assert.equal(projA.can_edit, true);
  assert.equal(projA.is_shared, false);

  const emptyOverview = await app.inject({
    method: "GET",
    url: `/v1/projects/${projA.id}/overview`,
    headers: viewerAHeaders,
  });
  assert.equal(emptyOverview.statusCode, 200, emptyOverview.body);
  assert.equal(emptyOverview.json().contentCount, 0, "new empty batch project must have 0 samples");

  // 3. Viewer B CANNOT see or mutate Viewer A's private project
  const bReadA = await app.inject({ method: "GET", url: `/v1/projects/${projA.id}`, headers: viewerBHeaders });
  assert.equal(bReadA.statusCode, 404);
  const bAttachA = await app.inject({
    method: "POST",
    url: `/v1/projects/${projA.id}/batches`,
    headers: viewerBHeaders,
    payload: { batchId: batch1Id },
  });
  assert.equal(bAttachA.statusCode, 404);

  // 4. Owner creates a shared project -> Viewer A can read it, CANNOT edit/delete it (403)
  const sharedRes = await app.inject({
    method: "POST",
    url: "/v1/projects",
    headers: ownerHeaders,
    payload: { name: "Admin Shared Project", datasetMode: "batch", sourceIds: [] },
  });
  assert.equal(sharedRes.statusCode, 200, sharedRes.body);
  const sharedProj = sharedRes.json();
  const aReadShared = await app.inject({ method: "GET", url: `/v1/projects/${sharedProj.id}`, headers: viewerAHeaders });
  assert.equal(aReadShared.statusCode, 200);
  assert.equal(aReadShared.json().can_edit, false);
  assert.equal(aReadShared.json().is_shared, true);
  const aEditShared = await app.inject({
    method: "PATCH",
    url: `/v1/projects/${sharedProj.id}`,
    headers: viewerAHeaders,
    payload: { name: "Hijack", revision: sharedProj.revision },
  });
  assert.equal(aEditShared.statusCode, 403);

  // 5. Viewer A attaches batch1 (2 items) and batch2 (2 items, 1 overlap) -> deduplicated count MUST be 3
  const att1 = await app.inject({
    method: "POST",
    url: `/v1/projects/${projA.id}/batches`,
    headers: viewerAHeaders,
    payload: { batchId: batch1Id },
  });
  assert.equal(att1.statusCode, 200, att1.body);
  const att2 = await app.inject({
    method: "POST",
    url: `/v1/projects/${projA.id}/batches`,
    headers: viewerAHeaders,
    payload: { batchId: batch2Id },
  });
  assert.equal(att2.statusCode, 200, att2.body);

  const dedupOverview = await app.inject({
    method: "GET",
    url: `/v1/projects/${projA.id}/overview`,
    headers: viewerAHeaders,
  });
  assert.equal(dedupOverview.statusCode, 200, dedupOverview.body);
  assert.equal(dedupOverview.json().contentCount, 3, "overlapping batches must deduplicate canonically");

  // 6. Viewer A creates a second project (Proj A2) and reuses batch1 without external API
  const projA2Res = await app.inject({
    method: "POST",
    url: "/v1/projects",
    headers: viewerAHeaders,
    payload: { name: "Viewer A Second Project", datasetMode: "batch" },
  });
  assert.equal(projA2Res.statusCode, 200, projA2Res.body);
  const projA2 = projA2Res.json();
  await app.inject({
    method: "POST",
    url: `/v1/projects/${projA2.id}/batches`,
    headers: viewerAHeaders,
    payload: { batchId: batch1Id },
  });

  // Disable batch1 in Proj A -> Proj A drops to 2 (only batch2's 2 items), Proj A2 stays at 2!
  const dis1 = await app.inject({
    method: "PATCH",
    url: `/v1/projects/${projA.id}/batches/${batch1Id}`,
    headers: viewerAHeaders,
    payload: { status: "disabled" },
  });
  assert.equal(dis1.statusCode, 200, dis1.body);
  assert.equal(
    (await app.inject({ method: "GET", url: `/v1/projects/${projA.id}/overview`, headers: viewerAHeaders })).json().contentCount,
    2,
  );
  assert.equal(
    (await app.inject({ method: "GET", url: `/v1/projects/${projA2.id}/overview`, headers: viewerAHeaders })).json().contentCount,
    2,
  );

  // Remove batch1 from Proj A -> soft-removed from Proj A list, Proj A2 still has 2!
  const rem1 = await app.inject({
    method: "PATCH",
    url: `/v1/projects/${projA.id}/batches/${batch1Id}`,
    headers: viewerAHeaders,
    payload: { status: "removed" },
  });
  assert.equal(rem1.statusCode, 200, rem1.body);
  const aBatches = (await app.inject({ method: "GET", url: `/v1/projects/${projA.id}/batches`, headers: viewerAHeaders })).json().batches;
  assert.equal(aBatches.length, 1);
  assert.equal(aBatches[0].batchId, batch2Id);
  assert.equal(
    (await app.inject({ method: "GET", url: `/v1/projects/${projA2.id}/overview`, headers: viewerAHeaders })).json().contentCount,
    2,
  );

  // 7. Free tier max_projects=3 enforcement (Viewer A already has 2; 3rd succeeds, 4th returns 403)
  const projA3 = await app.inject({
    method: "POST",
    url: "/v1/projects",
    headers: viewerAHeaders,
    payload: { name: "Viewer A Third Project", datasetMode: "batch" },
  });
  assert.equal(projA3.statusCode, 200, projA3.body);
  const projA4 = await app.inject({
    method: "POST",
    url: "/v1/projects",
    headers: viewerAHeaders,
    payload: { name: "Viewer A Fourth Project", datasetMode: "batch" },
  });
  assert.equal(projA4.statusCode, 403, projA4.body);

  // 8. P0-03 Cross-user private batch isolation on the SAME source:
  // Insert a private batch owned by Viewer A on the same sourceId -> Viewer B must NOT see or attach it!
  const viewerAId = (await db.pool.query<{ id: string }>("SELECT id FROM app_user WHERE email='viewer-a@example.test'")).rows[0].id;
  const privateBatchId = "11111111-2222-4333-8444-555555555555";
  await db.pool.query(
    `INSERT INTO collection_batch(id, job_id, collection_source_id, created_by_user_id, label, item_count, visibility)
     VALUES($1, NULL, $2, $3, 'Viewer A Private Batch', 1, 'private')`,
    [privateBatchId, sourceId, viewerAId],
  );
  // One genuinely private-only sample makes visibility predicates observable.
  const privateContentId = randomUUID();
  await db.pool.query(
    `INSERT INTO content SELECT (jsonb_populate_record(NULL::content, to_jsonb(c) ||
      jsonb_build_object('id',$1::text,'external_id','t3_privateaudit','url','https://reddit.com/privateaudit'))).*
      FROM content c LIMIT 1`, [privateContentId],
  );
  await db.pool.query(
    `INSERT INTO content_discovery SELECT (jsonb_populate_record(NULL::content_discovery, to_jsonb(d) ||
      jsonb_build_object('content_id',$1::text))).* FROM content_discovery d WHERE collection_source_id=$2 LIMIT 1`,
    [privateContentId, sourceId],
  );
  await db.pool.query("INSERT INTO collection_batch_item(batch_id,content_id) VALUES($1,$2)", [privateBatchId, privateContentId]);
  const viewerBId = (await db.pool.query("SELECT id FROM app_user WHERE email='viewer-b@example.test'")).rows[0].id;
  const sampleWindowEnd = new Date(Date.parse(nowIso) + 1).toISOString();
  for (const [userId, count] of [[viewerAId, 4], [viewerBId, 3]] as const) {
    const actor: Actor = { userId, email: "fixture@example.test", role: "viewer", clientKind: "browser",
      sessionId: randomUUID(), scopes: [], allowedSourceIds: null };
    assert.equal(await countSourceSamples(db.pool, sourceId, "2000-01-01T00:00:00Z", sampleWindowEnd,
      batchMembership(undefined, actor)), count, "all authorized batches stay in SQL, with private samples isolated");
    assert.equal(await countSourceSamples(db.pool, sourceId, "2000-01-01T00:00:00Z", sampleWindowEnd,
      batchMembership([], actor)), 0, "an explicitly empty project never becomes all batches");
  }
  // Viewer A sees their own private batch
  const aListBatches = (await app.inject({ method: "GET", url: "/v1/batches", headers: viewerAHeaders })).json().batches;
  assert.ok(aListBatches.some((b: { id: string }) => b.id === privateBatchId), "Viewer A must see own private batch");
  // Viewer B does NOT see Viewer A's private batch, even on the same source
  const bListBatches = (await app.inject({ method: "GET", url: "/v1/batches", headers: viewerBHeaders })).json().batches;
  assert.equal(bListBatches.some((b: { id: string }) => b.id === privateBatchId), false, "Viewer B must NOT see Viewer A's private batch");
  // Viewer B creates own project and tries to attach Viewer A's private batch -> 404!
  const projB = (await app.inject({
    method: "POST",
    url: "/v1/projects",
    headers: viewerBHeaders,
    payload: { name: "Viewer B Project", datasetMode: "batch" },
  })).json();
  const bSteal = await app.inject({
    method: "POST",
    url: `/v1/projects/${projB.id}/batches`,
    headers: viewerBHeaders,
    payload: { batchId: privateBatchId },
  });
  assert.equal(bSteal.statusCode, 404, "Viewer B must be blocked from attaching Viewer A's private batch");
  // Staff may link a private batch to a shared project without disclosing it to other viewers.
  const sharedAttach = await app.inject({
    method: "POST",
    url: `/v1/projects/${sharedProj.id}/batches`,
    headers: ownerHeaders,
    payload: { batchId: privateBatchId },
  });
  assert.equal(sharedAttach.statusCode, 200, sharedAttach.body);
  for (const [headers, expected] of [[ownerHeaders, 1], [viewerAHeaders, 1], [viewerBHeaders, 0]] as const) {
    const { project } = (await app.inject({
      method: "GET", url: `/v1/projects/${sharedProj.id}/overview`, headers,
    })).json();
    assert.equal(project.enabled_batch_count, expected);
    assert.equal(project.total_batch_count, expected);
    const { batches } = (await app.inject({
      method: "GET", url: `/v1/projects/${sharedProj.id}/batches`, headers,
    })).json();
    assert.equal(batches.length, expected);
  }

  // Viewer B CAN attach Owner's shared batch1
  const bShared = await app.inject({
    method: "POST",
    url: `/v1/projects/${projB.id}/batches`,
    headers: viewerBHeaders,
    payload: { batchId: batch1Id },
  });
  assert.equal(bShared.statusCode, 200, bShared.body);
  const eligibleB = await app.inject({
    method: "GET", url: `/v1/batches?forProjectId=${projB.id}`, headers: viewerBHeaders,
  });
  assert.equal(eligibleB.statusCode, 200, eligibleB.body);
  const eligibleIds = (eligibleB.json().batches as { id: string }[]).map(batch => batch.id);
  assert.ok(eligibleIds.includes(batch2Id));
  assert.ok(!eligibleIds.includes(batch1Id), "already linked data is excluded before pagination");
  assert.ok(!eligibleIds.includes(privateBatchId), "other users' private data is excluded");
  assert.equal((await app.inject({
    method: "GET", url: `/v1/batches?forProjectId=${sharedProj.id}`, headers: viewerBHeaders,
  })).statusCode, 403);


  // A duplicate discovery in a different source must not satisfy a project batch's source filter.
  const other = await app.inject({
    method: "POST", url: "/v1/sources", headers: ownerHeaders,
    payload: { label: "Second discovery", platform: "reddit", deliveryMode: "push",
      primaryProvider: "external_ingest", contentKind: "post", target: { type: "search", query: "other" } },
  });
  assert.equal(other.statusCode, 200, other.body);
  const otherId = other.json().source.id;
  await db.pool.query(
    `INSERT INTO content_discovery(content_id, collection_source_id, first_fetched_at, last_fetched_at)
     SELECT content_id, $1, first_fetched_at, last_fetched_at FROM content_discovery WHERE collection_source_id=$2`,
    [otherId, sourceId],
  );
  for (const [filter, expected] of [[sourceId, 2], [otherId, 0]] as const) {
    const list = await app.inject({
      method: "GET", url: `/v1/projects/${projB.id}/content?sourceId=${filter}`, headers: viewerBHeaders,
    });
    assert.equal(list.statusCode, 200, list.body);
    assert.equal(list.json().items.length, expected, "batch and explicit source filters share one discovery witness");
  }

  // 9. P0-02 & P1-01 Server-side collection plan preview:
  // Unregistered target -> needs_admin_source; excessive lookback -> blocked by maxLookbackDays!
  const from30d = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const previewUnreg = await app.inject({
    method: "POST",
    url: "/v1/research/collection-plans/preview",
    headers: viewerAHeaders,
    payload: {
      projectId: projA.id,
      platform: "reddit",
      targetType: "community",
      targetValue: "r/NonExistentCommunity",
      from: from30d,
      to: nowIso,
      limit: 10,
    },
  });
  assert.equal(previewUnreg.statusCode, 200, previewUnreg.body);
  const pBody = previewUnreg.json();
  assert.equal(pBody.resolutionStatus, "needs_admin_source");
  assert.equal(pBody.executable, false);
  assert.ok(pBody.restrictions.includes("target_unavailable"));
  assert.ok(pBody.restrictions.includes("scope_limit"));
  assert.equal(pBody.fieldPolicy.maxLookbackDays, 7);
  assert.ok(pBody.blockers.some((b: string) => /max lookback/i.test(b)), "Free viewer 30d window must be flagged against 7d maxLookbackDays");
});
