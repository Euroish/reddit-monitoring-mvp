import {
  createRedditConnector,
  resolveRedditScraplingProfile,
} from "../src/connectors/reddit/create-reddit-connector";

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

async function main(): Promise<void> {
  const subreddit = (process.env.REDDIT_RUN_SUBREDDIT ?? "machinelearning")
    .trim()
    .replace(/^r\//i, "")
    .toLowerCase();
  const now = new Date().toISOString();

  const connector = createRedditConnector({
    mode: "live",
    liveProvider: "scrapling",
    accessToken: process.env.REDDIT_ACCESS_TOKEN,
    userAgent: process.env.REDDIT_USER_AGENT,
    scraplingProfile: resolveRedditScraplingProfile(
      process.env.REDDIT_SCRAPLING_PROFILE,
    ),
    scraplingPythonExecutable: process.env.REDDIT_SCRAPLING_PYTHON,
    scraplingBridgeScriptPath: process.env.REDDIT_SCRAPLING_BRIDGE_SCRIPT,
    scraplingTimeoutMs: parsePositiveInt(
      process.env.REDDIT_SCRAPLING_TIMEOUT_MS,
      12_000,
    ),
    scraplingMaxRetries: parsePositiveInt(
      process.env.REDDIT_SCRAPLING_MAX_RETRIES,
      2,
    ),
    circuitBreaker: {
      enabled: false,
    },
  });

  const about = await connector.collectSubredditAbout(
    {
      subreddit,
    },
    {
      requestId: `scrapling-verify:${Date.now()}`,
      now,
    },
  );

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        event: "reddit.scrapling.verify",
        subreddit: `r/${subreddit}`,
        status: about.raw.httpStatus,
        provider: about.raw.responseHeaders["x-provider"] ?? "unknown",
        fetchedAt: about.raw.fetchedAt,
        endpoint: about.raw.endpoint,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify(
      {
        event: "reddit.scrapling.verify.failed",
        message,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});

