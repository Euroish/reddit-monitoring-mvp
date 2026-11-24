import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import test from "node:test";
import type { ContentProvider } from "../../src/connectors/shared/content-provider.interface";
import { buildApp } from "../../apps/api/src/app";
import { provisionMfa } from "../../src/modules/access/mfa-sql";
import { bootstrapOwner } from "../../src/modules/access/sql";
import { scheduleDueSourcesOnce } from "../../src/modules/collection/schedule";
import { workOnce } from "../../src/modules/collection/worker";
import { authorizeScheduledSourceDispatch } from "../../src/modules/intelligence/index";
import { testDatabase } from "../helpers/database";

const ORIGIN = "https://stage3-sched.test";

function fixtureCode(seed: Buffer, step: number) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", seed).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

function makeMockKaix(onCall?: () => void): ContentProvider {
  return {
    capability: {
      platform: "reddit",
      provider: "kaix",
      enabled: true,
      contentKinds: ["post", "comment"],
      targetTypes: ["community", "account", "search", "post"],
      keywordSearch: "global",
      metrics: [],
      observationModel: "snapshot",
      limitations: [],
      requestResourceUpperBound: 30,
    },
    normalizeTarget(target) {
      return target;
    },
    async collectPage(req) {
      onCall?.();
      const now = new Date().toISOString();
      const postId = `t3_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
      return {
        items: [
          {
            id: randomUUID(),
            platform: "reddit",
            kind: "post",
            externalId: postId,
            title: `Monitor hit ${req.source.label}`,
            text: "Scheduled sample.",
            url: `https://reddit.com/r/localllama/comments/${postId}`,
            language: "en",
            author: null,
            publishedAt: now,
            fetchedAt: now,
            availability: "available",
            references: [],
            media: [],
            platformDetails: { platform: "reddit", community: "localllama", flair: null, nsfw: false },
            observation: {
              provider: "kaix",
              sourceId: req.source.id,
              sourceObservedAt: now,
              fetchedAt: now,
              timeBasis: "provider_snapshot",
              maturity: "unknown",
              metrics: { "reddit.score": 10, "reddit.num_comments": 2 },
              evidenceKey: `ev-${postId}`,
            },
          },
        ],
        nextCheckpoint: null,
        exhausted: true,
        coverage: "partial",
        warning: null,
      };
    },
  };
}

test("Stage 3 auto-schedule: 168h cadence, viewer entitlements, pre-dispatch revocation, cumulative daily budget & due-only billing", async (t) => {
  const db = await testDatabase();
  t.after(db.close);

  const mfaKey = randomUUID().replace(/-/g, "").slice(0, 32);
  const keyBuf = Buffer.from(mfaKey, "utf8");
  const password = "fixture-password-123";
  await bootstrapOwner(db.pool, password, "owner@stage3.test");
  const ownerId = (await db.pool.query<{ id: string }>("SELECT id FROM app_user WHERE email='owner@stage3.test'")).rows[0].id;
  const seed = Buffer.alloc(20, 5);
  await provisionMfa(db.pool, ownerId, seed, keyBuf, Math.floor(Date.now() / 30000) - 1, false);

  let upstreamCalls = 0;
  const kaix = makeMockKaix(() => { upstreamCalls++; });
  const redCrawler: ContentProvider = {
    ...kaix,
    capability: { ...kaix.capability, provider: "red_crawler" },
  };

  const app = await buildApp({
    pool: db.pool,
    origin: ORIGIN,
    sessionSecret: "stage3-schedule-secret".repeat(3),
    providers: [kaix, redCrawler],
    mfa: { key: keyBuf, required: true },
    secureCookies: false,
    publicRegistration: true,
  });
  t.after(() => app.close());

  const loginOwner = await app.inject({
    method: "POST", url: "/v1/auth/login", headers: { origin: ORIGIN },
    payload: { email: "owner@stage3.test", password },
  });
  const { challenge } = loginOwner.json<{ challenge: string }>();
  const mfaRes = await app.inject({
    method: "POST", url: "/v1/auth/mfa/complete", headers: { origin: ORIGIN },
    payload: { challenge, code: fixtureCode(seed, Math.floor(Date.now() / 30000)) },
  });
  const ownerCookie = mfaRes.headers["set-cookie"]!.toString().split(";")[0];
  const ownerHeaders = { cookie: ownerCookie, origin: ORIGIN };

  // Enable kaix provider budget
  const budgets = (await app.inject({ method: "GET", url: "/v1/sources/budgets", headers: { cookie: ownerCookie } })).json().budgets;
  const kaixBudget = budgets.find((b: { provider: string }) => b.provider === "kaix");
  const updBudget = await app.inject({
    method: "PUT", url: "/v1/sources/budgets/kaix", headers: ownerHeaders,
    payload: { enabled: true, dailyRequests: 100, monthlyRequests: 1000, dailyResources: 5000, monthlyResources: 50000, minimumIntervalMs: 0, revision: kaixBudget.revision },
  });
  assert.equal(updBudget.statusCode, 200, updBudget.body);

  // 1. 168h cadence is NOT truncated to 12h
  const mon168Res = await app.inject({
    method: "POST", url: "/v1/intelligence/monitors", headers: ownerHeaders,
    payload: {
      kind: "keyword",
      name: "Weekly 168h Monitor",
      config: { platforms: ["reddit"], keywords: ["llama weekly"] },
      scheduleIntervalHours: 168,
      dailyItemBudget: 500,
      enabled: true,
    },
  });
  assert.equal(mon168Res.statusCode, 200, mon168Res.body);
  const mon168Id = mon168Res.json().monitor.id as string;
  const src168Row = (await db.pool.query(
    `SELECT cs.schedule FROM intel_monitor_source ms JOIN collection_source cs ON cs.id=ms.collection_source_id WHERE ms.monitor_id=$1`,
    [mon168Id],
  )).rows[0];
  assert.equal(src168Row.schedule.cadenceSeconds, 168 * 3600);

  // Register Viewer on pro tier
  const regV = await app.inject({
    method: "POST", url: "/v1/auth/register", headers: { origin: ORIGIN },
    payload: { email: "viewer@stage3.test", password },
  });
  const vCookie = regV.headers["set-cookie"]!.toString().split(";")[0];
  const vHeaders = { cookie: vCookie, origin: ORIGIN };
  const viewerId = (await db.pool.query<{ id: string }>("SELECT id FROM app_user WHERE email='viewer@stage3.test'")).rows[0].id;
  await db.pool.query("UPDATE app_user SET plan_tier='pro' WHERE id=$1", [viewerId]);

  const vProj = (await app.inject({
    method: "POST", url: "/v1/projects", headers: vHeaders,
    payload: { name: "Viewer Auto Project", datasetMode: "batch", sourceIds: [] },
  })).json();

  // Default pro plan has allowAutoSchedule=false -> viewer 403
  const deniedMon = await app.inject({
    method: "POST", url: "/v1/intelligence/monitors", headers: vHeaders,
    payload: { kind: "keyword", name: "Too soon", config: { platforms: ["reddit"], keywords: ["vllm"] }, projectId: vProj.id },
  });
  assert.equal(deniedMon.statusCode, 403);

  // Enable allowAutoSchedule on pro (maxScheduledTasks=1, minScheduleIntervalHours=24)
  const qSum = (await app.inject({ method: "GET", url: "/v1/quotas/summary", headers: { cookie: ownerCookie } })).json();
  const proPlan = qSum.planPolicies.find((p: { planTier: string }) => p.planTier === "pro");
  const updPro = await app.inject({
    method: "PUT", url: "/v1/quotas/plans/pro", headers: ownerHeaders,
    payload: {
      manualCollectEnabled: true, maxProjects: 5, maxLookbackDays: 30, allowProviderChoice: true, exportEnabled: true,
      allowAutoSchedule: true, maxScheduledTasks: 1, minScheduleIntervalHours: 24,
      allowedProviders: ["kaix"], allowedSourceIds: null, dailyRequests: 20, dailyResources: 1000,
      maxBatchLimit: 100, maxCommentsPerPost: 15, revision: proPlan.revision,
    },
  });
  assert.equal(updPro.statusCode, 200, updPro.body);

  // Too-short interval rejected (12h < 24h)
  const shortRes = await app.inject({
    method: "POST", url: "/v1/intelligence/monitors", headers: vHeaders,
    payload: { kind: "keyword", name: "Short", config: { platforms: ["reddit"], keywords: ["vllm"] }, scheduleIntervalHours: 12, projectId: vProj.id },
  });
  assert.equal(shortRes.statusCode, 422);

  // Valid 24h monitor bound to viewer project succeeds
  const vMonRes = await app.inject({
    method: "POST", url: "/v1/intelligence/monitors", headers: vHeaders,
    payload: {
      kind: "keyword",
      name: "Viewer 24h Schedule",
      config: { platforms: ["reddit"], keywords: ["shared topic stage3"] },
      scheduleIntervalHours: 24,
      dailyItemBudget: 500,
      projectId: vProj.id,
    },
  });
  assert.equal(vMonRes.statusCode, 200, vMonRes.body);
  const vMon = vMonRes.json().monitor;
  assert.equal(vMon.projectId, vProj.id);

  // Second enabled monitor exceeds maxScheduledTasks=1 -> 403
  const secondRes = await app.inject({
    method: "POST", url: "/v1/intelligence/monitors", headers: vHeaders,
    payload: { kind: "keyword", name: "Exceed limit", config: { platforms: ["reddit"], keywords: ["other kw"] }, scheduleIntervalHours: 24 },
  });
  assert.equal(secondRes.statusCode, 403);

  // 2. Due-only shared-source attribution (RB19) + Cumulative monitor budget (AUD-03):
  // Owner creates a second monitor sharing "shared topic stage3" at 24h, mark ownerMonitor NOT due yet (+20h), leave vMon DUE now!
  const oSharedRes = await app.inject({
    method: "POST", url: "/v1/intelligence/monitors", headers: ownerHeaders,
    payload: {
      kind: "keyword",
      name: "Owner Shared Monitor (Not Due)",
      config: { platforms: ["reddit"], keywords: ["shared topic stage3"] },
      scheduleIntervalHours: 24,
      dailyItemBudget: 50,
    },
  });
  assert.equal(oSharedRes.statusCode, 200, oSharedRes.body);
  const oSharedId = oSharedRes.json().monitor.id as string;
  await db.pool.query("UPDATE intel_monitor SET next_due_at = now() + interval '20 hours' WHERE id=$1", [oSharedId]);

  const sharedSourceId = (await db.pool.query<{ collection_source_id: string }>(
    "SELECT collection_source_id FROM intel_monitor_source WHERE monitor_id=$1", [vMon.id],
  )).rows[0].collection_source_id;
  await db.pool.query("UPDATE collection_source SET next_due_at = now() - interval '1 minute' WHERE id=$1", [sharedSourceId]);
  await db.pool.query("UPDATE collection_source SET next_due_at = now() + interval '7 days' WHERE id<>$1", [sharedSourceId]);

  const sched = await scheduleDueSourcesOnce(db.pool, [kaix]);
  assert.equal(sched.enqueuedCount, 1);
  for (const blockedBy of ["global", "provider"]) {
    await t.test(`${blockedBy} budget deferral never charges a monitor or its owner`, async () => {
      await db.pool.query("UPDATE source_global_budget SET daily_social_item_ceiling=$1", [blockedBy === "global" ? 0 : 20000]);
      await db.pool.query("UPDATE source_provider_budget SET enabled=$1 WHERE provider='kaix'", [blockedBy !== "provider"]);
      assert.equal(await workOnce(db.pool, [kaix], undefined, undefined, { authorizeScheduledSourceDispatch }), true);
      assert.equal(upstreamCalls, 0);
      const { rows: [usage] } = await db.pool.query(
        `SELECT (SELECT COUNT(*)::int FROM intel_monitor_usage WHERE monitor_id=$1) AS monitor,
                (SELECT COUNT(*)::int FROM user_provider_usage WHERE user_id=$2) AS viewer,
                (SELECT next_due_at <= NOW() FROM intel_monitor WHERE id=$1) AS due`,
        [vMon.id, viewerId],
      );
      assert.deepEqual(usage, { monitor: 0, viewer: 0, due: true });
    });
    await db.pool.query("UPDATE source_global_budget SET daily_social_item_ceiling=20000");
    await db.pool.query("UPDATE source_provider_budget SET enabled=true WHERE provider='kaix'");
    await db.pool.query("UPDATE source_collection_job SET next_run_at=now() WHERE collection_source_id=$1 AND status='queued'", [sharedSourceId]);
  }
  assert.equal(await workOnce(db.pool, [kaix], undefined, undefined, { authorizeScheduledSourceDispatch }), true);
  assert.equal(upstreamCalls, 1);

  // vMon was due -> debited in intel_monitor_usage; oShared was NOT due -> untouched!
  const vUsage = (await db.pool.query("SELECT requests, resources_reserved FROM intel_monitor_usage WHERE monitor_id=$1", [vMon.id])).rows;
  const oUsage = (await db.pool.query("SELECT requests, resources_reserved FROM intel_monitor_usage WHERE monitor_id=$1", [oSharedId])).rows;
  assert.equal(vUsage.length, 1);
  assert.ok(vUsage[0].resources_reserved > 0);
  assert.equal(oUsage.length, 0, "Non-due shared monitor must not be charged when another monitor runs");

  // 3. Pre-dispatch entitlement revocation (RB18):
  // Revoke allowAutoSchedule on viewer's override, queue a scheduled job -> workOnce auto-pauses vMon and makes 0 upstream calls!
  await app.inject({
    method: "PUT", url: `/v1/quotas/users/${viewerId}`, headers: ownerHeaders,
    payload: { allowAutoSchedule: false },
  });
  const revJobId = randomUUID();
  await db.pool.query(
    `INSERT INTO source_collection_job(id,collection_source_id,status,purpose,operation,provider,from_at,to_at,page_size,max_pages,next_run_at,created_at)
     VALUES($1,$2,'queued','scheduled','radar','kaix',now()-interval '1 hour',now(),25,1,now(),now())`,
    [revJobId, sharedSourceId],
  );
  // Also make oShared due so let's delete oShared first to test isolated viewer cancellation with 0 upstream calls
  await db.pool.query("DELETE FROM intel_monitor WHERE id=$1", [oSharedId]);
  await db.pool.query("UPDATE intel_monitor SET next_due_at = now() - interval '1 minute' WHERE id=$1", [vMon.id]);
  const callsBeforeRevoke = upstreamCalls;
  await workOnce(db.pool, [kaix], undefined, undefined, { authorizeScheduledSourceDispatch });
  assert.equal(upstreamCalls, callsBeforeRevoke, "Revoked monitor must not make upstream calls");

  const revMonRow = (await db.pool.query("SELECT enabled, paused_reason FROM intel_monitor WHERE id=$1", [vMon.id])).rows[0];
  assert.equal(revMonRow.enabled, false);
  assert.equal(revMonRow.paused_reason, "policy_revoked");
  const revJobRow = (await db.pool.query("SELECT status FROM source_collection_job WHERE id=$1", [revJobId])).rows[0];
  assert.equal(revJobRow.status, "cancelled");

  // 4. AUD-03 cumulative daily budget across manual /collect + estimate + scheduled dispatch
  const capMonRes = await app.inject({
    method: "POST", url: "/v1/intelligence/monitors", headers: ownerHeaders,
    payload: {
      kind: "keyword",
      name: "Cumulative Budget Monitor",
      config: { platforms: ["reddit"], keywords: ["budget cumulative check"] },
      scheduleIntervalHours: 24,
      dailyItemBudget: 35,
    },
  });
  assert.equal(capMonRes.statusCode, 200, capMonRes.body);
  const capMonId = capMonRes.json().monitor.id as string;

  const firstEst = await app.inject({
    method: "POST", url: `/v1/intelligence/monitors/${capMonId}/estimate`, headers: ownerHeaders,
    payload: { limitPerSource: 20, includeComments: false },
  });
  assert.equal(firstEst.statusCode, 200, firstEst.body);
  assert.equal(firstEst.json().monitorResourcesToday, 0);
  assert.equal(firstEst.json().exceedsMonitorBudget, false);

  const firstKey = randomUUID();
  const firstCollect = await app.inject({
    method: "POST", url: `/v1/intelligence/monitors/${capMonId}/collect`,
    headers: { ...ownerHeaders, "idempotency-key": firstKey },
    payload: { limitPerSource: 20, includeComments: false },
  });
  assert.equal(firstCollect.statusCode, 200, firstCollect.body);

  // Idempotent replay with same key must succeed and not double-charge
  const replayCollect = await app.inject({
    method: "POST", url: `/v1/intelligence/monitors/${capMonId}/collect`,
    headers: { ...ownerHeaders, "idempotency-key": firstKey },
    payload: { limitPerSource: 20, includeComments: false },
  });
  assert.equal(replayCollect.statusCode, 200, replayCollect.body);

  const capUsage = (await db.pool.query(
    "SELECT requests, resources_reserved FROM intel_monitor_usage WHERE monitor_id=$1",
    [capMonId],
  )).rows[0];
  assert.deepEqual(capUsage, { requests: 1, resources_reserved: 20 });

  // Finish first queued collect job so source is eligible for another collect job
  await db.pool.query(
    "UPDATE source_collection_job SET status='succeeded', finished_at=NOW() WHERE id=$1",
    [firstCollect.json().jobIds[0]],
  );

  const secondEst = await app.inject({
    method: "POST", url: `/v1/intelligence/monitors/${capMonId}/estimate`, headers: ownerHeaders,
    payload: { limitPerSource: 20, includeComments: false },
  });
  assert.equal(secondEst.statusCode, 200);
  assert.equal(secondEst.json().monitorResourcesToday, 20);
  assert.equal(secondEst.json().exceedsMonitorBudget, true);

  const secondCollect = await app.inject({
    method: "POST", url: `/v1/intelligence/monitors/${capMonId}/collect`,
    headers: { ...ownerHeaders, "idempotency-key": randomUUID() },
    payload: { limitPerSource: 20, includeComments: false },
  });
  assert.equal(secondCollect.statusCode, 422, secondCollect.body);
});
