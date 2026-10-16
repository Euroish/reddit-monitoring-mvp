import { PostgresClient } from "../src/storage/postgres/postgres-client";
import { PostgresPostSearchDocumentRepository } from "../src/storage/repositories/postgres/postgres-post-search-document.repository";

export interface PostSearchBackfillOptions { batchSize: number; maxBatches: number; configOnly: boolean }

export function parsePostSearchBackfillArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): PostSearchBackfillOptions {
  const options = { batchSize: env.POST_SEARCH_BACKFILL_BATCH_SIZE ?? "500", maxBatches: env.POST_SEARCH_BACKFILL_MAX_BATCHES ?? "10", configOnly: false };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--config-only") { options.configOnly = true; continue; }
    if (flag !== "--batch-size" && flag !== "--max-batches") throw new Error(`Unknown argument: ${flag}`);
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a positive integer`);
    if (flag === "--batch-size") options.batchSize = value;
    else options.maxBatches = value;
  }
  const boundedInteger = (raw: string, label: string, max: number) => {
    if (!/^\d+$/.test(raw)) throw new Error(`${label} must be an integer between 1 and ${max}`);
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`${label} must be an integer between 1 and ${max}`);
    return value;
  };
  return { batchSize: boundedInteger(options.batchSize, "batch size", 5000), maxBatches: boundedInteger(options.maxBatches, "max batches", 100), configOnly: options.configOnly };
}

export async function backfillPostSearchIndex(repo: Pick<PostgresPostSearchDocumentRepository, "seedFromContent">, options: Pick<PostSearchBackfillOptions, "batchSize" | "maxBatches">): Promise<{ rowsChanged: number; batchesExecuted: number; reachedBatchBudget: boolean }> {
  let rowsChanged = 0;
  for (let batch = 0; batch < options.maxBatches; batch++) {
    const changed = await repo.seedFromContent(options.batchSize);
    rowsChanged += changed;
    if (changed < options.batchSize) return { rowsChanged, batchesExecuted: batch + 1, reachedBatchBudget: false };
  }
  return { rowsChanged, batchesExecuted: options.maxBatches, reachedBatchBudget: true };
}

async function main(): Promise<void> {
  const options = parsePostSearchBackfillArgs(process.argv.slice(2));
  if (options.configOnly) { console.log(JSON.stringify({ event: "post_search.backfill.config", ...options, scope: "stored Reddit posts with legacy target", touchesExternalProviders: false })); return; }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required; choose the intended local/development database explicitly");
  const db = new PostgresClient();
  try { console.log(JSON.stringify({ event: "post_search.backfill.finished", ...await backfillPostSearchIndex(new PostgresPostSearchDocumentRepository(db), options), ...options })); }
  finally { await db.close(); }
}

if (require.main === module) void main().catch((error) => { console.error(error instanceof Error ? error.message : "Post search backfill failed"); process.exitCode = 1; });
