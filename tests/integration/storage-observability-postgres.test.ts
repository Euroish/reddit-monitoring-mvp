import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PostgresClient } from "../../src/storage/postgres/postgres-client";
import { PostgresStorageObservabilityRepository } from "../../src/storage/repositories/postgres/postgres-storage-observability.repository";
import { runMigrations } from "../../src/storage/schema/run-migrations";

const connectionString = process.env.TEST_SOURCE_DATABASE_URL;

test("native read-only storage inventory includes all public tables and later tables without views or other schemas", { skip: !connectionString }, async () => {
  const url = new URL(connectionString!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && /^\/source_validation_[a-z0-9_]+$/.test(url.pathname), "Use an isolated loopback source_validation_* database");
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = new PostgresClient({ connectionString: adminUrl.href, max: 1 });
  const database = `source_validation_inventory_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  try { await admin.query(`CREATE DATABASE "${database}"`); } finally { await admin.close(); }
  url.pathname = `/${database}`;
  const db = new PostgresClient({ connectionString: url.href, max: 2 });
  try {
    await runMigrations({ db });
    const snapshot = () => db.withTransaction(async client => {
      await client.query("SET TRANSACTION READ ONLY");
      return new PostgresStorageObservabilityRepository(client).getSnapshot();
    });
    const first = await snapshot();
    const expected = (await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(row => row.tablename);
    assert.deepEqual(first.tables.map(table => table.tableName).sort(), expected);
    for (const name of ["content_saved_query", "content_annotation", "research_export", "research_export_member", "public_content_search_document", "app_user", "app_audit_log"]) {
      assert.ok(first.tables.some(table => table.tableName === name), `${name} must be included`);
    }

    await db.query("CREATE TABLE public.inventory_future(id INTEGER PRIMARY KEY)");
    await db.query("INSERT INTO public.inventory_future VALUES(1),(2),(3)");
    await db.query("CREATE VIEW public.inventory_view AS SELECT * FROM public.inventory_future");
    await db.query("CREATE SCHEMA inventory_hidden");
    await db.query("CREATE TABLE inventory_hidden.inventory_private(id INTEGER)");
    await db.query("CREATE TABLE public.inventory_partitioned(id INTEGER) PARTITION BY RANGE(id)");
    await db.query("CREATE TABLE public.inventory_partition_child PARTITION OF public.inventory_partitioned FOR VALUES FROM(0) TO(10)");
    await db.query("ANALYZE public.inventory_future");

    const after = await snapshot();
    const names = after.tables.map(table => table.tableName);
    assert.ok(names.includes("inventory_future"), "New tables must appear without a repository change");
    assert.ok(names.includes("inventory_partitioned") && names.includes("inventory_partition_child"), "Partitioned tables and their physical children belong to the inventory");
    assert.ok(!names.includes("inventory_view") && !names.includes("inventory_private"));
    assert.equal(after.tables.find(table => table.tableName === "inventory_future")?.rowEstimate, 3);
    assert.ok(after.databaseSizeBytes > 0);
    assert.ok(after.tables.every(table => [table.rowEstimate, table.tableBytes, table.indexBytes, table.totalBytes].every(value => Number.isFinite(value) && value >= 0)));
    assert.deepEqual([...names].sort(), (await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(row => row.tablename));
    console.log(JSON.stringify({ scope: "dynamic read-only public storage inventory", database, initialTables: first.tables.length, afterTables: after.tables.length, includesNewAndPartitionedTables: true, excludesViewsAndOtherSchemas: true, rowCountsAreStatisticsEstimates: true, realSourceRequests: 0 }));
  } finally { await db.close(); }
});
