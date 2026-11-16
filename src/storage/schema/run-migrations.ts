import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Pool } from "pg";
import { createPool, transaction } from "../db";

export async function runMigrations(
  options: { pool?: Pool; schemaDir?: string } = {},
) {
  const pool = options.pool ?? createPool(),
    schemaDir = options.schemaDir ?? __dirname;
  try {
    const files = (await readdir(schemaDir))
      .filter((file) => /^\d{3}_[a-z0-9_]+\.sql$/.test(file))
      .sort();
    return await transaction(pool, async (client) => {
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
