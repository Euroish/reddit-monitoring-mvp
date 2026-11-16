import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { runMigrations } from "../../src/storage/schema/run-migrations";

export async function testDatabase() {
  if (!process.env.TEST_SOURCE_DATABASE_URL)
    throw new Error(
      "TEST_SOURCE_DATABASE_URL is required; use an isolated loopback source_validation_* PG16 database",
    );
  const url = new URL(process.env.TEST_SOURCE_DATABASE_URL);
  assert.ok(
    ["localhost", "127.0.0.1"].includes(url.hostname) &&
      /^\/source_validation_[a-z0-9_]+$/.test(url.pathname),
  );
  const database = `source_validation_kernel_${randomUUID().replaceAll("-", "")}`;
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = new Pool({ connectionString: adminUrl.href, max: 1 });
  assert.equal(
    Math.floor(
      Number(
        (await admin.query("SHOW server_version_num")).rows[0]
          .server_version_num,
      ) / 10000,
    ),
    16,
  );
  await admin.query(`CREATE DATABASE "${database}"`);
  url.pathname = `/${database}`;
  const pool = new Pool({
    connectionString: url.href,
    max: 10,
    statement_timeout: 10000,
    options: "-c timezone=UTC",
  });
  try {
    await runMigrations({ pool });
  } catch (error) {
    await pool.end();
    await admin.query(`DROP DATABASE "${database}"`);
    await admin.end();
    throw error;
  }
  return {
    pool,
    url: url.href,
    close: async () => {
      await pool.end();
      try {
        await admin.query(`DROP DATABASE "${database}"`);
      } finally {
        await admin.end();
      }
    },
  };
}
