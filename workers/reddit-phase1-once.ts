import {
  createPostgresPhase1Runtime,
  resolvePhase1CrawlMode,
  resolvePhase1RunMode,
  resolveRedditPhase1CycleOptionsFromEnv,
  type Phase1CrawlMode,
  type Phase1RunMode,
  upsertActiveSubredditTarget,
} from "../src/runtime/reddit-phase1-runtime";
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

    await runRedditPhase1Cycle(
      {
        ...runtime.repositories,
        redditConnector: runtime.createConnector(runMode, crawlMode),
        redditMapper: runtime.redditMapper,
      },
      nowIso,
      resolveRedditPhase1CycleOptionsFromEnv({
        env: process.env,
        mode: runMode,
        crawlMode,
        targetCanonicalNames: [`r/${subreddit}`],
        postLimit: parseOptionalPositiveInt(process.env.REDDIT_POST_LIMIT),
      }),
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

async function main(): Promise<void> {
  const result = await runPhase1OnceWithPostgres();
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  void main();
}
