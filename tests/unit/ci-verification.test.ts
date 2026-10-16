import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { postgresTestUrl, testFiles } from "../../scripts/run-ci-tests";

test("native SQL runner cannot succeed or silently skip without a dedicated URL", () => {
  assert.throws(() => postgresTestUrl({}), /required.*no tests were run/);
  for (const value of ["postgresql://postgres@db.example.test/source_validation_ci", "postgresql://postgres@127.0.0.1/info_workbench_dev", "https://127.0.0.1/source_validation_ci"]) assert.throws(() => postgresTestUrl({ TEST_SOURCE_DATABASE_URL: value }), /dedicated loopback/);
  const env: NodeJS.ProcessEnv = { ...process.env, LOCAL_ENV_FILE: "none" }; delete env.TEST_SOURCE_DATABASE_URL;
  const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/run-ci-tests.ts", "postgres"], { env, encoding: "utf8", windowsHide: true });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /TEST_SOURCE_DATABASE_URL is required/); assert.doesNotMatch(result.stdout, /# pass/);
});

test("native SQL and offline matrices form disjoint complete discovered test sets", async () => {
  const files = await testFiles();
  const sql = files.filter(file => file.endsWith("-postgres.test.ts"));
  const offline = files.filter(file => !file.endsWith("-postgres.test.ts"));
  assert.ok(sql.length >= 7); assert.ok(offline.length > 20);
  assert.equal(new Set([...sql, ...offline]).size, files.length);
  assert.ok(sql.some(file => file.endsWith("migrations-atomic-postgres.test.ts")));
  assert.ok(sql.some(file => file.endsWith("source-x-postgres.test.ts")));
});
