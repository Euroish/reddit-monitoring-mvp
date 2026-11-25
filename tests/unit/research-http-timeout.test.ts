import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { buildApp } from "../../apps/api/src/app";

test("research-style SQL and handler deadlines return structured 503 over HTTP without resetting the socket", async (t) => {
  const app = await buildApp({
    pool: { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as Pool,
    origin: "http://localhost",
    sessionSecret: "research-http-timeout-test-secret",
  });
  t.after(() => app.close());
  const publicRoute = { config: { auth: { access: "public" as const } } };
  app.get("/test-sql-timeout", publicRoute, async () => {
    throw Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
  });
  app.get("/test-handler-timeout", { ...publicRoute, handlerTimeout: 30 }, async (request) => {
    await new Promise<void>((resolve) => request.signal.addEventListener("abort", () => resolve(), { once: true }));
  });
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });
  assert.equal(app.server.timeout, 0);
  assert.equal(app.server.requestTimeout, 30_000);
  for (const path of ["/test-sql-timeout", "/test-handler-timeout"]) {
    const response = await fetch(origin + path, { signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("retry-after"), "1");
    const { error } = await response.json();
    assert.equal(error.code, "temporarily_unavailable");
    assert.equal(error.retryable, true);
    assert.ok(error.requestId);
  }
});
