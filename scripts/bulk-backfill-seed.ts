import { setTimeout as delay } from "node:timers/promises";
import { PostgresClient } from "../src/storage/postgres/postgres-client";
import { runMigrations } from "../src/storage/schema/run-migrations";
import { runPhase1OnceWithPostgres } from "../workers/reddit-phase1-once";

interface CountRow {
  count: string;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

async function queryContentCount(db: PostgresClient): Promise<number> {
  const result = await db.query<CountRow>("SELECT COUNT(*)::text AS count FROM content");
  return Number(result.rows[0]?.count ?? "0");
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    // eslint-disable-next-line no-console
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const targetNewRows = parsePositiveInt(process.env.REDDIT_BULK_TARGET_NEW_ROWS, 700);
  const maxNewRows = parsePositiveInt(process.env.REDDIT_BULK_MAX_NEW_ROWS, 1000);
  const maxRounds = parsePositiveInt(process.env.REDDIT_BULK_MAX_ROUNDS, 8);
  const postLimit = parsePositiveInt(process.env.REDDIT_BULK_POST_LIMIT, 100);
  const pauseMs = parsePositiveInt(process.env.REDDIT_BULK_PAUSE_MS, 250);
  const subreddits = (process.env.REDDIT_BULK_SUBREDDITS ??
    "machinelearning,datascience,programming,technology,artificial,learnmachinelearning,computervision,dataisbeautiful,cscareerquestions,python,javascript,webdev,startups,security,sysadmin")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);

  process.env.REDDIT_RUN_MODE = "live";
  process.env.REDDIT_CRAWL_MODE = "backfill";
  process.env.REDDIT_BACKFILL_PROVIDER = process.env.REDDIT_BACKFILL_PROVIDER ?? "http";
  process.env.REDDIT_POST_LIMIT = String(postLimit);

  const appliedMigrations = await runMigrations();
  const db = new PostgresClient();
  const runLog: Array<{
    round: number;
    subreddit: string;
    beforeCount: number;
    afterCount: number;
    delta: number;
    nowIso: string;
  }> = [];

  try {
    const baseCount = await queryContentCount(db);
    let currentCount = baseCount;
    let reached = false;

    for (let round = 1; round <= maxRounds && !reached; round += 1) {
      for (const subreddit of subreddits) {
        const beforeCount = currentCount;
        const nowIso = new Date().toISOString();
        await runPhase1OnceWithPostgres({
          runMode: "live",
          crawlMode: "backfill",
          subreddit,
          nowIso,
          db,
        });
        currentCount = await queryContentCount(db);
        const delta = currentCount - beforeCount;

        runLog.push({
          round,
          subreddit,
          beforeCount,
          afterCount: currentCount,
          delta,
          nowIso,
        });

        const totalNewRows = currentCount - baseCount;
        if (totalNewRows >= targetNewRows || totalNewRows >= maxNewRows) {
          reached = true;
          break;
        }

        await delay(pauseMs);
      }
    }

    const finalCount = await queryContentCount(db);
    const totalNewRows = finalCount - baseCount;
    const bySubreddit = new Map<string, { runs: number; inserted: number }>();
    for (const row of runLog) {
      const existing = bySubreddit.get(row.subreddit) ?? { runs: 0, inserted: 0 };
      existing.runs += 1;
      existing.inserted += Math.max(0, row.delta);
      bySubreddit.set(row.subreddit, existing);
    }

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          ok: true,
          appliedMigrations,
          config: {
            targetNewRows,
            maxNewRows,
            maxRounds,
            postLimit,
            pauseMs,
            subreddits,
            provider: process.env.REDDIT_BACKFILL_PROVIDER,
          },
          counts: {
            baseContentCount: baseCount,
            finalContentCount: finalCount,
            insertedContentRows: totalNewRows,
          },
          bySubreddit: Array.from(bySubreddit.entries())
            .map(([subreddit, value]) => ({
              subreddit,
              runs: value.runs,
              inserted: value.inserted,
            }))
            .sort((left, right) => right.inserted - left.inserted),
          runs: runLog,
        },
        null,
        2,
      ),
    );
  } finally {
    await db.close();
  }
}

void main();

