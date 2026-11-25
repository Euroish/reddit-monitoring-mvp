import type { ContentProvider } from "../shared/content-provider.interface";
import { ContentProviderError } from "../shared/content-provider.interface";
import { buildXSearchQuery, metricFields, normalizeTweet, normalizeXTarget } from "./twitterapis";

export function scrapeBadger(
  env = process.env,
  fetchPage = fetch,
  getSecret?: () => string | undefined,
): ContentProvider {
  const resolveKey = () => (getSecret?.() ?? env.SCRAPEBADGER_API_KEY)?.trim() || undefined;
  const timeout = Number(env.SCRAPEBADGER_TIMEOUT_MS ?? 20000);
  if (!Number.isInteger(timeout) || timeout < 100 || timeout > 120000)
    throw new Error("SCRAPEBADGER_TIMEOUT_MS must be an integer between 100 and 120000");
  const provider = "scrapebadger";
  const isEnabled = () => Boolean(resolveKey()) && env.SOURCE_NETWORK_ENABLED === "true";

  async function read(path: string, params: URLSearchParams, sourceId: string, signal?: AbortSignal) {
    const apiKey = resolveKey();
    if (!isEnabled() || !apiKey) throw new ContentProviderError("ScrapeBadger networking is disabled or credentials are missing", false);
    const timer = AbortSignal.timeout(timeout);
    const response = await fetchPage(`https://scrapebadger.com/v1/twitter/${path}?${params}`, {
      headers: { "x-api-key": apiKey },
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
      author: row?.author ?? {
        id: row?.user_id,
        username: row?.username,
        name: row?.user_name,
        followers_count: row?.user_followers_count ?? row?.followers_count,
        profilePicture: row?.user_avatar ?? row?.profile_image_url_https,
        verified: row?.user_verified,
      },
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
      platform: "x", provider,
      get enabled() {
        return isEnabled();
      },
      contentKinds: ["post"], targetTypes: ["search", "account"],
      keywordSearch: "global", observationModel: "snapshot", automaticRequestReplay: false,
      refreshByIds: true, requestResourceUpperBound: 100,
      limitations: ["Cursor-paginated search (up to 100 tweets per page) and up to 20 IDs per refresh"],
      metrics: Object.keys(metricFields).map((key) => ({
        key, label: key.slice(2), unit: "count", cumulative: true, signed: false, contentKinds: ["post"], direction: "higher",
      })),
    },
    normalizeTarget: normalizeXTarget,
    async collectPage(request) {
      const target = normalizeXTarget(request.source.target, request.source.contentKind);
      const from = Date.parse(request.from), to = Date.parse(request.to);
      const limit = Math.min(request.limit, 100);
      const cursor = request.checkpoint && typeof request.checkpoint === "object" && !Array.isArray(request.checkpoint)
        && typeof (request.checkpoint as Record<string, unknown>).cursor === "string"
        ? (request.checkpoint as Record<string, string>).cursor
        : null;
      const params = new URLSearchParams({
        query: buildXSearchQuery(target, from, to),
        query_type: target.sort === "top" || target.sort === "hot" ? "Top" : "Latest",
        count: String(limit),
        ...(cursor ? { cursor } : {}),
      });
      const page = await read("tweets/advanced_search", params, request.source.id, request.signal);
      const items = page.items.filter((item) => {
        const time = Date.parse(item.publishedAt!);
        return time >= from && time < to;
      });
      const truncated = items.length > limit || page.returned > 100;
      const hasNext = page.returned > 0 && Boolean(page.cursor) && page.cursor !== cursor;
      return {
        items: items.slice(0, limit), nextCheckpoint: hasNext ? { cursor: page.cursor! } : null, coverage: "partial",
        exhausted: !truncated && !page.partial && !hasNext,
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
