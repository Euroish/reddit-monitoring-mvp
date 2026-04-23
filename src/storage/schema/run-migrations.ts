import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { PostgresClient } from "../postgres/postgres-client";

interface MigrationRow {
  filename: string;
  checksum: string;
}

export interface RunMigrationsOptions {
  schemaDir?: string;
  db?: PostgresClient;
}

export async function runMigrations(options: RunMigrationsOptions = {}): Promise<string[]> {
  const schemaDir = options.schemaDir ?? join(process.cwd(), "src", "storage", "schema");
  const files = (await readdir(schemaDir))
    .filter((name) => name.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));
  const appliedFiles: string[] = [];

  if (files.length === 0) {
    return appliedFiles;
  }

  const db = options.db ?? new PostgresClient();
  const shouldClose = !options.db;
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS schema_migration (
        filename TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    for (const filename of files) {
      const sqlPath = join(schemaDir, filename);
      const sql = await readFile(sqlPath, "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");

      const existing = await db.query<MigrationRow>(
        `SELECT filename, checksum FROM schema_migration WHERE filename = $1`,
        [filename],
      );

      if (existing.rows.length > 0) {
        if (existing.rows[0].checksum !== checksum) {
          throw new Error(
            `Migration checksum mismatch: ${filename}. Create a new migration file instead of editing applied SQL.`,
          );
        }
        continue;
      }

      await db.query(sql);
      await db.query(`INSERT INTO schema_migration (filename, checksum) VALUES ($1, $2)`, [
        filename,
        checksum,
      ]);
      appliedFiles.push(filename);
    }
  } finally {
    if (shouldClose) {
      await db.close();
    }
  }

  return appliedFiles;
}

async function main(): Promise<void> {
  const appliedFiles = await runMigrations();
  for (const filename of appliedFiles) {
    // eslint-disable-next-line no-console
    console.log(`Applied migration: ${filename}`);
  }

  if (appliedFiles.length === 0) {
    // eslint-disable-next-line no-console
    console.log("No new migrations to apply.");
  }
}

if (require.main === module) {
  void main();
}
