import { PostgresClient } from "../src/storage/postgres/postgres-client";
import { pruneMetricsSnapshots, resolveRetentionPruneConfig } from "../src/ops/retention-prune";

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    // eslint-disable-next-line no-console
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const config = resolveRetentionPruneConfig(process.env);

  const db = new PostgresClient();

  try {
    const totalDeleted = await pruneMetricsSnapshots(db, {
      retentionDays: config.metricsSnapshotRetentionDays,
      batchSize: config.metricsSnapshotBatchSize,
      loopUntilDone: config.metricsSnapshotLoopUntilDone,
    });

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          ok: true,
          retentionDays: config.metricsSnapshotRetentionDays,
          batchSize: config.metricsSnapshotBatchSize,
          loopUntilDone: config.metricsSnapshotLoopUntilDone,
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
