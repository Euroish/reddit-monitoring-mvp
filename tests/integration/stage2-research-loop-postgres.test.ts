import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import test from "node:test";
import type { ContentProvider } from "../../src/connectors/shared/content-provider.interface";
import { buildApp } from "../../apps/api/src/app";
import { provisionMfa } from "../../src/modules/access/mfa-sql";
import { bootstrapOwner } from "../../src/modules/access/sql";
import { workOnce } from "../../src/modules/collection/worker";
import { contentVisibility } from "../../src/modules/collection/batches";
import { attachBatchToProjectInTx } from "../../src/modules/projects/index";
import { testDatabase } from "../helpers/database";

const ORIGIN = "https://stage2-loop.test";

function fixtureCode(seed: Buffer, step: number) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", seed).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

function makeMockKaix(enabled: boolean, onCollect?: (target: Record<string, unknown>) => void): ContentProvider {
  return {
    capability: {
      platform: "reddit",
      provider: "kaix",
      enabled,
      contentKinds: ["post", "comment"],
      targetTypes: ["community", "account", "search", "post"],
      keywordSearch: "global",
      metrics: [],
      observationModel: "snapshot",
      limitations: [],
      requestResourceUpperBound: 100,
    },
    normalizeTarget(target) {
      if (target.type === "community") {
        const clean = target.community.trim().replace(/^r\//i, "");
        if (!/^[a-z0-9_]{2,32}$/i.test(clean)) throw new Error("Invalid subreddit");
        return { type: "community", community: clean.toLowerCase() };
      }
      if (target.type === "search") return { type: "search", query: target.query.trim() };
      return target;
    },
    async collectPage(req) {
      onCollect?.(req.source.target as Record<string, unknown>);
      const now = new Date().toISOString();
      const postId = `t3_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
      return {
        items: [
          {
            id: randomUUID(),
            platform: "reddit",
            kind: "post",
            externalId: postId,
            title: `Collected ${req.source.label}`,
            text: "On-demand sample content for stage 2 verification.",
            url: `https://reddit.com/r/machinelearning/comments/${postId}`,
            language: "en",
            author: null,
            publishedAt: now,
            fetchedAt: now,
            availability: "available",
            references: [],
            media: [],
            platformDetails: { platform: "reddit", community: "machinelearning", flair: null, nsfw: false },
            observation: {
              provider: "kaix",
              sourceId: req.source.id,
              sourceObservedAt: now,
              fetchedAt: now,
              timeBasis: "provider_snapshot",
              maturity: "unknown",
              metrics: { "reddit.score": 99, "reddit.num_comments": 12 },
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

test("Stage 2 one-off research loop: on-demand targets, queryHints, diagnostics, visibility, publish/fork/move/discard, export", async (t) => {
  const db = await testDatabase();
  t.after(db.close);

  const mfaKey = randomUUID().replace(/-/g, "").slice(0, 32);
  const keyBuf = Buffer.from(mfaKey, "utf8");
  const password = "fixture-password-123";
  await bootstrapOwner(db.pool, password, "owner@stage2.test");
  const ownerId = (await db.pool.query<{ id: string }>("SELECT id FROM app_user WHERE email='owner@stage2.test'")).rows[0].id;
  const seed = Buffer.alloc(20, 9);
  await provisionMfa(db.pool, ownerId, seed, keyBuf, Math.floor(Date.now() / 30000) - 1, false);

  const observedTargets: Array<Record<string, unknown>> = [];
  const kaixActive = makeMockKaix(true, (target) => observedTargets.push(target));

  const app = await buildApp({
    pool: db.pool,
    origin: ORIGIN,
    sessionSecret: "stage2-research-secret".repeat(3),
    providers: [kaixActive],
    mfa: { key: keyBuf, required: true },
    secureCookies: false,
    publicRegistration: true,
  });
  t.after(() => app.close());

  const loginOwner = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    headers: { origin: ORIGIN },
    payload: { email: "owner@stage2.test", password },
  });
  const { challenge } = loginOwner.json<{ challenge: string }>();
  const code = fixtureCode(seed, Math.floor(Date.now() / 30000));
  const mfaRes = await app.inject({
    method: "POST",
    url: "/v1/auth/mfa/complete",
    headers: { origin: ORIGIN },
    payload: { challenge, code },
  });
  const ownerCookie = mfaRes.headers["set-cookie"]!.toString().split(";")[0];
  const ownerHeaders = { cookie: ownerCookie, origin: ORIGIN };

  // Enable kaix budget
  const bRes = await app.inject({ method: "GET", url: "/v1/sources/budgets", headers: { cookie: ownerCookie } });
  const kaixRev = bRes.json().budgets.find((b: { provider: string; revision: number }) => b.provider === "kaix").revision;
  const putBudget = await app.inject({
    method: "PUT",
    url: "/v1/sources/budgets/kaix",
    headers: ownerHeaders,
    payload: {
      enabled: true, dailyRequests: 100, monthlyRequests: 1000,
      dailyResources: 5000, monthlyResources: 50000, minimumIntervalMs: 0, revision: kaixRev,
    },
  });
  assert.equal(putBudget.statusCode, 200, putBudget.body);

  // Register Viewer A and Viewer B
  const regA = await app.inject({
    method: "POST", url: "/v1/auth/register", headers: { origin: ORIGIN },
    payload: { email: "viewera@stage2.test", password: "fixture-password-123" },
  });
  assert.equal(regA.statusCode, 200);
  const viewerACookie = regA.headers["set-cookie"]!.toString().split(";")[0];
  const viewerAHeaders = { cookie: viewerACookie, origin: ORIGIN };

  // Upgrade Viewer A to pro tier & configure pro plan policy
  const viewerAId = (await db.pool.query<{ id: string }>("SELECT id FROM app_user WHERE email='viewera@stage2.test'")).rows[0].id;
  await db.pool.query("UPDATE app_user SET plan_tier='pro' WHERE id=$1", [viewerAId]);
  const quotasRes = await app.inject({ method: "GET", url: "/v1/quotas/summary", headers: { cookie: ownerCookie } });
  const proRev = quotasRes.json().planPolicies.find((p: { planTier: string; revision: number }) => p.planTier === "pro").revision;
  const putPro = await app.inject({
    method: "PUT",
    url: "/v1/quotas/plans/pro",
    headers: ownerHeaders,
    payload: {
      manualCollectEnabled: true,
      maxProjects: 10,
      maxLookbackDays: 30,
      allowProviderChoice: true,
      exportEnabled: true,
      allowedProviders: ["kaix"],
      allowedSourceIds: null,
      dailyRequests: 20,
      dailyResources: 1000,
      maxBatchLimit: 100,
      maxCommentsPerPost: 15,
      revision: proRev,
    },
  });
  assert.equal(putPro.statusCode, 200, putPro.body);

  // 1. Default visibility = 'private' even for owner-created projects (AUD-09)
  const ownerPrivateRes = await app.inject({
    method: "POST",
    url: "/v1/projects",
    headers: ownerHeaders,
    payload: { name: "Owner Private Draft", datasetMode: "batch", sourceIds: [] },
  });
  assert.equal(ownerPrivateRes.statusCode, 200, ownerPrivateRes.body);
  const ownerPrivate = ownerPrivateRes.json();
  assert.equal(ownerPrivate.visibility, "private");
  assert.equal(ownerPrivate.is_shared, false);
  const viewerCannotReadPrivate = await app.inject({
    method: "GET",
    url: `/v1/projects/${ownerPrivate.id}`,
    headers: { cookie: viewerACookie },
  });
  assert.equal(viewerCannotReadPrivate.statusCode, 404);

  // 2. Viewer A creates two private batch projects -> preview unregistered r/machinelearning -> on_demand_available + queryHints!
  const projA1 = (await app.inject({
    method: "POST", url: "/v1/projects", headers: viewerAHeaders,
    payload: { name: "Viewer Study 1", datasetMode: "batch", sourceIds: [] },
  })).json();
  const projA2 = (await app.inject({
    method: "POST", url: "/v1/projects", headers: viewerAHeaders,
    payload: { name: "Viewer Study 2", datasetMode: "batch", sourceIds: [] },
  })).json();

  const fromIso = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const toIso = new Date().toISOString();
  const previewRes = await app.inject({
    method: "POST",
    url: "/v1/research/collection-plans/preview",
    headers: viewerAHeaders,
    payload: {
      projectId: projA1.id,
      platform: "reddit",
      targetType: "community",
      targetValue: "r/MachineLearning",
      from: fromIso,
      to: toIso,
      limit: 10,
      queryHints: { sort: "top", minLikes: 5 },
    },
  });
  assert.equal(previewRes.statusCode, 200, previewRes.body);
  const preview = previewRes.json();
  assert.equal(preview.resolutionStatus, "on_demand_available", JSON.stringify(preview));
  assert.equal(preview.executable, true);
  assert.equal(preview.fieldPolicy.canUseFallback, true);
  assert.ok(preview.fieldPolicy.supportedFilters.sortOptions.includes("top"));

  // Collect via on-demand endpoint with queryHints
  const collectRes = await app.inject({
    method: "POST",
    url: "/v1/research/collection-plans/collect",
    headers: { ...viewerAHeaders, "idempotency-key": "ondemand-1" },
    payload: {
      projectId: projA1.id,
      platform: "reddit",
      targetType: "community",
      targetValue: "r/MachineLearning",
      from: fromIso,
      to: toIso,
      limit: 10,
      queryHints: { sort: "top", minLikes: 5 },
    },
  });
  assert.equal(collectRes.statusCode, 200, collectRes.body);
  const { jobId, sourceId: onDemandSourceId } = collectRes.json<{ jobId: string; sourceId: string }>();
  assert.ok(jobId && onDemandSourceId);

  // Worker runs the job, merges queryHints onto in-memory target, attaches private batch to projA1
  assert.equal(await workOnce(db.pool, [kaixActive], undefined, undefined, { onProjectBatchCommitted: attachBatchToProjectInTx }), true);
  const jobRow = (await db.pool.query("SELECT status, error, records_processed, request_json FROM source_collection_job WHERE id=$1", [jobId])).rows[0];
  assert.equal(jobRow.status, "succeeded", JSON.stringify(jobRow));
  assert.equal(observedTargets[0]?.sort, "top");
  assert.equal(observedTargets[0]?.minLikes, 5);

  const batchesA1 = (await app.inject({
    method: "GET", url: `/v1/projects/${projA1.id}/batches`, headers: { cookie: viewerACookie },
  })).json().batches as Array<{ batchId: string; visibility: string }>;
  assert.equal(batchesA1.length, 1, JSON.stringify({ jobRow, batchesA1 }));
  assert.equal(batchesA1[0].visibility, "private");
  const batchId = batchesA1[0].batchId;

  // 3. Full Project Export (T06 B07): CSV and JSON on projA1
  const exportCsv = await app.inject({
    method: "GET",
    url: `/v1/content/export?projectId=${projA1.id}&format=csv&maxRows=10000`,
    headers: { cookie: viewerACookie },
  });
  assert.equal(exportCsv.statusCode, 200, exportCsv.body);
  assert.match(exportCsv.body, /Collected/);
  const exportJson = await app.inject({
    method: "GET",
    url: `/v1/content/export?projectId=${projA1.id}&format=json&maxRows=10000`,
    headers: { cookie: viewerACookie },
  });
  assert.equal(exportJson.statusCode, 200, exportJson.body);
  assert.equal(JSON.parse(exportJson.body).items.length, 1);

  // Moving must not silently re-enable an existing destination membership.
  await db.pool.query(
    "INSERT INTO monitor_project_batch(project_id,batch_id,status) VALUES($1,$2,'disabled')",
    [projA2.id, batchId],
  );
  // 4. Atomic Move batch from projA1 -> projA2 (AUD-11)
  const moveRes = await app.inject({
    method: "POST",
    url: `/v1/projects/${projA1.id}/batches/${batchId}/move`,
    headers: viewerAHeaders,
    payload: { targetProjectId: projA2.id },
  });
  assert.equal(moveRes.statusCode, 200, moveRes.body);
  assert.equal((await app.inject({ method: "GET", url: `/v1/projects/${projA1.id}/batches`, headers: { cookie: viewerACookie } })).json().batches.length, 0);
  assert.equal((await app.inject({ method: "GET", url: `/v1/projects/${projA2.id}/batches`, headers: { cookie: viewerACookie } })).json().batches.length, 1);

  await t.test("moving preserves the destination's disabled decision", async () => {
    const { rows: [membership] } = await db.pool.query(
      "SELECT status FROM monitor_project_batch WHERE project_id=$1 AND batch_id=$2",
      [projA2.id, batchId],
    );
    assert.equal(membership.status, "disabled");
  });

  // 5. Private Batch Soft-Discard removes from projects & hides from /v1/batches; Shared cannot be discarded (AUD-11)
  const delBatch = await app.inject({
    method: "DELETE", url: `/v1/batches/${batchId}`, headers: viewerAHeaders,
  });
  assert.equal(delBatch.statusCode, 200, delBatch.body);
  assert.equal((await app.inject({ method: "GET", url: `/v1/projects/${projA2.id}/batches`, headers: { cookie: viewerACookie } })).json().batches.length, 0);

  await t.test("discard never publishes private canonical content", async () => {
    for (const visibility of [
      contentVisibility({ role: "viewer", userId: randomUUID() }),
      contentVisibility(undefined, { publicOnly: true }),
    ]) {
      const values: unknown[] = [batchId];
      const condition = visibility.contains(value => `$${values.push(value)}`, "c.id");
      const visible = await db.pool.query(
        `SELECT c.id FROM content c JOIN collection_batch_item i ON i.content_id=c.id
         WHERE i.batch_id=$1 AND ${condition}`,
        values,
      );
      assert.equal(visible.rowCount, 0, "discard is not consent to share");
    }
  });

  // 6. Owner creates a shared source_filter project -> Viewer A forks it at 0 API cost (AUD-08)
  const sharedFilterRes = await app.inject({
    method: "POST",
    url: "/v1/projects",
    headers: ownerHeaders,
    payload: {
      name: "Shared Topic Feed",
      datasetMode: "source_filter",
      visibility: "shared",
      sourceIds: [onDemandSourceId],
    },
  });
  assert.equal(sharedFilterRes.statusCode, 200, sharedFilterRes.body);
  const sharedProj = sharedFilterRes.json();

  const forkRes = await app.inject({
    method: "POST",
    url: `/v1/projects/${sharedProj.id}/fork`,
    headers: viewerAHeaders,
    payload: { name: "My Forked Copy" },
  });
  assert.equal(forkRes.statusCode, 200, forkRes.body);
  const forked = forkRes.json();
  assert.equal(forked.visibility, "private");
  assert.equal(forked.can_edit, true);
  assert.equal(forked.forked_from_project_id, sharedProj.id);
  assert.equal(forked.dataset_mode, "batch");

  // Shared project CANNOT be soft-discarded or overwritten by viewer; viewer gets bypassPlanLimits=false
  const quotaSummary = await app.inject({
    method: "GET", url: "/v1/quotas/summary", headers: { cookie: viewerACookie },
  });
  assert.equal(quotaSummary.statusCode, 200, quotaSummary.body);
  assert.equal(quotaSummary.json().bypassPlanLimits, false);
  assert.equal(quotaSummary.json().effectivePolicy.allowProviderChoice, true);
  assert.equal(quotaSummary.json().effectiveCapabilities.canManagePlanPolicies, false);

  // Publish / unpublish private project via admin MFA endpoint
  const pubRes = await app.inject({
    method: "POST",
    url: `/v1/projects/${ownerPrivate.id}/publish`,
    headers: ownerHeaders,
    payload: { visibility: "shared", revision: ownerPrivate.revision },
  });
  assert.equal(pubRes.statusCode, 200, pubRes.body);
  assert.equal(pubRes.json().visibility, "shared");
  const viewerSeesPublished = await app.inject({
    method: "GET", url: `/v1/projects/${ownerPrivate.id}`, headers: { cookie: viewerACookie },
  });
  assert.equal(viewerSeesPublished.statusCode, 200);

  const ownerQuota = await app.inject({
    method: "GET", url: "/v1/quotas/summary", headers: { cookie: ownerCookie },
  });
  assert.equal(ownerQuota.json().bypassPlanLimits, true);

  // 7. Granular diagnostic: offline app reports network_disabled (or credential_missing when network is enabled)
  const kaixOffline = makeMockKaix(false);
  const appOffline = await buildApp({
    pool: db.pool,
    origin: ORIGIN,
    sessionSecret: "stage2-research-secret".repeat(3),
    providers: [kaixOffline],
    secureCookies: false,
  });
  t.after(() => appOffline.close());
  const offPrev = await appOffline.inject({
    method: "POST",
    url: "/v1/research/collection-plans/preview",
    headers: viewerAHeaders,
    payload: {
      projectId: projA1.id,
      platform: "reddit",
      targetType: "community",
      targetValue: "r/python",
      from: fromIso,
      to: toIso,
      limit: 5,
    },
  });
  assert.equal(offPrev.statusCode, 200, offPrev.body);
  assert.ok(
    offPrev.json().restrictions.includes("network_disabled") || offPrev.json().restrictions.includes("credential_missing"),
  );
});
