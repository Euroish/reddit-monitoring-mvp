import { createHash } from "node:crypto";
import type { ContentMedia, ContentReference, JsonValue, PublicContentKind, SourceCapability, SourceTarget } from "../../../packages/contracts/src/source-content";
import { stableUuidFromString } from "../../shared/ids/stable-id";
import { ContentProviderError, type CollectedContent, type CollectedPage, type CollectContentPageRequest, type ContentProvider } from "../shared/content-provider.interface";
import type { TwitterApiIoConfig } from "./twitterapi-io.config";

const PROVIDER = "twitterapi_io";
const BASE_URL = "https://api.twitterapi.io";
const MAX_PAGE_RESOURCES = 20;
const MAX_QUERY_CHARS = 400;
const ADAPTER_VERSION = "twitterapi_io_v1";
type RecordValue = Record<string, unknown>;
function object(value: unknown): RecordValue | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null; }
function string(value: unknown): string | null { return typeof value === "string" ? value : null; }
function id(value: unknown): string | null { return typeof value === "string" && /^[1-9][0-9]{0,29}$/.test(value) ? value : null; }
function count(value: unknown): number | null { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null; }
function bool(value: unknown): boolean | null { return typeof value === "boolean" ? value : null; }
function httpUrl(value: unknown): string | null { if (typeof value !== "string") return null; try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.href : null; } catch { return null; } }
function timestamp(value: unknown): string | null { const text = string(value); if (!text || !/(?:Z|GMT|[+-]\d{2}:?\d{2})(?:$|\s)/i.test(text)) return null; const time = Date.parse(text); return Number.isFinite(time) ? new Date(time).toISOString() : null; }
interface XCheckpoint { version: 1; cursor: string; scope: string }
function scopeHash(request: CollectContentPageRequest, target: SourceTarget): string { return createHash("sha256").update(JSON.stringify({ sourceId: request.source.id, target, from: request.from, to: request.to })).digest("hex"); }
function readCheckpoint(value: JsonValue | null, scope: string): XCheckpoint | null {
  if (value === null) return null;
  const row = object(value);
  if (!row || row.version !== 1 || row.scope !== scope || typeof row.cursor !== "string" || row.cursor.length < 1 || row.cursor.length > 4096 || /[\u0000-\u001f\u007f]/.test(row.cursor)) throw new ContentProviderError("Invalid X checkpoint or changed collection scope", false);
  return row as unknown as XCheckpoint;
}

export class TwitterApiIoContentConnector implements ContentProvider {
  readonly capability: SourceCapability;
  private readonly fetcher: typeof fetch;
  private readonly now: () => string;
  private readonly config: TwitterApiIoConfig;
  constructor(options: Partial<TwitterApiIoConfig> & { fetcher?: typeof fetch; now?: () => string } = {}) {
    this.config = { apiKey: options.apiKey, networkEnabled: options.networkEnabled ?? false, timeoutMs: options.timeoutMs ?? 20_000 };
    if (this.config.apiKey && (this.config.apiKey.length > 512 || /[\u0000-\u0020\u007f]/.test(this.config.apiKey))) throw new ContentProviderError("Invalid TwitterAPI.io credential header configuration", false);
    if (!Number.isInteger(this.config.timeoutMs) || this.config.timeoutMs < 100 || this.config.timeoutMs > 120_000) throw new ContentProviderError("Invalid TwitterAPI.io timeout configuration", false);
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? (() => new Date().toISOString());
    this.capability = {
      platform: "x", provider: PROVIDER, enabled: this.config.networkEnabled && Boolean(this.config.apiKey), contentKinds: ["post"], targetTypes: ["account", "search"], keywordSearch: "global", observationModel: "snapshot", refreshByIds: true,
      requestResourceUpperBound: MAX_PAGE_RESOURCES,
      metrics: [["likes", "Likes"], ["reposts", "Reposts"], ["replies", "Replies"], ["quotes", "Quotes"], ["views", "Views"], ["bookmarks", "Bookmarks"]].map(([key, label]) => ({ key: `x.${key}`, label, unit: "count", cumulative: true, signed: false, contentKinds: ["post"], direction: "higher" })),
      limitations: [
        "Requires TWITTERAPI_IO_API_KEY, SOURCE_NETWORK_ENABLED=true and a separately enabled provider budget; paid budgets default to zero.",
        "Each account/search request returns at most 20 posts; requested pageSize does not alter upstream billing. Resource reservations conservatively cover this bound.",
        "Source observation timestamp is not supplied by this provider; fetchedAt is receipt time and metrics must not be labelled as platform-time observations.",
        "Search/account results are a provider-visible sample; keyword coverage, account history, media fields and freshness require deferred real-provider acceptance.",
      ],
    };
  }

  normalizeTarget(target: SourceTarget, kind: PublicContentKind): SourceTarget {
    if (kind !== "post" || !target || typeof target !== "object") throw new ContentProviderError("TwitterAPI.io supports X posts only", false);
    if (target.type !== "account" && target.type !== "search") throw new ContentProviderError("TwitterAPI.io supports account or search targets", false);
    const rawQuery = "query" in target ? target.query : undefined;
    if (rawQuery !== undefined && typeof rawQuery !== "string") throw new ContentProviderError("X query must be a string", false);
    const query = rawQuery?.trim();
    if (query !== undefined && (!query || query.length > MAX_QUERY_CHARS || /[\u0000-\u001f\u007f]/.test(query))) throw new ContentProviderError("X query must contain 1–400 characters without control characters", false);
    // These operators are owned by the collection window/scope, not arbitrary user expressions.
    if (query && /(?:^|[\s(])(?:since(?:_time)?|until(?:_time)?):/i.test(query)) throw new ContentProviderError("X collection window operators must be supplied by from/to", false);
    if (target.type === "search") { if (!query) throw new ContentProviderError("X search requires a query", false); return { type: "search", query }; }
    const account = typeof target.account === "string" ? target.account.trim().replace(/^@/, "").toLowerCase() : "";
    if (!/^[a-z0-9_]{1,15}$/.test(account)) throw new ContentProviderError("X account must be a handle of 1–15 letters, digits or underscores", false);
    if (query && /(?:^|[\s(])from:/i.test(query)) throw new ContentProviderError("Account queries cannot override the source account", false);
    return { type: "account", account, ...(query ? { query } : {}) };
  }

  async collectPage(request: CollectContentPageRequest): Promise<CollectedPage> {
    this.assertEnabled();
    this.assertSource(request.source);
    const target = this.normalizeTarget(request.source.target, request.source.contentKind);
    if (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > 100) throw new ContentProviderError("X page budget must be 1–100", false);
    const from = Date.parse(request.from), to = Date.parse(request.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) throw new ContentProviderError("Invalid X collection window", false);
    const scope = scopeHash(request, target), saved = readCheckpoint(request.checkpoint, scope);
    const accountTimeline = target.type === "account" && !target.query;
    const url = new URL(accountTimeline ? "/twitter/user/last_tweets" : "/twitter/tweet/advanced_search", BASE_URL);
    if (accountTimeline && target.type === "account") { url.searchParams.set("userName", target.account); url.searchParams.set("includeReplies", "true"); }
    else {
      const query = target.type === "search" ? target.query : target.type === "account" ? `from:${target.account} (${target.query})` : "";
      url.searchParams.set("query", `(${query}) since_time:${Math.floor(from / 1000)} until_time:${Math.ceil(to / 1000)}`);
      url.searchParams.set("queryType", "Latest");
    }
    url.searchParams.set("cursor", saved?.cursor ?? "");
    const result = await this.requestPage(url, MAX_PAGE_RESOURCES, request.signal);
    const fetchedAt = this.now();
    const all = result.rows.map((row) => this.normalize(row, request.source.id, fetchedAt, accountTimeline ? "account" : "search", result.headers));
    const items = Array.from(new Map(all.filter((row) => !row.publishedAt || (Date.parse(row.publishedAt) >= from && Date.parse(row.publishedAt) < to)).map((row) => [row.externalId, row])).values());
    const unknownDates = all.filter((row) => !row.publishedAt).length;
    const warnings: string[] = [];
    if (unknownDates) warnings.push(`${unknownDates} returned posts have unknown publication time; window membership is unknown.`);
    const reachedOldTimeline = accountTimeline && all.length > 0 && all.every((row) => row.publishedAt && Date.parse(row.publishedAt) < from);
    if (result.hasNext && result.rows.length === 0) warnings.push("Provider returned an empty page while claiming another page; collection stopped without claiming exhaustion.");
    if (result.hasNext && (!result.cursor || result.cursor === saved?.cursor)) warnings.push("Provider cursor failed to advance; collection stopped without skipping records.");
    const stalled = result.hasNext && (result.rows.length === 0 || !result.cursor || result.cursor === saved?.cursor);
    const exhausted = !result.hasNext || reachedOldTimeline;
    return {
      items, exhausted, coverage: result.hasNext || unknownDates > 0 ? "partial" : "unknown",
      warning: warnings.length ? warnings.join(" ") : null,
      nextCheckpoint: !exhausted && !stalled ? { version: 1, cursor: result.cursor!, scope } : null,
    };
  }

  async refreshIds(request: Parameters<NonNullable<ContentProvider["refreshIds"]>>[0]): Promise<CollectedPage> {
    this.assertEnabled(); this.assertSource(request.source);
    if (request.externalIds.length < 1 || request.externalIds.length > 100 || request.externalIds.some((value) => !id(value))) throw new ContentProviderError("X ID refresh requires 1–100 string post IDs", false);
    const ids = Array.from(new Set(request.externalIds));
    const url = new URL("/twitter/tweets", BASE_URL); url.searchParams.set("tweet_ids", ids.join(","));
    const result = await this.requestPage(url, ids.length, request.signal, true), fetchedAt = this.now();
    const items = result.rows.map((row) => this.normalize(row, request.source.id, fetchedAt, "refresh", result.headers));
    if (items.some((row) => !ids.includes(row.externalId))) throw new ContentProviderError("X ID refresh returned an unrelated identity", false);
    return { items, nextCheckpoint: null, exhausted: true, coverage: items.length < ids.length ? "partial" : "unknown", warning: items.length < ids.length ? "Some requested X IDs were unavailable; absence does not prove deletion." : null };
  }

  private assertEnabled(): void { if (!this.capability.enabled) throw new ContentProviderError("TwitterAPI.io is disabled: configure key and enable SOURCE_NETWORK_ENABLED explicitly", false); }
  private assertSource(source: { platform: string; provider: string; contentKind: string }): void { if (source.platform !== "x" || source.provider !== PROVIDER || source.contentKind !== "post") throw new ContentProviderError("Unsupported TwitterAPI.io source", false); }

  private async requestPage(url: URL, resourceBound: number, parentSignal?: AbortSignal, ids = false): Promise<{ rows: unknown[]; hasNext: boolean; cursor: string | null; headers: Headers }> {
    parentSignal?.throwIfAborted();
    const signal = parentSignal ? AbortSignal.any([parentSignal, AbortSignal.timeout(this.config.timeoutMs)]) : AbortSignal.timeout(this.config.timeoutMs);
    let response: Response;
    try { response = await this.fetcher(url, { method: "GET", signal, redirect: "error", headers: { Accept: "application/json", "X-API-Key": this.config.apiKey! } }); }
    catch (error) { if (parentSignal?.aborted) throw error; throw new ContentProviderError("TwitterAPI.io network request failed", true); }
    if (!response.ok) throw new ContentProviderError(`TwitterAPI.io HTTP ${response.status}`, response.status === 429 || response.status === 408 || response.status >= 500, retryAfter(response.headers, this.now()), response.status);
    const chunks: Uint8Array[] = []; let bytes = 0;
    if (response.body) {
      const reader = response.body.getReader();
      try { for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 4 * 1024 * 1024) { await reader.cancel(); throw new ContentProviderError("TwitterAPI.io response exceeds 4 MiB", false); } chunks.push(value); } }
      catch (error) { if (error instanceof ContentProviderError || parentSignal?.aborted) throw error; throw new ContentProviderError("TwitterAPI.io response stream interrupted", true); }
      finally { reader.releaseLock(); }
    }
    let value: unknown;
    try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new ContentProviderError("TwitterAPI.io returned malformed JSON", false); }
    const body = object(value);
    if (!body || body.status === "error" || body.error !== undefined) throw new ContentProviderError("TwitterAPI.io reported a provider failure", false);
    // The account docs show a flat envelope while the provider's Python guide uses data.tweets.
    // Only this endpoint accepts the documented nested account variant; search/ID lookups stay flat.
    const nestedAccount = url.pathname === "/twitter/user/last_tweets" ? object(body.data) : null;
    const payload = nestedAccount ?? body;
    if (payload.status === "error" || payload.error !== undefined) throw new ContentProviderError("TwitterAPI.io reported a provider failure", false);
    if (!Array.isArray(payload.tweets) || payload.tweets.length > resourceBound || (!ids && typeof (payload.has_next_page ?? body.has_next_page) !== "boolean")) throw new ContentProviderError("Invalid TwitterAPI.io page shape or resource bound", false);
    const cursor = string(payload.next_cursor ?? body.next_cursor);
    return { rows: payload.tweets, hasNext: ids ? false : (payload.has_next_page ?? body.has_next_page) as boolean, cursor: cursor && cursor.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(cursor) ? cursor : null, headers: response.headers };
  }

  private normalize(value: unknown, sourceId: string, fetchedAt: string, endpoint: string, headers: Headers): CollectedContent {
    const row = object(value), externalId = id(row?.id);
    if (!row || !externalId) throw new ContentProviderError("X record lacks a safe string identity", false);
    const author = object(row.author), handle = string(author?.userName), authorId = id(author?.id);
    const quoted = object(row.quoted_tweet), reposted = object(row.retweeted_tweet);
    const references: ContentReference[] = [];
    for (const [refId, relation] of [[id(row.inReplyToId), "reply_to"], [id(row.conversationId), "thread_root"], [id(quoted?.id), "quote"], [id(reposted?.id), "repost"]] as const) if (refId && (relation !== "thread_root" || refId !== externalId)) references.push({ kind: "post", externalId: refId, relation });
    const metrics: Record<string, number | null> = { "x.likes": count(row.likeCount), "x.reposts": count(row.retweetCount), "x.replies": count(row.replyCount), "x.quotes": count(row.quoteCount), "x.views": count(row.viewCount), "x.bookmarks": count(row.bookmarkCount) };
    const evidenceKey = createHash("sha256").update(JSON.stringify({ externalId, fetchedAt, metrics })).digest("hex");
    return {
      id: stableUuidFromString(`x:content:${externalId}`), platform: "x", kind: "post", externalId,
      title: null, text: string(row.text), url: httpUrl(row.url) ?? `https://x.com/i/web/status/${externalId}`,
      language: string(row.lang), publishedAt: timestamp(row.createdAt), fetchedAt,
      author: author && (authorId || handle || string(author.name)) ? { externalId: authorId, handle, displayName: string(author.name), url: httpUrl(author.url) ?? (handle && /^[a-z0-9_]{1,15}$/i.test(handle) ? `https://x.com/${handle}` : null) } : null,
      availability: row.unavailable === true ? "unknown" : string(row.text) !== null ? "available" : "unknown",
      references, media: extractMedia(row),
      platformDetails: { platform: "x", conversationId: id(row.conversationId), isReply: bool(row.isReply), isQuote: id(quoted?.id) ? true : bool(row.isQuote), isRepost: id(reposted?.id) ? true : bool(row.isRetweet), sensitive: bool(row.possiblySensitive), extensions: { "twitterapi_io.adapter_version": ADAPTER_VERSION, "twitterapi_io.endpoint": endpoint, "twitterapi_io.request_id": headers.get("x-request-id")?.slice(0, 256) ?? null, "twitterapi_io.rate_limit_remaining": numericHeader(headers, "x-ratelimit-remaining"), "x.is_limited_reply": bool(row.isLimitedReply) } },
      observation: { provider: PROVIDER, sourceId, sourceObservedAt: null, fetchedAt, timeBasis: "provider_snapshot", maturity: "unknown", metrics, evidenceKey },
    };
  }
}

function numericHeader(headers: Headers, key: string): number | null { const raw = headers.get(key); if (raw === null || !/^\d+$/.test(raw)) return null; return count(Number(raw)); }
function retryAfter(headers: Headers, now: string): number {
  const raw = headers.get("retry-after");
  let seconds = raw && /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : raw ? (Date.parse(raw) - Date.parse(now)) / 1000 : NaN;
  if (!Number.isFinite(seconds)) { const reset = numericHeader(headers, "x-ratelimit-reset"); if (reset !== null) seconds = reset - Date.parse(now) / 1000; }
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(3600, Math.ceil(seconds)) : 30;
}
function extractMedia(row: RecordValue): ContentMedia[] {
  const media: ContentMedia[] = [], extended = object(row.extended_entities), entities = object(row.entities);
  const list = Array.isArray(extended?.media) ? extended.media : Array.isArray(entities?.media) ? entities.media : [];
  for (const value of list) {
    const item = object(value); if (!item) continue;
    const preview = httpUrl(item.media_url_https) ?? httpUrl(item.media_url), alt = string(item.ext_alt_text);
    if (item.type === "photo" && preview) media.push({ type: "image", url: preview, previewUrl: preview, altText: alt, durationSeconds: null });
    else if (item.type === "video" || item.type === "animated_gif") {
      const info = object(item.video_info), variants = Array.isArray(info?.variants) ? info.variants.map(object).filter((value): value is RecordValue => value !== null && value.content_type === "video/mp4" && httpUrl(value.url) !== null) : [];
      variants.sort((a, b) => (count(b.bitrate) ?? 0) - (count(a.bitrate) ?? 0));
      const url = httpUrl(variants[0]?.url), durationMs = count(info?.duration_millis);
      if (url) media.push({ type: "video", url, previewUrl: preview, altText: alt, durationSeconds: durationMs !== null ? durationMs / 1000 : null });
    }
  }
  for (const value of Array.isArray(entities?.urls) ? entities.urls : []) {
    const item = object(value), url = httpUrl(item?.expanded_url) ?? httpUrl(item?.url);
    if (url) media.push({ type: "link", url, previewUrl: null, altText: null, durationSeconds: null });
  }
  return Array.from(new Map(media.map((value) => [`${value.type}:${value.url}`, value])).values());
}
