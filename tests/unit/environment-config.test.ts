import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { environmentBoolean, environmentInteger, validateRuntimeEnvironment } from "../../src/runtime/environment-config";

test("network switch is strictly true/false, absent remains closed, and ordinary legacy flags retain documented aliases", () => {
  assert.equal(environmentBoolean({}, "SOURCE_NETWORK_ENABLED", false, true), false);
  assert.equal(environmentBoolean({ SOURCE_NETWORK_ENABLED: "true" }, "SOURCE_NETWORK_ENABLED", false, true), true);
  for (const value of ["tru", "TRUE", "yes", "1", "", " false "]) assert.throws(() => validateRuntimeEnvironment({ SOURCE_NETWORK_ENABLED: value }), /SOURCE_NETWORK_ENABLED/);
  for (const value of ["true", "1", "yes"]) assert.equal(environmentBoolean({ FLAG: value }, "FLAG", false), true);
  validateRuntimeEnvironment({ REDDIT_HTTP_TRANSPORT: "powershell", REDDIT_SCRAPLING_PROFILE: "dynamic", REDDIT_CB_ENABLED: "true", REDDIT_POST_LIMIT_ADAPTIVE: "yes", OTHER_EXTENSION: "custom" });
});

test("integer settings reject partial parse, unsafe values and out-of-range ports/pages without printing values", () => {
  for (const value of ["3000oops", "3000.5", "-1", "0", "65536", "", " 3000", "1e3"]) assert.throws(() => validateRuntimeEnvironment({ PORT: value }), /PORT/);
  for (const key of ["REDDIT_POST_LIMIT", "REDDIT_BACKFILL_POST_LIMIT"]) assert.throws(() => validateRuntimeEnvironment({ [key]: "5001" }), new RegExp(key));
  assert.equal(environmentInteger({ LIMIT: "100" }, "LIMIT", 25, 1, 100), 100);
  assert.throws(() => environmentInteger({ LIMIT: "101" }, "LIMIT", 25, 1, 100), /LIMIT/);
  validateRuntimeEnvironment({ PORT: "65535", PG_POOL_MAX: "100", REDDIT_BACKFILL_MAX_ITERATIONS_PER_TARGET: "0", REDDIT_CANDIDATE_MIN_SCORE: "0" });
});

test("known enums and URLs fail clearly while unrelated legacy extension settings remain accepted", () => {
  for (const [key, value] of Object.entries({ SOURCE_RUN_MODE: "dmeo", REDDIT_LIVE_PROVIDER: "arctic_shift", REDDIT_HTTP_TRANSPORT: "curl", REDDIT_SCRAPLING_PROFILE: "browser", TWITTERAPI_IO_TIMEOUT_MS: "20s", DATABASE_URL: "https://user:secret@host/db", VITE_API_PROXY_TARGET: "http://127.0.0.1:3000/api" })) {
    assert.throws(() => validateRuntimeEnvironment({ [key]: value }), error => error instanceof Error && error.message.includes(key) && !error.message.includes("secret"));
  }
});

test("local file loader preserves shell precedence, production requires an explicit file, and invalid loaded flags fail startup", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "source-env-"));
  const filename = path.join(directory, "private.env");
  const entry = path.resolve("src/runtime/load-local-env.ts");
  const env: NodeJS.ProcessEnv = { ...process.env, LOCAL_ENV_FILE: filename, NODE_ENV: "test", SOURCE_RUN_MODE: "demo" };
  delete env.SOURCE_NETWORK_ENABLED;
  try {
    await writeFile(filename, "SOURCE_NETWORK_ENABLED=typo\n");
    const invalid = spawnSync(process.execPath, ["--import", "tsx", entry], { env, encoding: "utf8", windowsHide: true });
    assert.notEqual(invalid.status, 0); assert.match(invalid.stderr, /SOURCE_NETWORK_ENABLED/);
    const valid = spawnSync(process.execPath, ["--import", "tsx", entry], { env: { ...env, SOURCE_NETWORK_ENABLED: "false" }, encoding: "utf8", windowsHide: true });
    assert.equal(valid.status, 0, valid.stderr);
    const absent = spawnSync(process.execPath, ["--import", "tsx", entry], { env: { ...env, LOCAL_ENV_FILE: path.join(directory, "missing.env") }, encoding: "utf8", windowsHide: true });
    assert.notEqual(absent.status, 0); assert.match(absent.stderr, /LOCAL_ENV_FILE does not exist/);
    await writeFile(path.join(directory, ".env.local"), "SOURCE_NETWORK_ENABLED=typo\n");
    const productionEnv: NodeJS.ProcessEnv = { ...env, NODE_ENV: "production" }; delete productionEnv.LOCAL_ENV_FILE;
    const production = spawnSync(process.execPath, ["--import", pathToFileURL(require.resolve("tsx")).href, entry], { cwd: directory, env: productionEnv, encoding: "utf8", windowsHide: true });
    assert.equal(production.status, 0, production.stderr);
  } finally {
    assert.equal(path.dirname(directory), path.resolve(tmpdir())); assert.ok(path.basename(directory).startsWith("source-env-"));
    await rm(directory, { recursive: true, force: true });
  }
});
