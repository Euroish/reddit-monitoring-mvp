import { createHash } from "node:crypto";
import type { ContentMedia, ContentReference, JsonValue, PublicContentKind, SourceCapability, SourceTarget } from "../../../packages/contracts/src/source-content";
import { stableUuidFromString } from "../../shared/ids/stable-id";
import { ContentProviderError, type CollectedContent, type CollectedPage, type CollectContentPageRequest, type ContentProvider } from "../shared/content-provider.interface";

type Row = Record<string, unknown>;
const object = (value: unknown): Row | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
const text = (value: unknown): string | null => typeof value === "string" ? value : null;
const count = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const postUri = (value: unknown): string | null => typeof value === "string" && /^at:\/\/did:[a-z0-9]+:[A-Za-z0-9._:%-]+\/app\.bsky\.feed\.post\/[A-Za-z0-9._~-]+$/.test(value) ? value : null;
function timestamp(value: unknown): string | null {
  const time = typeof value === "string" && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
function httpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
function media(embed: Row | null): ContentMedia[] {
  const view = object(embed?.media) ?? embed;
  const result: ContentMedia[] = [];
  if (Array.isArray(view?.images)) for (const image of view.images) {
    const row = object(image), url = httpUrl(row?.fullsize);
    if (url) result.push({ type: "image", url, previewUrl: httpUrl(row?.thumb), altText: text(row?.alt), durationSeconds: null });
  }
  const external = object(view?.external), link = httpUrl(external?.uri), video = httpUrl(view?.playlist);
  if (link) result.push({ type: "link", url: link, previewUrl: httpUrl(external?.thumb), altText: text(external?.title), durationSeconds: null });
  if (video) result.push({ type: "video", url: video, previewUrl: httpUrl(view?.thumbnail), altText: text(view?.alt), durationSeconds: null });
  return result;
}

/** Public, unauthenticated account reads only. Reposts are not authored posts. */
export class BlueskyAppViewContentConnector implements ContentProvider {
  readonly capability: SourceCapability;
  private readonly fetcher: typeof fetch;
  private readonly now: () => string;
  constructor(options: { networkEnabled?: boolean; fetcher?: typeof fetch; now?: () => string } = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? (() => new Date().toISOString());
    this.capability = {
      platform: "bluesky", provider: "bluesky_appview", enabled: options.networkEnabled ?? false,
      contentKinds: ["post"], targetTypes: ["account"], keywordSearch: "none", observationModel: "snapshot",
      metrics: [["likes", "Likes"], ["replies", "Replies"], ["reposts", "Reposts"], ["quotes", "Quotes"]].map(([key, label]) => ({ key: `bluesky.${key}`, label, unit: "count", cumulative: true, signed: false, contentKinds: ["post"], direction: "higher" })),
      limitations: [
        "Public AppView account posts and authored replies only; reposts and pins are excluded. No search, thread expansion or deletion detection.",
        "Opaque cursors page account history; date filtering does not terminate a scan early. Bounded jobs may remain partial even for recent windows.",
        "DID targets follow a stable actor; handle targets use the current handle resolution.",
        "AppView indexedAt is not an observation timestamp. Metrics use unknown sourceObservedAt and receipt fetchedAt.",
        "Network access and an explicit provider request/resource budget are required. No continuous freshness or full coverage claim.",
      ],
    };
  }

  normalizeTarget(target: SourceTarget, kind: PublicContentKind): SourceTarget {
    if (kind !== "post" || !target || target.type !== "account" || target.query !== undefined) throw new ContentProviderError("Bluesky AppView supports account posts without query filters", false);
    const raw = typeof target.account === "string" ? target.account.trim().replace(/^@/, "") : "";
    const did = /^did:[a-z0-9]+:[A-Za-z0-9._:%-]{1,200}$/.test(raw);
    const account = did ? raw : raw.toLowerCase();
    if (!did && (account.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(account))) throw new ContentProviderError("Bluesky account must be a handle or DID, not a URL", false);
    return { type: "account", account };
  }

  async collectPage(request: CollectContentPageRequest): Promise<CollectedPage> {
    if (!this.capability.enabled) throw new ContentProviderError("Bluesky AppView network access is disabled", false);
    if (request.source.platform !== "bluesky" || request.source.provider !== "bluesky_appview") throw new ContentProviderError("Unsupported Bluesky AppView source", false);
    const target = this.normalizeTarget(request.source.target, request.source.contentKind);
    if (target.type !== "account") throw new ContentProviderError("Bluesky account required", false);
    const from = Date.parse(request.from), to = Date.parse(request.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to || !Number.isInteger(request.limit) || request.limit < 1 || request.limit > 100) throw new ContentProviderError("Invalid Bluesky window or page size", false);
    const scope = createHash("sha256").update(JSON.stringify([request.source.id, target.account, request.from, request.to])).digest("hex");
    const saved = object(request.checkpoint);
    if (request.checkpoint !== null && (!saved || saved.version !== 1 || saved.scope !== scope || typeof saved.cursor !== "string" || !saved.cursor || saved.cursor.length > 4096 || /[\u0000-\u001f\u007f]/.test(saved.cursor))) throw new ContentProviderError("Invalid Bluesky checkpoint or changed scope", false);
    const cursor = saved?.cursor as string | undefined;
    const url = new URL("https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed");
    url.searchParams.set("actor", target.account); url.searchParams.set("limit", String(request.limit));
    url.searchParams.set("filter", "posts_with_replies"); url.searchParams.set("includePins", "false");
    if (cursor) url.searchParams.set("cursor", cursor);
    const body = await this.request(url, request.signal);
    if (!Array.isArray(body.feed) || body.feed.length > request.limit || body.cursor !== undefined && (typeof body.cursor !== "string" || !body.cursor || body.cursor.length > 4096 || /[\u0000-\u001f\u007f]/.test(body.cursor))) throw new ContentProviderError("Invalid Bluesky feed envelope", false);
    if (body.cursor && body.cursor === cursor) throw new ContentProviderError("Bluesky cursor did not advance; checkpoint retained", true);
    const fetchedAt = this.now(), items = new Map<string, CollectedContent>();
    for (const value of body.feed) {
      const entry = object(value), post = object(entry?.post), author = object(post?.author);
      if (!entry || !post || !author) throw new ContentProviderError("Invalid Bluesky feed post", false);
      if (entry.reason !== undefined) continue;
      const matches = target.account.startsWith("did:") ? author.did === target.account : text(author.handle)?.toLowerCase() === target.account;
      if (!matches) throw new ContentProviderError("Bluesky returned an unrelated authored post", false);
      const item = this.normalize(post, request.source.id, fetchedAt);
      if (!item.publishedAt || Date.parse(item.publishedAt) >= from && Date.parse(item.publishedAt) < to) items.set(item.externalId, item);
    }
    const unknownDates = [...items.values()].some(item => item.publishedAt === null);
    return {
      items: [...items.values()], nextCheckpoint: body.cursor ? { version: 1, scope, cursor: body.cursor } as JsonValue : null,
      exhausted: !body.cursor, coverage: body.cursor || unknownDates ? "partial" : "unknown",
      warning: unknownDates ? "Some authored posts have unknown publication time; window membership is unknown." : null,
    };
  }

  private normalize(post: Row, sourceId: string, fetchedAt: string): CollectedContent {
    const uri = postUri(post.uri), author = object(post.author), record = object(post.record);
    if (!uri || !author || typeof author.did !== "string" || !uri.startsWith(`at://${author.did}/`) || !record || record.$type !== "app.bsky.feed.post" || typeof record.text !== "string") throw new ContentProviderError("Invalid Bluesky post identity or record", false);
    const references: ContentReference[] = [];
    const addReference = (value: unknown, relation: ContentReference["relation"]) => { const externalId = postUri(object(value)?.uri); if (externalId) references.push({ kind: "post", externalId, relation }); };
    const reply = object(record.reply), embed = object(record.embed);
    addReference(reply?.parent, "reply_to"); addReference(reply?.root, "thread_root");
    addReference(object(embed?.record)?.record ?? embed?.record, "quote");
    const metrics = { "bluesky.likes": count(post.likeCount), "bluesky.replies": count(post.replyCount), "bluesky.reposts": count(post.repostCount), "bluesky.quotes": count(post.quoteCount) };
    const cid = text(post.cid), did = author.did;
    return {
      id: stableUuidFromString(`bluesky:content:post:${uri}`), platform: "bluesky", kind: "post", externalId: uri,
      title: null, text: record.text, url: `https://bsky.app/profile/${encodeURIComponent(did)}/post/${uri.slice(uri.lastIndexOf("/") + 1)}`,
      author: { externalId: did, handle: text(author.handle), displayName: text(author.displayName), url: `https://bsky.app/profile/${encodeURIComponent(did)}` },
      language: Array.isArray(record.langs) ? text(record.langs[0]) : null, publishedAt: timestamp(record.createdAt), fetchedAt,
      availability: "available", references, media: media(object(post.embed)), platformDetails: { platform: "bluesky", cid },
      observation: { provider: "bluesky_appview", sourceId, sourceObservedAt: null, fetchedAt, timeBasis: "provider_snapshot", maturity: "unknown", metrics, evidenceKey: createHash("sha256").update(JSON.stringify([uri, cid, metrics])).digest("hex") },
    };
  }

  private async request(url: URL, parentSignal?: AbortSignal): Promise<Row> {
    parentSignal?.throwIfAborted();
    const signal = parentSignal ? AbortSignal.any([parentSignal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000);
    let response: Response;
    try { response = await this.fetcher(url, { signal, redirect: "error", headers: { Accept: "application/json", "User-Agent": "reddit-monitoring-mvp/bluesky-appview" } }); }
    catch (error) { if (parentSignal?.aborted) throw error; throw new ContentProviderError("Bluesky AppView network request failed", true); }
    if (!response.ok) {
      await response.body?.cancel();
      const rawRetry = response.headers.get("retry-after"), seconds = rawRetry ? Number(rawRetry) : NaN;
      const retryDate = rawRetry ? Date.parse(rawRetry) : NaN;
      const retryAfter = Number.isFinite(seconds) && seconds >= 0 ? seconds : Number.isFinite(retryDate) ? Math.max(0, (retryDate - Date.parse(this.now())) / 1000) : 30;
      throw new ContentProviderError(`Bluesky AppView HTTP ${response.status}`, response.status === 429 || response.status === 408 || response.status >= 500, retryAfter, response.status);
    }
    const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      if (response.body) for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > 4 * 1024 * 1024) throw new ContentProviderError("Bluesky AppView response exceeds 4 MiB", false);
        chunks.push(chunk);
      }
    } catch (error) { if (error instanceof ContentProviderError || parentSignal?.aborted) throw error; throw new ContentProviderError("Bluesky AppView response stream interrupted", true); }
    let body: Row | null;
    try { body = object(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { throw new ContentProviderError("Bluesky AppView returned malformed JSON", false); }
    if (!body || body.error !== undefined) throw new ContentProviderError("Bluesky AppView reported a provider error", false);
    return body;
  }
}
