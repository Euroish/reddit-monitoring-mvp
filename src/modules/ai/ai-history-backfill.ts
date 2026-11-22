import type { Pool, PoolClient } from "pg";
import { transaction } from "../../storage/db";
import { listAiFirsthandArticles } from "../content/index";
import { classifyOfficialAnnouncement } from "./ai-discovery";
import {
  buildModelSlug,
  canonicalEventKey,
  canonicalizeSourceUrl,
  matchExistingRelease,
  normalizeVendorSlug,
} from "./ai-event-identity";
import {
  runEpochCsvBackfill,
  runOfficialArchiveBackfill,
  type BackfillOptions,
  type BackfillResult,
} from "./ai-history-backfill-sources";
import { isOfficialVendorUrl } from "./ai-registry";

export type { BackfillOptions, BackfillResult };

async function createOrResumeRun(
  pool: Pool,
  opts: BackfillOptions,
): Promise<{ runId: string; cursor: Record<string, unknown> }> {
  if (opts.resume) {
    const prev = await pool.query<{ id: string; cursor_json: Record<string, unknown> }>(
      `SELECT id, cursor_json FROM ai_history_backfill_run
       WHERE source_code = $1 AND ($2::text IS NULL OR vendor_slug = $2)
         AND status IN ('paused', 'failed', 'running')
       ORDER BY started_at DESC LIMIT 1`,
      [opts.sourceCode, opts.vendorSlug ?? null],
    );
    if (prev.rows[0]) {
      await pool.query(
        `UPDATE ai_history_backfill_run SET status = 'running', error_message = NULL, updated_at = NOW() WHERE id = $1`,
        [prev.rows[0].id],
      );
      return { runId: prev.rows[0].id, cursor: prev.rows[0].cursor_json ?? {} };
    }
  }
  const ins = await pool.query<{ id: string }>(
    `INSERT INTO ai_history_backfill_run (
       source_code, vendor_slug, date_from, date_to, status, cursor_json
     ) VALUES ($1, $2, $3::date, $4::date, 'running', '{}'::jsonb)
     RETURNING id`,
    [opts.sourceCode, opts.vendorSlug ?? null, opts.dateFrom ?? null, opts.dateTo ?? null],
  );
  return { runId: ins.rows[0].id, cursor: {} };
}

async function updateRunProgress(
  pool: Pool,
  runId: string,
  status: "running" | "paused" | "succeeded" | "failed",
  counts: { scanned: number; published: number; candidatesCreated: number; skipped: number; conflicts: number },
  cursor: Record<string, unknown>,
  errorMessage?: string | null,
): Promise<void> {
  await pool.query(
    `UPDATE ai_history_backfill_run
     SET status = $2,
         cursor_json = $3::jsonb,
         scanned_count = $4,
         published_count = $5,
         candidates_count = $6,
         skipped_count = $7,
         conflict_count = $8,
         error_message = $9,
         finished_at = CASE WHEN $2 IN ('succeeded', 'failed') THEN NOW() ELSE finished_at END,
         updated_at = NOW()
     WHERE id = $1`,
    [
      runId,
      status,
      JSON.stringify(cursor),
      counts.scanned,
      counts.published,
      counts.candidatesCreated,
      counts.skipped,
      counts.conflicts,
      errorMessage ?? null,
    ],
  );
}

async function processOfficialArticle(
  client: PoolClient,
  vendor: { id: string; slug: string; official_domains: string[]; auto_publish_enabled: boolean },
  article: { contentId: string | null; title: string; bodyText: string | null; url: string; publishedDate: string | null },
  allowAutoPublish: boolean,
): Promise<"published" | "candidate" | "skipped"> {
  const cleanUrl = canonicalizeSourceUrl(article.url);
  if (!cleanUrl || !isOfficialVendorUrl(cleanUrl, vendor.official_domains)) return "skipped";
  const classified = classifyOfficialAnnouncement(article.title, article.bodyText);
  if (!classified) return "skipped";

  const hasExactDate = Boolean(article.publishedDate && /^\d{4}-\d{2}-\d{2}$/.test(article.publishedDate));
  const eventKey = canonicalEventKey({
    vendorSlug: vendor.slug,
    eventType: classified.eventType,
    modelNameOrTitle: classified.modelName ?? article.title,
    date: hasExactDate ? article.publishedDate : null,
  });

  if (!hasExactDate || classified.confidence < 0.85 || !classified.modelName) {
    await client.query(
      `INSERT INTO ai_event_candidate (
         dedupe_key, candidate_type, status, priority, vendor_id, content_id,
         title, suggested_event_type, suggested_date, date_precision, draft_payload, evidence_payload
       ) VALUES ($1, 'official_document', 'needs_info', 65, $2, $3, $4, $5, NULL, 'unknown', $6::jsonb, $7::jsonb)
       ON CONFLICT (dedupe_key) DO UPDATE SET last_seen_at = NOW(), updated_at = NOW()`,
      [
        eventKey,
        vendor.id,
        article.contentId,
        article.title.slice(0, 240),
        classified.eventType,
        JSON.stringify({ officialUrl: cleanUrl, modelName: classified.modelName, ruleName: classified.ruleName }),
        JSON.stringify([{ contentId: article.contentId, url: cleanUrl, title: article.title }]),
      ],
    );
    return "candidate";
  }

  const modelSlug = buildModelSlug(vendor.slug, classified.modelName);
  const existingModel = await client.query<{ id: string }>(`SELECT id FROM ai_model WHERE slug = $1 LIMIT 1`, [modelSlug]);
  const matched = await matchExistingRelease(client, {
    dedupeKey: eventKey,
    vendorId: vendor.id,
    modelId: existingModel.rows[0]?.id ?? null,
    eventType: classified.eventType,
    eventDate: article.publishedDate!,
    referenceUrls: [cleanUrl],
  });
  if (matched) return "skipped";

  if (allowAutoPublish && vendor.auto_publish_enabled) {
    const modelRes = await client.query<{ id: string }>(
      `INSERT INTO ai_model (vendor_id, slug, official_name, lifecycle_state)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (slug) DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [vendor.id, modelSlug, classified.modelName, classified.eventStatus === "deprecated" ? "deprecated" : "active"],
    );
    const evRes = await client.query<{ id: string }>(
      `INSERT INTO ai_release_event (
         vendor_id, model_id, event_type, event_status, publication_status,
         title, event_date, date_precision, official_announced_on,
         summary_en, source_tier, dedupe_key
       ) VALUES ($1, $2, $3, $4, 'published', $5, $6::date, 'day', $6::date, $7, 'official', $8)
       ON CONFLICT (dedupe_key) DO NOTHING
       RETURNING id`,
      [
        vendor.id,
        modelRes.rows[0].id,
        classified.eventType,
        classified.eventStatus,
        article.title.slice(0, 240),
        article.publishedDate,
        article.bodyText ? article.bodyText.slice(0, 320) : null,
        eventKey,
      ],
    );
    if (evRes.rows[0]) {
      await client.query(
        `INSERT INTO ai_event_reference (event_id, content_id, title, url, source_kind, is_primary, verified_at)
         VALUES ($1, $2, $3, $4, 'official', TRUE, NOW())`,
        [evRes.rows[0].id, article.contentId, article.title.slice(0, 240), cleanUrl],
      );
      return "published";
    }
    return "skipped";
  }

  await client.query(
    `INSERT INTO ai_event_candidate (
       dedupe_key, candidate_type, status, priority, vendor_id, content_id,
       title, suggested_event_type, suggested_date, date_precision, draft_payload, evidence_payload
     ) VALUES ($1, 'release_event', 'pending', 80, $2, $3, $4, $5, $6::date, 'day', $7::jsonb, $8::jsonb)
     ON CONFLICT (dedupe_key) DO UPDATE SET last_seen_at = NOW(), updated_at = NOW()`,
    [
      eventKey,
      vendor.id,
      article.contentId,
      article.title.slice(0, 240),
      classified.eventType,
      article.publishedDate,
      JSON.stringify({ officialUrl: cleanUrl, modelName: classified.modelName, ruleName: classified.ruleName }),
      JSON.stringify([{ contentId: article.contentId, url: cleanUrl, title: article.title }]),
    ],
  );
  return "candidate";
}

async function runContentHistoryBackfill(pool: Pool, opts: BackfillOptions, runId: string, initialCursor: Record<string, unknown>): Promise<BackfillResult> {
  const batchSize = Math.min(200, Math.max(1, opts.batchSize ?? 50));
  const maxItems = Math.min(5000, Math.max(1, opts.maxItems ?? 500));
  const vendorsRes = await pool.query<{ id: string; slug: string; official_domains: string[]; auto_publish_enabled: boolean }>(
    `SELECT id, slug, official_domains, auto_publish_enabled FROM ai_vendor`,
  );
  const vendorSourceRows = (await pool.query<{ source_id: string; vendor_id: string }>("SELECT source_id, vendor_id FROM ai_vendor_source")).rows;
  const vendorBySourceId = new Map(vendorSourceRows.map((r) => [r.source_id, r.vendor_id]));
  const vendorSourceIds = [...vendorBySourceId.keys()];
  const vendors = vendorsRes.rows;
  let lastTs = typeof initialCursor.lastTs === "string" ? initialCursor.lastTs : "1970-01-01T00:00:00.000Z";
  let lastId = typeof initialCursor.lastId === "string" ? initialCursor.lastId : "00000000-0000-0000-0000-000000000000";

  const counts = { scanned: 0, published: 0, candidatesCreated: 0, skipped: 0, conflicts: 0 };
  while (counts.scanned < maxItems) {
    const take = Math.min(batchSize, maxItems - counts.scanned);
    const batchRows = await listAiFirsthandArticles(pool, {
      sourceIds: vendorSourceIds,
      dateFrom: opts.dateFrom ?? null,
      dateTo: opts.dateTo ?? null,
      cursorSortTs: lastTs,
      cursorId: lastId,
      order: "asc",
      limit: take,
    });
    if (batchRows.length === 0) break;
    const batch = {
      rows: batchRows.map((r) => ({
        ...r,
        mappedVendorId: vendorBySourceId.get(r.collectionSourceId) ?? null,
      })),
    };

    if (!opts.dryRun) {
      await transaction(pool, async (client) => {
        for (const row of batch.rows) {
          counts.scanned += 1;
          lastTs = row.sortTs;
          lastId = row.contentId;
          const url = (row.url ?? "").trim();
          const vendor = (row.mappedVendorId ? vendors.find((v) => v.id === row.mappedVendorId) : undefined)
            ?? vendors.find((v) => url && isOfficialVendorUrl(url, v.official_domains));
          if (!vendor || (opts.vendorSlug && vendor.slug !== normalizeVendorSlug(opts.vendorSlug))) {
            counts.skipped += 1;
            continue;
          }
          const outcome = await processOfficialArticle(client, vendor, {
            contentId: row.contentId,
            title: row.title,
            bodyText: row.bodyText,
            url,
            publishedDate: row.publishedAt ? row.publishedAt.slice(0, 10) : null,
          }, opts.autoPublish ?? false);
          if (outcome === "published") counts.published += 1;
          else if (outcome === "candidate") counts.candidatesCreated += 1;
          else counts.skipped += 1;
        }
      });
    } else {
      for (const row of batch.rows) {
        counts.scanned += 1;
        lastTs = row.sortTs;
        lastId = row.contentId;
      }
    }

    await updateRunProgress(pool, runId, "running", counts, { lastTs, lastId });
    if (batch.rows.length < take) break;
  }

  const finalStatus = counts.scanned >= maxItems ? "paused" : "succeeded";
  await updateRunProgress(pool, runId, finalStatus, counts, { lastTs, lastId });
  return { runId, sourceCode: opts.sourceCode, status: finalStatus, ...counts, cursor: { lastTs, lastId } };
}

/** Run resumable, domain-allowlisted historical backfill isolated from daily discovery. */
export async function runHistoryBackfill(pool: Pool, opts: BackfillOptions): Promise<BackfillResult> {
  const { runId, cursor } = await createOrResumeRun(pool, opts);
  try {
    if (opts.sourceCode === "content_history") {
      return await runContentHistoryBackfill(pool, opts, runId, cursor);
    }
    if (opts.sourceCode === "official_archive") {
      return await runOfficialArchiveBackfill(pool, opts, runId, cursor, processOfficialArticle, updateRunProgress);
    }
    if (opts.sourceCode === "epoch_csv") {
      return await runEpochCsvBackfill(pool, opts, runId, updateRunProgress);
    }
    throw new Error(`Unsupported backfill source: ${opts.sourceCode}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateRunProgress(
      pool,
      runId,
      "failed",
      { scanned: 0, published: 0, candidatesCreated: 0, skipped: 0, conflicts: 0 },
      cursor,
      msg.slice(0, 500),
    ).catch(() => {});
    throw err;
  }
}
