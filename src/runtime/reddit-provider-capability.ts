import { randomUUID } from "node:crypto";
import type { RedditConnector } from "../connectors/reddit/reddit-connector.interface";
import { resolveRedditLiveProvider, type RedditLiveProvider } from "../connectors/reddit/create-reddit-connector";
import { parseBooleanFlag, parseSubredditList } from "./runtime-parsing";

export interface RedditProviderCapabilityProbeConfig {
  required: boolean;
  provider: RedditLiveProvider;
  subreddit: string;
}

export interface RedditProviderCapabilityProbeResult {
  ok: boolean;
  provider: RedditLiveProvider;
  subreddit: string;
  endpoint?: string;
  httpStatus?: number;
  fetchedAt?: string;
  reason?: string;
}

export function resolveRedditProviderCapabilityProbeConfigFromEnv(
  env: NodeJS.ProcessEnv,
): RedditProviderCapabilityProbeConfig {
  const configuredSubreddit = normalizeSubredditName(env.REDDIT_PROVIDER_CAPABILITY_SUBREDDIT);
  const seedSubreddit = parseSubredditList(
    env.REDDIT_RUN_SUBREDDITS ?? env.REDDIT_RUN_SUBREDDIT,
  )[0];

  return {
    required: parseBooleanFlag(env.REDDIT_PROVIDER_CAPABILITY_REQUIRED, true),
    provider: resolveRedditLiveProvider(env.REDDIT_LIVE_PROVIDER),
    subreddit: configuredSubreddit ?? normalizeSubredditName(seedSubreddit) ?? "askreddit",
  };
}

export async function probeRedditProviderCapability(args: {
  connector: RedditConnector;
  provider: RedditLiveProvider;
  subreddit: string;
  nowIso: string;
}): Promise<RedditProviderCapabilityProbeResult> {
  const subreddit = normalizeSubredditName(args.subreddit) ?? "askreddit";
  try {
    const page = await args.connector.collectSubredditAbout(
      { subreddit },
      {
        requestId: randomUUID(),
        now: args.nowIso,
      },
    );

    return {
      ok: page.raw.httpStatus >= 200 && page.raw.httpStatus < 300,
      provider: args.provider,
      subreddit,
      endpoint: page.raw.endpoint,
      httpStatus: page.raw.httpStatus,
      fetchedAt: page.raw.fetchedAt,
      reason:
        page.raw.httpStatus >= 200 && page.raw.httpStatus < 300
          ? undefined
          : `unexpected_http_status:${page.raw.httpStatus}`,
    };
  } catch (error) {
    return {
      ok: false,
      provider: args.provider,
      subreddit,
      reason: error instanceof Error ? error.message : "unknown provider capability error",
    };
  }
}

function normalizeSubredditName(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/^r\//i, "").toLowerCase();
  return normalized && normalized.length > 0 ? normalized : undefined;
}
