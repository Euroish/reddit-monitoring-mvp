import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

export interface SqlQueryable {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;
}

export interface PostgresClientOptions {
  connectionString?: string;
  max?: number;
  ssl?: boolean;
  connectionTimeoutMs?: number;
  idleTimeoutMs?: number;
  queryTimeoutMs?: number;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

export class PostgresClient {
  private readonly pool: Pool;

  constructor(options: PostgresClientOptions = {}) {
    const connectionString = options.connectionString ?? process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is required for PostgresClient");
    }

    const connectionTimeoutMs =
      options.connectionTimeoutMs ?? parsePositiveInt(process.env.PG_CONNECTION_TIMEOUT_MS, 10_000);
    const idleTimeoutMs =
      options.idleTimeoutMs ?? parsePositiveInt(process.env.PG_IDLE_TIMEOUT_MS, 30_000);
    const queryTimeoutMs =
      options.queryTimeoutMs ?? parsePositiveInt(process.env.PG_QUERY_TIMEOUT_MS, 30_000);

    this.pool = new Pool({
      connectionString,
      max: options.max ?? 10,
      connectionTimeoutMillis: connectionTimeoutMs,
      idleTimeoutMillis: idleTimeoutMs,
      query_timeout: queryTimeoutMs,
      ssl: options.ssl ?? process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
    });
  }

  public query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, params);
  }

  public async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }
}
