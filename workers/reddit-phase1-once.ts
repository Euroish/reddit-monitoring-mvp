import {
  createPostgresPhase1Runtime,
  resolvePhase1CrawlMode,
  resolvePhase1RunMode,
  resolveRedditPhase1CycleOptionsFromEnv,
  type Phase1CrawlMode,
  type Phase1RunMode,
  upsertActiveSubredditTarget,
} from "../src/runtime/reddit-phase1-runtime";
import type { RedditConnector } from "../src/connectors/reddit/reddit-connector.interface";
import { parseOptionalPositiveInt } from "../src/runtime/runtime-parsing";
import { PostgresClient } from "../src/storage/postgres/postgres-client";
import { runRedditPhase1Cycle } from "../src/workers/reddit-phase1.worker";

export type RunMode = Phase1RunMode;
export type RunCrawlMode = Phase1CrawlMode;

export interface RunPhase1OnceWithPostgresOptions {
  subreddit?: string;
  runMode?: RunMode;
  crawlMode?: RunCrawlMode;
  nowIso?: string;
  db?: PostgresClient;
}

export async function runPhase1OnceWithPostgres(
  options: RunPhase1OnceWithPostgresOptions = {},
): Promise<{
  ok: true;
  mode: RunMode;
  crawlMode: RunCrawlMode;
  subreddit: string;
  nowIso: string;
}> {
  const subreddit = options.subreddit ?? process.env.REDDIT_RUN_SUBREDDIT ?? "machinelearning";
  const nowIso = options.nowIso ?? new Date().toISOString();
  const runMode = options.runMode ?? resolvePhase1RunMode(process.env.REDDIT_RUN_MODE);
  const crawlMode = options.crawlMode ?? resolvePhase1CrawlMode(process.env.REDDIT_CRAWL_MODE);
  const runtime = createPostgresPhase1Runtime({
    db: options.db,
  });

  try {
    await upsertActiveSubredditTarget({
      monitorTargetRepository: runtime.repositories.monitorTargetRepository,
      subreddit,
      nowIso,
    });

    const cycleOptions = resolveRedditPhase1CycleOptionsFromEnv({
      env: process.env,
      mode: runMode,
      crawlMode,
      targetCanonicalNames: [`r/${subreddit}`],
      postLimit: parseOptionalPositiveInt(process.env.REDDIT_POST_LIMIT),
    });
    const connectorCache = new Map<string, RedditConnector>();
    const resolveConnectorForProviderHint = (providerHint: string | undefined): RedditConnector => {
      const providerOverride = resolveProviderOverride(providerHint);
      const cacheKey = providerOverride ?? "__default__";
      const cached = connectorCache.get(cacheKey);
      if (cached) {
        return cached;
      }
      const connector = runtime.createConnector(runMode, crawlMode, providerOverride);
      connectorCache.set(cacheKey, connector);
      return connector;
    };

    await runRedditPhase1Cycle(
      {
        ...runtime.repositories,
        redditConnector: resolveConnectorForProviderHint(cycleOptions.providerHint),
        redditConnectorResolver: ({ providerHint }) =>
          resolveConnectorForProviderHint(providerHint),
        redditMapper: runtime.redditMapper,
      },
      nowIso,
      cycleOptions,
    );
    return {
      ok: true,
      mode: runMode,
      crawlMode,
      subreddit: `r/${subreddit}`,
      nowIso,
    };
  } finally {
    await runtime.close();
  }
}

function resolveProviderOverride(providerHint: string | undefined): string | undefined {
  const normalized = providerHint?.trim().toLowerCase();
  if (normalized === "http" || normalized === "apify" || normalized === "scrapling") {
    return normalized;
  }
  return undefined;
}

async function main(): Promise<void> {
  const result = await runPhase1OnceWithPostgres();
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  void main();
}
