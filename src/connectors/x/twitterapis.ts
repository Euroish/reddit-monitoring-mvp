import { createHash } from "node:crypto";
import type { ContentReference, PublicContentKind, SourceCapability, SourceTarget } from "../../../packages/contracts/src/source-content";
import { stableUuidFromString } from "../../shared/ids/stable-id";
import { fail } from "../../storage/db";
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

export function normalizeTweet(value: unknown, sourceId: string, fetchedAt: string, provider = "twitterapis"): CollectedContent {
  const row = object(value);
  const externalId = tweetId(row.id);
  const time = Date.parse(string(row.created_at) ?? "");
  const text = string(row.full_text) ?? string(row.text);
  if (!externalId || !Number.isFinite(time) || text === null)
    throw new ContentProviderError("TwitterAPIs tweet lacks a valid ID, date or text", false);
  const author = object(row.author);
  const handle = string(author.username);
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
  const metrics = Object.fromEntries(Object.entries(metricFields).map(([key, field]) => {
    const count = row[field];
    return [key, typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? count : null];
  }));
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
    author: handle ? {
      externalId: tweetId(author.id), handle, displayName: string(author.name),
      url: `https://x.com/${encodeURIComponent(handle)}`,
    } : null,
    references,
    media: [],
    platformDetails: {
      platform: "x", conversationId, isReply: flag(row.is_reply),
      isRepost: flag(row.is_retweet), isQuote: flag(row.is_quote), sensitive: flag(row.possibly_sensitive),
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

export function normalizeXTarget(target: SourceTarget, kind: PublicContentKind): Extract<SourceTarget, { type: "search" | "account" }> {
    if (kind === "post" && target.type === "search" && target.query.trim())
      return { type: "search", query: target.query.trim() };
    if (kind === "post" && target.type === "account" && !target.query) {
      const account = target.account.trim().replace(/^@/, "").toLowerCase();
      if (/^[a-z0-9_]{1,15}$/.test(account)) return { type: "account", account };
    }
    return fail(422, "X collection requires a search expression or X account");
  }

export function twitterApis(env: NodeJS.ProcessEnv = process.env, fetchPage = fetch): ContentProvider {
  const key = env.TWITTERAPIS_API_KEY?.trim();
  const timeout = Number(env.TWITTERAPIS_TIMEOUT_MS ?? 20000);
  if (!Number.isInteger(timeout) || timeout < 100 || timeout > 120000)
    throw new Error("TWITTERAPIS_TIMEOUT_MS must be an integer between 100 and 120000");
  const capability: SourceCapability = {
    platform: "x", provider: "twitterapis", enabled: Boolean(key) && env.SOURCE_NETWORK_ENABLED === "true",
    contentKinds: ["post"], targetTypes: ["account", "search"], keywordSearch: "global",
    observationModel: "snapshot", automaticRequestReplay: false, refreshByIds: false,
    requestResourceUpperBound: 20, limitations: ["One page per task, up to 20 posts"],
    metrics: Object.keys(metricFields).map((metric) => ({
      key: metric, label: metric.slice(2), unit: "count", cumulative: true,
      signed: false, contentKinds: ["post"], direction: "higher",
    })),
  };
  return {
    capability, normalizeTarget: normalizeXTarget,
    async collectPage(request: CollectContentPageRequest) {
      if (!capability.enabled || request.limit > 20 || request.includeComments)
        throw new ContentProviderError("TwitterAPIs requires networking, credentials and a limit of up to 20 posts", false);
      const target = normalizeXTarget(request.source.target, request.source.contentKind);
      const account = target.type === "account";
      const path = account ? "user/tweets" : "tweet/advanced_search";
      const url = new URL(`https://api.twitterapis.com/twitter/${path}`);
      const from = Date.parse(request.from), to = Date.parse(request.to);
      if (account) url.searchParams.set("username", target.account);
      else if (target.type === "search") {
        url.searchParams.set("query", `(${target.query}) since_time:${Math.floor(from / 1000)} until_time:${Math.ceil(to / 1000)}`);
        url.searchParams.set("product", "Latest");
      }
      const cursor = string(object(request.checkpoint).cursor);
      if (cursor) url.searchParams.set("cursor", cursor);
      const timeoutSignal = AbortSignal.timeout(timeout);
      const signal = request.signal ? AbortSignal.any([request.signal, timeoutSignal]) : timeoutSignal;
      const response = await fetchPage(url, { headers: { Authorization: `Bearer ${key}` }, signal, redirect: "error" });
      if (!response.ok) {
        await response.body?.cancel();
        throw new ContentProviderError(`TwitterAPIs returned HTTP ${response.status}`, false, 30, response.status);
      }
      const body = object(await response.json());
      if (!Array.isArray(body.tweets) || body.error || (body.next_cursor != null && typeof body.next_cursor !== "string"))
        throw new ContentProviderError("Invalid TwitterAPIs response envelope", false);
      const fetchedAt = new Date().toISOString();
      const tweets = body.tweets.slice(0, 20).map((row) => normalizeTweet(row, request.source.id, fetchedAt));
      const matched = tweets.filter((tweet) => {
        const time = Date.parse(tweet.publishedAt!);
        return time >= from && time < to;
      });
      const next = string(body.next_cursor);
      const truncated = body.tweets.length > 20 || matched.length > request.limit;
      const partial = body.partial === true;
      const hasNext = body.tweets.length > 0 && next !== null && next !== cursor && body.has_more !== false;
      return {
        items: matched.slice(0, request.limit),
        nextCheckpoint: !truncated && !partial && hasNext ? { cursor: next } : null,
        exhausted: !partial && !truncated && !hasNext,
        coverage: "partial",
        warning: partial ? "TwitterAPIs returned a partial page" : null,
      };
    },
  };
}
