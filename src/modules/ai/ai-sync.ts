import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { searchAiOfficialArticlesByTerm } from "../content/index";
import { ContentProviderError } from "../../connectors/shared/content-provider.interface";
import { httpsUrl, read } from "../../connectors/web/http";
import {
  parseArtificialAnalysisPayload,
  parseEpochCsv,
  parseHuggingFacePayload,
  parseLiteLlmPayload,
  parseOpenRouterPayload,
  stableHash,
  type NormalizedRegistryItem,
} from "./ai-registry";
export { validateLlmExtraction } from "./ai-llm";

export async function saveArtificialAnalysisSnapshots(
  pool: Pool,
  sourceId: string,
  sourceCode: string,
  bodyText: string,
  aaPublicAllowed: boolean,
  dryRun = false,
) {
  const snapshots = parseArtificialAnalysisPayload(JSON.parse(bodyText));
  const licenseTier = aaPublicAllowed ? "commercial_public" : "free_internal";
  let saved = 0;
  if (!dryRun) {
    for (const snap of snapshots) {
      const snapRes = await pool.query<{ id: string }>(
        `INSERT INTO ai_benchmark_snapshot (
           provider_code, category, metric_name, metric_version, metric_direction,
           unit, attribution_text, attribution_url, license_tier, public_redistribution_allowed
         ) VALUES ('artificial_analysis',$1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [snap.category, snap.metricName, snap.metricVersion, snap.metricDirection, snap.unit, snap.attributionText, snap.attributionUrl, licenseTier, aaPublicAllowed],
      );
      if (snap.entries.length > 0) {
        await pool.query(
          `INSERT INTO ai_benchmark_entry (snapshot_id, external_model_id, model_name, vendor_name, score, rank, provider_setting)
           SELECT $1, external_model_id, model_name, vendor_name, score, rank, provider_setting
           FROM UNNEST($2::text[], $3::text[], $4::text[], $5::double precision[], $6::int[], $7::text[])
             AS t(external_model_id, model_name, vendor_name, score, rank, provider_setting)
           ON CONFLICT (snapshot_id, external_model_id) DO NOTHING`,
          [
            snapRes.rows[0].id,
            snap.entries.map((e) => e.externalModelId),
            snap.entries.map((e) => e.modelName),
            snap.entries.map((e) => e.vendorName ?? null),
            snap.entries.map((e) => e.score),
            snap.entries.map((e) => e.rank ?? null),
            snap.entries.map((e) => e.providerSetting ?? null),
          ],
        );
      }
      saved += 1;
    }
    await pool.query(
      `UPDATE ai_registry_source SET last_success_at = NOW(), consecutive_failures = 0, backoff_seconds = 0,
       circuit_open_until = NULL, last_error = NULL,
       next_run_at = NOW() + make_interval(secs => sync_interval_seconds), updated_at = NOW() WHERE id = $1`,
      [sourceId],
    );
    await pool.query(`UPDATE ai_ops_alert SET resolved_at = NOW() WHERE source_code = $1 AND resolved_at IS NULL`, [sourceCode]);
  }
  return { snapshotsSaved: saved, licenseTier, publicRedistributionAllowed: aaPublicAllowed };
}

const AI_SYNC_LOCK_KEY = 9042054;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

export interface SyncFetchResult {
  status: number;
  etag?: string | null;
  blobSha?: string | null;
  bodyText?: string;
}

export type SyncFetcher = (url: string, headers: Record<string, string>) => Promise<SyncFetchResult>;

async function defaultFetcher(url: string, headers: Record<string, string>): Promise<SyncFetchResult> {
  const target = httpsUrl(url);
  if (!target) return { status: 400 };
  try {
    const res = await read(target, undefined, headers, 15_000, {
      maxBytes: MAX_RESPONSE_BYTES,
      allowRedirect: (next) => next.origin === target.origin,
    });
    return { status: res.status, etag: res.etag, bodyText: res.body };
  } catch (error) {
    if (error instanceof ContentProviderError) return { status: error.httpStatus ?? 502 };
    throw error;
  }
}

async function resolveAliasAndVendor(
  client: PoolClient,
  item: NormalizedRegistryItem,
): Promise<{ vendorId: string | null; modelId: string | null }> {
  const aliasRow = await client.query<{ model_id: string; vendor_id: string }>(
    `SELECT a.model_id, m.vendor_id
     FROM ai_model_alias a JOIN ai_model m ON m.id = a.model_id
     WHERE a.source_namespace = $1 AND a.alias = $2 AND a.review_status = 'verified'
     LIMIT 1`,
    [item.sourceNamespace, item.externalId],
  );
  if (aliasRow.rows[0]) {
    return { vendorId: aliasRow.rows[0].vendor_id, modelId: aliasRow.rows[0].model_id };
  }
  if (!item.vendorSlugHint) return { vendorId: null, modelId: null };
  const vendorRow = await client.query<{ id: string }>(
    `SELECT id FROM ai_vendor WHERE slug = $1 LIMIT 1`,
    [item.vendorSlugHint],
  );
  return { vendorId: vendorRow.rows[0]?.id ?? null, modelId: null };
}

async function matchOfficialContentIds(
  client: PoolClient,
  vendorId: string | null,
  displayName: string,
  observedAtIso: string,
): Promise<Array<{ id: string; title: string | null; url: string | null; published_at: string | null }>> {
  const token = displayName.split(/[/:(\s]/).find((t) => t.length >= 3) ?? "";
  if (!token) return [];
  const sourceIds = vendorId
    ? (await client.query<{ source_id: string }>("SELECT source_id FROM ai_vendor_source WHERE vendor_id = $1", [vendorId])).rows.map((r) => r.source_id)
    : [];
  return searchAiOfficialArticlesByTerm(client, { sourceIds, term: token, observedAtIso, limit: 3 });
}

interface ExistingListingRow {
  id: string;
  external_id: string;
  route_variant: string;
  content_hash: string;
  normalized_payload: Record<string, unknown>;
  active_state: string;
  missing_streak: number;
}

async function applyChangedListing(
  client: PoolClient,
  sourceId: string,
  sourceCode: string,
  item: NormalizedRegistryItem,
  prev: ExistingListingRow | undefined,
  isInitialSnapshot: boolean,
  nowIso: string,
): Promise<boolean> {
  const { vendorId, modelId } = await resolveAliasAndVendor(client, item);
  const listingRes = await client.query<{ id: string }>(
    `INSERT INTO ai_registry_listing (
       registry_source_id, external_id, route_variant, model_id, vendor_slug_hint,
       display_name, active_state, missing_streak, registry_created_at,
       first_seen_at, last_seen_at, content_hash, normalized_payload
     ) VALUES ($1,$2,$3,$4,$5,$6,'active',0,$7,NOW(),NOW(),$8,$9::jsonb)
     ON CONFLICT (registry_source_id, external_id, route_variant) DO UPDATE SET
       model_id = COALESCE(ai_registry_listing.model_id, EXCLUDED.model_id),
       vendor_slug_hint = COALESCE(EXCLUDED.vendor_slug_hint, ai_registry_listing.vendor_slug_hint),
       display_name = EXCLUDED.display_name,
       active_state = 'active',
       missing_streak = 0,
       last_seen_at = NOW(),
       content_hash = EXCLUDED.content_hash,
       normalized_payload = EXCLUDED.normalized_payload
     RETURNING id`,
    [
      sourceId, item.externalId, item.routeVariant, modelId, item.vendorSlugHint,
      item.displayName, item.registryCreatedAt, item.contentHash, JSON.stringify(item.normalizedPayload),
    ],
  );
  const listingId = listingRes.rows[0].id;
  const priceChanged =
    Boolean(prev) &&
    (prev!.normalized_payload?.inputPrice !== item.inputPrice || prev!.normalized_payload?.outputPrice !== item.outputPrice);
  const changeType = !prev ? "new_listing" : priceChanged ? "pricing_change" : "spec_change";

  const changeRes = await client.query<{ id: string }>(
    `INSERT INTO ai_registry_change (
       registry_source_id, listing_id, external_id, route_variant, change_type, change_hash, previous_value, current_value
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)
     ON CONFLICT (registry_source_id, external_id, route_variant, change_type, change_hash) DO NOTHING
     RETURNING id`,
    [
      sourceId, listingId, item.externalId, item.routeVariant, changeType, item.contentHash,
      prev ? JSON.stringify(prev.normalized_payload) : null, JSON.stringify(item.normalizedPayload),
    ],
  );
  if (item.inputPrice !== null || item.outputPrice !== null || item.contextLength !== null) {
    await client.query(
      `INSERT INTO ai_model_spec_observation (
         model_id, listing_id, source_kind, provider_name, context_length, max_output_tokens,
         input_modalities, output_modalities, currency, price_unit, input_price, output_price, cache_read_price, raw_unit_note
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13,$14)`,
      [
        modelId, listingId, item.sourceNamespace, item.providerName, item.contextLength, item.maxOutputTokens,
        JSON.stringify(item.inputModalities), JSON.stringify(item.outputModalities),
        item.currency, item.priceUnit, item.inputPrice, item.outputPrice, item.cacheReadPrice, item.rawUnitNote,
      ],
    );
  }
  if (isInitialSnapshot && item.sourceNamespace !== "epoch") return false;
  return createRegistryCandidate(client, sourceCode, item, vendorId, modelId, changeRes.rows[0]?.id ?? null, changeType, nowIso);
}

async function createRegistryCandidate(
  client: PoolClient,
  sourceCode: string,
  item: NormalizedRegistryItem,
  vendorId: string | null,
  modelId: string | null,
  changeId: string | null,
  changeType: "new_listing" | "pricing_change" | "spec_change",
  nowIso: string,
): Promise<boolean> {
  const candidateType =
    item.sourceNamespace === "epoch"
      ? "historical_import"
      : changeType === "pricing_change"
        ? "pricing_observation"
        : changeType === "spec_change"
          ? "spec_change"
          : "new_listing";
  const dedupeKey = `${sourceCode}:${item.externalId}:${item.routeVariant}:${candidateType}:${item.contentHash.slice(0, 16)}`;
  const matchedDocs = await matchOfficialContentIds(client, vendorId, item.displayName, nowIso);
  const evidenceList = matchedDocs.map((d) => ({ contentId: d.id, title: d.title, url: d.url, publishedAt: d.published_at }));
  const candRes = await client.query<{ id: string }>(
    `INSERT INTO ai_event_candidate (
       dedupe_key, candidate_type, status, priority, vendor_id, model_id, registry_change_id,
       content_id, title, external_id, suggested_event_type, suggested_date, date_precision,
       draft_payload, evidence_payload
     ) VALUES ($1,$2,'pending',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb)
     ON CONFLICT (dedupe_key) DO UPDATE SET last_seen_at = NOW(), updated_at = NOW()
     RETURNING id`,
    [
      dedupeKey, candidateType, matchedDocs.length > 0 ? 80 : 50, vendorId, modelId, changeId,
      matchedDocs[0]?.id ?? null, `${item.displayName} (${sourceCode})`, item.externalId,
      candidateType === "pricing_observation" ? "pricing_change" : null,
      item.historicalDate?.date ?? null, item.historicalDate?.precision ?? "unknown",
      JSON.stringify({ ...item.normalizedPayload, registryCreatedAt: item.registryCreatedAt, rawUnitNote: item.rawUnitNote }),
      JSON.stringify(evidenceList),
    ],
  );
  return Boolean(candRes.rows[0]);
}

async function applyMissingListingsBatch(
  client: PoolClient,
  sourceId: string,
  existingByKey: Map<string, ExistingListingRow>,
  seenKeys: Set<string>,
) {
  const missingIds: string[] = [];
  const nextStreaks: number[] = [];
  const nextStates: string[] = [];
  const confirmed: Array<{ row: ExistingListingRow; hash: string }> = [];

  for (const [key, row] of existingByKey) {
    if (seenKeys.has(key) || (row.active_state !== "active" && row.active_state !== "missing_once")) continue;
    const nextStreak = row.missing_streak + 1;
    missingIds.push(row.id);
    nextStreaks.push(nextStreak);
    nextStates.push(nextStreak >= 2 ? "missing_confirmed" : "missing_once");
    if (nextStreak === 2) {
      confirmed.push({ row, hash: stableHash({ missing: row.external_id, route: row.route_variant }) });
    }
  }
  if (missingIds.length) {
    await client.query(
      `UPDATE ai_registry_listing l
       SET missing_streak = v.streak, active_state = v.state
       FROM UNNEST($1::uuid[], $2::int[], $3::text[]) AS v(id, streak, state)
       WHERE l.id = v.id`,
      [missingIds, nextStreaks, nextStates],
    );
  }
  if (confirmed.length) {
    await client.query(
      `INSERT INTO ai_registry_change (registry_source_id, listing_id, external_id, route_variant, change_type, change_hash)
       SELECT $1, v.listing_id, v.external_id, v.route_variant, 'listing_missing', v.hash
       FROM UNNEST($2::uuid[], $3::text[], $4::text[], $5::text[]) AS v(listing_id, external_id, route_variant, hash)
       ON CONFLICT DO NOTHING`,
      [
        sourceId,
        confirmed.map((c) => c.row.id),
        confirmed.map((c) => c.row.external_id),
        confirmed.map((c) => c.row.route_variant),
        confirmed.map((c) => c.hash),
      ],
    );
  }
}

export async function applyRegistryItems(
  pool: Pool,
  sourceCode: string,
  items: NormalizedRegistryItem[],
  options: { dryRun?: boolean; triggerKind?: "scheduled" | "manual" | "dry_run"; blobSha?: string | null; etag?: string | null } = {},
): Promise<{ runId: string; fetchedCount: number; changedCount: number; candidatesCreated: number; skippedUnchanged: boolean }> {
  const started = Date.now();
  const triggerKind = options.dryRun ? "dry_run" : (options.triggerKind ?? "scheduled");
  const client = await pool.connect();
  try {
    const source = (
      await client.query<{ id: string; kind: string; last_blob_sha: string | null }>(
        "SELECT id, kind, last_blob_sha FROM ai_registry_source WHERE code = $1",
        [sourceCode],
      )
    ).rows[0];
    if (!source) throw new Error(`Unknown ai_registry_source: ${sourceCode}`);
    const runId = randomUUID();
    await client.query(
      `INSERT INTO ai_sync_run (id, registry_source_id, source_code, trigger_kind, status, lease_owner, lease_expires_at)
       VALUES ($1, $2, $3, $4, 'running', $5, NOW() + INTERVAL '15 minutes')`,
      [runId, source.id, sourceCode, triggerKind, `pid-${process.pid}`],
    );
    if (options.blobSha && source.last_blob_sha && options.blobSha === source.last_blob_sha) {
      await client.query("UPDATE ai_sync_run SET status = 'succeeded', duration_ms = $2, finished_at = NOW() WHERE id = $1", [
        runId, Date.now() - started,
      ]);
      return { runId, fetchedCount: 0, changedCount: 0, candidatesCreated: 0, skippedUnchanged: true };
    }
    if (items.length === 0) {
      await client.query(
        "UPDATE ai_sync_run SET status = 'partial_failed', error_code = 'empty_payload', error_message = 'Upstream returned 0 items; existing listings preserved', duration_ms = $2, finished_at = NOW() WHERE id = $1",
        [runId, Date.now() - started],
      );
      return { runId, fetchedCount: 0, changedCount: 0, candidatesCreated: 0, skippedUnchanged: false };
    }

    const existingRows = (
      await client.query<ExistingListingRow>(
        `SELECT id, external_id, route_variant, content_hash, normalized_payload, active_state, missing_streak
         FROM ai_registry_listing WHERE registry_source_id = $1`,
        [source.id],
      )
    ).rows;
    const existingByKey = new Map(existingRows.map((r) => [`${r.external_id}::${r.route_variant}`, r]));
    const isInitialSnapshot = existingByKey.size === 0;
    const seenKeys = new Set<string>();
    const unchangedIds: string[] = [];
    let changedCount = 0;
    let candidatesCreated = 0;
    const nowIso = new Date().toISOString();

    if (!options.dryRun) await client.query("BEGIN");
    try {
      for (const item of items) {
        const compositeKey = `${item.externalId}::${item.routeVariant}`;
        if (seenKeys.has(compositeKey)) continue;
        seenKeys.add(compositeKey);
        const prev = existingByKey.get(compositeKey);
        if (prev && prev.content_hash === item.contentHash && prev.active_state === "active") {
          unchangedIds.push(prev.id);
          continue;
        }
        changedCount += 1;
        if (options.dryRun) continue;
        if (await applyChangedListing(client, source.id, sourceCode, item, prev, isInitialSnapshot, nowIso)) {
          candidatesCreated += 1;
        }
      }
      if (!options.dryRun) {
        if (unchangedIds.length) {
          await client.query("UPDATE ai_registry_listing SET last_seen_at = NOW(), missing_streak = 0 WHERE id = ANY($1::uuid[])", [
            unchangedIds,
          ]);
        }
        if (!isInitialSnapshot) await applyMissingListingsBatch(client, source.id, existingByKey, seenKeys);
        await client.query(
          `UPDATE ai_registry_source
           SET etag = COALESCE($2, etag), last_blob_sha = COALESCE($3, last_blob_sha),
               consecutive_failures = 0, circuit_open_until = NULL, last_success_at = NOW(), last_error = NULL, updated_at = NOW()
           WHERE id = $1`,
          [source.id, options.etag ?? null, options.blobSha ?? null],
        );
        await client.query("COMMIT");
      }
    } catch (err) {
      if (!options.dryRun) await client.query("ROLLBACK");
      await client.query(
        "UPDATE ai_sync_run SET status = 'failed', error_code = 'apply_error', error_message = $2, duration_ms = $3, finished_at = NOW() WHERE id = $1",
        [runId, String(err).slice(0, 400), Date.now() - started],
      );
      throw err;
    }

    await client.query(
      "UPDATE ai_sync_run SET status = 'succeeded', fetched_count = $2, changed_count = $3, candidates_created = $4, duration_ms = $5, finished_at = NOW() WHERE id = $1",
      [runId, items.length, changedCount, candidatesCreated, Date.now() - started],
    );
    return { runId, fetchedCount: items.length, changedCount, candidatesCreated, skippedUnchanged: false };
  } finally {
    client.release();
  }
}

async function handleSyncFailureStatus(
  pool: Pool,
  src: { id: string; backoff_seconds: number },
  sourceCode: string,
  status: number,
) {
  const nextBackoff = Math.min(21600, Math.max(300, (src.backoff_seconds || 150) * 2));
  const failRes = await pool.query<{ consecutive_failures: number }>(
    `UPDATE ai_registry_source SET consecutive_failures = consecutive_failures + 1, backoff_seconds = $3::int,
     next_run_at = NOW() + make_interval(secs => $3::int),
     circuit_open_until = CASE WHEN consecutive_failures + 1 >= 3 THEN NOW() + INTERVAL '2 hours' ELSE circuit_open_until END,
     last_error = $2, updated_at = NOW() WHERE id = $1 RETURNING consecutive_failures`,
    [src.id, `HTTP ${status}`, nextBackoff],
  );
  if ((failRes.rows[0]?.consecutive_failures ?? 0) >= 3 || status === 429) {
    await pool.query(
      "INSERT INTO ai_ops_alert (severity, source_code, alert_key, message, details) VALUES ($1,$2,$3,$4,$5::jsonb)",
      [
        status === 429 ? "warning" : "critical",
        sourceCode,
        `sync_failure:${sourceCode}`,
        `AI sync ${sourceCode} failed with HTTP ${status} (backoff ${nextBackoff}s)`,
        JSON.stringify({ status, backoffSeconds: nextBackoff }),
      ],
    );
  }
  throw new Error(`Upstream ${sourceCode} returned HTTP ${status}`);
}

function parseSyncPayload(kind: string, bodyText: string, config: Record<string, unknown>): NormalizedRegistryItem[] {
  if (kind === "openrouter") return parseOpenRouterPayload(JSON.parse(bodyText));
  if (kind === "litellm") return parseLiteLlmPayload(JSON.parse(bodyText));
  if (kind === "hf") {
    const orgs = Array.isArray(config?.orgs) ? (config.orgs as string[]) : [];
    return parseHuggingFacePayload(JSON.parse(bodyText), orgs);
  }
  return kind === "epoch" ? parseEpochCsv(bodyText) : [];
}

export async function syncRegistrySourceByCode(
  pool: Pool,
  sourceCode: string,
  options: { dryRun?: boolean; triggerKind?: "scheduled" | "manual" | "dry_run"; fetcher?: SyncFetcher } = {},
) {
  const fetcher = options.fetcher ?? defaultFetcher;
  const lockClient = await pool.connect();
  let locked = false;
  try {
    const lockRes = await lockClient.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [AI_SYNC_LOCK_KEY]);
    locked = Boolean(lockRes.rows[0]?.ok);
    if (!locked) return { skippedLocked: true };

    const src = (
      await pool.query<{
        id: string; kind: string; endpoint_url: string; etag: string | null;
        sync_interval_seconds: number; backoff_seconds: number; config: Record<string, unknown>;
      }>(
        "SELECT id, kind, endpoint_url, etag, sync_interval_seconds, backoff_seconds, config FROM ai_registry_source WHERE code = $1",
        [sourceCode],
      )
    ).rows[0];
    if (!src) throw new Error(`Unknown ai_registry_source: ${sourceCode}`);

    const headers: Record<string, string> = { "user-agent": "SIFTLINE-AI-Catalog/1.0" };
    if (src.etag) headers["if-none-match"] = src.etag;
    let targetUrl = src.endpoint_url;
    let aaPublicAllowed = false;
    if (src.kind === "artificial_analysis") {
      const apiKey = process.env.ARTIFICIAL_ANALYSIS_API_KEY?.trim();
      if (!apiKey) throw new Error("ARTIFICIAL_ANALYSIS_API_KEY is not configured");
      headers["x-api-key"] = apiKey;
      aaPublicAllowed = process.env.ARTIFICIAL_ANALYSIS_PUBLIC_REDISTRIBUTION === "true";
      if (aaPublicAllowed && typeof src.config?.commercialUrl === "string") targetUrl = src.config.commercialUrl;
    }

    const res = await fetcher(targetUrl, headers);
    if (res.status === 304) {
      await pool.query(
        `UPDATE ai_registry_source SET last_success_at = NOW(), consecutive_failures = 0, backoff_seconds = 0,
         circuit_open_until = NULL, last_error = NULL,
         next_run_at = NOW() + make_interval(secs => sync_interval_seconds), updated_at = NOW() WHERE id = $1`,
        [src.id],
      );
      await pool.query("UPDATE ai_ops_alert SET resolved_at = NOW() WHERE source_code = $1 AND resolved_at IS NULL", [sourceCode]);
      return { skippedUnchanged: true, fetchedCount: 0, changedCount: 0, candidatesCreated: 0 };
    }
    if (res.status >= 400 || !res.bodyText) {
      return await handleSyncFailureStatus(pool, src, sourceCode, res.status);
    }
    if (src.kind === "artificial_analysis") {
      return saveArtificialAnalysisSnapshots(pool, src.id, sourceCode, res.bodyText, aaPublicAllowed, options.dryRun);
    }

    const items = parseSyncPayload(src.kind, res.bodyText, src.config);
    const result = await applyRegistryItems(pool, sourceCode, items, {
      dryRun: options.dryRun,
      triggerKind: options.triggerKind,
      blobSha: res.blobSha ?? stableHash(res.bodyText),
      etag: res.etag ?? null,
    });
    if (!options.dryRun) {
      await pool.query(
        `UPDATE ai_registry_source SET consecutive_failures = 0, backoff_seconds = 0, circuit_open_until = NULL,
         next_run_at = NOW() + make_interval(secs => sync_interval_seconds), updated_at = NOW() WHERE id = $1`,
        [src.id],
      );
      await pool.query("UPDATE ai_ops_alert SET resolved_at = NOW() WHERE source_code = $1 AND resolved_at IS NULL", [sourceCode]);
    }
    return result;
  } finally {
    if (locked) await lockClient.query("SELECT pg_advisory_unlock($1)", [AI_SYNC_LOCK_KEY]).catch(() => {});
    lockClient.release();
  }
}
