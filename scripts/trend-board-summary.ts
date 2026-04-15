import { buildSubredditTrendReadModel } from "../src/application/services/subreddit-trend-read-model";
import { floorToWindow } from "../src/shared/time/windowing";
import { PostgresClient } from "../src/storage/postgres/postgres-client";
import { createPostgresRepositoryBundle } from "../src/storage/repositories/postgres/postgres-repository-bundle";

const DEFAULT_LOOKBACK_MINUTES = 120;
const DEFAULT_RECENT_POSTS_LIMIT = 10;

function normalizeSubreddit(value: string): string {
  const normalized = value.trim().replace(/^r\//i, "").toLowerCase();
  if (!/^[a-z0-9_]{3,21}$/.test(normalized)) {
    throw new Error("invalid subreddit format: use letters/numbers/underscore, length 3-21");
  }
  return normalized;
}

function resolveIsoRange(nowIso: string): { fromIso: string; toIso: string } {
  const requestedTo = process.env.TREND_TO ?? nowIso;
  const defaultFrom = new Date(
    new Date(requestedTo).getTime() - DEFAULT_LOOKBACK_MINUTES * 60 * 1000,
  ).toISOString();
  const requestedFrom = process.env.TREND_FROM ?? defaultFrom;

  const fromIso = floorToWindow(requestedFrom, 15);
  const toIso = floorToWindow(requestedTo, 15);

  if (new Date(fromIso).getTime() > new Date(toIso).getTime()) {
    throw new Error("TREND_FROM must be <= TREND_TO");
  }

  return { fromIso, toIso };
}

function resolveRecentPostsLimit(): number {
  const raw = process.env.TREND_RECENT_POSTS_LIMIT;
  if (!raw) {
    return DEFAULT_RECENT_POSTS_LIMIT;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) {
    throw new Error("TREND_RECENT_POSTS_LIMIT must be an integer between 1 and 50");
  }
  return parsed;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    // eslint-disable-next-line no-console
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const subreddit = normalizeSubreddit(
    process.env.TREND_SUBREDDIT ?? process.env.REDDIT_RUN_SUBREDDIT ?? "machinelearning",
  );
  const canonicalName = `r/${subreddit}`;
  const nowIso = new Date().toISOString();
  const { fromIso, toIso } = resolveIsoRange(nowIso);
  const recentPostsLimit = resolveRecentPostsLimit();

  const db = new PostgresClient();
  const repos = createPostgresRepositoryBundle(db);

  try {
    const target = await repos.monitorTargetRepository.findByCanonicalName(canonicalName);
    if (!target) {
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify(
          {
            ok: false,
            error: `target not found: ${canonicalName}`,
            next: "Seed target first via POST /v1/targets/subreddit or run worker once.",
          },
          null,
          2,
        ),
      );
      process.exitCode = 1;
      return;
    }

    const [points, recentPosts] = await Promise.all([
      repos.subredditTrendPointRepository.listByTargetInRange({
        targetId: target.id,
        from: fromIso,
        to: toIso,
      }),
      repos.contentRepository.findRecentByTarget(target.id, recentPostsLimit),
    ]);

    const readModel = buildSubredditTrendReadModel(points);

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          ok: true,
          generatedAtIso: nowIso,
          targetId: target.id,
          canonicalName,
          fromIso,
          toIso,
          timeline: readModel.timeline,
          summary: readModel.summary,
          topMovers: readModel.topMovers,
          recentAnomalies: readModel.recentAnomalies,
          recentPosts: recentPosts.map((post) => ({
            id: post.id,
            title: post.title,
            permalink: post.permalink,
            createdAtSource: post.createdAtSource,
          })),
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
