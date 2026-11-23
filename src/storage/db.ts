import { Pool, type PoolClient } from "pg";

export function createPool(connectionString = process.env.DATABASE_URL, max = 10) {
  if (!connectionString) throw new Error("DATABASE_URL is required");
  return new Pool({
    connectionString,
    options: "-c timezone=UTC",
    max,
    connectionTimeoutMillis: 3000,
    statement_timeout: 10000,
    lock_timeout: 3000,
    idle_in_transaction_session_timeout: 10000,
  });
}

export async function transaction<T>(
  pool: Pool,
  action: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await action(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
