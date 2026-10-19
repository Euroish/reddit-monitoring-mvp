import assert from "node:assert/strict";
import test from "node:test";
import { PostgresClient } from "../../src/storage/postgres/postgres-client";
import { createSourceContentService } from "../../src/runtime/source-content-runtime";

test("Runtime lists disabled real adapters by default and demo never enables external providers", async () => {
  const keys = ["SOURCE_RUN_MODE", "SOURCE_NETWORK_ENABLED", "TWITTERAPI_IO_API_KEY", "TWITTERAPI_IO_TIMEOUT_MS"] as const;
  const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const db = new PostgresClient({ connectionString: "postgresql://postgres@127.0.0.1:1/source_validation_config", connectionTimeoutMs: 100 });
  try {
    for (const key of keys) delete process.env[key];
    let caps = createSourceContentService(db).capabilities();
    assert.deepEqual(caps.map(cap => [cap.provider, cap.enabled]), [["arctic_shift", false], ["twitterapi_io", false], ["bluesky_appview", false]]);
    process.env.SOURCE_NETWORK_ENABLED = "true";
    caps = createSourceContentService(db).capabilities();
    assert.equal(caps.find(row => row.provider === "arctic_shift")?.enabled, true);
    assert.equal(caps.find(row => row.provider === "twitterapi_io")?.enabled, false);
    assert.equal(caps.find(row => row.provider === "bluesky_appview")?.enabled, true);
    process.env.TWITTERAPI_IO_API_KEY = "synthetic-config-key";
    assert.equal(createSourceContentService(db).capabilities().find(row => row.provider === "twitterapi_io")?.enabled, true);
    process.env.SOURCE_RUN_MODE = "demo";
    caps = createSourceContentService(db).capabilities();
    assert.deepEqual(caps.filter(row => row.enabled).map(row => row.provider), ["demo_reddit", "demo_x"]);
    process.env.SOURCE_RUN_MODE = "invalid";
    assert.throws(() => createSourceContentService(db), /must be demo or live/);
  } finally {
    for (const key of keys) if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key];
    await db.close();
  }
});
