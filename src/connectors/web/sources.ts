import { createHash } from "node:crypto";
import { Resolver } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { load } from "cheerio";
import Parser from "rss-parser";
import sanitize from "sanitize-html";
import type { SourceTarget } from "../../../packages/contracts/src/source-content";
import type { webBoards } from "../../../packages/contracts/src/web-boards";
import { stableUuidFromString } from "../../shared/ids/stable-id";
import { fail } from "../../storage/db";
import { ContentProviderError, type CollectedContent, type CollectedPage, type ContentProvider } from "../shared/content-provider.interface";

const reserved = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3],
] as const) reserved.addSubnet(network, prefix);
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
for (const [network, prefix] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]] as const)
  reserved.addSubnet(network, prefix, "ipv6");

const hn = "https://news.ycombinator.com";
type MediaGroup = { "media:description"?: ({ _?: string } | string)[]; "media:thumbnail"?: { $?: { url?: string } }[] };
const parser = new Parser<Record<string, never>, { author?: string; mediaGroup?: MediaGroup; trendNews?: { "ht:news_item_url"?: string[] }[] }>({
  customFields: { item: [["media:group", "mediaGroup"], ["ht:news_item", "trendNews", { keepArray: true }]] },
});
const clean = (value: string) => sanitize(value, { allowedTags: [], allowedAttributes: {} }).trim();
const decodeGzip = promisify(gunzip);
const maxResponseBytes = 2 * 1024 * 1024;

function httpsUrl(raw: string, base?: string) {
  try {
    const url = new URL(raw, base);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !url.hostname.includes(".") || isIP(url.hostname)) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

async function read(url: URL, parent?: AbortSignal, headers?: Record<string, string>) {
  const timer = AbortSignal.timeout(15000);
  const signal = parent ? AbortSignal.any([parent, timer]) : timer;
  const resolver = new Resolver();
  const cancel = () => resolver.cancel();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (let hop = 0; hop <= 3; hop++) {
      signal.throwIfAborted();
      const addresses = (await Promise.allSettled([
        resolver.resolve4(url.hostname), resolver.resolve6(url.hostname),
      ])).flatMap((result) => result.status === "fulfilled" ? result.value : []);
      signal.throwIfAborted();
      if (!addresses.length) throw new ContentProviderError("Web source DNS lookup failed", true);
      const address = addresses.find((ip) => isIP(ip) === 4 ? !reserved.check(ip) :
        globalV6.check(ip, "ipv6") && !reserved.check(ip, "ipv6"));
      if (!address) throw new ContentProviderError("Web source address is not public", false);
      const response = await requestPage(url, address, signal, headers);
      if (!response.location) return { ...response, url: url.href };
      const next = httpsUrl(response.location, url.href);
      if (!next || hop === 3) throw new ContentProviderError("Invalid web source redirect", false);
      if (next.origin !== url.origin) headers = undefined;
      url = next;
    }
    throw new ContentProviderError("Too many web source redirects", false);
  } catch (error) {
    if (error instanceof ContentProviderError || parent?.aborted) throw error;
    throw new ContentProviderError("Web source connection failed or timed out", true);
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

function requestPage(url: URL, ip: string, signal: AbortSignal, headers?: Record<string, string>) {
  const family = isIP(ip);
  return new Promise<{ body: string; status: number; etag?: string; modified?: string; location?: string }>((resolve, reject) => {
    const req = request(url, {
      headers: {
        "User-Agent": "MonitoringWorkbench/1.0 (RSS reader)",
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.1",
        "Accept-Encoding": "gzip",
        ...headers,
      },
      family, signal, agent: false,
      lookup: (_host, _options, callback) => callback(null, ip, family),
    }, async (response) => {
      try {
        const status = response.statusCode ?? 500;
        if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
          response.destroy();
          resolve({ status, body: "", location: response.headers.location });
          return;
        }
        if (status !== 200 && status !== 304) {
          const retry = response.headers["retry-after"];
          const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : (Date.parse(retry ?? "") - Date.now()) / 1000;
          const delay = Number.isFinite(seconds) ? Math.min(43200, Math.max(1, Math.ceil(seconds))) : 30;
          throw new ContentProviderError(`Web source returned HTTP ${status}`, status === 429 || status >= 500, delay, status);
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        for await (const chunk of response) {
          bytes += chunk.length;
          if (bytes > maxResponseBytes) throw new ContentProviderError("Web source response exceeds 2 MiB", false);
          chunks.push(chunk);
        }
        const body = Buffer.concat(chunks, bytes);
        const decoded = status === 200 && response.headers["content-encoding"] === "gzip"
          ? await decodeGzip(body, { maxOutputLength: maxResponseBytes }).catch(() => {
            throw new ContentProviderError("Invalid or oversized gzip response", false);
          })
          : body;
        signal.throwIfAborted();
        resolve({
          body: decoded.toString("utf8"), status,
          etag: response.headers.etag, modified: response.headers["last-modified"],
        });
      } catch (error) {
        response.destroy();
        reject(error);
      }
    });
    req.on("error", reject);
    req.end();
  });
}

function article(input: {
  provider: "feed" | "newsnow"; sourceId: string; fetchedAt: string; url: URL;
  title: string; text: string | null; publishedAt: string | null; feedUrl: string | null; rank?: number; author?: string; thumbnail?: string;
  externalId?: string;
  relatedUrl?: string;
}): CollectedContent {
  const externalId = input.externalId ?? input.url.href;
  const snapshot = Math.floor(Date.parse(input.fetchedAt) / 300000);
  const evidence = input.rank !== undefined
    ? JSON.stringify([externalId, snapshot, input.rank, input.title, input.text, input.publishedAt, input.author])
    : JSON.stringify([externalId, input.title, input.text, input.publishedAt, input.author, ...(input.thumbnail ? [input.thumbnail] : []),
      ...(input.relatedUrl ? [input.relatedUrl] : [])]);
  return {
    id: stableUuidFromString(`web:content:article:${externalId}`),
    platform: "web", kind: "article", externalId, url: input.url.href,
    title: input.title, text: input.text, publishedAt: input.publishedAt, fetchedAt: input.fetchedAt,
    author: input.author ? { externalId: null, handle: null, displayName: input.author, url: null } : null,
    language: null, availability: "available", references: [],
    media: input.thumbnail || input.relatedUrl
      ? [{ type: input.thumbnail ? "image" : "link", url: input.thumbnail ?? input.relatedUrl!, previewUrl: null, altText: null, durationSeconds: null }]
      : [],
    platformDetails: { platform: "web", publisher: input.url.hostname, canonicalUrl: input.url.href, feedUrl: input.feedUrl },
    observation: {
      provider: input.provider, sourceId: input.sourceId, sourceObservedAt: null, fetchedAt: input.fetchedAt,
      timeBasis: "provider_snapshot", maturity: "unknown",
      metrics: input.rank === undefined ? {} : { "web.rank": input.rank },
      evidenceKey: createHash("sha256").update(evidence).digest("hex"),
    },
  };
}

type ReadPage = (url: URL, signal?: AbortSignal, headers?: Record<string, string>) => Promise<{
  body: string; status: number; etag?: string; modified?: string; url?: string;
}>;

type ListConfig = NonNullable<Extract<SourceTarget, { type: "feed" }>["list"]>;
type Entry = { link?: string; title?: string; summary?: string; publishedAt?: string; author?: string; thumbnail?: string };

function jsonDocument(body: string): unknown {
  try { return JSON.parse(body); }
  catch { throw new ContentProviderError("Expected a JSON document", false); }
}

function jsonField(value: unknown, path?: string): unknown {
  if (!path) return undefined;
  if (path === "$") return value;
  for (const key of path.split(".")) {
    if (!value || typeof value !== "object" || !Object.hasOwn(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function jsonText(value: unknown, path?: string) {
  const field = jsonField(value, path);
  return typeof field === "string" ? field : undefined;
}

function listEntries(body: string, config: ListConfig, base: string, preview?: boolean) {
  if (config.format === "json_list") {
    const rows = jsonField(jsonDocument(body), config.items);
    if (!Array.isArray(rows)) throw new ContentProviderError("JSON items path must select an array", false);
    return { entries: rows.slice(0, 200).map((row): Entry => ({
      link: jsonText(row, config.link), title: jsonText(row, config.title), summary: jsonText(row, config.summary),
      publishedAt: jsonText(row, config.publishedAt), author: jsonText(row, config.author),
    })), discoveredFeeds: undefined };
  }

  const page = load(body);
  const rows = page(config.items).slice(0, 200);
  if (!rows.length) throw new ContentProviderError("Item selector matched no elements", false);
  const entries = rows.toArray().map((row): Entry => {
    const item = page(row);
    const field = (selector?: string) => !selector ? page([]) : item.is(selector) ? item : item.find(selector).first();
    const date = field(config.publishedAt);
    return {
      link: field(config.link).attr("href"), title: field(config.title).text(), summary: field(config.summary).text(),
      publishedAt: date.attr("datetime") ?? date.text(), author: field(config.author).text(),
    };
  });
  const discoveredFeeds = preview ? [...new Set(page('link[rel="alternate"][type="application/rss+xml"],link[rel="alternate"][type="application/atom+xml"]')
    .slice(0, 10).toArray().flatMap((node) => {
      const href = page(node).attr("href");
      const url = href && httpsUrl(href, base);
      return url ? [url.href] : [];
    }))] : undefined;
  return { entries, discoveredFeeds };
}

const boards = {
  hackernews: hn,
  "bilibili-hot-video": "https://api.bilibili.com/x/web-interface/popular",
  "zhihu-hot": "https://api.zhihu.com/topstory/hot-lists/total?limit=30",
  "google-trends-us": "https://trends.google.com/trending/rss?geo=US",
  "v2ex-share": "https://www.v2ex.com/feed/share.json",
  "github-trending": "https://github.com/trending",
  "huggingface-papers": "https://huggingface.co/api/daily_papers?limit=30",
} as const satisfies Record<keyof typeof webBoards, string>;
type Board = keyof typeof boards;

export function webSource(provider: "feed" | "newsnow", env = process.env, readPage: ReadPage = read): ContentProvider {
  const allowed = new Set((env.FEED_ALLOWED_URLS ?? "").split(",").map((raw) => httpsUrl(raw.trim())?.href));
  const targetTypes: SourceTarget["type"][] = [provider === "feed" ? "feed" : "search"];
  const enabled = env.SOURCE_NETWORK_ENABLED === "true" && (provider === "newsnow" || [...allowed].some(Boolean));
  const normalizeTarget: ContentProvider["normalizeTarget"] = (target, kind) => {
    if (kind === "article" && provider === "newsnow" && target.type === "search") {
      const query = target.query.trim().toLowerCase();
      if (Object.hasOwn(boards, query)) return { type: "search", query };
    }
    if (kind === "article" && provider === "feed" && target.type === "feed") {
      const url = httpsUrl(target.url);
      if (url && allowed.has(url.href)) return { ...target, url: url.href };
    }
    return fail(422, provider === "feed" ? "Select an approved HTTPS feed URL" : `Available boards: ${Object.keys(boards).join(", ")}`);
  };
  return {
    capability: {
      platform: "web", provider, enabled, contentKinds: ["article"], targetTypes, keywordSearch: "none",
      metrics: provider === "newsnow" ? [{
        key: "web.rank", label: "Board rank", unit: "rank", cumulative: false, signed: false, contentKinds: ["article"], direction: "lower",
      }] : [],
      observationModel: "snapshot", limitations: ["Current snapshot, up to 30 articles"],
    },
    normalizeTarget,
    async collectPage(input): Promise<CollectedPage> {
      if (!enabled) fail(422, "Web collection is disabled");
      const target = normalizeTarget(input.source.target, input.source.contentKind);
      const fetchedAt = new Date().toISOString();
      const base = { exhausted: false, coverage: "partial" as const, warning: null };
      const limit = Math.min(30, input.limit);
      if (target.type === "feed") {
        const url = new URL(target.url);
        const checkpoint = input.checkpoint;
        const prior = checkpoint && typeof checkpoint === "object" && !Array.isArray(checkpoint) ? checkpoint : {};
        const from = Date.parse(input.from), to = Date.parse(input.to);
        const headers: Record<string, string> = {};
        // A 304 is usable only when the new window excludes all previously skipped entries.
        if (typeof prior.coveredFrom === "number" && from >= prior.coveredFrom &&
            (prior.coveredTo === null || typeof prior.coveredTo === "number" && to <= prior.coveredTo)) {
          if (typeof prior.etag === "string") headers["If-None-Match"] = prior.etag;
          if (typeof prior.modified === "string") headers["If-Modified-Since"] = prior.modified;
        }
        const response = await readPage(url, input.signal, headers);
        if (response.status === 304) return {
          ...base, items: [], notModified: true, exhausted: true,
          nextCheckpoint: { ...prior, etag: response.etag ?? prior.etag ?? null, modified: response.modified ?? prior.modified ?? null },
        };
        const baseUrl = response.url ?? url.href;
        let entries: Entry[];
        let discoveredFeeds: string[] | undefined;
        if (target.list) {
          ({ entries, discoveredFeeds } = listEntries(response.body, target.list, baseUrl, input.preview));
        } else {
          const feed = await parser.parseString(response.body).catch(() => {
            throw new ContentProviderError("Expected a valid RSS or Atom feed", false);
          });
          const youtube = url.hostname === "www.youtube.com" && url.pathname === "/feeds/videos.xml";
          entries = feed.items.map((entry) => {
            const media = youtube ? entry.mediaGroup : undefined;
            const description = media?.["media:description"]?.[0];
            const thumbnail = media?.["media:thumbnail"]?.[0]?.$?.url;
            return {
              link: entry.link, title: entry.title, publishedAt: entry.isoDate, author: entry.creator ?? entry.author,
              summary: entry.content ?? entry.summary ?? (typeof description === "string" ? description : description?._),
              thumbnail: thumbnail ? httpsUrl(thumbnail, baseUrl)?.href : undefined,
            };
          });
        }
        let coveredTo: number | null = null;
        const items: CollectedContent[] = [];
        let truncated = false;
        const seen = new Set<string>();
        let valid = false;
        const ordered = entries.map((entry) => ({ entry, timestamp: Date.parse(entry.publishedAt ?? "") }));
        const sortTime = (time: number) => Number.isFinite(time) ? time : -Infinity;
        ordered.sort((a, b) => sortTime(b.timestamp) - sortTime(a.timestamp));
        for (const { entry, timestamp } of ordered) {
          const link = entry.link?.trim() && httpsUrl(entry.link, baseUrl);
          const title = clean(entry.title ?? "");
          if (!link || link.href.length > 1000 || !title || seen.has(link.href)) continue;
          valid = true;
          if (timestamp < from) continue;
          if (timestamp >= to) {
            coveredTo = Math.min(coveredTo ?? timestamp, timestamp);
            continue;
          }
          if (items.length === limit) {
            truncated = true;
            break;
          }
          seen.add(link.href);
          items.push(article({
            provider, sourceId: input.source.id, fetchedAt, url: link, title,
            publishedAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null,
            text: clean(entry.summary ?? "") || null, feedUrl: url.href,
            author: clean(entry.author ?? "") || undefined, thumbnail: entry.thumbnail,
          }));
        }
        if (target.list && entries.length && !valid)
          throw new ContentProviderError("No list entries have both a title and a valid HTTPS link", false);
        return {
          ...base, items, exhausted: !truncated, discoveredFeeds,
          nextCheckpoint: {
            etag: response.etag ?? null, modified: response.modified ?? null,
            coveredFrom: truncated ? null : from, coveredTo,
          },
        };
      }
      const board = (target as Extract<SourceTarget, { type: "search" }>).query as Board;
      const response = await readPage(new URL(boards[board]), input.signal);
      if (board === "zhihu-hot" || board === "google-trends-us") {
        const common = { provider, sourceId: input.source.id, fetchedAt, feedUrl: null };
        if (board === "zhihu-hot") {
          const rows = jsonField(jsonDocument(response.body), "data");
          if (!Array.isArray(rows) || !rows.length) throw new ContentProviderError("Invalid Zhihu hot list", false);
          const items = rows.slice(0, limit).flatMap((row, index) => {
            // The URL carries the exact ID. The JSON number can exceed JavaScript's safe integer range.
            const id = jsonText(row, "target.url")?.match(/\/questions?\/(\d+)(?:[/?#]|$)/u)?.[1];
            const title = clean(jsonText(row, "target.title") ?? "");
            return id && title ? [article({ ...common, title, text: clean(jsonText(row, "target.excerpt") ?? "") || null,
              url: new URL(`https://www.zhihu.com/question/${id}`), publishedAt: null, rank: index + 1 })] : [];
          });
          if (!items.length) throw new ContentProviderError("No valid Zhihu questions", false);
          return { ...base, items, nextCheckpoint: null };
        }
        const feed = await parser.parseString(response.body).catch(() => {
          throw new ContentProviderError("Invalid Google Trends RSS", false);
        });
        const items = feed.items.slice(0, limit).flatMap((entry) => {
          const title = clean(entry.title ?? "");
          if (!title || !entry.isoDate) return [];
          const url = new URL("https://trends.google.com/trends/explore");
          url.search = new URLSearchParams({ geo: "US", q: title, date: `${entry.isoDate.slice(0, 10)} ${entry.isoDate.slice(0, 10)}` }).toString();
          const externalId = `google-trends:US:${createHash("sha256").update(JSON.stringify([title, entry.isoDate])).digest("hex")}`;
          if (url.href.length > 1000) return [];
          const news = entry.trendNews?.[0]?.["ht:news_item_url"]?.[0];
          const relatedUrl = news && news.length <= 1000 ? httpsUrl(news)?.href : undefined;
          return [article({ ...common, title, url, externalId, relatedUrl, text: null, publishedAt: entry.isoDate })];
        });
        if (feed.items.length && !items.length) throw new ContentProviderError("No valid Google Trends entries", false);
        return { ...base, items, nextCheckpoint: null };
      }
      if (board === "github-trending" || board === "huggingface-papers") {
        const baseUrl = response.url ?? boards[board];
        let entries: Entry[];
        if (board === "github-trending") {
          ({ entries } = listEntries(response.body, { format: "web_list", items: "article.Box-row", link: "h2 a", title: "h2 a", summary: "p" }, baseUrl));
          for (const entry of entries) entry.title = entry.title?.replace(/\s*\/\s*/u, "/");
        } else {
          const rows = jsonDocument(response.body);
          if (!Array.isArray(rows)) throw new ContentProviderError("Invalid Daily Papers response", false);
          entries = rows.slice(0, limit).map((row) => {
            const id = jsonText(row, "paper.id");
            return {
              title: jsonText(row, "title"), summary: jsonText(row, "summary"), publishedAt: jsonText(row, "paper.publishedAt"),
              link: id && /^\d{4}\.\d{4,5}(?:v\d+)?$/.test(id) ? `/papers/${id}` : undefined,
              author: jsonText(row, "paper.authors.0.name"),
            };
          });
        }
        const items = entries.slice(0, limit).flatMap((entry, index) => {
          const url = entry.link && httpsUrl(entry.link, baseUrl);
          const title = clean(entry.title ?? "");
          const timestamp = Date.parse(entry.publishedAt ?? "");
          return url && title ? [article({ provider, sourceId: input.source.id, fetchedAt, url, title,
            text: clean(entry.summary ?? "") || null, publishedAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null,
            feedUrl: null, rank: index + 1, author: entry.author && clean(entry.author) })] : [];
        });
        if (entries.length && !items.length) throw new ContentProviderError("Board entries no longer match the expected format", false);
        return { ...base, items, nextCheckpoint: null };
      }
      if (board !== "hackernews") {
        const envelope = JSON.parse(response.body);
        const bilibili = board === "bilibili-hot-video";
        const rows = bilibili ? envelope?.code === 0 && envelope.data?.list : envelope?.items;
        if (!Array.isArray(rows)) throw new ContentProviderError("Invalid board response", false);
        const items = rows.slice(0, limit).flatMap((row, index) => {
          const link = bilibili && typeof row?.bvid === "string" && /^BV\w+$/.test(row.bvid)
            ? `https://www.bilibili.com/video/${row.bvid}` : row?.url;
          const url = typeof link === "string" ? httpsUrl(link) : null;
          if (!url || typeof row.title !== "string" || !row.title.trim()) return [];
          const time = bilibili && typeof row.pubdate === "number" ? row.pubdate * 1000 : Date.parse(row.date_published ?? "");
          const date = new Date(time);
          const name = bilibili ? row.owner?.name : row.authors?.[0]?.name;
          return [article({
            provider, sourceId: input.source.id, fetchedAt, url, title: clean(row.title),
            text: null, publishedAt: Number.isFinite(date.getTime()) ? date.toISOString() : null,
            feedUrl: null, rank: bilibili ? index + 1 : undefined, author: typeof name === "string" ? clean(name) : undefined,
          })];
        });
        return { ...base, items, nextCheckpoint: null };
      }
      const page = load(response.body);
      const rows = page("tr.athing").toArray();
      if (!rows.length) throw new ContentProviderError("Hacker News front page has no stories", false);
      const items = rows.slice(0, limit).flatMap((row, index) => {
        const id = page(row).attr("id");
        const title = page(row).find(".titleline a").first().text();
        return id && /^\d+$/.test(id) && title ? [article({
          provider, sourceId: input.source.id, fetchedAt, url: new URL(`/item?id=${id}`, hn),
          title, text: null, publishedAt: null, feedUrl: null, rank: index + 1,
        })] : [];
      });
      return { ...base, items, nextCheckpoint: null };
    },
  };
}
