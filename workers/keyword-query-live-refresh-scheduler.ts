import { runKeywordQueryLiveRefreshCycle } from "../src/application/services/keyword-query-live-refresh.service";
import { PostgresClient } from "../src/storage/postgres/postgres-client";
import { createPostgresRepositoryBundle } from "../src/storage/repositories/postgres/postgres-repository-bundle";

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no") {
    return false;
  }
  return fallback;
}

async function main(): Promise<void> {
  const intervalMs = parsePositiveInt(
    process.env.KEYWORD_QUERY_LIVE_REFRESH_INTERVAL_MS,
    60_000,
  );
  const runOnBoot = parseBoolean(
    process.env.KEYWORD_QUERY_LIVE_REFRESH_RUN_ON_START,
    true,
  );
  const candidateLimit = parsePositiveInt(
    process.env.KEYWORD_QUERY_LIVE_REFRESH_CANDIDATE_LIMIT,
    50,
  );
  const bucketSearchLimit = parsePositiveInt(
    process.env.KEYWORD_QUERY_LIVE_REFRESH_BUCKET_SEARCH_LIMIT,
    200,
  );
  const liveWindowMinutes = parsePositiveInt(
    process.env.KEYWORD_QUERY_LIVE_REFRESH_WINDOW_MINUTES,
    20,
  );
  const bucketMinutes = parsePositiveInt(
    process.env.KEYWORD_QUERY_LIVE_REFRESH_BUCKET_MINUTES,
    5,
  );

  const db = new PostgresClient();
  const repos = createPostgresRepositoryBundle(db);

  let inFlight = false;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const runCycle = async (): Promise<void> => {
    if (stopped || inFlight) {
      return;
    }
    inFlight = true;
    const nowIso = new Date().toISOString();
    try {
      const result = await runKeywordQueryLiveRefreshCycle({
        nowIso,
        keywordQuerySessionRepository: repos.keywordQuerySessionRepository,
        postSearchDocumentRepository: repos.postSearchDocumentRepository,
        candidateLimit,
        bucketSearchLimit,
        liveWindowMinutes,
        bucketMinutes,
      });
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          event: "keyword_query_live_refresh.cycle.completed",
          nowIso,
          ...result,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify({
          event: "keyword_query_live_refresh.cycle.failed",
          nowIso,
          error: message,
        }),
      );
    } finally {
      inFlight = false;
    }
  };

  const closeGracefully = async (): Promise<void> => {
    if (stopped) {
      return;
    }
    stopped = true;
    if (timer) {
      clearInterval(timer);
      timer = undefined;
    }
    while (inFlight) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    await db.close();
  };

  process.on("SIGINT", () => {
    void closeGracefully().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void closeGracefully().finally(() => process.exit(0));
  });

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      event: "keyword_query_live_refresh.started",
      intervalMs,
      runOnBoot,
      candidateLimit,
      bucketSearchLimit,
      liveWindowMinutes,
      bucketMinutes,
    }),
  );

  if (runOnBoot) {
    await runCycle();
  }
  timer = setInterval(() => {
    void runCycle();
  }, intervalMs);
}

if (require.main === module) {
  void main();
}
