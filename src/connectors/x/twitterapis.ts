import { createHash } from "node:crypto";
import type { ContentAuthor, ContentMedia, ContentReference } from "../../../packages/contracts/src/content";
import type { PublicContentKind } from "../../../packages/contracts/src/common";
import type { SourceCapability, SourceTarget } from "../../../packages/contracts/src/collection";
import { stableUuidFromString } from "../../shared/ids/stable-id";
import { fail } from "../../shared/errors";
import {
  ContentProviderError,
  type CollectedContent,
  type CollectContentPageRequest,
  type ContentProvider,
} from "../shared/content-provider.interface";

export const metricFields = {
  "x.likes": "favorite_count",
  "x.reposts": "retweet_count",
  "x.replies": "reply_count",
  "x.quotes": "quote_count",
  "x.views": "view_count",
  "x.bookmarks": "bookmark_count",
};
const string = (value: unknown) => typeof value === "string" && value.length ? value : null;
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const tweetId = (value: unknown) => typeof value === "string" && /^\d{1,25}$/.test(value) ? value : null;
const flag = (value: unknown) => typeof value === "boolean" ? value : null;
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const nonNegInt = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

function https(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("https://")) return null;
  try {
    const url = new URL(value);
    return url.username || url.password ? null : url.href;
  } catch {
    return null;
  }
}

function externalHost(rawUrl: string): string | null {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, "");
    if (!host || host === "x.com" || host === "twitter.com" || host === "t.co" || host.endsWith(".twitter.com")) {
      return null;
    }
    return host;
  } catch {
    return null;
  }
}

function tweetMedia(row: Record<string, unknown>): ContentMedia[] {
  const entities = object(row.entities);
  const attached = row.media ?? object(row.extended_entities).media ?? entities.media;
  const result = new Map<string, ContentMedia>();
  for (const value of array(attached).slice(0, 20)) {
    const media = object(value), info = object(media.video_info);
    const preview = https(media.media_url_https ?? media.media_url);
    const isVideo = media.type === "video" || media.type === "animated_gif";
    const best = array(info.variants).map(object)
      .filter((variant) => variant.content_type === "video/mp4" && https(variant.url))
      .sort((a, b) => (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0))[0];
    const video = isVideo && https(best?.url);
    const url = video || preview;
    if (!url) continue;
    const duration = info.duration_millis;
    result.set(url, {
      type: video ? "video" : "image", url, previewUrl: video ? preview : null,
      altText: string(media.ext_alt_text),
      durationSeconds: video && typeof duration === "number" && Number.isFinite(duration) && duration >= 0 ? duration / 1000 : null,
    });
  }
  for (const value of array(entities.urls).slice(0, 30)) {
    const link = object(value);
    const url = https(link.expanded_url ?? link.url);
    if (url && !result.has(url))
      result.set(url, { type: "link", url, previewUrl: null, altText: null, durationSeconds: null });
  }
  return [...result.values()];
}

function buildXAuthor(authorObj: Record<string, unknown>, handle: string): ContentAuthor {
  const result: ContentAuthor = {
    externalId: tweetId(authorObj.id),
    handle,
    displayName: string(authorObj.name),
    url: `https://x.com/${encodeURIComponent(handle)}`,
  };
  const avatarUrl = https(authorObj.profilePicture ?? authorObj.profile_image_url_https ?? authorObj.avatar);
  if (avatarUrl) result.avatarUrl = avatarUrl;
  const bio = string(authorObj.description ?? authorObj.bio);
  if (bio) result.bio = bio.slice(0, 500);
  const location = string(authorObj.location);
  if (location) result.location = location.slice(0, 120);
  const verified = flag(authorObj.isBlueVerified ?? authorObj.verified);
  if (verified !== null) result.verified = verified;
  const followers = nonNegInt(authorObj.followers ?? authorObj.followers_count);
  if (followers !== null) result.followersCount = followers;
  const following = nonNegInt(authorObj.following ?? authorObj.friends_count ?? authorObj.following_count);
  if (following !== null) result.followingCount = following;
  const statuses = nonNegInt(authorObj.statusesCount ?? authorObj.statuses_count);
  if (statuses !== null) result.statusesCount = statuses;
  const createdMs = Date.parse(string(authorObj.createdAt ?? authorObj.created_at) ?? "");
  if (Number.isFinite(createdMs)) result.accountCreatedAt = new Date(createdMs).toISOString();
  return result;
}

function extractTagList(items: unknown[], key: string, max: number, lower = true): string[] {
  const seen = new Set<string>();
  for (const entry of items) {
    const raw = string(object(entry)[key])?.trim();
    if (raw) seen.add(lower ? raw.toLowerCase() : raw.toUpperCase());
    if (seen.size >= max) break;
  }
  return [...seen];
}

function buildXEntities(row: Record<string, unknown>, media: ContentMedia[]) {
  const entities = object(row.entities);
  const hashtags = extractTagList(array(entities.hashtags), "text", 30, true);
  const mentions = extractTagList(array(entities.user_mentions), "screen_name", 30, true);
  const cashtags = extractTagList(array(entities.symbols), "text", 20, false);
  const firstExternal = media.find((m) => m.type === "link")?.url ?? null;
  const domain = firstExternal ? externalHost(firstExternal) : null;
  return {
    ...(hashtags.length ? { hashtags } : {}),
    ...(mentions.length ? { mentions } : {}),
    ...(cashtags.length ? { cashtags } : {}),
    ...(domain ? { externalDomain: domain } : {}),
  };
}

export function normalizeTweet(value: unknown, sourceId: string, fetchedAt: string, provider = "twitterapis"): CollectedContent {
  const row = object(value);
  const externalId = tweetId(row.id);
  const time = Date.parse(string(row.created_at) ?? "");
  const text = string(row.full_text) ?? string(row.text);
  if (!externalId || !Number.isFinite(time) || text === null)
    throw new ContentProviderError("TwitterAPIs tweet lacks a valid ID, date or text", false);
  const authorObj = object(row.author);
  const handle = string(authorObj.username);
  const conversationId = tweetId(row.conversation_id);
  const references: ContentReference[] = [];
  for (const [relation, id] of [
    ["thread_root", conversationId],
    ["reply_to", tweetId(row.in_reply_to_status_id)],
    ["quote", tweetId(row.quoted_status_id) ?? tweetId(object(row.quoted_tweet).id)],
    ["repost", tweetId(object(row.retweeted_tweet).id)],
  ] as const) {
    if (id && id !== externalId) references.push({ relation, kind: "post", externalId: id });
  }
  const metrics = Object.fromEntries(Object.entries(metricFields).map(([key, field]) => [key, nonNegInt(row[field])]));
  const media = tweetMedia(row);
  const content = {
    id: stableUuidFromString(`x:content:${externalId}`),
    platform: "x",
    kind: "post",
    externalId,
    title: null,
    text,
    url: `https://x.com/i/status/${externalId}`,
    language: string(row.lang),
    publishedAt: new Date(time).toISOString(),
    availability: "available",
    author: handle ? buildXAuthor(authorObj, handle) : null,
    references,
    media,
    platformDetails: {
      platform: "x",
      conversationId,
      isReply: flag(row.is_reply),
      isRepost: flag(row.is_retweet),
      isQuote: flag(row.is_quote),
      sensitive: flag(row.possibly_sensitive),
      ...buildXEntities(row, media),
    },
  } satisfies Omit<CollectedContent, "fetchedAt" | "observation">;
  return {
    ...content, fetchedAt,
    observation: {
      provider, sourceId, sourceObservedAt: null, fetchedAt,
      timeBasis: "provider_snapshot", maturity: "unknown", metrics,
      evidenceKey: createHash("sha256").update(JSON.stringify([content, metrics])).digest("hex"),
    },
  };
}

export type NormalizedXTarget = Extract<SourceTarget, { type: "search" | "account" }>;

export function normalizeXTarget(target: SourceTarget, kind: PublicContentKind): NormalizedXTarget {
  if (kind === "post" && target.type === "search" && target.query.trim()) {
    return {
      type: "search",
      query: target.query.trim(),
      ...(target.sort ? { sort: target.sort } : {}),
      ...(target.minLikes !== undefined ? { minLikes: target.minLikes } : {}),
      ...(target.minComments !== undefined ? { minComments: target.minComments } : {}),
      ...(target.excludeReposts ? { excludeReposts: true } : {}),
      ...(target.language ? { language: target.language.toLowerCase() } : {}),
    };
  }
  if (kind === "post" && target.type === "account" && !target.query) {
    const clean = (raw: string) => raw.trim().replace(/^@/, "").toLowerCase();
    const account = clean(target.account);
    const valid = (h: string) => /^[a-z0-9_]{1,15}$/.test(h);
    const list = (target.accounts ?? []).map(clean).filter(valid);
    if (valid(account)) {
      const unique = [...new Set([account, ...list])].slice(0, 20);
      return {
        type: "account",
        account,
        ...(unique.length > 1 ? { accounts: unique } : {}),
        ...(target.sort ? { sort: target.sort } : {}),
        ...(target.excludeReposts ? { excludeReposts: true } : {}),
      };
    }
  }
  return fail(422, "X collection requires a search expression or X account");
}

export function buildXSearchQuery(target: NormalizedXTarget, fromMs: number, toMs: number): string {
  const parts: string[] = [];
  if (target.type === "account") {
    const handles = target.accounts?.length ? target.accounts : [target.account];
    parts.push(handles.length > 1 ? `(${handles.map((h) => `from:${h}`).join(" OR ")})` : `from:${handles[0]}`);
  } else {
    parts.push(`(${target.query})`);
    if (target.minLikes && target.minLikes > 0) parts.push(`min_faves:${target.minLikes}`);
    if (target.minComments && target.minComments > 0) parts.push(`min_replies:${target.minComments}`);
    if (target.language) parts.push(`lang:${target.language}`);
  }
  if (target.excludeReposts) parts.push("-is:retweet");
  parts.push(`since_time:${Math.floor(fromMs / 1000)}`, `until_time:${Math.ceil(toMs / 1000)}`);
  return parts.join(" ");
}

function isTweetInScope(
  tweet: CollectedContent,
  from: number,
  to: number,
  allowedHandles: Set<string> | null,
) {
  const time = Date.parse(tweet.publishedAt ?? "");
  if (!Number.isFinite(time) || time < from || time >= to) return false;
  if (!allowedHandles) return true;
  const handle = tweet.author?.handle?.toLowerCase();
  return Boolean(handle && allowedHandles.has(handle));
}

function formatXPage(
  matched: CollectedContent[],
  rawCount: number,
  limit: number,
  cursor: string | null,
  body: Record<string, unknown>,
) {
  const next = string(body.next_cursor);
  const truncated = rawCount > 20 || matched.length > limit;
  const partial = body.partial === true;
  const hasNext = rawCount > 0 && next !== null && next !== cursor && body.has_more !== false;
  return {
    items: matched.slice(0, limit),
    nextCheckpoint: !truncated && !partial && hasNext ? { cursor: next } : null,
    exhausted: !partial && !truncated && !hasNext,
    coverage: "partial" as const,
    warning: partial ? "TwitterAPIs returned a partial page" : null,
  };
}

export function twitterApis(
  env: NodeJS.ProcessEnv = process.env,
  fetchPage = fetch,
  getSecret?: () => string | undefined,
): ContentProvider {
  const resolveKey = () => (getSecret?.() ?? env.TWITTERAPIS_API_KEY)?.trim() || undefined;
  const timeout = Number(env.TWITTERAPIS_TIMEOUT_MS ?? 20000);
  if (!Number.isInteger(timeout) || timeout < 100 || timeout > 120000)
    throw new Error("TWITTERAPIS_TIMEOUT_MS must be an integer between 100 and 120000");
  const capability: SourceCapability = {
    platform: "x", provider: "twitterapis",
    get enabled() {
      return Boolean(resolveKey()) && env.SOURCE_NETWORK_ENABLED === "true";
    },
    contentKinds: ["post"], targetTypes: ["account", "search"], keywordSearch: "global",
    observationModel: "snapshot", automaticRequestReplay: false, refreshByIds: false,
    requestResourceUpperBound: 20, limitations: ["Up to 20 posts per page; recent search coverage"],
    metrics: Object.keys(metricFields).map((metric) => ({
      key: metric, label: metric.slice(2), unit: "count", cumulative: true,
      signed: false, contentKinds: ["post"], direction: "higher",
    })),
  };
  return {
    capability, normalizeTarget: normalizeXTarget,
    async collectPage(request: CollectContentPageRequest) {
      if (!capability.enabled || request.includeComments)
        throw new ContentProviderError("TwitterAPIs requires networking and credentials and does not collect comments", false);
      const target = normalizeXTarget(request.source.target, request.source.contentKind);
      const url = new URL("https://api.twitterapis.com/twitter/tweet/advanced_search");
      const from = Date.parse(request.from), to = Date.parse(request.to);
      url.searchParams.set("query", buildXSearchQuery(target, from, to));
      url.searchParams.set("product", target.sort === "top" || target.sort === "hot" ? "Top" : "Latest");
      const limit = Math.min(request.limit, 20);
      const cursor = string(object(request.checkpoint).cursor);
      if (cursor) url.searchParams.set("cursor", cursor);
      const timeoutSignal = AbortSignal.timeout(timeout);
      const signal = request.signal ? AbortSignal.any([request.signal, timeoutSignal]) : timeoutSignal;
      const response = await fetchPage(url, { headers: { Authorization: `Bearer ${resolveKey()}` }, signal, redirect: "error" });
      if (!response.ok) {
        await response.body?.cancel();
        throw new ContentProviderError(`TwitterAPIs returned HTTP ${response.status}`, false, 30, response.status);
      }
      const body = object(await response.json());
      if (!Array.isArray(body.tweets) || body.error || (body.next_cursor != null && typeof body.next_cursor !== "string"))
        throw new ContentProviderError("Invalid TwitterAPIs response envelope", false);
      const fetchedAt = new Date().toISOString();
      const tweets = body.tweets.slice(0, 20).map((row) => normalizeTweet(row, request.source.id, fetchedAt));
      const allowedHandles = target.type === "account"
        ? new Set((target.accounts?.length ? target.accounts : [target.account]).map((h) => h.toLowerCase()))
        : null;
      const matched = tweets.filter((tweet) => isTweetInScope(tweet, from, to, allowedHandles));
      return formatXPage(matched, body.tweets.length, limit, cursor, body);
    },
  };
}
