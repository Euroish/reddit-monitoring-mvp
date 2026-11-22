import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Pool } from "pg";
import {
  canonicalizeSourceUrl,
  matchExistingRelease,
} from "./ai-event-identity";
import {
  loadAndValidateDataset,
  planHistoryImport,
  resolveModelIds,
  resolveVendorIds,
  type HistoryImportPlanItem,
  type HistoryImportReport,
} from "./ai-history-plan";
import type { HistoryReference } from "./ai-history-schema";

export { planHistoryImport, type HistoryImportPlanItem, type HistoryImportReport };

const HISTORY_IMPORT_LOCK_KEY = 9042056;

/** Resolve dataset directory, preferring compiled dist/data when present. */
export function resolveHistoryDatasetDir(datasetVersion = "v1", cwd = process.cwd()): string {
  const safeVersion = datasetVersion.replace(/[^a-zA-Z0-9_-]/g, "");
  const distCandidate = resolve(cwd, "dist", "data", "ai", "history", safeVersion);
  if (existsSync(resolve(distCandidate, "manifest.json"))) return distCandidate;
  return resolve(cwd, "data", "ai", "history", safeVersion);
}

/** Transactional, idempotent history seed import with PG advisory lock and audit ledger. */
export async function applyHistoryImport(
  pool: Pool,
  datasetDir: string,
  options: {
    triggerKind?: "startup" | "manual" | "reconcile";
    reconcile?: boolean;
    sourceCommit?: string | null;
  } = {},
): Promise<HistoryImportReport> {
  const dataset = loadAndValidateDataset(datasetDir);
  const triggerKind = options.reconcile ? "reconcile" : (options.triggerKind ?? "manual");
  const refMap = new Map<string, HistoryReference>(dataset.references.map((r) => [r.referenceId, r]));

  const client = await pool.connect();
  let locked = false;
  try {
    await client.query(`SELECT pg_advisory_lock($1)`, [HISTORY_IMPORT_LOCK_KEY]);
    locked = true;

    if (!options.reconcile) {
      const prevRun = await client.query<{ id: string }>(
        `SELECT id FROM ai_history_import_run
         WHERE dataset_version = $1 AND dataset_sha256 = $2 AND status = 'succeeded'
         ORDER BY finished_at DESC LIMIT 1`,
        [dataset.manifest.datasetVersion, dataset.manifestSha256],
      );
      const existingCount = await client.query<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt FROM ai_release_event WHERE source_tier = 'historical_verified'`,
      );
      if (prevRun.rows[0] && Number(existingCount.rows[0]?.cnt ?? "0") > 0) {
        await client.query(
          `INSERT INTO ai_history_import_run (
             dataset_version, dataset_sha256, trigger_kind, status, finished_at, source_branch_commit, summary_json
           ) VALUES ($1, $2, $3, 'skipped_unchanged', NOW(), $4, $5::jsonb)`,
          [
            dataset.manifest.datasetVersion,
            dataset.manifestSha256,
            triggerKind,
            options.sourceCommit ?? null,
            JSON.stringify({ reason: "Dataset SHA-256 already applied" }),
          ],
        );
        return {
          datasetVersion: dataset.manifest.datasetVersion,
          datasetSha256: dataset.manifestSha256,
          status: "skipped_unchanged",
          insertedModels: 0,
          insertedAliases: 0,
          insertedEvents: 0,
          matchedEvents: 0,
          skippedEvents: dataset.releases.length,
          conflicts: 0,
          conflictDetails: [],
        };
      }
    }

    await client.query("BEGIN");
    try {
      const vendorIds = await resolveVendorIds(client, dataset, true);
      const { modelIds, insertedModels, conflicts } = await resolveModelIds(client, dataset, vendorIds, true);

      let insertedAliases = 0;
      for (const a of dataset.aliases) {
        const modelId = modelIds.get(a.canonicalModelKey);
        if (!modelId) continue;
        const existing = await client.query<{ model_id: string; review_status: string }>(
          `SELECT model_id, review_status FROM ai_model_alias WHERE source_namespace = $1 AND alias = $2 LIMIT 1`,
          [a.sourceNamespace, a.alias],
        );
        if (existing.rows[0]) {
          if (existing.rows[0].model_id !== modelId && existing.rows[0].review_status === "verified") {
            conflicts.push({
              kind: "alias",
              key: `${a.sourceNamespace}:${a.alias}`,
              reason: "Verified alias already points to a different model",
            });
          }
          continue;
        }
        await client.query(
          `INSERT INTO ai_model_alias (model_id, source_namespace, alias, review_status)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (source_namespace, alias) DO NOTHING`,
          [modelId, a.sourceNamespace, a.alias, a.reviewStatus],
        );
        insertedAliases += 1;
      }

      let insertedEvents = 0;
      let matchedEvents = 0;
      let skippedEvents = 0;

      for (const rel of dataset.releases) {
        const vendorId = vendorIds.get(rel.vendorSlug);
        if (!vendorId) {
          conflicts.push({ kind: "release", key: rel.sourceEventKey, reason: `Missing vendor ${rel.vendorSlug}` });
          continue;
        }
        const modelId = rel.canonicalModelKey ? (modelIds.get(rel.canonicalModelKey) ?? null) : null;
        const refs = rel.sourceReferenceIds
          .map((id) => refMap.get(id))
          .filter((r): r is HistoryReference => Boolean(r));
        const urls = refs.map((r) => canonicalizeSourceUrl(r.url)).filter(Boolean);

        const matched = await matchExistingRelease(client, {
          dedupeKey: rel.sourceEventKey,
          vendorId,
          modelId,
          eventType: rel.eventType,
          eventDate: rel.date.value,
          referenceUrls: urls,
        });

        let eventId: string;
        if (!matched) {
          const ins = await client.query<{ id: string }>(
            `INSERT INTO ai_release_event (
               vendor_id, model_id, event_type, event_status, publication_status,
               title, event_date, date_precision, official_announced_on,
               available_from, effective_on, summary_zh, summary_en,
               key_changes, source_tier, dedupe_key, verified_at
             ) VALUES (
               $1, $2, $3, $4, 'published',
               $5, $6::date, $7, $8::date,
               $9::date, $10::date, $11, $12,
               $13::jsonb, 'historical_verified', $14, $15::timestamptz
             ) RETURNING id`,
            [
              vendorId,
              modelId,
              rel.eventType,
              rel.eventStatus,
              rel.title,
              rel.date.value,
              rel.date.precision,
              rel.officialAnnouncedOn ?? null,
              rel.availableFrom ?? null,
              rel.effectiveOn ?? null,
              rel.summaryZh ?? null,
              rel.summaryEn ?? null,
              JSON.stringify(rel.keyChanges ?? []),
              rel.sourceEventKey,
              rel.verification.checkedAt,
            ],
          );
          eventId = ins.rows[0].id;
          insertedEvents += 1;
        } else if (matched.publicationStatus === "unpublished") {
          skippedEvents += 1;
          continue;
        } else {
          eventId = matched.id;
          matchedEvents += 1;
          if (options.reconcile) {
            await client.query(
              `UPDATE ai_release_event
               SET event_date = $2::date,
                   date_precision = $3,
                   official_announced_on = COALESCE($4::date, official_announced_on),
                   available_from = COALESCE($5::date, available_from),
                   effective_on = COALESCE($6::date, effective_on),
                   revision = revision + 1,
                   updated_at = NOW()
               WHERE id = $1::uuid`,
              [
                eventId,
                rel.date.value,
                rel.date.precision,
                rel.officialAnnouncedOn ?? null,
                rel.availableFrom ?? null,
                rel.effectiveOn ?? null,
              ],
            );
          }
        }

        const existingRefs = await client.query<{ url: string }>(
          `SELECT url FROM ai_event_reference WHERE event_id = $1::uuid`,
          [eventId],
        );
        const existingUrlSet = new Set(existingRefs.rows.map((r) => canonicalizeSourceUrl(r.url)));
        for (let i = 0; i < refs.length; i++) {
          const ref = refs[i];
          const cleanUrl = canonicalizeSourceUrl(ref.url);
          if (!cleanUrl || existingUrlSet.has(cleanUrl)) continue;
          await client.query(
            `INSERT INTO ai_event_reference (
               event_id, url, title, source_kind, article_published_at,
               excerpt, is_primary, verified_at
             ) VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7, $8::timestamptz)`,
            [
              eventId,
              cleanUrl,
              ref.title.slice(0, 240),
              ref.kind,
              ref.articlePublishedOn ? `${ref.articlePublishedOn}T00:00:00Z` : null,
              ref.locator ? ref.locator.slice(0, 240) : null,
              i === 0 && existingUrlSet.size === 0,
              ref.verifiedAt,
            ],
          );
          existingUrlSet.add(cleanUrl);
        }
      }

      const report: HistoryImportReport = {
        datasetVersion: dataset.manifest.datasetVersion,
        datasetSha256: dataset.manifestSha256,
        status: "succeeded",
        insertedModels,
        insertedAliases,
        insertedEvents,
        matchedEvents,
        skippedEvents,
        conflicts: conflicts.length,
        conflictDetails: conflicts,
      };

      await client.query(
        `INSERT INTO ai_history_import_run (
           dataset_version, dataset_sha256, trigger_kind, status, finished_at,
           inserted_models, inserted_aliases, inserted_events, matched_events,
           skipped_events, conflicts, errors, source_branch_commit, summary_json
         ) VALUES ($1, $2, $3, 'succeeded', NOW(), $4, $5, $6, $7, $8, $9, 0, $10, $11::jsonb)`,
        [
          report.datasetVersion,
          report.datasetSha256,
          triggerKind,
          report.insertedModels,
          report.insertedAliases,
          report.insertedEvents,
          report.matchedEvents,
          report.skippedEvents,
          report.conflicts,
          options.sourceCommit ?? null,
          JSON.stringify({ conflictDetails: conflicts }),
        ],
      );

      await client.query("COMMIT");
      return report;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      await client.query(
        `INSERT INTO ai_history_import_run (
           dataset_version, dataset_sha256, trigger_kind, status, finished_at, errors, source_branch_commit, summary_json
         ) VALUES ($1, $2, $3, 'failed', NOW(), 1, $4, $5::jsonb)`,
        [
          dataset.manifest.datasetVersion,
          dataset.manifestSha256,
          triggerKind,
          options.sourceCommit ?? null,
          JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
        ],
      ).catch(() => {});
      throw err;
    }
  } finally {
    if (locked) {
      await client.query(`SELECT pg_advisory_unlock($1)`, [HISTORY_IMPORT_LOCK_KEY]).catch(() => {});
    }
    client.release();
  }
}
