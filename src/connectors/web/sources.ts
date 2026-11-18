import { createHash } from "node:crypto";
import { resolve4 } from "node:dns/promises";
import { request } from "node:https";
import { BlockList } from "node:net";
import { load } from "cheerio";
import Parser from "rss-parser";
import sanitize from "sanitize-html";
import type { SourceTarget } from "../../../packages/contracts/src/source-content";
import { stableUuidFromString } from "../../shared/ids/stable-id";
import { fail } from "../../storage/db";
import { ContentProviderError, type CollectedContent, type ContentProvider } from "../shared/content-provider.interface";

const reserved = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3],
] as const) reserved.addSubnet(network, prefix);
const hn = "https://news.ycombinator.com";
const parser = new Parser();
const clean = (value: string) => sanitize(value, { allowedTags: [], allowedAttributes: {} }).trim();

function httpsUrl(raw: string, base?: string) {
  try {
    const url = new URL(raw, base);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !url.hostname.includes(".")) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

async function read(url: URL, signal?: AbortSignal, headers?: Record<string, string>) {
  const [ip] = await resolve4(url.hostname);
  if (!ip || reserved.check(ip)) throw new ContentProviderError("Feed address is not public IPv4", false);
  const timer = AbortSignal.timeout(15000);
  return new Promise<{ body: string; status: number; etag?: string; modified?: string }>((resolve, reject) => {
    const req = request(url, {
      headers, family: 4,
      signal: signal ? AbortSignal.any([signal, timer]) : timer,
      lookup: (_host, _options, callback) => callback(null, ip, 4),
    }, async (response) => {
      try {
        const status = response.statusCode ?? 500;
        if (status !== 200 && status !== 304)
          throw new ContentProviderError(`Web source returned HTTP ${status}`, status === 429 || status >= 500, 30, status);
        const chunks = [];
        let bytes = 0;
        for await (const chunk of response) {
          bytes += chunk.length;
          if (bytes > 2 * 1024 * 1024) throw new ContentProviderError("Web source response exceeds 2 MiB", false);
          chunks.push(chunk);
        }
        resolve({
          body: Buffer.concat(chunks).toString("utf8"), status,
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
  title: string; text: string | null; publishedAt: string | null; feedUrl: string | null; rank?: number;
}): CollectedContent {
  const externalId = input.url.href;
  const snapshot = Math.floor(Date.parse(input.fetchedAt) / 300000);
  const evidence = input.provider === "newsnow"
    ? `hackernews:${externalId}:${snapshot}`
    : JSON.stringify([externalId, input.title, input.text, input.publishedAt]);
  return {
    id: stableUuidFromString(`web:content:article:${externalId}`),
    platform: "web", kind: "article", externalId, url: externalId,
    title: input.title, text: input.text, publishedAt: input.publishedAt, fetchedAt: input.fetchedAt,
    author: null, language: null, availability: "available", references: [], media: [],
    platformDetails: { platform: "web", publisher: input.url.hostname, canonicalUrl: externalId, feedUrl: input.feedUrl },
    observation: {
      provider: input.provider, sourceId: input.sourceId, sourceObservedAt: null, fetchedAt: input.fetchedAt,
      timeBasis: "provider_snapshot", maturity: "unknown",
      metrics: input.rank === undefined ? {} : { "web.rank": input.rank },
      evidenceKey: createHash("sha256").update(evidence).digest("hex"),
    },
  };
}

export function webSource(provider: "feed" | "newsnow", env = process.env): ContentProvider {
  const allowed = new Set((env.FEED_ALLOWED_URLS ?? "").split(",").map((raw) => httpsUrl(raw.trim())?.href));
  const targetTypes: SourceTarget["type"][] = [provider === "feed" ? "feed" : "search"];
  const enabled = env.SOURCE_NETWORK_ENABLED === "true" && (provider === "newsnow" || [...allowed].some(Boolean));
  const normalizeTarget: ContentProvider["normalizeTarget"] = (target, kind) => {
    if (kind === "article" && provider === "newsnow" && target.type === "search" && target.query.trim().toLowerCase() === "hackernews")
      return { type: "search", query: "hackernews" };
    if (kind === "article" && provider === "feed" && target.type === "feed") {
      const url = httpsUrl(target.url);
      if (url && allowed.has(url.href)) return { type: "feed", url: url.href };
    }
    return fail(422, provider === "feed" ? "Select an approved HTTPS feed URL" : "Available board: hackernews");
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
    async collectPage(input) {
      if (!enabled) fail(422, "Web collection is disabled");
      const target = normalizeTarget(input.source.target, input.source.contentKind);
      const fetchedAt = new Date().toISOString();
      const base = { exhausted: false, coverage: "partial" as const, warning: null };
      const limit = Math.min(30, input.limit);
      if (target.type === "feed") {
        const url = new URL(target.url);
        const checkpoint = input.checkpoint;
        const prior = checkpoint && typeof checkpoint === "object" && !Array.isArray(checkpoint) ? checkpoint : {};
        const headers: Record<string, string> = {};
        if (typeof prior.etag === "string") headers["If-None-Match"] = prior.etag;
        if (typeof prior.modified === "string") headers["If-Modified-Since"] = prior.modified;
        const response = await read(url, input.signal, headers);
        if (response.status === 304) return { ...base, items: [], nextCheckpoint: checkpoint, notModified: true };
        const feed = await parser.parseString(response.body);
        const items = feed.items.flatMap((entry) => {
          const link = entry.link && httpsUrl(entry.link, url.href);
          const title = clean(entry.title ?? "");
          if (!link || !title) return [];
          const timestamp = Date.parse(entry.isoDate ?? "");
          const publishedAt = Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
          if (publishedAt && (timestamp < Date.parse(input.from) || timestamp >= Date.parse(input.to))) return [];
          return [article({
            provider, sourceId: input.source.id, fetchedAt, url: link, title, publishedAt,
            text: clean(entry.content ?? entry.summary ?? "") || null, feedUrl: url.href,
          })];
        });
        return {
          ...base, items: items.slice(0, limit),
          nextCheckpoint: items.length > limit ? null : { etag: response.etag ?? null, modified: response.modified ?? null },
        };
      }
      const response = await read(new URL(hn), input.signal);
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
