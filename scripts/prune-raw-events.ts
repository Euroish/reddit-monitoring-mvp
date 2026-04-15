import { PostgresClient } from "../src/storage/postgres/postgres-client";

interface DeleteRow {
  id: number;
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

  const retentionDays = parsePositiveInt(process.env.RAW_EVENT_RETENTION_DAYS, 30);
  const batchSize = parsePositiveInt(process.env.RAW_EVENT_PRUNE_BATCH_SIZE, 5000);
  const loopUntilDone = process.env.RAW_EVENT_PRUNE_LOOP === "true";

  const db = new PostgresClient();
  let totalDeleted = 0;

  try {
    while (true) {
      const deleted = await db.query<DeleteRow>(
        `
        WITH candidates AS (
          SELECT id
          FROM raw_reddit_event
          WHERE fetched_at < NOW() - ($1::int * INTERVAL '1 day')
          ORDER BY fetched_at ASC
          LIMIT $2
        )
        DELETE FROM raw_reddit_event r
        USING candidates c
        WHERE r.id = c.id
        RETURNING r.id
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
