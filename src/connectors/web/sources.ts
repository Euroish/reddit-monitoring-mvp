import { createHash } from "node:crypto";
import { Resolver } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import { load } from "cheerio";
import Parser from "rss-parser";
import sanitize from "sanitize-html";
import type { SourceTarget } from "../../../packages/contracts/src/source-content";
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
const parser = new Parser<Record<string, never>, { author?: string }>();
const clean = (value: string) => sanitize(value, { allowedTags: [], allowedAttributes: {} }).trim();

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
      headers, family, signal, agent: false,
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
          if (bytes > 2 * 1024 * 1024) throw new ContentProviderError("Web source response exceeds 2 MiB", false);
          chunks.push(chunk);
        }
        resolve({
          body: Buffer.concat(chunks, bytes).toString("utf8"), status,
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
  title: string; text: string | null; publishedAt: string | null; feedUrl: string | null; rank?: number; author?: string;
}): CollectedContent {
  const externalId = input.url.href;
  const snapshot = Math.floor(Date.parse(input.fetchedAt) / 300000);
  const evidence = input.rank !== undefined
    ? JSON.stringify([externalId, snapshot, input.rank, input.title, input.text, input.publishedAt, input.author])
    : JSON.stringify([externalId, input.title, input.text, input.publishedAt, input.author]);
  return {
    id: stableUuidFromString(`web:content:article:${externalId}`),
    platform: "web", kind: "article", externalId, url: externalId,
    title: input.title, text: input.text, publishedAt: input.publishedAt, fetchedAt: input.fetchedAt,
    author: input.author ? { externalId: null, handle: null, displayName: input.author, url: null } : null,
    language: null, availability: "available", references: [], media: [],
    platformDetails: { platform: "web", publisher: input.url.hostname, canonicalUrl: externalId, feedUrl: input.feedUrl },
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

const boards = {
  hackernews: hn,
  "bilibili-hot-video": "https://api.bilibili.com/x/web-interface/popular",
  "v2ex-share": "https://www.v2ex.com/feed/share.json",
} as const;
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
      if (url && allowed.has(url.href)) return { type: "feed", url: url.href };
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
        const feed = await parser.parseString(response.body);
        let coveredTo: number | null = null;
        const items: CollectedContent[] = [];
        let truncated = false;
        const entries = feed.items.map((entry) => ({ entry, timestamp: Date.parse(entry.isoDate ?? "") }));
        entries.sort((a, b) => (b.timestamp || -Infinity) - (a.timestamp || -Infinity));
        for (const { entry, timestamp } of entries) {
          const link = entry.link && httpsUrl(entry.link, response.url ?? url.href);
          if (!link || !entry.title) continue;
          if (timestamp < from) continue;
          if (timestamp >= to) {
            coveredTo = Math.min(coveredTo ?? timestamp, timestamp);
            continue;
          }
          const title = clean(entry.title);
          if (!title) continue;
          if (items.length === limit) {
            truncated = true;
            break;
          }
          items.push(article({
            provider, sourceId: input.source.id, fetchedAt, url: link, title,
            publishedAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null,
            text: clean(entry.content ?? entry.summary ?? "") || null, feedUrl: url.href,
            author: clean(entry.creator ?? entry.author ?? "") || undefined,
          }));
        }
        return {
          ...base, items, exhausted: !truncated,
          nextCheckpoint: {
            etag: response.etag ?? null, modified: response.modified ?? null,
            coveredFrom: truncated ? null : from, coveredTo,
          },
        };
      }
      const board = (target as Extract<SourceTarget, { type: "search" }>).query as Board;
      const response = await readPage(new URL(boards[board]), input.signal);
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
