import { PostgresClient } from "../src/storage/postgres/postgres-client";

interface DeleteRow {
  target_id: string;
  snapshot_at: string;
  metric_name: string;
  content_id: string | null;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    // eslint-disable-next-line no-console
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const retentionDays = parsePositiveInt(process.env.METRICS_SNAPSHOT_RETENTION_DAYS, 30);
  const batchSize = parsePositiveInt(process.env.METRICS_SNAPSHOT_PRUNE_BATCH_SIZE, 10000);
  const loopUntilDone = process.env.METRICS_SNAPSHOT_PRUNE_LOOP === "true";

  const db = new PostgresClient();
  let totalDeleted = 0;

  try {
    while (true) {
      const deleted = await db.query<DeleteRow>(
        `
        WITH candidates AS (
          SELECT target_id, snapshot_at, metric_name, content_id
          FROM metrics_snapshot
          WHERE snapshot_at < NOW() - ($1::int * INTERVAL '1 day')
          ORDER BY snapshot_at ASC
          LIMIT $2
        )
        DELETE FROM metrics_snapshot m
        USING candidates c
        WHERE m.target_id = c.target_id
          AND m.snapshot_at = c.snapshot_at
          AND m.metric_name = c.metric_name
          AND m.content_id IS NOT DISTINCT FROM c.content_id
        RETURNING m.target_id, m.snapshot_at, m.metric_name, m.content_id
        `,
        [retentionDays, batchSize],
      );

      const deletedCount = deleted.rows.length;
      totalDeleted += deletedCount;

      if (!loopUntilDone || deletedCount < batchSize) {
        break;
      }
    }

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          ok: true,
          retentionDays,
          batchSize,
          loopUntilDone,
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
