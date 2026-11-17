import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import { transaction } from "../db";

export async function runMigrations(
  options: { pool?: Pool; schemaDir?: string } = {},
) {
  if (!options.pool && !process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const pool = options.pool ?? new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 10000,
    statement_timeout: 600000,
    lock_timeout: 30000,
    idle_in_transaction_session_timeout: 600000,
  }),
    schemaDir = options.schemaDir ?? __dirname;
  try {
    const files = (await readdir(schemaDir))
      .filter((file) => /^\d{3}_[a-z0-9_]+\.sql$/.test(file))
      .sort();
    if (!files.length) throw new Error(`No SQL migrations found in ${schemaDir}`);
    const prefixes = files.filter(file => Number(file.slice(0, 3)) >= 41).map(file => file.slice(0, 3));
    if (new Set(prefixes).size !== prefixes.length) throw new Error("Duplicate migration number");
    return await transaction(pool, async (client) => {
      await client.query("SET LOCAL statement_timeout='600s'");
      await client.query("SET LOCAL lock_timeout='30s'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout='600s'");
      await client.query("SELECT pg_advisory_xact_lock(728419,1)");
      await client.query(
        "CREATE TABLE IF NOT EXISTS schema_migration(filename TEXT PRIMARY KEY,checksum TEXT NOT NULL,applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
      );
      const applied: string[] = [];
      for (const file of files) {
        const sql = await readFile(join(schemaDir, file), "utf8"),
          checksum = createHash("sha256").update(sql).digest("hex");
        const existing = (
          await client.query(
            "SELECT checksum FROM schema_migration WHERE filename=$1",
            [file],
          )
        ).rows[0];
        if (existing) {
          if (existing.checksum !== checksum)
            throw new Error(`Migration checksum mismatch: ${file}`);
          continue;
        }
        await client.query(
          sql.replace(/^BEGIN;\s*$/gim, "").replace(/^COMMIT;\s*$/gim, ""),
        );
        await client.query(
          "INSERT INTO schema_migration(filename,checksum) VALUES($1,$2)",
          [file, checksum],
        );
        applied.push(file);
      }
      return applied;
    });
  } finally {
    if (!options.pool) await pool.end();
  }
}
if (require.main === module)
  void runMigrations()
    .then((files) => console.log(`Applied ${files.length} migrations`))
    .catch((error) => {
      console.error(
        error instanceof Error ? error.message : "Migration failed",
      );
      process.exitCode = 1;
    });
