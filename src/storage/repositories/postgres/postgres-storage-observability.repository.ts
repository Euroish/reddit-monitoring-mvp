import type {
  StorageObservabilityRepository,
  StorageObservabilitySnapshot,
  StorageTableStat,
} from "../../../domain/repositories/storage-observability-repository";
import type { SqlQueryable } from "../../postgres/postgres-client";

interface StorageSizeRow {
  table_name: string;
  row_estimate: string | number;
  table_bytes: string | number;
  index_bytes: string | number;
  total_bytes: string | number;
}

interface DatabaseSizeRow {
  database_size_bytes: string | number;
}

const OBSERVED_TABLES = [
  "reddit_fetch_event",
  "raw_reddit_event",
  "metrics_snapshot",
  "post_engagement_latest",
  "post_engagement_window",
  "content",
  "post_search_document",
  "subreddit_daily_fact",
  "keyword_trend_daily",
  "subreddit_trend_point",
  "post_growth_fact",
] as const;

export class PostgresStorageObservabilityRepository implements StorageObservabilityRepository {
  constructor(
    private readonly db: SqlQueryable,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public async getSnapshot(): Promise<StorageObservabilitySnapshot> {
    const [databaseSizeResult, tableStatsResult] = await Promise.all([
      this.db.query<DatabaseSizeRow>(
        `
        SELECT pg_database_size(current_database()) AS database_size_bytes
        `,
      ),
      this.db.query<StorageSizeRow>(
        `
        SELECT
          c.relname AS table_name,
          GREATEST(c.reltuples, 0)::bigint AS row_estimate,
          pg_table_size(c.oid) AS table_bytes,
          pg_indexes_size(c.oid) AS index_bytes,
          pg_total_relation_size(c.oid) AS total_bytes
        FROM pg_class c
        INNER JOIN pg_namespace n
          ON n.oid = c.relnamespace
        WHERE
          n.nspname = 'public'
          AND c.relkind = 'r'
          AND c.relname = ANY($1::text[])
        ORDER BY pg_total_relation_size(c.oid) DESC, c.relname ASC
        `,
        [OBSERVED_TABLES],
      ),
    ]);

    return {
      capturedAtIso: this.now(),
      databaseSizeBytes: toNumber(databaseSizeResult.rows[0]?.database_size_bytes),
      tables: tableStatsResult.rows.map(
        (row): StorageTableStat => ({
          tableName: row.table_name,
          rowEstimate: toNumber(row.row_estimate),
          tableBytes: toNumber(row.table_bytes),
          indexBytes: toNumber(row.index_bytes),
          totalBytes: toNumber(row.total_bytes),
        }),
      ),
    };
  }
}

function toNumber(value: string | number | undefined): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
