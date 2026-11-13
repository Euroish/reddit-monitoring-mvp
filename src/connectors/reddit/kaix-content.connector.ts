import { createHash } from "node:crypto";
import type { ContentReference, PublicContentKind, SourceCapability, SourceTarget } from "../../../packages/contracts/src/source-content";
import { stableUuidFromString } from "../../shared/ids/stable-id";
import { ARCTIC_SHIFT_CAPABILITY } from "./arctic-shift-content.connector";
import type { KaixConfig } from "./kaix.config";
import { ContentProviderError, type CollectedContent, type CollectContentPageRequest, type ContentProvider } from "../shared/content-provider.interface";

const WARNING = "Bounded kaix sample; no continuation cursor. New sorting may fall back to relevance. Local date/literal filters do not establish complete coverage. Comments support account or post targets only.";
type Row = Record<string, unknown>;
const object = (v: unknown): Row | null => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Row : null;
const text = (v: unknown): string | null => typeof v === "string" ? v : null;
const number = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
const literal = (v: string) => v.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
function httpUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  try { const u = new URL(v); return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; }
}

/** One bounded Actor run per collection operation. Never automatically resubmit an ambiguous paid POST. */
export class KaixContentConnector implements ContentProvider {
  readonly capability: SourceCapability;
  constructor(private readonly config: KaixConfig, private readonly fetcher: typeof fetch = fetch, private readonly now = () => new Date().toISOString()) {
    this.capability = {
      platform: "reddit", provider: "kaix", enabled: config.networkEnabled && Boolean(config.apiToken),
      contentKinds: ["post", "comment"], targetTypes: ["community", "account", "post", "search"], keywordSearch: "global",
      observationModel: "snapshot", metrics: ARCTIC_SHIFT_CAPABILITY.metrics,
      // Post detail always emits the root post in addition to at most 100 comments.
      requestResourceUpperBound: 101,
      automaticRequestReplay: false,
      limitations: [WARNING, "Paid Apify Actor 0.2.25; default budget disabled. Each operation includes a run POST and dataset GET. Event charge cap excludes platform usage.", "Source metric observation time is unknown. No automatic maturity refresh.", ...(!config.networkEnabled || !config.apiToken ? ["Requires live networking and private APIFY_API_TOKEN."] : [])],
    };
  }

  normalizeTarget(target: SourceTarget, kind: PublicContentKind): SourceTarget {
    if (!target || !["post", "comment"].includes(kind) || !this.capability.targetTypes.includes(target.type)) throw new ContentProviderError("Unsupported kaix target/content kind", false);
    const query = "query" in target ? target.query : undefined;
    if (query !== undefined && (typeof query !== "string" || !query.trim() || query.length > 200 || /[\u0000-\u001f\u007f]/.test(query))) throw new ContentProviderError("Kaix query must contain 1–200 characters without controls", false);
    if (target.type === "search") {
      if (!query || kind !== "post") throw new ContentProviderError("Kaix global search collects posts only", false);
      return { type: "search", query: query.trim() };
    }
    if (target.type === "feed") throw new ContentProviderError("Unsupported kaix target", false);
    if (target.type === "community" && kind !== "post" || target.type === "post" && kind !== "comment") throw new ContentProviderError("Kaix community targets collect posts; post targets collect comments", false);
    const raw = target.type === "community" ? target.community : target.type === "account" ? target.account : target.postId;
    if (typeof raw !== "string") throw new ContentProviderError("Invalid kaix target identifier", false);
    const name = raw.trim().replace(/^[ru]\//i, "").replace(/^t3_/i, "").toLowerCase();
    if (!(target.type === "post" ? /^[a-z0-9]{2,32}$/ : /^[a-z0-9_-]{2,40}$/).test(name)) throw new ContentProviderError("Invalid kaix target identifier", false);
    const filter = query ? { query: query.trim() } : {};
    return target.type === "community" ? { type: "community", community: name, ...filter } : target.type === "account" ? { type: "account", account: name, ...filter } : { type: "post", postId: name, ...filter };
  }

  async collectPage(request: CollectContentPageRequest) {
    if (!this.capability.enabled) throw new ContentProviderError("Kaix collection disabled; configure live networking and APIFY_API_TOKEN", false);
    if (request.source.platform !== "reddit" || request.source.provider !== "kaix") throw new ContentProviderError("Unsupported kaix source", false);
    if (request.checkpoint !== null) throw new ContentProviderError("Kaix does not support continuation checkpoints", false);
    if (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > 100) throw new ContentProviderError("Kaix page size must be 1–100", false);
    const from = Date.parse(request.from), to = Date.parse(request.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) throw new ContentProviderError("Invalid kaix collection window", false);
    const target = this.normalizeTarget(request.source.target, request.source.contentKind);
    request.signal?.throwIfAborted();
    const input: Row = { sort: "new", time: "all", depth: "detailed", includeNsfw: true, includeComments: false, maxItems: request.limit, maxCommentsPerPost: 1, proxyConfiguration: { useApifyProxy: false } };
    if (target.type === "search") Object.assign(input, { mode: "search", keyword: target.query });
    else if (target.type === "community") Object.assign(input, target.query ? { mode: "search", subreddit: target.community, keyword: target.query } : { mode: "subreddit", subreddit: target.community });
    else if (target.type === "account") Object.assign(input, { mode: "user", username: target.account, userContent: request.source.contentKind === "comment" ? "comments" : "submitted" });
    else if (target.type === "post") Object.assign(input, { mode: "post", postUrls: [target.postId], maxItems: 1, includeComments: true, maxCommentsPerPost: request.limit, commentSort: "new" });
    // Fixed build, memory and wall time bound platform usage independently of the Actor event cap.
    const start = new URL("https://api.apify.com/v2/acts/kaix~reddit-scraper/runs");
    start.search = new URLSearchParams({ build: "0.2.25", memory: "512", timeout: "45", waitForFinish: "60", maxTotalChargeUsd: "0.01", restartOnError: "false" }).toString();
    const body = object(await this.json(start, { method: "POST", body: JSON.stringify(input) }, request.signal, 65_000));
    const run = object(body?.data), runId = text(run?.id);
    if (!runId || !/^[a-zA-Z0-9]{1,64}$/.test(runId)) throw new ContentProviderError("Invalid kaix run response; check Apify console before Retry", false);
    if (run?.status !== "SUCCEEDED") throw new ContentProviderError(`Kaix run ${runId} did not succeed; inspect Apify console before Retry`, false);
    const datasetId = text(run.defaultDatasetId);
    if (!datasetId || !/^[a-zA-Z0-9]{1,64}$/.test(datasetId)) throw new ContentProviderError(`Kaix run ${runId} has no valid dataset`, false);
    const data = await this.json(new URL(`https://api.apify.com/v2/datasets/${datasetId}/items?format=json&limit=${request.limit + 2}`), {}, request.signal);
    if (!Array.isArray(data) || data.length > request.limit + (target.type === "post" ? 1 : 0)) throw new ContentProviderError(`Invalid kaix dataset for run ${runId}`, false);
    const fetchedAt = this.now(), items = new Map<string, CollectedContent>();
    for (const value of data) {
      const row = object(value);
      if (!row || !["post", "comment"].includes(String(row.type))) throw new ContentProviderError("Invalid kaix dataset record", false);
      if (row.type !== request.source.contentKind) { if (target.type === "post" && row.type === "post") continue; throw new ContentProviderError("Unexpected kaix content kind", false); }
      const item = this.normalize(row, request, fetchedAt);
      if (target.type === "community" && item.platformDetails.platform === "reddit" && item.platformDetails.community.toLowerCase() !== target.community) throw new ContentProviderError("Kaix returned a different community", false);
      if (target.type === "account" && item.author?.handle?.toLowerCase() !== target.account) continue;
      if (target.type === "post" && !item.references.some(ref => ref.relation === "thread_root" && ref.externalId === `t3_${target.postId}`)) throw new ContentProviderError("Kaix returned comments for a different post", false);
      if (!item.publishedAt || Date.parse(item.publishedAt) < from || Date.parse(item.publishedAt) >= to) continue;
      if ("query" in target && target.query && !literal(`${item.title ?? ""}\n${item.text ?? ""}`).includes(literal(target.query))) continue;
      items.set(item.externalId, item);
    }
    return { items: [...items.values()], nextCheckpoint: null, exhausted: true, coverage: "partial" as const, warning: WARNING };
  }

  private async json(url: URL, init: RequestInit, parent?: AbortSignal, timeoutMs = 20_000): Promise<unknown> {
    const signal = parent ? AbortSignal.any([parent, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
    try {
      const response = await this.fetcher(url, { ...init, signal, redirect: "error", headers: { Authorization: `Bearer ${this.config.apiToken}`, Accept: "application/json", "Content-Type": "application/json" } });
      if (!response.ok) { await response.body?.cancel(); throw new ContentProviderError(`Apify HTTP ${response.status}; check console before Retry (paid run may exist)`, false, 30, response.status); }
      const chunks: Uint8Array[] = []; let bytes = 0;
      const reader = response.body?.getReader();
      if (reader) try { for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 8 * 1024 * 1024) { await reader.cancel(); throw new ContentProviderError("Kaix response exceeds 8 MiB", false); } chunks.push(value); } } finally { reader.releaseLock(); }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch (error) {
      if (error instanceof ContentProviderError) throw error;
      throw new ContentProviderError("Kaix request interrupted or invalid JSON; check Apify console before Retry (paid run may exist)", false);
    }
  }

  private normalize(row: Row, request: CollectContentPageRequest, fetchedAt: string): CollectedContent {
    const kind = request.source.contentKind, prefix = kind === "comment" ? "t1_" : "t3_";
    const id = text(row.id), community = text(row.subreddit), created = number(row.createdUtc);
    if (!id || !/^[a-z0-9]{2,32}$/i.test(id) || !community || created === null || created <= 0 || created >= 253402300800) throw new ContentProviderError("Kaix record lacks valid identity/publication/community", false);
    const externalId = prefix + id.toLowerCase();
    if (row.fullName !== undefined && row.fullName !== externalId) throw new ContentProviderError("Kaix record identity mismatch", false);
    const body = text(kind === "post" ? row.selftext : row.body), author = text(row.author);
    const metrics: Record<string, number | null> = { "reddit.score": number(row.score) };
    if (kind === "post") { const count = number(row.numComments), ratio = number(row.upvoteRatio); metrics["reddit.num_comments"] = count !== null && Number.isInteger(count) && count >= 0 ? count : null; metrics["reddit.upvote_ratio"] = ratio !== null && ratio >= 0 && ratio <= 1 ? ratio : null; }
    const references: ContentReference[] = [];
    for (const [key, relation] of [["parentId", "reply_to"], ["linkId", "thread_root"], ["crosspostParentId", "repost"]] as const) {
      const ref = text(row[key]); if (ref && /^t[13]_[a-z0-9]{2,32}$/i.test(ref)) references.push({ kind: ref.startsWith("t1_") ? "comment" : "post", externalId: ref.toLowerCase(), relation });
    }
    const url = httpUrl(row.permalink), linked = httpUrl(row.url);
    const removed = body === "[removed]" || Boolean(row.removedByCategory), deleted = body === "[deleted]";
    return {
      id: stableUuidFromString(`reddit:content:${externalId}`), platform: "reddit", kind, externalId,
      title: kind === "post" ? text(row.title) : null, text: removed || deleted ? null : body, url, language: null,
      publishedAt: new Date(created * 1000).toISOString(), fetchedAt, availability: deleted ? "deleted" : removed ? "removed" : (kind === "post" ? text(row.title) !== null : body !== null) ? "available" : "unknown",
      author: author && author !== "[deleted]" ? { externalId: text(row.authorFullName), handle: author, displayName: null, url: `https://www.reddit.com/user/${encodeURIComponent(author)}/` } : null,
      references, media: linked && linked !== url ? [{ type: "link", url: linked, previewUrl: null, altText: null, durationSeconds: null }] : [],
      platformDetails: { platform: "reddit", community, flair: text(row.linkFlairText), nsfw: typeof row.over18 === "boolean" ? row.over18 : null },
      observation: { provider: "kaix", sourceId: request.source.id, sourceObservedAt: null, fetchedAt, timeBasis: "provider_snapshot", maturity: "unknown", metrics, evidenceKey: createHash("sha256").update(JSON.stringify({ externalId, fetchedAt, metrics })).digest("hex") },
    };
  }
}
