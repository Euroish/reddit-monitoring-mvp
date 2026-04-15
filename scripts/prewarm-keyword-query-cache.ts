import { runKeywordPulseQuery } from "../src/application/services/keyword-pulse-query.service";
import { PostgresClient } from "../src/storage/postgres/postgres-client";
import { createPostgresRepositoryBundle } from "../src/storage/repositories/postgres/postgres-repository-bundle";

interface PrewarmTarget {
  queryText: string;
  canonicalSubreddit?: string;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function normalizeSubreddit(value: string): string {
  const trimmed = value.trim().toLowerCase().replace(/^r\//, "");
  if (!trimmed) {
    throw new Error("prewarm subreddit cannot be empty");
  }
  return `r/${trimmed}`;
}

function parsePrewarmTargets(raw: string | undefined): PrewarmTarget[] {
  if (!raw?.trim()) {
    return [];
  }
  return raw
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [queryTextRaw, subredditRaw] = entry.split("@", 2);
      const queryText = queryTextRaw?.trim();
      if (!queryText) {
        throw new Error(`invalid prewarm entry: ${entry}`);
      }
      return {
        queryText,
        canonicalSubreddit: subredditRaw?.trim() ? normalizeSubreddit(subredditRaw) : undefined,
      };
    });
}

async function main(): Promise<void> {
  const targets = parsePrewarmTargets(process.env.KEYWORD_QUERY_PREWARM_TARGETS);
  if (targets.length === 0) {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        event: "keyword_query_prewarm.skipped",
        reason: "no_targets",
      }),
    );
    return;
  }

  const limit = parsePositiveInt(process.env.KEYWORD_QUERY_PREWARM_LIMIT, 10);
  const db = new PostgresClient();
  const repos = createPostgresRepositoryBundle(db);

  try {
    for (const target of targets) {
      const nowIso = new Date().toISOString();
      const result = await runKeywordPulseQuery({
        input: {
          queryText: target.queryText,
          canonicalSubreddit: target.canonicalSubreddit,
          limit,
          nowIso,
        },
        postSearchDocumentRepository: repos.postSearchDocumentRepository,
        keywordQuerySessionRepository: repos.keywordQuerySessionRepository,
      });

      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          event: "keyword_query_prewarm.completed",
          nowIso,
          queryText: target.queryText,
          canonicalSubreddit: target.canonicalSubreddit,
          queryId: result.session.id,
          cacheStatus: result.cacheStatus,
          supportCount: result.session.supportCount,
        }),
      );
    }
  } finally {
    await db.close();
  }
}

if (require.main === module) {
  void main();
}
