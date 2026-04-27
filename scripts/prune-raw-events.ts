import { PostgresClient } from "../src/storage/postgres/postgres-client";
import { pruneRawEvents, resolveRetentionPruneConfig } from "../src/ops/retention-prune";

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    // eslint-disable-next-line no-console
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const config = resolveRetentionPruneConfig(process.env);

  const db = new PostgresClient();

  try {
    const totalDeleted = await pruneRawEvents(db, {
      retentionDays: config.rawEventRetentionDays,
      batchSize: config.rawEventBatchSize,
      loopUntilDone: config.rawEventLoopUntilDone,
    });

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          ok: true,
          retentionDays: config.rawEventRetentionDays,
          batchSize: config.rawEventBatchSize,
          loopUntilDone: config.rawEventLoopUntilDone,
          deletedRows: totalDeleted,
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
