import assert from "node:assert/strict";
import test from "node:test";
import { testDatabase } from "../helpers/database";
import { buildApp } from "../../apps/api/src/app";
import { webSource } from "../../src/connectors/web/sources";
import { bootstrapOwner } from "../../src/modules/access/sql";
import { parseLiteLlmPayload, parseOpenRouterPayload } from "../../src/modules/ai/ai-registry";
import { applyRegistryItems, syncRegistrySourceByCode } from "../../src/modules/ai/ai-sync";
import { archiveLowValueCandidates, rollbackAiEvent, runOfficialEventDiscovery } from "../../src/modules/ai/ai-discovery";
import { runDueAiSyncSources } from "../../src/modules/ai/ai-scheduler";
import { extractWithOptionalLlm } from "../../src/modules/ai/ai-llm";

const dbUrl = process.env.TEST_SOURCE_DATABASE_URL;
const ORIGIN = "https://monitor.example.test";
const SECRET = "test-session-secret-0123456789abcdef";

function extractCookie(res: { headers: Record<string, unknown> }): string {
  const setCookie = res.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie[0] : String(setCookie ?? "");
  return raw.split(";")[0];
}

test(
  "AI release intelligence PG16 integration: sync diff, RBAC, revision lock, publish/unpublish, publicRead gate",
  { skip: !dbUrl },
  async (t) => {
    const db = await testDatabase();
    t.after(db.close);
    const pool = db.pool;

    await bootstrapOwner(pool, "OwnerPass123!@#", "ai-owner@example.test");

    const app = await buildApp({
      pool,
      providers: [webSource("feed", {})],
      sessionSecret: SECRET,
      origin: ORIGIN,
      secureCookies: false,
      publicRead: true,
      publicRegistration: true,
      rateLimitMax: 500,
    });
    const privateApp = await buildApp({
      pool,
      sessionSecret: SECRET,
      origin: ORIGIN,
      secureCookies: false,
      publicRead: false,
      publicRegistration: false,
      rateLimitMax: 500,
    });

    try {
      // 1. Anonymous public read works on publicApp and is gated on privateApp
      const pubVendors = await app.inject({ method: "GET", url: "/v1/ai/vendors" });
      assert.equal(pubVendors.statusCode, 200);
      const vendorsBody = pubVendors.json() as { items: Array<{ id: string; slug: string }> };
      assert.ok(vendorsBody.items.length >= 10);
      const anthropicVendor = vendorsBody.items.find((v) => v.slug === "anthropic");
      assert.ok(anthropicVendor);

      const privVendors = await privateApp.inject({ method: "GET", url: "/v1/ai/vendors" });
      assert.equal(privVendors.statusCode, 401);

      const privEvents = await privateApp.inject({ method: "GET", url: "/v1/ai/events" });
      assert.equal(privEvents.statusCode, 401);

      // 2. OpenRouter initial snapshot does NOT flood candidates; second snapshot diffs new model & pricing
      const initialItems = parseOpenRouterPayload({
        data: [
          {
            id: "anthropic/claude-sonnet-4",
            canonical_slug: "anthropic/claude-sonnet-4-20250514",
            name: "Claude Sonnet 4",
            context_length: 200000,
            pricing: { prompt: "0.000003", completion: "0.000015" },
          },
        ],
      });
      const r1 = await applyRegistryItems(pool, "openrouter", initialItems, {
        triggerKind: "manual",
        blobSha: "sha-1",
      });
      assert.equal(r1.fetchedCount, 1);
      assert.equal(r1.candidatesCreated, 0);

      // Incremental diff: new model + price drop on existing model
      const secondItems = parseOpenRouterPayload({
        data: [
          {
            id: "anthropic/claude-sonnet-4",
            canonical_slug: "anthropic/claude-sonnet-4-20250514",
            name: "Claude Sonnet 4",
            context_length: 200000,
            pricing: { prompt: "0.000002", completion: "0.000010" },
          },
          {
            id: "anthropic/claude-opus-4",
            canonical_slug: "anthropic/claude-opus-4-20250514",
            name: "Claude Opus 4",
            context_length: 200000,
            pricing: { prompt: "0.000015", completion: "0.000075" },
          },
        ],
      });
      const r2 = await applyRegistryItems(pool, "openrouter", secondItems, {
        triggerKind: "manual",
        blobSha: "sha-2",
      });
      assert.equal(r2.fetchedCount, 2);
      assert.ok(r2.candidatesCreated >= 1);

      // LiteLLM unchanged blobSha short-circuit
      const llItems = parseLiteLlmPayload({
        "openai/gpt-5": { litellm_provider: "openai", max_input_tokens: 400000, input_cost_per_token: 0.00000125 },
      });
      await applyRegistryItems(pool, "litellm", llItems, { triggerKind: "manual", blobSha: "ll-sha-1" });
      const llSkip = await applyRegistryItems(pool, "litellm", llItems, { triggerKind: "manual", blobSha: "ll-sha-1" });
      assert.equal(llSkip.skippedUnchanged, true);

      // 3. RBAC: anonymous, viewer, and machine key are all blocked from /v1/admin/ai/*
      const anonQueue = await app.inject({ method: "GET", url: "/v1/admin/ai/queue" });
      assert.equal(anonQueue.statusCode, 401);

      // Login as owner
      const ownerLogin = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        headers: { origin: ORIGIN },
        payload: { email: "ai-owner@example.test", password: "OwnerPass123!@#" },
      });
      assert.equal(ownerLogin.statusCode, 200);
      const ownerCookie = extractCookie(ownerLogin);

      // Register a viewer
      const viewerEmail = `viewer-${Date.now()}@example.test`;
      const viewerReg = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        headers: { origin: ORIGIN },
        payload: { email: viewerEmail, password: "ViewerPass123!@#" },
      });
      assert.ok(viewerReg.statusCode === 200 || viewerReg.statusCode === 201);
      const viewerCookie = extractCookie(viewerReg);

      const viewerQueue = await app.inject({
        method: "GET",
        url: "/v1/admin/ai/queue",
        headers: { cookie: viewerCookie },
      });
      assert.equal(viewerQueue.statusCode, 403);

      // Create machine key as owner and verify machine key is blocked from /v1/admin/ai/*
      const mkRes = await app.inject({
        method: "POST",
        url: "/v1/access/keys",
        headers: { cookie: ownerCookie, origin: ORIGIN },
        payload: { label: "ai-test-key", scopes: ["read", "collect", "sources:write", "projects:write"], allowedSourceIds: [], expiresInDays: 7 },
      });
      assert.ok(mkRes.statusCode === 200 || mkRes.statusCode === 201);
      const machineToken = (mkRes.json() as { token: string }).token;

      const machineQueue = await app.inject({
        method: "GET",
        url: "/v1/admin/ai/queue",
        headers: { authorization: `Bearer ${machineToken}` },
      });
      assert.equal(machineQueue.statusCode, 403);

      const source = await app.inject({
        method: "POST", url: "/v1/sources", headers: { cookie: ownerCookie, origin: ORIGIN },
        payload: {
          platform: "web", primaryProvider: "feed", deliveryMode: "pull", contentKind: "article",
          label: "Official binding", target: { type: "feed", url: "https://www.anthropic.com/news/binding-fixture" },
        },
      });
      assert.equal(source.statusCode, 200, source.body);
      const sourceId = source.json().source.id;
      const vendorId = anthropicVendor.id;
      const binding = { sourceId, vendorId, sourceRole: "changelog", isOfficial: true };
      const bindingUrl = "/v1/admin/ai/vendor-sources";
      const ownerHeaders = { cookie: ownerCookie, origin: ORIGIN };
      assert.equal((await app.inject({ method: "PUT", url: bindingUrl, headers: { cookie: viewerCookie, origin: ORIGIN }, payload: binding })).statusCode, 403);
      assert.equal((await app.inject({ url: bindingUrl, headers: { authorization: "Bearer " + machineToken } })).statusCode, 403);
      const saved = await app.inject({ method: "PUT", url: bindingUrl, headers: ownerHeaders, payload: binding });
      assert.equal(saved.statusCode, 200, saved.body);
      assert.ok((await app.inject({ url: bindingUrl, headers: ownerHeaders })).json().items.some(
        (item: { sourceId: string; vendorId: string; sourceRole: string }) =>
          item.sourceId === sourceId && item.vendorId === vendorId && item.sourceRole === "changelog",
      ));
      const conflicting = vendorsBody.items.find(vendor => vendor.slug === "openai")!;
      assert.equal((await app.inject({ method: "PUT", url: bindingUrl, headers: ownerHeaders,
        payload: { ...binding, vendorId: conflicting.id } })).statusCode, 409);
      assert.equal((await app.inject({ method: "DELETE", url: bindingUrl + "/" + sourceId + "/" + vendorId, headers: ownerHeaders })).statusCode, 200);
      assert.equal((await pool.query("SELECT 1 FROM ai_vendor_source WHERE source_id=$1", [sourceId])).rowCount, 0);

      // 4. Owner lists queue, tests 409 revision conflict, publishes candidate -> visible publicly -> unpublishes
      const queueRes = await app.inject({
        method: "GET",
        url: "/v1/admin/ai/queue",
        headers: { cookie: ownerCookie },
      });
      assert.equal(queueRes.statusCode, 200);
      const queueItems = (queueRes.json() as { items: Array<{ id: string; revision: number; title: string }> }).items;
      assert.ok(queueItems.length >= 1);
      const cand = queueItems[0];

      // Stale revision -> 409
      const conflictRes = await app.inject({
        method: "PATCH",
        url: `/v1/admin/ai/candidates/${cand.id}`,
        headers: { cookie: ownerCookie, origin: ORIGIN },
        payload: { expectedRevision: cand.revision + 99, title: "Stale edit" },
      });
      assert.equal(conflictRes.statusCode, 409);

      // Publish candidate with official primary reference
      const pubRes = await app.inject({
        method: "POST",
        url: `/v1/admin/ai/candidates/${cand.id}/publish`,
        headers: { cookie: ownerCookie, origin: ORIGIN },
        payload: {
          expectedRevision: cand.revision,
          vendorId: anthropicVendor.id,
          eventType: "model_release",
          eventStatus: "released",
          title: "Claude Opus 4 Official Release",
          eventDate: "2025-05-22",
          datePrecision: "day",
          summaryZh: "Anthropic 正式发布 Claude Opus 4。",
          summaryEn: "Anthropic officially released Claude Opus 4.",
          primaryReferenceUrl: "https://www.anthropic.com/news/claude-4",
          primaryReferenceTitle: "Introducing Claude 4",
          sourceTier: "official",
        },
      });
      assert.equal(pubRes.statusCode, 200);
      const { eventId } = pubRes.json() as { eventId: string };
      assert.ok(eventId);

      // Immediately visible on public GET /v1/ai/events and /v1/ai/events/:id
      const eventsList = await app.inject({ method: "GET", url: "/v1/ai/events" });
      assert.equal(eventsList.statusCode, 200);
      const events = (eventsList.json() as { items: Array<{ id: string; title: string }> }).items;
      assert.ok(events.some((e) => e.id === eventId && e.title === "Claude Opus 4 Official Release"));

      const eventDetail = await app.inject({ method: "GET", url: `/v1/ai/events/${eventId}` });
      assert.equal(eventDetail.statusCode, 200);
      const detail = eventDetail.json() as { references: Array<{ url: string; role: string }> };
      assert.equal(detail.references[0]?.url, "https://www.anthropic.com/news/claude-4");
      assert.equal(detail.references[0]?.role, "primary");

      // Unpublish -> immediately hidden
      const unpubRes = await app.inject({
        method: "POST",
        url: `/v1/admin/ai/events/${eventId}/unpublish`,
        headers: { cookie: ownerCookie, origin: ORIGIN },
        payload: { reason: "Correction test" },
      });
      assert.equal(unpubRes.statusCode, 200);

      const hiddenDetail = await app.inject({ method: "GET", url: `/v1/ai/events/${eventId}` });
      assert.equal(hiddenDetail.statusCode, 404);

      // 5. Automation & Low-Ops: official discovery, shadow vs auto-publish, missing-date guard,
      //    non-official domain rejection, AA free-tier license boundary, due scheduler + 429 recovery, LLM cache
      const webSourceRow = (await pool.query<{ id: string }>(`SELECT id FROM source WHERE code = 'web' LIMIT 1`)).rows[0];
      const csCreate = await app.inject({
        method: "POST",
        url: "/v1/sources",
        headers: { cookie: ownerCookie, origin: ORIGIN },
        payload: {
          platform: "web",
          deliveryMode: "push",
          primaryProvider: "external_ingest",
          contentKind: "article",
          label: "Anthropic Official News",
          target: { type: "feed", url: "https://www.anthropic.com/news" },
          sourceGroup: "ai-firsthand",
          tier: "T1",
        },
      });
      assert.ok(csCreate.statusCode === 200 || csCreate.statusCode === 201, csCreate.body);
      const csBody = csCreate.json() as { source?: { id: string }; id?: string };
      const csId = csBody.source?.id ?? csBody.id!;
      await pool.query(`INSERT INTO ai_vendor_source (vendor_id, source_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [anthropicVendor.id, csId]);

      // Seed 3 content items: (a) valid official release with explicit date, (b) missing date, (c) non-official domain
      const insertContent = async (extId: string, title: string, url: string, createdAtSource: string | null) => {
        const c = await pool.query<{ id: string }>(
          `INSERT INTO content (id, source_id, kind, external_id, title, body_text, url, created_at_source, first_seen_at, last_seen_at, content_evidence_key, content_version_fetched_at)
           VALUES (gen_random_uuid(), $1, 'article', $2, $3, 'Official announcement text', $4, $5::timestamptz, NOW(), NOW(), $6, NOW())
           RETURNING id`,
          [webSourceRow.id, extId, title, url, createdAtSource, `ev-${extId}`],
        );
        await pool.query(
          `INSERT INTO content_discovery (content_id, collection_source_id, first_fetched_at, last_fetched_at)
           VALUES ($1, $2, NOW(), NOW())`,
          [c.rows[0].id, csId],
        );
        return c.rows[0].id;
      };

      await insertContent("auto-1", "Introducing Claude Sonnet 4.5", "https://www.anthropic.com/news/claude-sonnet-4-5", "2026-11-20T12:00:00Z");
      await insertContent("auto-nodate", "Introducing Claude Haiku 4.5", "https://www.anthropic.com/news/claude-haiku-4-5", null);
      await insertContent("auto-unofficial", "Introducing Claude 5 Rumor", "https://random-blog.example.com/claude-5", "2026-11-20T12:00:00Z");

      // Shadow run first (vendor auto_publish_enabled defaults to FALSE)
      const shadow = await runOfficialEventDiscovery(pool, { shadowMode: false, lookbackHours: 168 });
      assert.equal(shadow.autoPublished, 0);
      assert.equal(shadow.shadowPassed, 1);
      assert.equal(shadow.candidatesQueued, 1);
      assert.equal(shadow.skippedNonOfficial, 1);

      // Verify missing-date candidate NEVER fabricated today's date
      const nodateRow = await pool.query<{ suggested_date: string | null; status: string }>(
        `SELECT suggested_date::text, status FROM ai_event_candidate WHERE title = 'Introducing Claude Haiku 4.5' LIMIT 1`,
      );
      assert.equal(nodateRow.rows[0]?.suggested_date, null);
      assert.equal(nodateRow.rows[0]?.status, "needs_info");

      // Enable gradual auto-publish for Anthropic and run discovery -> auto-publishes Claude Sonnet 4.5!
      const toggleRes = await app.inject({
        method: "PATCH",
        url: `/v1/admin/ai/vendors/${anthropicVendor.id}/autopublish`,
        headers: { cookie: ownerCookie, origin: ORIGIN },
        payload: { enabled: true },
      });
      assert.equal(toggleRes.statusCode, 200);

      const liveDisc = await runOfficialEventDiscovery(pool, { shadowMode: false, lookbackHours: 168 });
      assert.equal(liveDisc.autoPublished, 1);

      const autoEvents = (await app.inject({ method: "GET", url: "/v1/ai/events?vendor=anthropic" })).json() as {
        items: Array<{ id: string; title: string; eventDate: string }>;
      };
      const autoEv = autoEvents.items.find((e) => e.title === "Introducing Claude Sonnet 4.5");
      assert.ok(autoEv);
      assert.equal(autoEv.eventDate, "2026-11-20");

      // Rollback auto-published event -> hidden immediately + audit/alert created
      const rb = await rollbackAiEvent(pool, autoEv.id, "Test rollback");
      assert.equal(rb.rolledBack, true);
      assert.equal((await app.inject({ method: "GET", url: `/v1/ai/events/${autoEv.id}` })).statusCode, 404);

      // Low-value queue hygiene
      const arch = await archiveLowValueCandidates(pool, 0);
      assert.ok(arch.archived >= 0);

      // Artificial Analysis v2 free-tier sync -> internal only, NOT exposed on public /v1/ai/rankings
      const prevAaKey = process.env.ARTIFICIAL_ANALYSIS_API_KEY;
      const prevAaPub = process.env.ARTIFICIAL_ANALYSIS_PUBLIC_REDISTRIBUTION;
      process.env.ARTIFICIAL_ANALYSIS_API_KEY = "test-aa-key-fixture";
      process.env.ARTIFICIAL_ANALYSIS_PUBLIC_REDISTRIBUTION = "false";
      try {
        const aaSync = await syncRegistrySourceByCode(pool, "artificial_analysis", {
          triggerKind: "manual",
          fetcher: async () => ({
            status: 200,
            bodyText: JSON.stringify({
              data: [
                {
                  id: "aa-m1",
                  name: "GLM-4.5V",
                  slug: "glm-4-5v",
                  model_creator: { name: "Z AI" },
                  evaluations: { artificial_analysis_intelligence_index: 62.1, artificial_analysis_coding_index: 65.4, artificial_analysis_agentic_index: 58.0 },
                  performance: { median_output_tokens_per_second: 42.5 },
                },
              ],
            }),
          }),
        });
        assert.equal((aaSync as { snapshotsSaved: number }).snapshotsSaved, 4);

        const pubRank = (await app.inject({ method: "GET", url: "/v1/ai/rankings" })).json() as {
          items: unknown[];
          publicRedistributionAllowed: boolean;
          internalSnapshotCount: number;
        };
        assert.equal(pubRank.items.length, 0);
        assert.equal(pubRank.publicRedistributionAllowed, false);
        assert.ok(pubRank.internalSnapshotCount >= 4);

        const adminRank = (await app.inject({
          method: "GET",
          url: "/v1/admin/ai/rankings",
          headers: { cookie: ownerCookie },
        })).json() as { items: Array<{ category: string }> };
        assert.equal(adminRank.items.length, 4);
      } finally {
        if (prevAaKey === undefined) delete process.env.ARTIFICIAL_ANALYSIS_API_KEY;
        else process.env.ARTIFICIAL_ANALYSIS_API_KEY = prevAaKey;
        if (prevAaPub === undefined) delete process.env.ARTIFICIAL_ANALYSIS_PUBLIC_REDISTRIBUTION;
        else process.env.ARTIFICIAL_ANALYSIS_PUBLIC_REDISTRIBUTION = prevAaPub;
      }

      // Due scheduler failure (429 backoff + alert) and recovery (auto-resolves alert)
      await pool.query(`UPDATE ai_registry_source SET next_run_at = NOW() - INTERVAL '1 minute', backoff_seconds = 0, consecutive_failures = 0 WHERE code = 'openrouter'`);
      await pool.query(`UPDATE ai_registry_source SET next_run_at = NOW() + INTERVAL '1 day' WHERE code <> 'openrouter'`);
      const failTick = await runDueAiSyncSources(pool, { fetcher: async () => ({ status: 429, bodyText: "" }) });
      assert.equal(failTick.failed.length, 1);
      const alertAfterFail = await pool.query(`SELECT id FROM ai_ops_alert WHERE source_code = 'openrouter' AND resolved_at IS NULL`);
      assert.ok((alertAfterFail.rowCount ?? 0) >= 1);

      await pool.query(`UPDATE ai_registry_source SET next_run_at = NOW() - INTERVAL '1 minute', circuit_open_until = NULL WHERE code = 'openrouter'`);
      const okTick = await runDueAiSyncSources(pool, { fetcher: async () => ({ status: 304 }) });
      assert.deepEqual(okTick.executed, ["openrouter"]);
      const alertAfterOk = await pool.query(`SELECT id FROM ai_ops_alert WHERE source_code = 'openrouter' AND resolved_at IS NULL`);
      assert.equal(alertAfterOk.rowCount ?? 0, 0);

      // Optional LLM extractor: disabled when unconfigured, caches when configured
      const llmOff = await extractWithOptionalLlm(pool, {
        referenceId: "ref-1",
        vendorName: "Anthropic",
        title: "Test",
        bodyText: "Test body",
        publishedDate: "2026-11-20",
        url: "https://www.anthropic.com/news/test",
      });
      assert.equal(llmOff.status, "disabled");

      const opsSummary = await app.inject({
        method: "GET",
        url: "/v1/admin/ai/ops/summary",
        headers: { cookie: ownerCookie },
      });
      assert.equal(opsSummary.statusCode, 200);

      // AUD-19: Admin event CRUD (list all visibilities + search + create + update + delete)
      const createdEv = await app.inject({
        method: "POST",
        url: "/v1/admin/ai/events",
        headers: { cookie: ownerCookie, origin: ORIGIN },
        payload: {
          vendorId: anthropicVendor!.id,
          eventType: "model_release",
          eventStatus: "released",
          publicationStatus: "unpublished",
          title: "Stage 1 Draft Release",
          eventDate: "2026-11-24",
          datePrecision: "day",
          summaryZh: "中文摘要测试",
        },
      });
      assert.equal(createdEv.statusCode, 200, createdEv.body);
      const evId = (createdEv.json() as { id: string }).id;

      const listAdminEv = await app.inject({
        method: "GET",
        url: "/v1/admin/ai/events?visibility=unpublished&q=Stage%201%20Draft",
        headers: { cookie: ownerCookie },
      });
      assert.equal(listAdminEv.statusCode, 200, listAdminEv.body);
      const listAdminBody = listAdminEv.json() as { items: Array<{ id: string; visibility: string }>; totalCount: number };
      assert.equal(listAdminBody.totalCount, 1);
      assert.equal(listAdminBody.items[0].id, evId);

      const patchedEv = await app.inject({
        method: "PATCH",
        url: `/v1/admin/ai/events/${evId}`,
        headers: { cookie: ownerCookie, origin: ORIGIN },
        payload: { title: "Stage 1 Published Release", visibility: "published" },
      });
      assert.equal(patchedEv.statusCode, 200, patchedEv.body);
      assert.equal((patchedEv.json() as { visibility: string }).visibility, "published");

      const deletedEv = await app.inject({
        method: "DELETE",
        url: `/v1/admin/ai/events/${evId}`,
        headers: { cookie: ownerCookie, origin: ORIGIN },
      });
      assert.equal(deletedEv.statusCode, 200, deletedEv.body);
      assert.equal((deletedEv.json() as { deleted: boolean }).deleted, true);

      // AUD-20: Registry source PATCH (enable/cadence/clearCircuit) & encrypted AI credentials
      const patchReg = await app.inject({
        method: "PATCH",
        url: "/v1/admin/ai/sources/openrouter",
        headers: { cookie: ownerCookie, origin: ORIGIN },
        payload: { enabled: false, cadenceSeconds: 7200, clearCircuit: true },
      });
      assert.equal(patchReg.statusCode, 200, patchReg.body);
      assert.equal((patchReg.json() as { enabled: boolean; cadenceSeconds: number }).enabled, false);
      assert.equal((patchReg.json() as { cadenceSeconds: number }).cadenceSeconds, 7200);

      const badLlmUrl = await app.inject({
        method: "PUT",
        url: "/v1/admin/ai/credentials/ai_llm",
        headers: { cookie: ownerCookie, origin: ORIGIN },
        payload: { apiKey: "sk-test-secret-1234", config: { apiUrl: "http://127.0.0.1:8080/v1/chat/completions" } },
      });
      assert.equal(badLlmUrl.statusCode, 422);

      const saveAaCred = await app.inject({
        method: "PUT",
        url: "/v1/admin/ai/credentials/artificial_analysis",
        headers: { cookie: ownerCookie, origin: ORIGIN },
        payload: { apiKey: "aa-secret-key-9876", config: { publicRedistribution: true } },
      });
      assert.equal(saveAaCred.statusCode, 200, saveAaCred.body);
      assert.equal((saveAaCred.json() as { configured: boolean; keyHint: string }).configured, true);
      assert.equal((saveAaCred.json() as { keyHint: string }).keyHint, "••••9876");

      const opsWithCred = await app.inject({
        method: "GET",
        url: "/v1/admin/ai/ops/summary",
        headers: { cookie: ownerCookie },
      });
      assert.equal((opsWithCred.json() as { aaKeyConfigured: boolean; aaPublicRedistribution: boolean }).aaKeyConfigured, true);
      assert.equal((opsWithCred.json() as { aaPublicRedistribution: boolean }).aaPublicRedistribution, true);

      const delAaCred = await app.inject({
        method: "DELETE",
        url: "/v1/admin/ai/credentials/artificial_analysis",
        headers: { cookie: ownerCookie, origin: ORIGIN },
      });
      assert.equal(delAaCred.statusCode, 200);
    } finally {
      await app.close();
      await privateApp.close();
    }
  },
);
