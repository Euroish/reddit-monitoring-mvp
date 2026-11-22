import type { Pool, PoolClient } from "pg";
import { buildModelSlug, matchExistingRelease } from "./ai-event-identity";
import {
  validateHistoryDatasetDir,
  type HistoryReference,
  type LoadedHistoryDataset,
} from "./ai-history-schema";

export interface HistoryImportPlanItem {
  sourceEventKey: string;
  action: "insert" | "match_enrich" | "skip_unpublished" | "conflict";
  reason?: string;
}

export interface HistoryImportReport {
  datasetVersion: string;
  datasetSha256: string;
  status: "planned" | "succeeded" | "skipped_unchanged" | "failed";
  insertedModels: number;
  insertedAliases: number;
  insertedEvents: number;
  matchedEvents: number;
  skippedEvents: number;
  conflicts: number;
  conflictDetails: Array<{ kind: string; key: string; reason: string }>;
  items?: HistoryImportPlanItem[];
}

export function loadAndValidateDataset(datasetDir: string): LoadedHistoryDataset {
  const res = validateHistoryDatasetDir(datasetDir);
  if (!res.valid || !res.dataset) {
    throw new Error(`AI history dataset validation failed (${datasetDir}): ${res.errors.join(" | ")}`);
  }
  return res.dataset;
}

export async function resolveVendorIds(
  client: PoolClient,
  dataset: LoadedHistoryDataset,
  write: boolean,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const v of dataset.vendors) {
    const existing = await client.query<{ id: string }>(`SELECT id FROM ai_vendor WHERE slug = $1 LIMIT 1`, [v.slug]);
    if (existing.rows[0]) {
      map.set(v.slug, existing.rows[0].id);
      continue;
    }
    if (!write) continue;
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO ai_vendor (slug, name, website_url, official_orgs, official_domains, display_order)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
       ON CONFLICT (slug) DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [
        v.slug,
        v.name,
        v.websiteUrl,
        JSON.stringify(v.officialOrgs ?? []),
        JSON.stringify(v.officialDomains),
        v.displayOrder ?? 100,
      ],
    );
    map.set(v.slug, inserted.rows[0].id);
  }
  return map;
}

export async function resolveModelIds(
  client: PoolClient,
  dataset: LoadedHistoryDataset,
  vendorIds: Map<string, string>,
  write: boolean,
): Promise<{
  modelIds: Map<string, string>;
  insertedModels: number;
  conflicts: Array<{ kind: string; key: string; reason: string }>;
}> {
  const modelIds = new Map<string, string>();
  const conflicts: Array<{ kind: string; key: string; reason: string }> = [];
  let insertedModels = 0;

  for (const m of dataset.models) {
    const vendorId = vendorIds.get(m.vendorSlug);
    if (!vendorId) {
      if (write) conflicts.push({ kind: "model", key: m.canonicalKey, reason: `Missing vendor ${m.vendorSlug}` });
      continue;
    }
    const slug = buildModelSlug(m.vendorSlug, m.officialName);
    const existing = await client.query<{ id: string; vendor_id: string }>(
      `SELECT id, vendor_id FROM ai_model WHERE slug = $1 LIMIT 1`,
      [slug],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].vendor_id !== vendorId) {
        conflicts.push({
          kind: "model",
          key: m.canonicalKey,
          reason: `Model slug ${slug} already belongs to another vendor`,
        });
        continue;
      }
      modelIds.set(m.canonicalKey, existing.rows[0].id);
      continue;
    }
    if (!write) {
      insertedModels += 1;
      continue;
    }
    const ins = await client.query<{ id: string }>(
      `INSERT INTO ai_model (
         vendor_id, slug, family, official_name, official_api_id,
         model_kind, lifecycle_state, open_weights, license_name,
         modalities, context_window, summary_zh, summary_en
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13)
       RETURNING id`,
      [
        vendorId,
        slug,
        m.family,
        m.officialName,
        m.officialApiId ?? null,
        m.kind,
        m.lifecycle,
        m.openWeights ?? null,
        m.licenseName ?? null,
        JSON.stringify(m.modalities ?? []),
        m.contextWindow ?? null,
        m.summaryZh ?? null,
        m.summaryEn ?? null,
      ],
    );
    modelIds.set(m.canonicalKey, ins.rows[0].id);
    insertedModels += 1;
  }

  return { modelIds, insertedModels, conflicts };
}

/** Read-only dry-run plan comparing versioned dataset against PostgreSQL. */
export async function planHistoryImport(pool: Pool, datasetDir: string): Promise<HistoryImportReport> {
  const dataset = loadAndValidateDataset(datasetDir);
  const refMap = new Map<string, HistoryReference>(dataset.references.map((r) => [r.referenceId, r]));
  const client = await pool.connect();
  try {
    const vendorIds = await resolveVendorIds(client, dataset, false);
    const { modelIds, insertedModels, conflicts } = await resolveModelIds(client, dataset, vendorIds, false);

    let insertedAliases = 0;
    for (const a of dataset.aliases) {
      const targetModelId = modelIds.get(a.canonicalModelKey);
      const existing = await client.query<{ model_id: string; review_status: string }>(
        `SELECT model_id, review_status FROM ai_model_alias WHERE source_namespace = $1 AND alias = $2 LIMIT 1`,
        [a.sourceNamespace, a.alias],
      );
      if (existing.rows[0]) {
        if (targetModelId && existing.rows[0].model_id !== targetModelId && existing.rows[0].review_status === "verified") {
          conflicts.push({
            kind: "alias",
            key: `${a.sourceNamespace}:${a.alias}`,
            reason: "Verified alias points to a different model_id",
          });
        }
      } else {
        insertedAliases += 1;
      }
    }

    const items: HistoryImportPlanItem[] = [];
    let insertedEvents = 0;
    let matchedEvents = 0;
    let skippedEvents = 0;
    for (const rel of dataset.releases) {
      const vendorId = vendorIds.get(rel.vendorSlug);
      if (!vendorId) {
        insertedEvents += 1;
        items.push({ sourceEventKey: rel.sourceEventKey, action: "insert" });
        continue;
      }
      const modelId = rel.canonicalModelKey ? (modelIds.get(rel.canonicalModelKey) ?? null) : null;
      const urls = rel.sourceReferenceIds.map((id) => refMap.get(id)?.url ?? "").filter(Boolean);
      const matched = await matchExistingRelease(client, {
        dedupeKey: rel.sourceEventKey,
        vendorId,
        modelId,
        eventType: rel.eventType,
        eventDate: rel.date.value,
        referenceUrls: urls,
      });
      if (!matched) {
        insertedEvents += 1;
        items.push({ sourceEventKey: rel.sourceEventKey, action: "insert" });
      } else if (matched.publicationStatus === "unpublished") {
        skippedEvents += 1;
        items.push({
          sourceEventKey: rel.sourceEventKey,
          action: "skip_unpublished",
          reason: "Existing event was manually unpublished",
        });
      } else {
        matchedEvents += 1;
        items.push({ sourceEventKey: rel.sourceEventKey, action: "match_enrich" });
      }
    }

    return {
      datasetVersion: dataset.manifest.datasetVersion,
      datasetSha256: dataset.manifestSha256,
      status: "planned",
      insertedModels,
      insertedAliases,
      insertedEvents,
      matchedEvents,
      skippedEvents,
      conflicts: conflicts.length,
      conflictDetails: conflicts,
      items,
    };
  } finally {
    client.release();
  }
}
