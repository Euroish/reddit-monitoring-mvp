import type { Pool } from "pg";
import { fail } from "../../shared/errors";
import { transaction } from "../../storage/db";
import { listAiFirsthandArticles, type AiFirsthandArticleRow } from "../content/index";
import {
  buildModelSlug,
  canonicalEventKey,
  canonicalizeSourceUrl,
  matchExistingRelease,
} from "./ai-event-identity";
import { isOfficialVendorUrl } from "./ai-registry";
import { extractWithOptionalLlm, llmDailyBudget, llmRequestsReservedToday } from "./ai-llm";
import type { AiCredentialVault } from "./ai-credentials";

export interface OfficialArticleRow {
  contentId: string;
  title: string;
  bodyText: string | null;
  url: string | null;
  publishedAt: string | null;
  vendorId: string | null;
  vendorSlug: string | null;
  vendorName: string | null;
  officialDomains: string[];
  autoPublishEnabled: boolean;
}

export interface ClassifiedAnnouncement {
  eventType: "model_release" | "model_update" | "api_release" | "pricing_change" | "deprecation";
  eventStatus: "released" | "announced_future" | "deprecated";
  modelName: string | null;
  confidence: number;
  ruleName: string;
}

const MODEL_PATTERNS: Array<{ re: RegExp; eventType?: ClassifiedAnnouncement["eventType"] }> = [
  { re: /\b(gpt-[45](?:\.\d+)?(?:\s*(?:o|mini|nano|turbo|pro|codex))?|o[134](?:-mini|-pro)?)\b/i },
  { re: /\b(claude\s*(?:3(?:\.[57])?|4(?:\.\d+)?)\s*(?:opus|sonnet|haiku)?|claude\s*(?:opus|sonnet|haiku)\s*4(?:\.\d+)?)\b/i },
  { re: /\b(gemini\s*[23](?:\.\d+)?\s*(?:pro|flash|ultra|lite)?|gemma\s*[23](?:\.\d+)?)\b/i },
  { re: /\b(llama\s*[34](?:\.\d+)?(?:\s*(?:scout|maverick|behemoth))?)\b/i },
  { re: /\b(deepseek[- ](?:r[12]|v[23](?:\.\d+)?|prover|coder))\b/i },
  { re: /\b(qwen\s*[23](?:\.\d+)?(?:-\w+)?|qwq-\w+)\b/i },
  { re: /\b(kimi\s*k[12](?:\.\d+)?|moonshot-v\d+)\b/i },
  { re: /\b(glm-[45](?:\.\d+)?(?:v|z|x|-plus|-air|-flash)?)\b/i },
  { re: /\b(mistral\s*(?:large|medium|small|nemo|codestral|pixtral)\s*[\d.]*|magistral)\b/i },
  { re: /\b(grok[- ]?[234](?:\.\d+)?(?:\s*(?:mini|heavy|beta))?)\b/i },
];

export function classifyOfficialAnnouncement(title: string, bodyText: string | null): ClassifiedAnnouncement | null {
  const combined = `${title}\n${(bodyText ?? "").slice(0, 800)}`;
  let modelName: string | null = null;
  for (const p of MODEL_PATTERNS) {
    const m = title.match(p.re) ?? combined.match(p.re);
    if (m?.[1]) {
      modelName = m[1].trim().replace(/\s+/g, " ");
      break;
    }
  }
  const lower = title.toLowerCase();
  const isDeprecate = /\b(deprecat\w*|retir\w*|sunset\w*|shutting down|end of life)\b|弃用|下线|停止服务/i.test(lower);
  const isPricing = /\b(pricing|price cut|price drop|lower prices|cheaper|per million tokens)\b|降价|价格调整/i.test(lower);
  const isApi = /\b(api|general availability|\bga\b|now available in api|developer preview)\b|开放\s*api|正式开放/i.test(lower);
  const isRelease = /\b(introducing|announcing|release|releasing|launch|launching|unveil|meets?|new model)\b|发布|推出|开源|上线/i.test(lower);
  const isUpdate = /\b(update|upgraded|improved|changelog|new version|v\d+\.\d+)\b|更新|升级|迭代/i.test(lower);
  const isFuture = /\b(coming soon|previewing|will be available|later this (?:month|year)|upcoming)\b|即将推出|预告/i.test(lower);

  if (!modelName && !isDeprecate && !isPricing) return null;
  if (isDeprecate) {
    return { eventType: "deprecation", eventStatus: "deprecated", modelName, confidence: modelName ? 0.92 : 0.72, ruleName: "official_deprecation_v1" };
  }
  if (isPricing) {
    return { eventType: "pricing_change", eventStatus: "released", modelName, confidence: modelName ? 0.90 : 0.70, ruleName: "official_pricing_v1" };
  }
  if (isRelease && modelName) {
    return {
      eventType: "model_release",
      eventStatus: isFuture ? "announced_future" : "released",
      modelName,
      confidence: 0.95,
      ruleName: "official_model_release_v1",
    };
  }
  if (isApi && modelName) {
    return { eventType: "api_release", eventStatus: "released", modelName, confidence: 0.90, ruleName: "official_api_release_v1" };
  }
  if (isUpdate && modelName) {
    return { eventType: "model_update", eventStatus: "released", modelName, confidence: 0.86, ruleName: "official_model_update_v1" };
  }
  return null;
}

interface VendorRow {
  id: string;
  slug: string;
  name: string;
  official_domains: string[];
  auto_publish_enabled: boolean;
}

async function classifyArticleCandidate(
  pool: Pool,
  vendor: VendorRow,
  row: AiFirsthandArticleRow,
  url: string,
  aiVault?: AiCredentialVault,
) {
  let classified = classifyOfficialAnnouncement(row.title, row.bodyText);
  const officialDate = row.publishedAt ? row.publishedAt.slice(0, 10) : null;
  if (!classified) {
    const resolvedLlm = aiVault?.resolve("ai_llm");
    const llm = await extractWithOptionalLlm(pool, {
      referenceId: row.contentId,
      vendorName: vendor.name,
      title: row.title,
      bodyText: row.bodyText ?? "",
      publishedDate: officialDate,
      url,
    }, resolvedLlm ? {
      apiUrl: resolvedLlm.config.apiUrl,
      apiKey: resolvedLlm.apiKey,
      model: resolvedLlm.config.model,
    } : {});
    if ((llm.status === "ok" || llm.status === "cached") && !llm.data.insufficient_evidence && llm.data.official_model_name) {
      const mappedType =
        llm.data.event_type === "unknown" || llm.data.event_type === "other" ? "model_update" : llm.data.event_type;
      classified = {
        eventType: mappedType,
        eventStatus: "released",
        modelName: llm.data.official_model_name,
        confidence: 0.88,
        ruleName: "llm_verified_official_v1",
      };
    }
  }
  return { classified, officialDate };
}

async function queueDiscoveryCandidate(
  pool: Pool,
  vendor: VendorRow,
  row: AiFirsthandArticleRow,
  classified: ClassifiedAnnouncement,
  eventKey: string,
  url: string,
  officialDate: string | null,
) {
  const candRes = await pool.query<{ id: string }>(
    `INSERT INTO ai_event_candidate (
       dedupe_key, candidate_type, status, priority, vendor_id, content_id,
       title, suggested_event_type, suggested_date, date_precision, draft_payload, evidence_payload
     ) VALUES ($1, 'official_document', 'needs_info', 70, $2, $3, $4, $5, NULL, 'unknown', $6::jsonb, $7::jsonb)
     ON CONFLICT (dedupe_key) DO UPDATE SET last_seen_at = NOW(), updated_at = NOW()
     RETURNING id`,
    [
      eventKey, vendor.id, row.contentId, row.title.slice(0, 240), classified.eventType,
      JSON.stringify({ officialUrl: url, modelName: classified.modelName, ruleName: classified.ruleName }),
      JSON.stringify([{ contentId: row.contentId, url, title: row.title }]),
    ],
  );
  await pool.query(
    `INSERT INTO ai_auto_publish_audit (mode, vendor_id, candidate_id, content_id, confidence, rule_name, reason, evidence_snapshot)
     VALUES ('shadow_reject', $1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      vendor.id, candRes.rows[0].id, row.contentId, classified.confidence, classified.ruleName,
      !officialDate ? "Missing explicit official publication date" : "Confidence below auto-publish threshold",
      JSON.stringify({ url, title: row.title }),
    ],
  );
}

async function linkExistingReleaseIfMatched(
  pool: Pool,
  vendor: VendorRow,
  row: AiFirsthandArticleRow,
  classified: ClassifiedAnnouncement,
  eventKey: string,
  officialDate: string,
  canonicalUrl: string,
) {
  return transaction(pool, async (client) => {
    const modelSlug = buildModelSlug(vendor.slug, classified.modelName!);
    const modelRow = await client.query<{ id: string }>("SELECT id FROM ai_model WHERE slug = $1 LIMIT 1", [modelSlug]);
    const found = await matchExistingRelease(client, {
      dedupeKey: eventKey, vendorId: vendor.id, modelId: modelRow.rows[0]?.id ?? null,
      eventType: classified.eventType, eventDate: officialDate, referenceUrls: [canonicalUrl],
    });
    if (!found) return false;
    const existingRefs = await client.query<{ url: string }>("SELECT url FROM ai_event_reference WHERE event_id = $1", [found.id]);
    if (canonicalUrl && !existingRefs.rows.some((r) => canonicalizeSourceUrl(r.url) === canonicalUrl)) {
      await client.query(
        `INSERT INTO ai_event_reference (event_id, content_id, title, url, source_kind, is_primary, verified_at)
         VALUES ($1, $2, $3, $4, 'official', FALSE, NOW())`,
        [found.id, row.contentId, row.title.slice(0, 240), canonicalUrl],
      );
    }
    return true;
  });
}

async function evaluateDiscoveryArticle(
  pool: Pool,
  vendors: VendorRow[],
  vendorBySourceId: Map<string, string>,
  shadowMode: boolean,
  row: AiFirsthandArticleRow,
  aiVault?: AiCredentialVault,
): Promise<"skipped" | "queued" | "published" | "shadow" | "noop"> {
  const url = (row.url ?? "").trim();
  const mappedVendorId = vendorBySourceId.get(row.collectionSourceId);
  const vendor =
    (mappedVendorId ? vendors.find((v) => v.id === mappedVendorId) : undefined) ??
    vendors.find((v) => url && isOfficialVendorUrl(url, v.official_domains));
  if (!vendor || !url || !isOfficialVendorUrl(url, vendor.official_domains)) return "skipped";

  const { classified, officialDate } = await classifyArticleCandidate(pool, vendor, row, url, aiVault);
  if (!classified) return "noop";

  const eventKey = canonicalEventKey({
    vendorSlug: vendor.slug,
    eventType: classified.eventType,
    modelNameOrTitle: classified.modelName ?? row.title,
    date: officialDate,
  });
  if (!officialDate || !/^\d{4}-\d{2}-\d{2}$/.test(officialDate) || classified.confidence < 0.85 || !classified.modelName) {
    await queueDiscoveryCandidate(pool, vendor, row, classified, eventKey, url, officialDate);
    return "queued";
  }
  const canonicalUrl = canonicalizeSourceUrl(url);
  if (await linkExistingReleaseIfMatched(pool, vendor, row, classified, eventKey, officialDate, canonicalUrl)) {
    return "noop";
  }
  if (!shadowMode && vendor.auto_publish_enabled) {
    let published = false;
    await transaction(pool, async (client) => {
      const modelSlug = buildModelSlug(vendor.slug, classified.modelName!);
      const modelRes = await client.query<{ id: string }>(
        `INSERT INTO ai_model (vendor_id, slug, official_name, lifecycle_state)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (slug) DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [vendor.id, modelSlug, classified.modelName!, classified.eventStatus === "deprecated" ? "deprecated" : "active"],
      );
      const evRes = await client.query<{ id: string }>(
        `INSERT INTO ai_release_event (
           vendor_id, model_id, event_type, event_status, publication_status,
           title, event_date, date_precision, official_announced_on,
           summary_en, source_tier, dedupe_key
         ) VALUES ($1,$2,$3,$4,'published',$5,$6::date,'day',$6::date,$7,'official',$8)
         ON CONFLICT (dedupe_key) DO NOTHING
         RETURNING id`,
        [
          vendor.id, modelRes.rows[0].id, classified.eventType, classified.eventStatus,
          row.title.slice(0, 240), officialDate, row.bodyText ? row.bodyText.slice(0, 320) : null, eventKey,
        ],
      );
      if (evRes.rows[0]) {
        await client.query(
          `INSERT INTO ai_event_reference (event_id, content_id, title, url, source_kind, is_primary, verified_at)
           VALUES ($1, $2, $3, $4, 'official', TRUE, NOW())`,
          [evRes.rows[0].id, row.contentId, row.title.slice(0, 240), url],
        );
        await client.query(
          `INSERT INTO ai_auto_publish_audit (mode, vendor_id, event_id, content_id, confidence, rule_name, reason, evidence_snapshot)
           VALUES ('auto_publish', $1, $2, $3, $4, $5, 'Verified official domain + explicit date + model identity', $6::jsonb)`,
          [vendor.id, evRes.rows[0].id, row.contentId, classified.confidence, classified.ruleName, JSON.stringify({ url, officialDate, modelName: classified.modelName })],
        );
        published = true;
      }
    });
    return published ? "published" : "noop";
  }
  const candRes = await pool.query<{ id: string }>(
    `INSERT INTO ai_event_candidate (
       dedupe_key, candidate_type, status, priority, vendor_id, content_id,
       title, suggested_event_type, suggested_date, date_precision, draft_payload, evidence_payload
     ) VALUES ($1, 'release_event', 'pending', 85, $2, $3, $4, $5, $6::date, 'day', $7::jsonb, $8::jsonb)
     ON CONFLICT (dedupe_key) DO UPDATE SET last_seen_at = NOW(), updated_at = NOW()
     RETURNING id`,
    [
      eventKey, vendor.id, row.contentId, row.title.slice(0, 240), classified.eventType, officialDate,
      JSON.stringify({ officialUrl: url, modelName: classified.modelName, ruleName: classified.ruleName, shadowPassed: true }),
      JSON.stringify([{ contentId: row.contentId, url, title: row.title }]),
    ],
  );
  await pool.query(
    `INSERT INTO ai_auto_publish_audit (mode, vendor_id, candidate_id, content_id, confidence, rule_name, reason, evidence_snapshot)
     VALUES ('shadow_pass', $1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      vendor.id, candRes.rows[0].id, row.contentId, classified.confidence, classified.ruleName,
      shadowMode ? "Global shadow mode active" : `Vendor ${vendor.slug} auto_publish_enabled=false`,
      JSON.stringify({ url, officialDate, modelName: classified.modelName }),
    ],
  );
  return "shadow";
}

export async function runOfficialEventDiscovery(
  pool: Pool,
  options: { shadowMode?: boolean; lookbackHours?: number; limit?: number; aiVault?: AiCredentialVault } = {},
) {
  await options.aiVault?.ensureLoaded();
  const shadowMode = options.shadowMode ?? (process.env.AI_AUTO_PUBLISH_SHADOW === "true");
  const lookbackHours = Math.min(24 * 365, Math.max(1, options.lookbackHours ?? 72));
  const limit = Math.min(200, Math.max(1, options.limit ?? 80));

  const [vendorsRes, vendorSourcesRes] = await Promise.all([
    pool.query<VendorRow>("SELECT id, slug, name, official_domains, auto_publish_enabled FROM ai_vendor"),
    pool.query<{ source_id: string; vendor_id: string }>("SELECT source_id, vendor_id FROM ai_vendor_source"),
  ]);
  const vendorBySourceId = new Map(vendorSourcesRes.rows.map((r) => [r.source_id, r.vendor_id]));
  const articles = await listAiFirsthandArticles(pool, {
    sourceIds: [...vendorBySourceId.keys()],
    sinceHours: lookbackHours,
    limit,
  });

  let autoPublished = 0;
  let shadowPassed = 0;
  let candidatesQueued = 0;
  let skippedNonOfficial = 0;
  for (const row of articles) {
    const outcome = await evaluateDiscoveryArticle(pool, vendorsRes.rows, vendorBySourceId, shadowMode, row, options.aiVault);
    if (outcome === "published") autoPublished += 1;
    else if (outcome === "shadow") shadowPassed += 1;
    else if (outcome === "queued") candidatesQueued += 1;
    else if (outcome === "skipped") skippedNonOfficial += 1;
  }
  return { scanned: articles.length, autoPublished, shadowPassed, candidatesQueued, skippedNonOfficial };
}

export async function archiveLowValueCandidates(pool: Pool, olderThanHours = 24): Promise<{ archived: number }> {
  const res = await pool.query<{ id: string; vendor_id: string | null }>(
    `UPDATE ai_event_candidate
     SET status = 'deferred',
         reviewer_note = COALESCE(reviewer_note, 'Auto-archived low-value registry spec observation without official announcement'),
         revision = revision + 1,
         updated_at = NOW()
     WHERE status = 'pending'
       AND candidate_type IN ('spec_change', 'pricing_observation', 'listing_missing')
       AND content_id IS NULL
       AND created_at <= NOW() - make_interval(hours => $1)
     RETURNING id, vendor_id`,
    [olderThanHours],
  );
  if (res.rows.length > 0) {
    await pool.query(
      `INSERT INTO ai_auto_publish_audit (mode, vendor_id, candidate_id, rule_name, reason)
       SELECT 'low_value_archived', v_id, c_id, 'queue_hygiene_v1', 'Archived uncorroborated registry micro-change'
       FROM UNNEST($1::uuid[], $2::uuid[]) AS u(v_id, c_id)`,
      [res.rows.map((r) => r.vendor_id), res.rows.map((r) => r.id)],
    );
  }
  return { archived: res.rowCount ?? 0 };
}

export async function rollbackAiEvent(
  pool: Pool,
  eventId: string,
  reason: string,
  mode: "auto_rollback" | "manual_rollback" = "manual_rollback",
) {
  return transaction(pool, async (client) => {
    const res = await client.query<{ id: string; vendor_id: string; title: string }>(
      `UPDATE ai_release_event
       SET publication_status = 'unpublished', revision = revision + 1, updated_at = NOW()
       WHERE id = $1::uuid
       RETURNING id, vendor_id, title`,
      [eventId],
    );
    if (!res.rows[0]) fail(404, "AI release event not found");
    await client.query(
      `INSERT INTO ai_auto_publish_audit (mode, vendor_id, event_id, rule_name, reason)
       VALUES ($1, $2, $3, 'rollback_guard_v1', $4)`,
      [mode, res.rows[0].vendor_id, eventId, reason],
    );
    await client.query(
      `INSERT INTO ai_ops_alert (severity, source_code, alert_key, message, details)
       VALUES ('warning', 'official_discovery', $1, $2, $3::jsonb)`,
      [`rollback:${eventId}`, `Event rolled back: ${res.rows[0].title}`, JSON.stringify({ eventId, reason, mode })],
    );
    return { id: eventId, visibility: "unpublished", rolledBack: true };
  });
}

export type ReadWorkerHealth = (pool: Pool) => Promise<{ state: string; lastHeartbeatAt: Date; heartbeatFresh: boolean } | null>;

export async function getAiOpsSummary(
  pool: Pool,
  days = 7,
  readWorkerHealth?: ReadWorkerHealth,
  aiVault?: AiCredentialVault,
) {
  await aiVault?.ensureLoaded();
  const safeDays = Math.min(30, Math.max(1, days));
  const [auditCounts, openAlerts, recentRuns, vendorPolicy, llmReserved, worker] = await Promise.all([
    pool.query<{ mode: string; count: number }>(
      `SELECT mode, COUNT(*)::int AS count FROM ai_auto_publish_audit
       WHERE created_at >= NOW() - make_interval(days => $1) GROUP BY mode`,
      [safeDays],
    ),
    pool.query(
      `SELECT id, severity, source_code AS "sourceCode", alert_key AS "alertKey",
              message, details, created_at AS "createdAt"
       FROM ai_ops_alert WHERE resolved_at IS NULL ORDER BY created_at DESC LIMIT 20`,
    ),
    pool.query(
      `SELECT source_code AS "sourceCode", status, COUNT(*)::int AS runs,
              SUM(candidates_created)::int AS "candidatesCreated"
       FROM ai_sync_run WHERE started_at >= NOW() - make_interval(days => $1)
       GROUP BY source_code, status ORDER BY source_code`,
      [safeDays],
    ),
    pool.query(
      `SELECT id, slug, name, auto_publish_enabled AS "autoPublishEnabled", official_domains AS "officialDomains"
       FROM ai_vendor ORDER BY display_order ASC`,
    ),
    llmRequestsReservedToday(pool),
    readWorkerHealth?.(pool) ?? null,
  ]);
  const counts = Object.fromEntries(auditCounts.rows.map((r) => [r.mode, r.count]));
  const llmStatus = aiVault?.resolve("ai_llm");
  const aaStatus = aiVault?.resolve("artificial_analysis");
  return {
    windowDays: safeDays,
    shadowMode: process.env.AI_AUTO_PUBLISH_SHADOW === "true",
    schedulerConfigured: process.env.AI_SYNC_ENABLED === "true",
    collectionWorker: worker,
    llmBudget: { dailyLimit: llmDailyBudget(), reservedToday: llmReserved },
    sourceNetworkingConfigured: process.env.SOURCE_NETWORK_ENABLED === "true",
    llmConfigured: llmStatus ? llmStatus.configured : Boolean(process.env.AI_LLM_API_URL?.trim() && process.env.AI_LLM_API_KEY?.trim()),
    aaKeyConfigured: aaStatus ? aaStatus.configured : Boolean(process.env.ARTIFICIAL_ANALYSIS_API_KEY?.trim()),
    aaPublicRedistribution: aaStatus ? Boolean(aaStatus.config.publicRedistribution) : process.env.ARTIFICIAL_ANALYSIS_PUBLIC_REDISTRIBUTION === "true",
    metrics: {
      autoPublished: counts.auto_publish ?? 0,
      shadowPassed: counts.shadow_pass ?? 0,
      shadowRejected: counts.shadow_reject ?? 0,
      lowValueArchived: counts.low_value_archived ?? 0,
      rolledBack: (counts.manual_rollback ?? 0) + (counts.auto_rollback ?? 0),
    },
    openAlerts: openAlerts.rows,
    recentRuns: recentRuns.rows,
    vendors: vendorPolicy.rows,
  };
}
