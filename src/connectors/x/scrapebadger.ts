import type { ContentProvider } from "../shared/content-provider.interface";
import { ContentProviderError } from "../shared/content-provider.interface";
import { metricFields, normalizeTweet, normalizeXTarget } from "./twitterapis";

export function scrapeBadger(env = process.env, fetchPage = fetch): ContentProvider {
  const apiKey = env.SCRAPEBADGER_API_KEY?.trim();
  const timeout = Number(env.SCRAPEBADGER_TIMEOUT_MS ?? 20000);
  if (!Number.isInteger(timeout) || timeout < 100 || timeout > 120000)
    throw new Error("SCRAPEBADGER_TIMEOUT_MS must be an integer between 100 and 120000");
  const provider = "scrapebadger";
  const enabled = Boolean(apiKey) && env.SOURCE_NETWORK_ENABLED === "true";

  async function read(path: string, params: URLSearchParams, sourceId: string, signal?: AbortSignal) {
    if (!enabled) throw new ContentProviderError("ScrapeBadger networking is disabled or credentials are missing", false);
    const timer = AbortSignal.timeout(timeout);
    const response = await fetchPage(`https://scrapebadger.com/v1/twitter/${path}?${params}`, {
      headers: { "x-api-key": apiKey! },
      signal: signal ? AbortSignal.any([timer, signal]) : timer,
      redirect: "error",
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new ContentProviderError(`ScrapeBadger returned HTTP ${response.status}`, false, 30, response.status);
    }
    const body = await response.json();
    const tweets = body && Object.hasOwn(body, "data") ? body.data === null ? [] : body.data : body?.tweets;
    if (!Array.isArray(tweets) || (body.next_cursor != null && typeof body.next_cursor !== "string"))
      throw new ContentProviderError("Invalid ScrapeBadger response envelope", false);
    const fetchedAt = new Date().toISOString();
    const items = tweets.slice(0, 100).map((row) => normalizeTweet({
      ...row,
      author: { id: row?.user_id, username: row?.username, name: row?.user_name },
    }, sourceId, fetchedAt, provider));
    const credits = response.headers.get("x-credits-used");
    return {
      items, returned: tweets.length, partial: body.partial === true,
      cursor: typeof body.next_cursor === "string" && body.next_cursor || null,
      creditsUsed: credits !== null && /^\d+$/.test(credits) ? Number(credits) : undefined,
    };
  }

  return {
    capability: {
      platform: "x", provider, enabled, contentKinds: ["post"], targetTypes: ["search", "account"],
      keywordSearch: "global", observationModel: "snapshot", automaticRequestReplay: false,
      refreshByIds: true, requestResourceUpperBound: 100, limitations: ["One page per task, up to 20 IDs per refresh"],
      metrics: Object.keys(metricFields).map((key) => ({
        key, label: key.slice(2), unit: "count", cumulative: true, signed: false, contentKinds: ["post"], direction: "higher",
      })),
    },
    normalizeTarget: normalizeXTarget,
    async collectPage(request) {
      const target = normalizeXTarget(request.source.target, request.source.contentKind);
      const from = Date.parse(request.from), to = Date.parse(request.to);
      const params = new URLSearchParams();
      const path = target.type === "account" ? `users/${target.account}/latest_tweets` : "tweets/advanced_search";
      if (target.type === "search") {
        params.set("query", `(${target.query}) since_time:${Math.floor(from / 1000)} until_time:${Math.ceil(to / 1000)}`);
        params.set("query_type", "Latest");
        params.set("count", String(request.limit));
      }
      const page = await read(path, params, request.source.id, request.signal);
      const items = page.items.filter((item) => {
        const time = Date.parse(item.publishedAt!);
        return time >= from && time < to;
      });
      const truncated = items.length > request.limit || page.returned > 100;
      return {
        items: items.slice(0, request.limit), nextCheckpoint: null, coverage: "partial",
        exhausted: !truncated && !page.partial && (!page.cursor || !page.returned),
        warning: page.partial ? "ScrapeBadger returned a partial page" : null,
        creditsUsed: page.creditsUsed,
      };
    },
    async refreshIds({ source, externalIds, signal }) {
      if (!externalIds.length || externalIds.length > 20)
        throw new ContentProviderError("ScrapeBadger refresh needs 1–20 IDs", false);
      const page = await read("tweets/", new URLSearchParams({ tweets: externalIds.join(",") }), source.id, signal);
      const requested = new Set(externalIds);
      return {
        items: page.items.filter((item) => requested.has(item.externalId)), nextCheckpoint: null,
        exhausted: !page.partial, coverage: "partial", warning: null, creditsUsed: page.creditsUsed,
      };
    },
  };
}
