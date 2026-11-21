import assert from "node:assert/strict";
import test from "node:test";
import { createPool } from "../../src/storage/db";
import { runMigrations } from "../../src/storage/schema/run-migrations";
import { buildApp } from "../../apps/api/src/app";
import { bootstrapOwner } from "../../src/modules/access/sql";
import { parseLiteLlmPayload, parseOpenRouterPayload } from "../../src/modules/content/ai-registry";
import { applyRegistryItems } from "../../src/modules/content/ai-sync";

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
  async () => {
    const pool = createPool(dbUrl, 6);
    await runMigrations({ pool });
    // Clean AI test tables (keep seeded vendors and registry sources)
    await pool.query(
      `TRUNCATE ai_benchmark_entry, ai_benchmark_snapshot, ai_sync_run, ai_event_reference,
                ai_release_event, ai_event_candidate, ai_model_spec_observation, ai_registry_change,
                ai_registry_listing, ai_model_alias, ai_model RESTART IDENTITY CASCADE`,
    );
    await pool.query(`UPDATE ai_registry_source SET etag = NULL, last_blob_sha = NULL, last_success_at = NULL, consecutive_failures = 0`);

    await bootstrapOwner(pool, "OwnerPass123!@#", "ai-owner@example.test");

    const app = await buildApp({
      pool,
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
    } finally {
      await app.close();
      await privateApp.close();
      await pool.end();
    }
  },
);
