import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

const VENDOR_SLUG_ALIASES: Record<string, string> = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  "google-deepmind": "google",
  deepmind: "google",
  gemini: "google",
  meta: "meta",
  "meta-llama": "meta",
  deepseek: "deepseek",
  "deepseek-ai": "deepseek",
  qwen: "qwen",
  alibaba: "qwen",
  moonshot: "moonshot",
  moonshotai: "moonshot",
  kimi: "moonshot",
  zai: "zai",
  "z-ai": "zai",
  "zai-org": "zai",
  thudm: "zai",
  zhipu: "zai",
  mistral: "mistral",
  mistralai: "mistral",
  xai: "xai",
  "x-ai": "xai",
  "xai-org": "xai",
};

const TRACKING_QUERY_PARAMS = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "source",
  "spm",
]);

/** Normalize vendor slug or org handle into one of the canonical vendor slugs. */
export function normalizeVendorSlug(raw: string): string {
  const key = raw.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "");
  return VENDOR_SLUG_ALIASES[key] ?? key;
}

/** Normalize official model name for stable identity comparison without collapsing distinct versions. */
export function normalizeOfficialModelName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^a-z0-9.+-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Build a stable canonical model key: vendorSlug:normalizedName. */
export function canonicalModelKey(vendorSlug: string, officialName: string): string {
  const vendor = normalizeVendorSlug(vendorSlug);
  const model = normalizeOfficialModelName(officialName);
  return `${vendor}:${model}`;
}

/** Build a deterministic URL-safe slug for ai_model.slug (<= 90 chars). */
export function buildModelSlug(vendorSlug: string, officialName: string): string {
  const vendor = normalizeVendorSlug(vendorSlug);
  const norm = normalizeOfficialModelName(officialName).replace(/\+/g, "-plus");
  const combined = `${vendor}-${norm}`.replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (combined.length <= 90 && /^[a-z0-9][a-z0-9._-]{0,89}$/.test(combined)) return combined;
  const hash = createHash("sha256").update(`${vendor}:${officialName}`).digest("hex").slice(0, 10);
  return `${combined.slice(0, 79).replace(/-$/g, "")}-${hash}`;
}

/** Canonicalize an official source URL by stripping UTM/tracking params, fragments, and trailing slashes. */
export function canonicalizeSourceUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";
  try {
    const u = new URL(trimmed);
    u.hostname = u.hostname.toLowerCase();
    u.hash = "";
    const kept: Array<[string, string]> = [];
    for (const [k, v] of u.searchParams.entries()) {
      const lowerKey = k.toLowerCase();
      if (lowerKey.startsWith("utm_") || TRACKING_QUERY_PARAMS.has(lowerKey)) continue;
      kept.push([k, v]);
    }
    kept.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
    u.search = "";
    for (const [k, v] of kept) u.searchParams.append(k, v);
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.replace(/\/+$/, "");
    }
    return u.toString();
  } catch {
    return trimmed;
  }
}

/** Build the shared dedupe_key used by seed import, backfill, and live official discovery. */
export function canonicalEventKey(params: {
  vendorSlug: string;
  eventType: string;
  modelNameOrTitle: string;
  date: string | null;
}): string {
  const vendor = normalizeVendorSlug(params.vendorSlug);
  const eventType = params.eventType.trim().toLowerCase();
  const normalizedTarget = normalizeOfficialModelName(params.modelNameOrTitle);
  const datePart = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date.trim())
    ? params.date.trim()
    : "nodate";
  const digest = createHash("sha256")
    .update([vendor, eventType, normalizedTarget, datePart].join("|"))
    .digest("hex")
    .slice(0, 40);
  return `official:${vendor}:${digest}`;
}

export interface MatchedReleaseEvent {
  id: string;
  title: string;
  publicationStatus: string;
  sourceTier: string;
  dedupeKey: string | null;
}

/**
 * Find an existing ai_release_event matching by dedupe_key, canonicalized source URL + vendor + eventType + date,
 * or resolved model_id + vendor + eventType + date.
 */
export async function matchExistingRelease(
  client: PoolClient,
  params: {
    dedupeKey: string;
    vendorId: string;
    modelId?: string | null;
    eventType: string;
    eventDate: string;
    referenceUrls?: string[];
  },
): Promise<MatchedReleaseEvent | null> {
  const byKey = await client.query<MatchedReleaseEvent>(
    `SELECT id, title, publication_status AS "publicationStatus",
            source_tier AS "sourceTier", dedupe_key AS "dedupeKey"
     FROM ai_release_event
     WHERE dedupe_key = $1
     LIMIT 1`,
    [params.dedupeKey],
  );
  if (byKey.rows[0]) return byKey.rows[0];

  if (params.modelId) {
    const byModelDate = await client.query<MatchedReleaseEvent>(
      `SELECT id, title, publication_status AS "publicationStatus",
              source_tier AS "sourceTier", dedupe_key AS "dedupeKey"
       FROM ai_release_event
       WHERE vendor_id = $1::uuid
         AND model_id = $2::uuid
         AND event_type = $3
         AND event_date = $4::date
       ORDER BY created_at ASC
       LIMIT 1`,
      [params.vendorId, params.modelId, params.eventType, params.eventDate],
    );
    if (byModelDate.rows[0]) return byModelDate.rows[0];
  }

  const canonicalUrls = (params.referenceUrls ?? [])
    .map(canonicalizeSourceUrl)
    .filter((u) => u.length > 0);
  if (canonicalUrls.length > 0) {
    const byUrlRes = await client.query<MatchedReleaseEvent & { refUrl: string; modelId: string | null }>(
      `SELECT e.id, e.title, e.publication_status AS "publicationStatus",
              e.source_tier AS "sourceTier", e.dedupe_key AS "dedupeKey",
              e.model_id AS "modelId", r.url AS "refUrl"
       FROM ai_release_event e
       JOIN ai_event_reference r ON r.event_id = e.id
       WHERE e.vendor_id = $1::uuid
         AND e.event_type = $2
         AND e.event_date = $3::date`,
      [params.vendorId, params.eventType, params.eventDate],
    );
    const urlSet = new Set(canonicalUrls);
    const matched = byUrlRes.rows.find((row) =>
      urlSet.has(canonicalizeSourceUrl(row.refUrl)) &&
      (!params.modelId || !row.modelId || row.modelId === params.modelId),
    );
    if (matched) {
      return {
        id: matched.id,
        title: matched.title,
        publicationStatus: matched.publicationStatus,
        sourceTier: matched.sourceTier,
        dedupeKey: matched.dedupeKey,
      };
    }
  }

  return null;
}
