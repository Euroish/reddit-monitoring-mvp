import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResultRow } from "pg";
import type { SqlQueryable } from "../../src/storage/postgres/postgres-client";
import { PostgresStorageObservabilityRepository } from "../../src/storage/repositories/postgres/postgres-storage-observability.repository";

test("storage snapshots discover new public tables without a fixed allowlist and retain estimates", async () => {
  const catalog = [
    { table_name: "content", row_estimate: "120", table_bytes: "8192", index_bytes: "4096", total_bytes: "12288" },
    { table_name: "research_export_member", row_estimate: "45", table_bytes: "4096", index_bytes: "2048", total_bytes: "6144" },
    { table_name: "public_content_search_document", row_estimate: "100", table_bytes: "2048", index_bytes: "1024", total_bytes: "3072" },
  ];
  const db: SqlQueryable = {
    async query<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]) {
      assert.ok(/^\s*SELECT\b/iu.test(sql), "Inventory must use read-only statements");
      let rows: QueryResultRow[];
      if (sql.includes("pg_database_size")) rows = [{ database_size_bytes: "100000" }];
      else {
        // Emulate the catalog selection: older SQL supplies the fixed table list.
        const allowlist = params?.[0] as readonly string[] | undefined;
        rows = catalog.filter(row => !allowlist || allowlist.includes(row.table_name));
      }
      return { rows: rows as T[], rowCount: rows.length, command: "SELECT", oid: 0, fields: [] };
    },
  };
  const repository = new PostgresStorageObservabilityRepository(db, () => "2026-10-13T04:00:00.000Z");
  const first = await repository.getSnapshot();
  assert.deepEqual(first.tables.map(table => table.tableName), catalog.map(table => table.table_name));
  assert.equal(first.tables.find(table => table.tableName === "research_export_member")?.rowEstimate, 45);
  assert.equal(first.databaseSizeBytes, 100000);
  catalog.push({ table_name: "next_migration_table", row_estimate: "7", table_bytes: "1024", index_bytes: "0", total_bytes: "1024" });
  assert.equal((await repository.getSnapshot()).tables.at(-1)?.tableName, "next_migration_table");
});
