import { runMigrations } from "../src/storage/schema/run-migrations";
import { runPhase1OnceWithPostgres } from "../workers/reddit-phase1-once";

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    // eslint-disable-next-line no-console
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const appliedFiles = await runMigrations();
  const runResult = await runPhase1OnceWithPostgres();

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        ok: true,
        appliedMigrations: appliedFiles,
        run: runResult,
        next: [
          "Run `npm run app:api`",
          "Call GET /healthz",
          "Call GET /v1/trends/subreddit/<subreddit>",
        ],
      },
      null,
      2,
    ),
  );
}

void main();
