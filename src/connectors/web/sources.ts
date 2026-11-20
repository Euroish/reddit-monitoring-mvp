import { createHash } from "node:crypto";
import { load } from "cheerio";
import Parser from "rss-parser";
import sanitize from "sanitize-html";
import type { JsonValue, SourceTarget } from "../../../packages/contracts/src/source-content";
import type { webBoards } from "../../../packages/contracts/src/web-boards";
import { stableUuidFromString } from "../../shared/ids/stable-id";
import { detectLanguage, detectWebChannel } from "../../shared/text/language";
import { fail } from "../../storage/db";
import { ContentProviderError, type CollectedContent, type CollectedPage, type ContentProvider } from "../shared/content-provider.interface";
import { canonicalizeUrl, httpsUrl, read, type ReadPage } from "./http";

const hn = "https://news.ycombinator.com";
type MediaGroup = { "media:description"?: ({ _?: string } | string)[]; "media:thumbnail"?: { $?: { url?: string } }[] };
const parser = new Parser<Record<string, never>, { author?: string; mediaGroup?: MediaGroup; trendNews?: { "ht:news_item_url"?: string[] }[] }>({
  customFields: { item: [["media:group", "mediaGroup"], ["ht:news_item", "trendNews", { keepArray: true }]] },
});
const clean = (value: string) => sanitize(value, { allowedTags: [], allowedAttributes: {} }).trim();

function article(input: {
  provider: "feed" | "newsnow";
  sourceId: string;
  fetchedAt: string;
  url: URL;
  title: string;
  text: string | null;
  publishedAt: string | null;
  feedUrl: string | null;
  board?: string;
  rank?: number;
  metrics?: Record<string, number>;
  author?: string;
  thumbnail?: string;
  externalId?: string;
  relatedUrl?: string;
}): CollectedContent {
  const externalId = input.externalId ?? input.url.href;
  const snapshot = Math.floor(Date.parse(input.fetchedAt) / 3600000);
  const language = detectLanguage(input.title, input.text);
  const textCompleteness = !input.text ? "title_only" : input.text.length < 400 ? "summary" : "full";
  const channel = detectWebChannel(input.url, input.board);
  const metrics: Record<string, number> = {
    ...(input.rank === undefined ? {} : { "web.rank": input.rank }),
    ...input.metrics,
  };
  const evidence = input.rank !== undefined || Object.keys(metrics).length > 0
    ? JSON.stringify([externalId, snapshot, metrics, input.title, input.text, input.publishedAt, input.author, channel, textCompleteness])
    : JSON.stringify([
        externalId, input.title, input.text, input.publishedAt, input.author, channel, textCompleteness,
        ...(input.thumbnail ? [input.thumbnail] : []),
        ...(input.relatedUrl ? [input.relatedUrl] : []),
      ]);
  return {
    id: stableUuidFromString(`web:content:article:${externalId}`),
    platform: "web",
    kind: "article",
    externalId,
    url: input.url.href,
    title: input.title,
    text: input.text,
    publishedAt: input.publishedAt,
    fetchedAt: input.fetchedAt,
    author: input.author ? { externalId: null, handle: null, displayName: input.author, url: null } : null,
    language,
    availability: "available",
    references: [],
    media: input.thumbnail || input.relatedUrl
      ? [{ type: input.thumbnail ? "image" : "link", url: input.thumbnail ?? input.relatedUrl!, previewUrl: null, altText: null, durationSeconds: null }]
      : [],
    platformDetails: {
      platform: "web",
      publisher: input.url.hostname,
      canonicalUrl: input.url.href,
      feedUrl: input.feedUrl,
      channel,
      textCompleteness,
    },
    observation: {
      provider: input.provider,
      sourceId: input.sourceId,
      sourceObservedAt: null,
      fetchedAt: input.fetchedAt,
      timeBasis: "provider_snapshot",
      maturity: "unknown",
      metrics,
      evidenceKey: createHash("sha256").update(evidence).digest("hex"),
    },
  };
}

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
  const allowedRaw = (env.FEED_ALLOWED_URLS ?? "")
    .split(",")
    .map((raw) => httpsUrl(raw.trim())?.href)
    .filter((v): v is string => Boolean(v));
  const restrictAllowlist = allowedRaw.length > 0;
  const allowed = new Set(allowedRaw);
  const targetTypes: SourceTarget["type"][] = [provider === "feed" ? "feed" : "search"];
  const enabled = env.SOURCE_NETWORK_ENABLED === "true";
  const normalizeTarget: ContentProvider["normalizeTarget"] = (target, kind) => {
    if (kind === "article" && provider === "newsnow" && target.type === "search") {
      const query = target.query.trim().toLowerCase();
      if (Object.hasOwn(boards, query)) return { type: "search", query };
    }
    if (kind === "article" && provider === "feed" && target.type === "feed") {
      const url = httpsUrl(target.url);
      if (url && (!restrictAllowlist || allowed.has(url.href))) return { ...target, url: url.href };
    }
    const feedErr = restrictAllowlist ? "Select an approved HTTPS feed URL" : "Enter a valid public HTTPS feed URL";
    return fail(422, provider === "feed" ? feedErr : `Available boards: ${Object.keys(boards).join(", ")}`);
  };
  return {
    capability: {
      platform: "web",
      provider,
      enabled,
      contentKinds: ["article"],
      targetTypes,
      keywordSearch: "none",
      metrics: provider === "newsnow" ? [
        { key: "web.rank", label: "Board rank", unit: "rank", cumulative: false, signed: false, contentKinds: ["article"], direction: "lower" },
        { key: "web.views", label: "Views", unit: "count", cumulative: true, signed: false, contentKinds: ["article"], direction: "higher" },
        { key: "web.likes", label: "Likes", unit: "count", cumulative: true, signed: false, contentKinds: ["article"], direction: "higher" },
      ] : [],
      observationModel: "snapshot",
      limitations: ["Current snapshot, up to 100 articles"],
    },
    normalizeTarget,
    async collectPage(input): Promise<CollectedPage> {
      if (!enabled) fail(422, "Web collection is disabled");
      const target = normalizeTarget(input.source.target, input.source.contentKind);
      const fetchedAt = new Date().toISOString();
      const base = { exhausted: false, coverage: "partial" as const, warning: null };
      const policyMax = input.source.fetchPolicy?.maxItems;
      const effectiveMax = policyMax !== undefined ? Math.min(input.limit, policyMax) : input.limit;
      const limit = Math.min(100, Math.max(1, effectiveMax));
      const stripTracking = input.source.fetchPolicy?.stripTrackingParams !== false;
      const timeoutMs = input.source.fetchPolicy?.timeoutMs;
      if (target.type === "feed") {
        const url = new URL(target.url);
        const checkpoint = input.checkpoint;
        const prior: Record<string, JsonValue> = checkpoint && typeof checkpoint === "object" && !Array.isArray(checkpoint) ? checkpoint : {};
        const from = Date.parse(input.from), to = Date.parse(input.to);
        const etag = input.httpEtag ?? (typeof prior.etag === "string" ? prior.etag : undefined);
        const modified = input.httpLastModified ?? (typeof prior.modified === "string" ? prior.modified : undefined);
        const headers: Record<string, string> = {};
        const coveredToOk = prior.coveredTo == null || (typeof prior.coveredTo === "number" && to <= prior.coveredTo);
        const coveredFromOk = (typeof prior.coveredFrom === "number" && from >= prior.coveredFrom) ||
          (prior.truncated === true &&
            (prior.limit === undefined || limit <= Number(prior.limit)) &&
            (prior.from === undefined || from >= Number(prior.from)));
        if (!input.preview && coveredToOk && coveredFromOk) {
          if (etag) headers["If-None-Match"] = etag;
          if (modified) headers["If-Modified-Since"] = modified;
        }
        const response = await readPage(url, input.signal, headers, timeoutMs);
        if (response.status === 304) {
          const nextEtag = response.etag ?? etag ?? null;
          const nextModified = response.modified ?? modified ?? null;
          return {
            ...base,
            items: [],
            notModified: true,
            exhausted: true,
            truncated: false,
            httpEtag: nextEtag,
            httpLastModified: nextModified,
            nextCheckpoint: { ...prior, etag: nextEtag, modified: nextModified },
          };
        }
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
          const link = entry.link?.trim() ? canonicalizeUrl(entry.link, baseUrl, stripTracking) : null;
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
        const nextEtag = response.etag ?? null;
        const nextModified = response.modified ?? null;
        return {
          ...base,
          items,
          exhausted: !truncated,
          truncated,
          httpEtag: nextEtag,
          httpLastModified: nextModified,
          discoveredFeeds,
          nextCheckpoint: {
            etag: nextEtag,
            modified: nextModified,
            coveredFrom: truncated ? null : from,
            coveredTo,
            truncated,
            limit,
            from,
          },
        };
      }
      const board = (target as Extract<SourceTarget, { type: "search" }>).query as Board;
      const response = await readPage(new URL(boards[board]), input.signal, undefined, timeoutMs);
      if (board === "zhihu-hot" || board === "google-trends-us") {
        const common = { provider, sourceId: input.source.id, fetchedAt, feedUrl: null, board };
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
          const relatedUrl = news && news.length <= 1000 ? canonicalizeUrl(news, undefined, stripTracking)?.href : undefined;
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
          const url = entry.link ? canonicalizeUrl(entry.link, baseUrl, stripTracking) : null;
          const title = clean(entry.title ?? "");
          const timestamp = Date.parse(entry.publishedAt ?? "");
          return url && title ? [article({ provider, sourceId: input.source.id, fetchedAt, url, title,
            text: clean(entry.summary ?? "") || null, publishedAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null,
            feedUrl: null, board, rank: index + 1, author: entry.author && clean(entry.author) })] : [];
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
          const url = typeof link === "string" ? canonicalizeUrl(link, undefined, stripTracking) : null;
          if (!url || typeof row.title !== "string" || !row.title.trim()) return [];
          const time = bilibili && typeof row.pubdate === "number" ? row.pubdate * 1000 : Date.parse(row.date_published ?? "");
          const date = new Date(time);
          const name = bilibili ? row.owner?.name : row.authors?.[0]?.name;
          const metrics: Record<string, number> = {};
          if (bilibili) {
            if (typeof row.stat?.view === "number" && Number.isFinite(row.stat.view)) metrics["web.views"] = row.stat.view;
            if (typeof row.stat?.like === "number" && Number.isFinite(row.stat.like)) metrics["web.likes"] = row.stat.like;
          }
          return [article({
            provider, sourceId: input.source.id, fetchedAt, url, title: clean(row.title),
            text: null, publishedAt: Number.isFinite(date.getTime()) ? date.toISOString() : null,
            feedUrl: null, board, rank: bilibili ? index + 1 : undefined,
            metrics: bilibili ? metrics : undefined,
            author: typeof name === "string" ? clean(name) : undefined,
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
          title, text: null, publishedAt: null, feedUrl: null, board, rank: index + 1,
        })] : [];
      });
      return { ...base, items, nextCheckpoint: null };
    },
  };
}
