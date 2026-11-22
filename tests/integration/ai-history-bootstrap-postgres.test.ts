import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildApp } from "../../apps/api/src/app";
import { bootstrapOwner } from "../../src/modules/access/sql";
import { runOfficialEventDiscovery } from "../../src/modules/ai/ai-discovery";
import { canonicalEventKey } from "../../src/modules/ai/ai-event-identity";
import { runHistoryBackfill } from "../../src/modules/ai/ai-history-backfill";
import {
  applyHistoryImport,
  planHistoryImport,
  resolveHistoryDatasetDir,
} from "../../src/modules/ai/ai-history-import";
import { parseOpenRouterPayload } from "../../src/modules/ai/ai-registry";
import { applyRegistryItems } from "../../src/modules/ai/ai-sync";
import { testDatabase } from "../helpers/database";

const dbUrl = process.env.TEST_SOURCE_DATABASE_URL;
const ORIGIN = "https://monitor.example.test";
const SECRET = "test-session-secret-0123456789abcdef";

test(
  "AI history bootstrap PG16: seed apply, idempotency, manual edit/unpublish protection, dedupe with discovery/registry, and resumable backfill",
  { skip: !dbUrl },
  async (t) => {
    const db = await testDatabase();
    t.after(db.close);
    const pool = db.pool;

    const datasetDir = resolveHistoryDatasetDir("v1");
    const plan = await planHistoryImport(pool, datasetDir);
    assert.equal(plan.status, "planned");
    assert.ok(plan.insertedEvents >= 60, `Expected >=60 planned events, got ${plan.insertedEvents}`);
    assert.equal(plan.conflicts, 0);

    // 1. First apply on fresh 001..056 PG16 DB
    const first = await applyHistoryImport(pool, datasetDir, { triggerKind: "startup" });
    assert.equal(first.status, "succeeded");
    assert.equal(first.insertedEvents, plan.insertedEvents);
    assert.equal(first.conflicts, 0);

    // 2. Second apply is fast-skipped and idempotent
    const second = await applyHistoryImport(pool, datasetDir, { triggerKind: "startup" });
    assert.equal(second.status, "skipped_unchanged");
    assert.equal(second.insertedEvents, 0);

    // 3. Public API /v1/ai/events returns real seeded events including month precision
    const app = await buildApp({
      pool,
      sessionSecret: SECRET,
      origin: ORIGIN,
      secureCookies: false,
      publicRead: true,
      publicRegistration: false,
      rateLimitMax: 500,
    });
    try {
      const evRes = await app.inject({ method: "GET", url: "/v1/ai/events?limit=100" });
      assert.equal(evRes.statusCode, 200);
      const evBody = evRes.json() as { items: Array<{ id: string; title: string; datePrecision: string }> };
      assert.ok(evBody.items.length >= 60);
      assert.ok(evBody.items.some((e) => e.datePrecision === "month"));

      // 4. Manual edit & unpublish protection on reconcile
      const targetEv = evBody.items[0];
      await pool.query(
        `UPDATE ai_release_event SET summary_en = 'Manual curator edit', publication_status = 'unpublished' WHERE id = $1`,
        [targetEv.id],
      );
      const reconciled = await applyHistoryImport(pool, datasetDir, { triggerKind: "reconcile", reconcile: true });
      assert.equal(reconciled.status, "succeeded");
      assert.ok(reconciled.skippedEvents >= 1);
      const checkEv = await pool.query<{ summary_en: string; publication_status: string }>(
        `SELECT summary_en, publication_status FROM ai_release_event WHERE id = $1`,
        [targetEv.id],
      );
      assert.equal(checkEv.rows[0].summary_en, "Manual curator edit");
      assert.equal(checkEv.rows[0].publication_status, "unpublished");

      // 5. OpenRouter initial snapshot links via verified aliases without flooding candidates
      const orItems = parseOpenRouterPayload({
        data: [
          {
            id: "openai/gpt-5",
            canonical_slug: "openai/gpt-5",
            name: "GPT-5",
            context_length: 400000,
            pricing: { prompt: "0.00000125", completion: "0.00001" },
          },
        ],
      });
      const orRes = await applyRegistryItems(pool, "openrouter", orItems, { triggerKind: "manual", blobSha: "or-1" });
      assert.equal(orRes.candidatesCreated, 0);
      const listing = await pool.query<{ model_id: string | null }>(
        `SELECT model_id FROM ai_registry_listing WHERE external_id = 'openai/gpt-5' LIMIT 1`,
      );
      assert.ok(listing.rows[0]?.model_id, "OpenRouter listing should link to seeded GPT-5 model_id");

      // 6. Seed <-> runOfficialEventDiscovery deduplication (both directions)
      await bootstrapOwner(pool, "OwnerPass123!@#", "ai-history-owner@example.test");
      const loginRes = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        headers: { origin: ORIGIN },
        payload: { email: "ai-history-owner@example.test", password: "OwnerPass123!@#" },
      });
      assert.equal(loginRes.statusCode, 200);
      const cookie = String(loginRes.headers["set-cookie"] ?? "").split(";")[0];
      const csCreate = await app.inject({
        method: "POST",
        url: "/v1/sources",
        headers: { origin: ORIGIN, cookie },
        payload: {
          platform: "web",
          deliveryMode: "push",
          primaryProvider: "external_ingest",
          contentKind: "article",
          label: "OpenAI Official News",
          target: { type: "feed", url: "https://openai.com/news/rss.xml" },
          sourceGroup: "ai-firsthand",
          tier: "T1",
        },
      });
      assert.ok(csCreate.statusCode === 200 || csCreate.statusCode === 201, csCreate.body);
      const csId = (csCreate.json() as { source?: { id: string }; id?: string }).source?.id ?? (csCreate.json() as { id: string }).id;
      const webSourceRow = (await pool.query<{ id: string }>(`SELECT id FROM source LIMIT 1`)).rows[0];
      await pool.query(`UPDATE ai_vendor SET auto_publish_enabled = TRUE WHERE slug = 'openai'`);

      // 6a. Article matching already-seeded GPT-5 event -> must NOT create duplicate event
      const c1 = await pool.query<{ id: string }>(
        `INSERT INTO content (id, source_id, kind, external_id, title, body_text, url, permalink, created_at_source, first_seen_at, last_seen_at, content_evidence_key, content_version_fetched_at)
         VALUES (gen_random_uuid(), $1, 'article', 'openai-gpt5-1', 'Introducing GPT-5', 'OpenAI introduces GPT-5.', 'https://openai.com/index/introducing-gpt-5/?utm_source=test', 'https://openai.com/index/introducing-gpt-5/', '2025-08-07T12:00:00Z', NOW(), NOW(), 'ev-gpt5-1', NOW())
         RETURNING id`,
        [webSourceRow.id],
      );
      await pool.query(
        `INSERT INTO content_discovery (content_id, collection_source_id, first_fetched_at, last_fetched_at) VALUES ($1, $2, NOW(), NOW())`,
        [c1.rows[0].id, csId],
      );
      const countBefore = Number((await pool.query(`SELECT COUNT(*)::int AS c FROM ai_release_event`)).rows[0].c);
      await runOfficialEventDiscovery(pool, { lookbackHours: 24 * 365, shadowMode: false });
      const countAfter = Number((await pool.query(`SELECT COUNT(*)::int AS c FROM ai_release_event`)).rows[0].c);
      assert.equal(countAfter, countBefore, "Discovery must not duplicate seeded GPT-5 event");

      // 6b. Resumable content_history backfill (batch=1, maxItems=1 -> paused -> resume -> succeeded)
      const c2 = await pool.query<{ id: string }>(
        `INSERT INTO content (id, source_id, kind, external_id, title, body_text, url, permalink, created_at_source, first_seen_at, last_seen_at, content_evidence_key, content_version_fetched_at)
         VALUES (gen_random_uuid(), $1, 'article', 'openai-gpt45-1', 'Introducing GPT-4.5 Research Preview', 'New model.', 'https://openai.com/index/introducing-gpt-4-5/', 'https://openai.com/index/introducing-gpt-4-5/', '2025-02-27T12:00:00Z', NOW(), NOW(), 'ev-gpt45-1', NOW())
         RETURNING id`,
        [webSourceRow.id],
      );
      await pool.query(
        `INSERT INTO content_discovery (content_id, collection_source_id, first_fetched_at, last_fetched_at) VALUES ($1, $2, NOW(), NOW())`,
        [c2.rows[0].id, csId],
      );
      const bf1 = await runHistoryBackfill(pool, {
        sourceCode: "content_history",
        vendorSlug: "openai",
        batchSize: 1,
        maxItems: 1,
        autoPublish: false,
      });
      assert.equal(bf1.status, "paused");
      assert.equal(bf1.scanned, 1);

      const bf2 = await runHistoryBackfill(pool, {
        sourceCode: "content_history",
        vendorSlug: "openai",
        batchSize: 5,
        maxItems: 10,
        resume: true,
        autoPublish: false,
      });
      assert.equal(bf2.status, "succeeded");
      assert.ok(bf2.scanned >= 1);

      // 7. Epoch CSV backfill flags YYYY-MM-15 and YYYY-07-01 as suspected padding & keeps in candidates only
      const tmpDir = mkdtempSync(path.join(os.tmpdir(), "epoch-csv-"));
      t.after(() => rmSync(tmpDir, { recursive: true, force: true }));
      const csvPath = path.join(tmpDir, "epoch.csv");
      writeFileSync(
        csvPath,
        [
          "Model,Organization,Publication date,Link",
          "Synthetic Padded Model,OpenAI,2025-06-15,https://example.org/model1",
          "Synthetic Exact Model,Anthropic,2025-05-22,https://example.org/model2",
        ].join("\n"),
      );
      const eventsBeforeEpoch = Number((await pool.query(`SELECT COUNT(*)::int AS c FROM ai_release_event`)).rows[0].c);
      const epRes = await runHistoryBackfill(pool, { sourceCode: "epoch_csv", csvPath });
      assert.equal(epRes.status, "succeeded");
      assert.equal(epRes.candidatesCreated, 2);
      assert.equal(epRes.published, 0);
      const eventsAfterEpoch = Number((await pool.query(`SELECT COUNT(*)::int AS c FROM ai_release_event`)).rows[0].c);
      assert.equal(eventsAfterEpoch, eventsBeforeEpoch, "Epoch CSV must never write directly to ai_release_event");

      const paddedCand = await pool.query<{ date_precision: string; suggested_date: string | null; draft_payload: { suspectedPadding: boolean } }>(
        `SELECT date_precision, suggested_date::text, draft_payload FROM ai_event_candidate WHERE external_id = 'Synthetic Padded Model'`,
      );
      assert.equal(paddedCand.rows[0].date_precision, "unknown");
      assert.equal(paddedCand.rows[0].suggested_date, null);
      assert.equal(paddedCand.rows[0].draft_payload.suspectedPadding, true);

      // Verify shared canonicalEventKey matches DB dedupe_key
      const expectedKey = canonicalEventKey({
        vendorSlug: "openai",
        eventType: "model_release",
        modelNameOrTitle: "GPT-5",
        date: "2025-08-07",
      });
      const seededGpt5 = await pool.query<{ dedupe_key: string }>(
        `SELECT dedupe_key FROM ai_release_event WHERE dedupe_key = $1`,
        [expectedKey],
      );
      assert.equal(seededGpt5.rows.length, 1);
    } finally {
      await app.close();
    }
  },
);
