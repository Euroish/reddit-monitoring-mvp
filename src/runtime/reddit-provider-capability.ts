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
  failureCategory?: RedditProviderCapabilityFailureCategory;
  remediationHint?: string;
}

export type RedditProviderCapabilityFailureCategory =
  | "unexpected_http_status"
  | "connector_error"
  | "network_policy_block";

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
      failureCategory:
        page.raw.httpStatus >= 200 && page.raw.httpStatus < 300
          ? undefined
          : "unexpected_http_status",
    };
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "unknown provider capability error";
    const classified = classifyRedditProviderCapabilityFailure(reason);
    return {
      ok: false,
      provider: args.provider,
      subreddit,
      reason,
      failureCategory: classified.failureCategory,
      remediationHint: classified.remediationHint,
    };
  }
}

export function classifyRedditProviderCapabilityFailure(reason: string | undefined): {
  failureCategory: RedditProviderCapabilityFailureCategory;
  remediationHint?: string;
} {
  const normalized = reason?.toLowerCase() ?? "";
  if (
    normalized.includes("blocked by network security") ||
    normalized.includes("blocked due to a network policy") ||
    normalized.includes("whoa there, pardner!") ||
    normalized.includes("use your developer token") ||
    normalized.includes("developer credentials") ||
    normalized.includes("status=403") &&
      (normalized.includes("body=<body class=theme-beta>") ||
        normalized.includes("body=<!doctype html>"))
  ) {
    return {
      failureCategory: "network_policy_block",
      remediationHint:
        "Reddit is blocking this host or unauthenticated lane; use OAuth/developer token, a different provider, or a different egress IP before enabling schedulers.",
    };
  }
  return {
    failureCategory: "connector_error",
  };
}

function normalizeSubredditName(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/^r\//i, "").toLowerCase();
  return normalized && normalized.length > 0 ? normalized : undefined;
}
