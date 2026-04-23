import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("legacy collection_job status cleanup migration removes old constraint explicitly", async () => {
  const sql = await readFile(
    "src/storage/schema/019_collection_job_status_constraint_cleanup.sql",
    "utf8",
  );

  assert.match(sql, /DROP CONSTRAINT IF EXISTS collection_job_status_check/);
  assert.match(sql, /ADD CONSTRAINT ck_collection_job_status/);
});
