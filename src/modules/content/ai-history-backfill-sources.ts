import { readFileSync } from "node:fs";
import type { Pool, PoolClient } from "pg";
import { ContentProviderError } from "../../connectors/shared/content-provider.interface";
import { httpsUrl, read } from "../../connectors/web/http";
import { transaction } from "../../storage/db";
import { normalizeVendorSlug } from "./ai-event-identity";
import { isSuspectedEpochPaddingDate } from "./ai-history-schema";
import { isOfficialVendorUrl, parseEpochCsv } from "./ai-registry";

export interface BackfillOptions {
  sourceCode: "content_history" | "official_archive" | "epoch_csv";
  vendorSlug?: string;
  dateFrom?: string;
  dateTo?: string;
  batchSize?: number;
  maxItems?: number;
  dryRun?: boolean;
  resume?: boolean;
  autoPublish?: boolean;
  csvPath?: string;
  archiveUrls?: Array<{ vendorSlug: string; url: string }>;
  fetcher?: (url: string, headers: Record<string, string>) => Promise<{ status: number; bodyText?: string }>;
}

export interface BackfillResult {
  runId: string;
  sourceCode: string;
  status: "succeeded" | "paused" | "failed";
  scanned: number;
  published: number;
  candidatesCreated: number;
  skipped: number;
  conflicts: number;
  cursor: Record<string, unknown>;
}

type ProcessArticleFn = (
  client: PoolClient,
  vendor: { id: string; slug: string; official_domains: string[]; auto_publish_enabled: boolean },
  article: { contentId: string | null; title: string; bodyText: string | null; url: string; publishedDate: string | null },
  allowAutoPublish: boolean,
) => Promise<"published" | "candidate" | "skipped">;

type UpdateProgressFn = (
  pool: Pool,
  runId: string,
  status: "running" | "paused" | "succeeded" | "failed",
  counts: { scanned: number; published: number; candidatesCreated: number; skipped: number; conflicts: number },
  cursor: Record<string, unknown>,
  errorMessage?: string | null,
) => Promise<void>;

/** Import Epoch AI CSV rows strictly as unverified research leads (never directly to ai_release_event). */
export async function runEpochCsvBackfill(
  pool: Pool,
  opts: BackfillOptions,
  runId: string,
  updateProgress: UpdateProgressFn,
): Promise<BackfillResult> {
  if (!opts.csvPath) throw new Error("csvPath is required for epoch_csv backfill");
  const csvText = readFileSync(opts.csvPath, "utf8");
  const maxItems = Math.min(5000, Math.max(1, opts.maxItems ?? 250));
  const items = parseEpochCsv(csvText, maxItems);
  const vendorsRes = await pool.query<{ id: string; slug: string }>(`SELECT id, slug FROM ai_vendor`);
  const vendorBySlug = new Map(vendorsRes.rows.map((v) => [v.slug, v.id]));
  const counts = { scanned: 0, published: 0, candidatesCreated: 0, skipped: 0, conflicts: 0 };

  if (!opts.dryRun) {
    await transaction(pool, async (client) => {
      for (const item of items) {
        counts.scanned += 1;
        if (opts.vendorSlug && item.vendorSlugHint !== normalizeVendorSlug(opts.vendorSlug)) {
          counts.skipped += 1;
          continue;
        }
        const rawDate = item.historicalDate?.date ?? null;
        const suspectedPadding = isSuspectedEpochPaddingDate(rawDate);
        const precision = suspectedPadding ? "unknown" : (item.historicalDate?.precision ?? "unknown");
        const suggestedDate = suspectedPadding ? null : rawDate;
        const vendorId = item.vendorSlugHint ? (vendorBySlug.get(item.vendorSlugHint) ?? null) : null;
        const dedupeKey = `epoch:${item.externalId}:${item.contentHash.slice(0, 16)}`;

        await client.query(
          `INSERT INTO ai_event_candidate (
             dedupe_key, candidate_type, status, priority, vendor_id,
             title, external_id, suggested_date, date_precision, draft_payload, evidence_payload
           ) VALUES ($1, 'historical_import', 'needs_info', 40, $2, $3, $4, $5::date, $6, $7::jsonb, $8::jsonb)
           ON CONFLICT (dedupe_key) DO UPDATE SET last_seen_at = NOW(), updated_at = NOW()`,
          [
            dedupeKey,
            vendorId,
            `${item.displayName} (Epoch AI lead)`,
            item.externalId,
            suggestedDate,
            precision,
            JSON.stringify({
              rawEpochDate: rawDate,
              suspectedPadding,
              attribution: item.rawUnitNote,
              sourceUrl: item.historicalDate?.url ?? null,
            }),
            JSON.stringify(item.historicalDate?.url ? [{ url: item.historicalDate.url, title: item.displayName }] : []),
          ],
        );
        counts.candidatesCreated += 1;
      }
    });
  } else {
    counts.scanned = items.length;
  }

  await updateProgress(pool, runId, "succeeded", counts, { imported: counts.candidatesCreated });
  return { runId, sourceCode: opts.sourceCode, status: "succeeded", ...counts, cursor: { imported: counts.candidatesCreated } };
}

async function defaultArchiveFetcher(url: string, headers: Record<string, string>, officialDomains: string[]) {
  const target = httpsUrl(url);
  if (!target) return { status: 400 };
  try {
    const result = await read(target, undefined, headers, 15_000, {
      allowRedirect: (next) => isOfficialVendorUrl(next.href, officialDomains),
    });
    return { status: result.status, bodyText: result.body };
  } catch (error) {
    if (error instanceof ContentProviderError) return { status: error.httpStatus ?? 502 };
    throw error;
  }
}

function extractArchiveItems(bodyText: string): Array<{ url: string; title: string; date: string | null }> {
  const out: Array<{ url: string; title: string; date: string | null }> = [];
  for (const m of bodyText.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const block = m[1];
    const link = block.match(/<link>([^<]+)<\/link>/i)?.[1]?.trim() ?? "";
    const title = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1]?.trim() ?? link;
    const pub = block.match(/<pubDate>([^<]+)<\/pubDate>/i)?.[1]?.trim();
    const dt = pub ? new Date(pub) : null;
    const iso = dt && !Number.isNaN(dt.getTime()) ? dt.toISOString().slice(0, 10) : null;
    if (link) out.push({ url: link, title, date: iso });
  }
  if (out.length > 0) return out;
  for (const m of bodyText.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/gi)) {
    const loc = m[1].match(/<loc>([^<]+)<\/loc>/i)?.[1]?.trim() ?? "";
    if (loc) out.push({ url: loc, title: loc.split("/").filter(Boolean).pop() ?? loc, date: null });
  }
  return out;
}

/** Domain-allowlisted official RSS/Atom/Sitemap historical archive scanner with checkpointing. */
export async function runOfficialArchiveBackfill(
  pool: Pool,
  opts: BackfillOptions,
  runId: string,
  initialCursor: Record<string, unknown>,
  processArticle: ProcessArticleFn,
  updateProgress: UpdateProgressFn,
): Promise<BackfillResult> {
  const urls = opts.archiveUrls ?? [];
  if (urls.length === 0) throw new Error("archiveUrls is required for official_archive backfill");
  const maxItems = Math.min(2000, Math.max(1, opts.maxItems ?? 200));
  const vendorsRes = await pool.query<{ id: string; slug: string; official_domains: string[]; auto_publish_enabled: boolean }>(
    `SELECT id, slug, official_domains, auto_publish_enabled FROM ai_vendor`,
  );
  const startIdx = typeof initialCursor.archiveIdx === "number" ? initialCursor.archiveIdx : 0;
  const counts = { scanned: 0, published: 0, candidatesCreated: 0, skipped: 0, conflicts: 0 };

  for (let idx = startIdx; idx < urls.length && counts.scanned < maxItems; idx++) {
    const entry = urls[idx];
    const vendor = vendorsRes.rows.find((v) => v.slug === normalizeVendorSlug(entry.vendorSlug));
    if (!vendor || !isOfficialVendorUrl(entry.url, vendor.official_domains)) {
      counts.conflicts += 1;
      continue;
    }
    const headers = { "user-agent": "SIFTLINE-History-Backfill/1.0" };
    const res = opts.fetcher
      ? await opts.fetcher(entry.url, headers)
      : await defaultArchiveFetcher(entry.url, headers, vendor.official_domains);
    if (res.status >= 400 || !res.bodyText) {
      await updateProgress(pool, runId, "paused", counts, { archiveIdx: idx }, `Archive returned HTTP ${res.status}`);
      return { runId, sourceCode: opts.sourceCode, status: "paused", ...counts, cursor: { archiveIdx: idx } };
    }
    const items = extractArchiveItems(res.bodyText).slice(0, maxItems - counts.scanned);
    if (!opts.dryRun) {
      await transaction(pool, async (client) => {
        for (const item of items) {
          counts.scanned += 1;
          const out = await processArticle(client, vendor, {
            contentId: null,
            title: item.title,
            bodyText: null,
            url: item.url,
            publishedDate: item.date,
          }, opts.autoPublish ?? false);
          if (out === "published") counts.published += 1;
          else if (out === "candidate") counts.candidatesCreated += 1;
          else counts.skipped += 1;
        }
      });
    } else {
      counts.scanned += items.length;
    }
    await updateProgress(pool, runId, "running", counts, { archiveIdx: idx + 1 });
  }

  await updateProgress(pool, runId, "succeeded", counts, { archiveIdx: urls.length });
  return { runId, sourceCode: opts.sourceCode, status: "succeeded", ...counts, cursor: { archiveIdx: urls.length } };
}
