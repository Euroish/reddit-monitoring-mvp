import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";

const home = path.resolve("output", "local-dev");
const config = { pgBin: path.join(home, "pgsql", "bin"), pgData: path.join(home, "postgres-data"), pgPort: 25432, apiPort: 3000, webPort: 5173, databaseUrl: "postgresql://postgres@127.0.0.1:25432/info_workbench_dev", setupComplete: true };
const values = { DATABASE_URL: config.databaseUrl, PORT: "3000", LOCAL_WEB_PORT: "5173", VITE_API_PROXY_TARGET: "http://127.0.0.1:3000", NODE_ENV: "development" };

test("managed config binds database identity, owned paths and distinct exact ports", async () => {
  const { validateManagedConfig } = await import("../../scripts/local-dev-config.mjs");
  assert.deepEqual(validateManagedConfig(config, home), config);
  for (const change of [{ apiPort: "3000" }, { pgPort: 0 }, { webPort: 3000 }, { pgData: path.resolve(home, "..", "other") }, { databaseUrl: "postgresql://postgres@127.0.0.1:5432/info_workbench_dev" }, { databaseUrl: "postgresql://postgres@remote.test:25432/info_workbench_dev" }, { setupComplete: "true" }]) {
    assert.throws(() => validateManagedConfig({ ...config, ...change }, home), /Managed local configuration/);
  }
});

test("managed startup validates env/port/proxy before writes and fixes demo values despite shell network/key settings", async () => {
  const { managedEnvironment } = await import("../../scripts/local-dev-config.mjs");
  const originValues = { ...values, API_CORS_ALLOW_ORIGINS: "https://untrusted.example" };
  const result = managedEnvironment(config, originValues, { SOURCE_RUN_MODE: "live", SOURCE_NETWORK_ENABLED: "true", REDDIT_RUN_MODE: "live", API_CORS_ALLOW_ORIGINS: "*" });
  assert.equal(result.SOURCE_NETWORK_ENABLED, "false"); assert.equal(result.SOURCE_RUN_MODE, "demo"); assert.equal(result.REDDIT_RUN_MODE, "mock");
  assert.equal(result.API_CORS_ALLOW_ORIGINS, "http://127.0.0.1:5173");
  assert.equal(originValues.API_CORS_ALLOW_ORIGINS, "https://untrusted.example", "Private environment input must remain unchanged");
  for (const change of [{ PORT: "3001" }, { LOCAL_WEB_PORT: "5174" }, { VITE_API_PROXY_TARGET: "http://127.0.0.1:3000/api" }, { DATABASE_URL: "postgresql://postgres@127.0.0.1:25432/another" }, { SOURCE_NETWORK_ENABLED: "tru" }, { API_HOST: "0.0.0.0" }, { NODE_ENV: "production" }]) assert.throws(() => managedEnvironment(config, { ...values, ...change }), /\.env.local/);
});
