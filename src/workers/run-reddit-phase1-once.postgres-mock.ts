import {
  createPostgresPhase1Runtime,
  resolvePhase1CrawlMode,
  resolveRedditPhase1CycleOptionsFromEnv,
  upsertActiveSubredditTarget,
} from "../runtime/reddit-phase1-runtime";
import { parseFilterMode, parseNonNegativeInt } from "../runtime/runtime-parsing";
import { runRedditPhase1Cycle } from "./reddit-phase1.worker";

async function main(): Promise<void> {
  const subreddit = process.env.REDDIT_RUN_SUBREDDIT ?? "machinelearning";
  const nowIso = new Date().toISOString();
  const crawlMode = resolvePhase1CrawlMode(process.env.REDDIT_CRAWL_MODE);
  const runtime = createPostgresPhase1Runtime();
  try {
    await upsertActiveSubredditTarget({
      monitorTargetRepository: runtime.repositories.monitorTargetRepository,
      subreddit,
      nowIso,
    });

    await runRedditPhase1Cycle(
      {
        ...runtime.repositories,
        redditConnector: runtime.createConnector("mock", crawlMode),
        redditMapper: runtime.redditMapper,
      },
      nowIso,
      {
        ...resolveRedditPhase1CycleOptionsFromEnv({
          env: process.env,
          mode: "mock",
          crawlMode,
          targetCanonicalNames: [`r/${subreddit}`],
        }),
        postCandidateMinScore: parseNonNegativeInt(process.env.REDDIT_CANDIDATE_MIN_SCORE, 0),
        postCandidateMinComments: parseNonNegativeInt(
          process.env.REDDIT_CANDIDATE_MIN_COMMENTS,
          0,
        ),
        postCandidateFilterMode: parseFilterMode(process.env.REDDIT_CANDIDATE_FILTER_MODE),
      },
    );

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          ok: true,
          subreddit: `r/${subreddit}`,
          nowIso,
          mode: "postgres-mock",
        },
        null,
        2,
      ),
    );
  } finally {
    await runtime.close();
  }
}

void main();
