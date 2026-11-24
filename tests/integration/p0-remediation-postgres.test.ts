import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import test from "node:test";
import { buildApp } from "../../apps/api/src/app";
import { KaixContentConnector } from "../../src/connectors/reddit/kaix-content.connector";
import { webSource } from "../../src/connectors/web/sources";
import { provisionMfa } from "../../src/modules/access/mfa-sql";
import { bootstrapOwner } from "../../src/modules/access/sql";
import { workOnce } from "../../src/modules/collection/worker";
import { testDatabase } from "../helpers/database";

const ORIGIN = "https://p0-remediation.test";

function fixtureCode(seed: Buffer, step: number) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", seed).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

test("P0 foundations: domain/lane consistency, MFA on budget writes, configurable global ceiling, dispatch cancel, and legacy source reconciliation", async (t) => {
  const db = await testDatabase();
  t.after(db.close);

  const mfaKey = randomUUID().replace(/-/g, "").slice(0, 32);
  const keyBuf = Buffer.from(mfaKey, "utf8");
  const password = "fixture-password-123";
  await bootstrapOwner(db.pool, password, "owner@p0.test");
  const ownerId = (await db.pool.query<{ id: string }>("SELECT id FROM app_user WHERE email='owner@p0.test'")).rows[0].id;
  const seed = Buffer.alloc(20, 7);
  await provisionMfa(db.pool, ownerId, seed, keyBuf, Math.floor(Date.now() / 30000) - 1, false);

  const feed = webSource("feed", { SOURCE_NETWORK_ENABLED: "true" }, async () => ({
    status: 200,
    body: "<rss><channel><item><title>Ok</title><link>https://example.test/1</link></item></channel></rss>",
  }));
  let providerCalls = 0;
  const kaix = new KaixContentConnector({ networkEnabled: true, apiToken: "fixture-token" }, async () => {
    providerCalls++;
    return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
  });
  const app = await buildApp({
    pool: db.pool,
    origin: ORIGIN,
    sessionSecret: "p0-remediation-secret".repeat(3),
    providers: [feed, kaix],
    mfa: { key: keyBuf, required: true },
    secureCookies: false,
  });
  t.after(() => app.close());

  // Complete owner MFA login
  const loginRes = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    headers: { origin: ORIGIN },
    payload: { email: "owner@p0.test", password },
  });
  assert.equal(loginRes.statusCode, 202);
  const { challenge } = loginRes.json<{ challenge: string }>();
  const code = fixtureCode(seed, Math.floor(Date.now() / 30000));
  const mfaRes = await app.inject({
    method: "POST",
    url: "/v1/auth/mfa/complete",
    headers: { origin: ORIGIN },
    payload: { challenge, code },
  });
  assert.equal(mfaRes.statusCode, 200);
  const ownerCookie = mfaRes.headers["set-cookie"]!.toString().split(";")[0];

  // 1. AUD-01: Domain/lane validation on create and patch
  const badFeedLane = await app.inject({
    method: "POST",
    url: "/v1/sources",
    headers: { cookie: ownerCookie, origin: ORIGIN },
    payload: {
      platform: "web",
      primaryProvider: "feed",
      deliveryMode: "pull",
      contentKind: "article",
      feedLane: "monitor_only",
      label: "Invalid feed lane",
      target: { type: "feed", url: "https://example.test/rss.xml" },
    },
  });
  assert.equal(badFeedLane.statusCode, 422);

  const badResearchLane = await app.inject({
    method: "POST",
    url: "/v1/sources",
    headers: { cookie: ownerCookie, origin: ORIGIN },
    payload: {
      platform: "reddit",
      primaryProvider: "kaix",
      deliveryMode: "pull",
      contentKind: "post",
      feedLane: "release",
      label: "Invalid research lane",
      target: { type: "community", community: "localllama" },
    },
  });
  assert.equal(badResearchLane.statusCode, 422);

  // 2. AUD-15 / AUD-14: Budget writes require recent MFA; configurable global ceiling enforces dispatch
  await db.pool.query("UPDATE app_session SET mfa_step_up_at = NOW() - interval '6 minutes' WHERE user_id = $1", [ownerId]);
  const staleMfaBudget = await app.inject({
    method: "PUT",
    url: "/v1/sources/budgets/kaix",
    headers: { cookie: ownerCookie, origin: ORIGIN },
    payload: {
      enabled: true,
      dailyRequests: 100,
      monthlyRequests: 1000,
      dailyResources: 5000,
      monthlyResources: 50000,
      minimumIntervalMs: 0,
      revision: 1,
    },
  });
  assert.equal(staleMfaBudget.statusCode, 403);

  const staleMfaGlobal = await app.inject({
    method: "PUT",
    url: "/v1/sources/budgets/global",
    headers: { cookie: ownerCookie, origin: ORIGIN },
    payload: { dailySocialItemCeiling: 500, autoHydrationEnabled: true, revision: 1 },
  });
  assert.equal(staleMfaGlobal.statusCode, 403);

  // Step up MFA (advance counter so code differs or reuse next step? In test, update mfa_step_up_at directly)
  await db.pool.query("UPDATE app_session SET mfa_step_up_at = NOW() WHERE user_id = $1", [ownerId]);
  const okGlobal = await app.inject({
    method: "PUT",
    url: "/v1/sources/budgets/global",
    headers: { cookie: ownerCookie, origin: ORIGIN },
    payload: { dailySocialItemCeiling: 10, autoHydrationEnabled: false, revision: 1 },
  });
  assert.equal(okGlobal.statusCode, 200, okGlobal.body);
  assert.equal(okGlobal.json().dailySocialItemCeiling, 10);
  assert.equal(okGlobal.json().autoHydrationEnabled, false);

  const budgetsRes = await app.inject({
    method: "GET",
    url: "/v1/sources/budgets",
    headers: { cookie: ownerCookie },
  });
  assert.equal(budgetsRes.statusCode, 200, budgetsRes.body);
  const kaixRev = budgetsRes.json().budgets.find((b: { provider: string; revision: number }) => b.provider === "kaix").revision;

  const okKaixBudget = await app.inject({
    method: "PUT",
    url: "/v1/sources/budgets/kaix",
    headers: { cookie: ownerCookie, origin: ORIGIN },
    payload: {
      enabled: true,
      dailyRequests: 100,
      monthlyRequests: 1000,
      dailyResources: 5000,
      monthlyResources: 50000,
      minimumIntervalMs: 0,
      revision: kaixRev,
    },
  });
  assert.equal(okKaixBudget.statusCode, 200, okKaixBudget.body);

  // Create a research source with schedule enabled (legacy monitor_managed = false)
  const srcRes = await app.inject({
    method: "POST",
    url: "/v1/sources",
    headers: { cookie: ownerCookie, origin: ORIGIN },
    payload: {
      platform: "reddit",
      primaryProvider: "kaix",
      deliveryMode: "pull",
      contentKind: "post",
      feedLane: "monitor_only",
      label: "Legacy candidate",
      schedule: { enabled: true, cadenceSeconds: 3600 },
      target: { type: "community", community: "localllama" },
    },
  });
  assert.equal(srcRes.statusCode, 200, srcRes.body);
  const srcId = srcRes.json().source.id as string;

  // Job requesting 20 items > configured 10 ceiling -> deferred with 0 provider calls!
  const jobId = randomUUID();
  await db.pool.query(
    `INSERT INTO source_collection_job(id,collection_source_id,status,purpose,operation,provider,from_at,to_at,page_size,max_pages,next_run_at,created_at)
     VALUES($1,$2,'queued','manual','radar','kaix',now()-interval '1 hour',now(),20,1,now(),now())`,
    [jobId, srcId],
  );
  assert.equal(await workOnce(db.pool, [kaix]), true);
  assert.equal(providerCalls, 0);
  assert.equal(
    (await db.pool.query("SELECT error FROM source_collection_job WHERE id=$1", [jobId])).rows[0].error,
    "Waiting for system social budget",
  );

  // 3. AUD-04 (SEC04): Blocked/paused source cancels queued job at dispatch before any charge
  await db.pool.query("UPDATE collection_source SET automatic_collection_blocked=true WHERE id=$1", [srcId]);
  // Simulate a job that was already claimed or ready while source became blocked -> workOnce skips/cancels with 0 charges
  await db.pool.query("UPDATE source_collection_job SET next_run_at=now(), error=NULL WHERE id=$1", [jobId]);
  assert.equal(await workOnce(db.pool, [kaix]), false);
  await db.pool.query("UPDATE collection_source SET automatic_collection_blocked=false WHERE id=$1", [srcId]);

  // 4. AUD-04 (X04): Legacy monitor_managed=false inspection & pause_schedule reconciliation
  const legacyList = await app.inject({
    method: "GET",
    url: "/v1/intelligence/admin/legacy-sources",
    headers: { cookie: ownerCookie },
  });
  assert.equal(legacyList.statusCode, 200, legacyList.body);
  const found = legacyList.json().items.find((i: { id: string }) => i.id === srcId);
  assert.ok(found);
  assert.equal(found.classification, "unclassified");
  assert.equal(found.scheduleEnabled, true);

  const reconciled = await app.inject({
    method: "POST",
    url: `/v1/intelligence/admin/legacy-sources/${srcId}/reconcile`,
    headers: { cookie: ownerCookie, origin: ORIGIN },
    payload: { action: "pause_schedule", revision: found.revision },
  });
  assert.equal(reconciled.statusCode, 200, reconciled.body);
  const srcAfter = await db.pool.query("SELECT schedule, next_due_at FROM collection_source WHERE id=$1", [srcId]);
  assert.equal(srcAfter.rows[0].schedule.enabled, false);
  assert.equal(srcAfter.rows[0].next_due_at, null);

  // Non-scheduled unmanaged monitor_only research source still appears in legacy-sources audit (AUD-04)
  const legacyAfter = await app.inject({
    method: "GET",
    url: "/v1/intelligence/admin/legacy-sources",
    headers: { cookie: ownerCookie },
  });
  assert.equal(legacyAfter.statusCode, 200);
  const unscheduledLegacy = legacyAfter.json().items.find((i: { id: string }) => i.id === srcId);
  assert.ok(unscheduledLegacy);
  assert.equal(unscheduledLegacy.classification, "unclassified");
  assert.equal(unscheduledLegacy.scheduleEnabled, false);

  // 5. AUD-05: Archived feed recovery & batch-update + qualityGrade filter
  const feedRes = await app.inject({
    method: "POST",
    url: "/v1/sources",
    headers: { cookie: ownerCookie, origin: ORIGIN },
    payload: {
      platform: "web",
      primaryProvider: "feed",
      deliveryMode: "pull",
      contentKind: "article",
      feedLane: "news",
      label: "061 Archived Feed",
      target: { type: "feed", url: "https://example.test/archived.xml" },
    },
  });
  assert.equal(feedRes.statusCode, 200, feedRes.body);
  const feedId = feedRes.json().source.id as string;

  const archiveBatch = await app.inject({
    method: "POST",
    url: "/v1/sources/batch-update",
    headers: { cookie: ownerCookie, origin: ORIGIN },
    payload: { ids: [feedId], state: "archived", feedLane: "news" },
  });
  assert.equal(archiveBatch.statusCode, 200, archiveBatch.body);

  const invalidBatch = await app.inject({
    method: "POST",
    url: "/v1/sources/batch-update",
    headers: { cookie: ownerCookie, origin: ORIGIN },
    payload: { ids: [feedId], feedLane: "monitor_only" },
  });
  assert.equal(invalidBatch.statusCode, 422);

  const batchOk = await app.inject({
    method: "POST",
    url: "/v1/sources/batch-update",
    headers: { cookie: ownerCookie, origin: ORIGIN },
    payload: { ids: [feedId], state: "active", feedLane: "release", qualityGrade: "S" },
  });
  assert.equal(batchOk.statusCode, 200, batchOk.body);
  assert.equal(batchOk.json().updatedCount, 1);

  const gradedList = await app.inject({
    method: "GET",
    url: "/v1/sources?qualityGrade=S",
    headers: { cookie: ownerCookie },
  });
  assert.equal(gradedList.statusCode, 200);
  assert.ok(gradedList.json().sources.some((s: { id: string; feedLane: string; qualityGrade: string }) =>
    s.id === feedId && s.feedLane === "release" && s.qualityGrade === "S"));
});
