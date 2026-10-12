import { createHash } from "node:crypto";
import type { CollectionSource, ContentMedia, ContentReference, JsonValue, PublicContentKind, SourceCapability, SourceTarget } from "../../../packages/contracts/src/source-content";
import { stableUuidFromString } from "../../shared/ids/stable-id";
import { ContentProviderError, type CollectedContent, type CollectedPage, type CollectContentPageRequest, type ContentProvider } from "../shared/content-provider.interface";

export const ARCTIC_SHIFT_CAPABILITY: SourceCapability = {
  platform: "reddit", provider: "arctic_shift", enabled: true, contentKinds: ["post", "comment"],
  targetTypes: ["community", "account", "post"], keywordSearch: "scoped", observationModel: "archive",
  refreshByIds:true,
  metrics: [
    { key: "reddit.score", label: "Score", unit: "count", cumulative: false, signed: true, contentKinds: ["post", "comment"], direction: "higher" },
    { key: "reddit.num_comments", label: "Comments", unit: "count", cumulative: true, signed: false, contentKinds: ["post"], direction: "higher" },
    { key: "reddit.upvote_ratio", label: "Upvote ratio", unit: "ratio", cumulative: false, signed: false, contentKinds: ["post"], direction: "higher" },
  ],
  limitations: ["Archive coverage is unknown; fresh content is not proof of complete coverage.", "Recent metrics may be initial placeholders; archive refresh is normally around 36 hours.", "Keyword queries require a supported community/account/post scope.", "No live community active-user metrics or hot-listing semantics.", "Time-only pagination may truncate saturated timestamp boundaries."],
};

type RecordValue = Record<string, unknown>;
function object(value: unknown): RecordValue | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null; }
function text(value: unknown): string | null { return typeof value === "string" ? value : null; }
function number(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function epoch(value: unknown): string | null { const n = number(value); return n !== null && n > 0 && n < 253402300800 ? new Date(n * 1000).toISOString() : null; }
function httpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try { const url = new URL(value.replaceAll("&amp;", "&")); return ["http:", "https:"].includes(url.protocol) ? url.href : null; } catch { return null; }
}
interface ArcticCheckpoint { before: number; boundary: number; seen: string[] }
function checkpoint(value: JsonValue | null): ArcticCheckpoint | null {
  if (value === null) return null;
  const obj = object(value);
  if (!obj || !Number.isInteger(obj.before) || !Number.isInteger(obj.boundary) || !Array.isArray(obj.seen) || obj.seen.some(id => typeof id !== "string")) throw new ContentProviderError("Invalid Arctic Shift checkpoint", false);
  return obj as unknown as ArcticCheckpoint;
}

export class ArcticShiftContentConnector implements ContentProvider {
  readonly capability = ARCTIC_SHIFT_CAPABILITY;
  constructor(private readonly fetcher: typeof fetch = fetch, private readonly timeoutMs = 20_000, private readonly now = () => new Date().toISOString()) {}

  normalizeTarget(target: SourceTarget, kind: PublicContentKind): SourceTarget {
    if (!target || typeof target !== "object" || !this.capability.targetTypes.includes(target.type)) throw new ContentProviderError("Target type is not supported by Arctic Shift", false);
    const name = target.type === "community" ? target.community : target.type === "account" ? target.account : target.type === "post" ? target.postId : "";
    if (typeof name !== "string") throw new ContentProviderError("Invalid target", false);
    const clean = name.trim().replace(/^[ru]\//, "");
    if (target.type === "post" ? !/^(?:t3_)?[a-z0-9]{2,12}$/i.test(clean) : !/^[a-z0-9_-]{2,40}$/i.test(clean)) throw new ContentProviderError("Invalid community/account/post identifier", false);
    if (target.type === "post" && kind !== "comment") throw new ContentProviderError("Post targets collect comments only", false);
    const query = "query" in target ? target.query : undefined;
    if (query !== undefined && (typeof query !== "string" || query.trim().length > 200 || /[\u0000-\u001f]/.test(query))) throw new ContentProviderError("Query must be at most 200 characters without control characters", false);
    const filter = query?.trim() ? { query: query.trim() } : {};
    return target.type === "community" ? { type: "community", community: clean.toLowerCase(), ...filter }
      : target.type === "account" ? { type: "account", account: clean.toLowerCase(), ...filter }
      : { type: "post", postId: clean.toLowerCase().replace(/^t3_/, ""), ...filter };
  }

  async collectPage(request: CollectContentPageRequest): Promise<CollectedPage> {
    const { source } = request;
    if (source.platform !== "reddit" || source.provider !== "arctic_shift" || !["post", "comment"].includes(source.contentKind)) throw new ContentProviderError("Unsupported Arctic Shift source", false);
    if (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > 100) throw new ContentProviderError("Page size must be 1–100", false);
    const from = Date.parse(request.from) / 1000, to = Date.parse(request.to) / 1000;
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) throw new ContentProviderError("Invalid collection window", false);
    const saved = checkpoint(request.checkpoint);
    const url = new URL(`https://arctic-shift.photon-reddit.com/api/${source.contentKind === "post" ? "posts" : "comments"}/search`);
    url.searchParams.set("sort", "desc"); url.searchParams.set("limit", String(request.limit));
    // Request full records: fields projection discards _meta.retrieved_2nd_on.
    url.searchParams.set("after", String(Math.floor(from) - 1));
    url.searchParams.set("before", String(saved?.before ?? Math.ceil(to)));
    const target = source.target;
    if (target.type === "community") url.searchParams.set("subreddit", target.community);
    else if (target.type === "account") url.searchParams.set("author", target.account);
    else if (target.type === "post" && source.contentKind === "comment") url.searchParams.set("link_id", target.postId);
    else throw new ContentProviderError("Unsupported Arctic Shift target", false);
    if ("query" in target && target.query) url.searchParams.set(source.contentKind === "comment" ? "body" : "query", target.query);
    const data=await this.requestData(url,request.limit,request.signal);
    const fetchedAt = this.now();
    const all = data.map(value => this.normalize(value, request, fetchedAt));
    const seen = new Set(saved?.seen ?? []);
    const items = all.filter(item => !seen.has(item.externalId) && Date.parse(item.publishedAt!) / 1000 >= from && Date.parse(item.publishedAt!) / 1000 < to);
    if (all.length < request.limit) return { items, nextCheckpoint: null, exhausted: true, coverage: "unknown", warning: null };
    const boundary = Math.floor(Math.min(...all.map(item => Date.parse(item.publishedAt!) / 1000)));
    const boundaryIds = all.filter(item => Math.floor(Date.parse(item.publishedAt!) / 1000) === boundary).map(item => item.externalId);
    if (saved && boundary >= saved.boundary && items.length === 0) return { items, nextCheckpoint: null, exhausted: false, coverage: "partial", warning: "Timestamp boundary saturated; collection stopped to avoid silently skipping records." };
    const next: ArcticCheckpoint = { before: boundary + 1, boundary, seen: boundaryIds };
    return { items, nextCheckpoint: next as unknown as JsonValue, exhausted: false, coverage: "partial", warning: null };
  }

  async refreshIds(request:{source:CollectionSource;externalIds:string[];signal?:AbortSignal}):Promise<CollectedPage> {
    const kind=request.source.contentKind,prefix=kind==="comment"?"t1_":"t3_";
    if(!["post","comment"].includes(kind)||request.externalIds.length<1||request.externalIds.length>100||request.externalIds.some(id=>!id.startsWith(prefix)||!/^[a-z0-9]{2,12}$/i.test(id.slice(3))))throw new ContentProviderError("Invalid bounded Arctic Shift ID refresh",false);
    const url=new URL(`https://arctic-shift.photon-reddit.com/api/${kind==="post"?"posts":"comments"}/ids`);url.searchParams.set("ids",request.externalIds.map(id=>id.slice(3)).join(","));
    const fetchedAt=this.now(),rows=await this.requestData(url,request.externalIds.length,request.signal),normalization:CollectContentPageRequest={source:request.source,from:"1970-01-01T00:00:00.000Z",to:fetchedAt,limit:request.externalIds.length,checkpoint:null,signal:request.signal};
    const items=rows.map(row=>this.normalize(row,normalization,fetchedAt));if(items.some(item=>!request.externalIds.includes(item.externalId)))throw new ContentProviderError("ID refresh returned an unrelated identity",false);
    return {items,nextCheckpoint:null,exhausted:true,coverage:items.length===request.externalIds.length?"unknown":"partial",warning:items.length===request.externalIds.length?null:"Some requested IDs were unavailable in the archive."};
  }

  private async requestData(url:URL,limit:number,parentSignal?:AbortSignal):Promise<unknown[]> {
    const signal = parentSignal ? AbortSignal.any([parentSignal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs);
    let response: Response;
    try { response = await this.fetcher(url, { signal, redirect: "error", headers: { Accept: "application/json", "User-Agent": "reddit-monitoring-mvp/arctic-shift" } }); }
    catch (error) { if (parentSignal?.aborted) throw error; throw new ContentProviderError("Arctic Shift network request failed", true); }
    const chunks: Uint8Array[] = []; let bytes = 0;
    if (response.body) {
      const reader = response.body.getReader();
      try { for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 8 * 1024 * 1024) { await reader.cancel(); throw new ContentProviderError("Arctic Shift response exceeds 8 MiB; reduce page size", false); } chunks.push(value); } }
      catch (error) { if (error instanceof ContentProviderError || parentSignal?.aborted) throw error; throw new ContentProviderError("Arctic Shift response stream interrupted",true); }
      finally { reader.releaseLock(); }
    }
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new ContentProviderError(`Arctic Shift returned non-JSON (HTTP ${response.status})`, response.status === 429 || response.status >= 500); }
    const data = object(body);
    if (!response.ok || data?.error) {
      const retryAfter = Number(response.headers.get("x-ratelimit-reset") ?? response.headers.get("retry-after"));
      const retryable = response.status === 429 || response.status >= 500 || (response.status === 422 && /timeout|slow down/i.test(String(data?.error)));
      throw new ContentProviderError(`Arctic Shift HTTP ${response.status}${typeof data?.error === "string" ? `: ${data.error.slice(0, 160)}` : ""}`, retryable, Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(3600, Math.ceil(retryAfter)) : 30, response.status);
    }
    if (!Array.isArray(data?.data) || data.data.length > limit) throw new ContentProviderError("Invalid Arctic Shift data array", false);
    return data.data;
  }

  private normalize(value: unknown, request: CollectContentPageRequest, fetchedAt: string): CollectedContent {
    const row = object(value), kind = request.source.contentKind;
    if (!row || !/^[a-z0-9]+$/i.test(String(row.id)) || typeof row.id !== "string" || !epoch(row.created_utc) || typeof row.subreddit !== "string") throw new ContentProviderError("Arctic Shift record lacks valid identity/publication/community", false);
    const publishedAt = epoch(row.created_utc)!;
    if (request.source.target.type === "community" && row.subreddit.toLowerCase() !== request.source.target.community.toLowerCase()) throw new ContentProviderError("Arctic Shift returned a different community", false);
    if (request.source.target.type === "post" && String(row.link_id).replace(/^t3_/, "") !== request.source.target.postId.replace(/^t3_/, "")) throw new ContentProviderError("Arctic Shift returned comments for a different post", false);
    const externalId = `${kind === "comment" ? "t1" : "t3"}_${row.id.toLowerCase()}`;
    const meta = object(row._meta);
    const initial = epoch(row.retrieved_on), second = epoch(meta?.retrieved_2nd_on);
    const validSecond = second && second >= publishedAt && (!initial || second >= initial) && second <= fetchedAt ? second : null;
    const validInitial = initial && initial >= publishedAt && initial <= fetchedAt ? initial : null;
    const metrics: Record<string, number | null> = { "reddit.score": number(row.score) };
    if (kind === "post") {
      const comments = number(row.num_comments), ratio = number(row.upvote_ratio);
      metrics["reddit.num_comments"] = comments !== null && Number.isInteger(comments) && comments >= 0 ? comments : null;
      metrics["reddit.upvote_ratio"] = ratio !== null && ratio >= 0 && ratio <= 1 ? ratio : null;
    }
    const references: ContentReference[] = [];
    for (const [key, relation] of [["parent_id", "reply_to"], ["link_id", "thread_root"], ["crosspost_parent", "repost"]] as const) {
      const id = text(row[key]); if (id && /^t[13]_[a-z0-9]+$/i.test(id)) references.push({ kind: id.startsWith("t1_") ? "comment" : "post", externalId: id.toLowerCase(), relation });
    }
    const body = text(kind === "comment" ? row.body : row.selftext), author = text(row.author);
    const removed = body === "[removed]", deleted = body === "[deleted]";
    const root = text(row.link_id)?.replace(/^t3_/, "");
    const permalink = httpUrl(row.permalink) ?? (typeof row.permalink === "string" && row.permalink.startsWith("/r/") ? httpUrl(`https://www.reddit.com${row.permalink}`) : null);
    const url = permalink ?? (kind === "post" || root ? `https://www.reddit.com/r/${encodeURIComponent(row.subreddit)}/comments/${kind === "post" ? row.id : root}/${kind === "comment" ? `_/${row.id}/` : ""}` : null);
    const media: ContentMedia[] = [];
    const linked = httpUrl(row.url); if (kind === "post" && linked && linked !== url) media.push({ type: "link", url: linked, previewUrl: null, altText: null, durationSeconds: null });
    const sourceObservedAt = validSecond ?? validInitial;
    const evidenceKey = createHash("sha256").update(JSON.stringify({ externalId, sourceObservedAt, metrics })).digest("hex");
    return {
      id: stableUuidFromString(`reddit:content:${externalId}`), platform: "reddit", kind, externalId,
      title: kind === "post" ? text(row.title) : null, text: removed || deleted ? null : body,
      url, language: null, publishedAt, fetchedAt, availability: removed ? "removed" : deleted ? "deleted" : (kind === "post" ? text(row.title) !== null : body !== null) ? "available" : "unknown",
      author: author && author !== "[deleted]" ? { externalId: text(row.author_fullname), handle: author, displayName: null, url: `https://www.reddit.com/user/${encodeURIComponent(author)}/` } : null,
      references, media, platformDetails: { platform: "reddit", community: row.subreddit, flair: text(row.link_flair_text), nsfw: typeof row.over_18 === "boolean" ? row.over_18 : null, extensions: { "reddit.stickied": typeof row.stickied === "boolean" ? row.stickied : null, "reddit.locked": typeof row.locked === "boolean" ? row.locked : null, "reddit.post_hint": text(row.post_hint) } },
      observation: { provider: "arctic_shift", sourceId: request.source.id, sourceObservedAt, fetchedAt, metrics, evidenceKey, timeBasis: validSecond ? "archive_refresh" : validInitial ? "archive_initial" : "unknown", maturity: validSecond ? "refreshed" : validInitial ? "initial" : "unknown" },
    };
  }
}
