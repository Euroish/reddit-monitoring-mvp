import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApiServer } from "../../apps/api/src/create-api-server";
import { PasswordHashingService } from "../../src/application/services/password-hashing.service";
import { RedditMockConnector } from "../../src/connectors/reddit/reddit-mock.connector";
import { createApiTestRepositories, startServer, stopServer } from "./api-server.helpers";

const now = "2026-10-19T12:00:00.000Z";
const path = "/v1/workbench/saved-views";
const valid = {
  name: "  Saved   comparison  ", viewKind: "comparison", primaryTarget: "R/DataScience",
  compareTargets: [" MachineLearning ", "MachineLearning"], keywords: [" LLM ", "LLM"],
  seriesIds: ["heat_price", "heat_price"], routePath: "/compare?targets=datascience,machinelearning",
};

test("saved views preserve viewer ownership, input errors, limits, audit and method behavior", async () => {
  const repositories = createApiTestRepositories();
  const hashing = new PasswordHashingService();
  const password = "saved-view-fixture-password";
  for (const name of ["alice", "bob"]) {
    const id = randomUUID();
    await repositories.appUserRepository.create({
      id, email: `${name}@example.test`, displayName: name, role: "viewer", status: "active", createdAt: now, updatedAt: now,
    }, { userId: id, passwordHash: await hashing.hashPassword(password), passwordAlgo: hashing.passwordAlgo, updatedAt: now });
  }
  const server = createApiServer({
    repositories, createConnector: () => new RedditMockConnector(), now: () => now,
    auth: { bearerToken: "saved-view-machine" }, logger: () => {},
  });
  const base = await startServer(server);
  try {
    const cookies: string[] = [];
    for (const name of ["alice", "bob"]) {
      const login = await fetch(`${base}/auth/login`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: `${name}@example.test`, password }),
      });
      assert.equal(login.status, 200);
      cookies.push(login.headers.get("set-cookie")!.split(";")[0]);
    }
    const post = (body: unknown, cookie = cookies[0]) => fetch(base + path, {
      method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const list = (cookie: string, query = "") => fetch(base + path + query, { headers: { cookie } });
    assert.equal((await fetch(base + path)).status, 401);
    assert.equal((await fetch(base + path, { headers: { authorization: "Bearer saved-view-machine" } })).status, 401);
    const created = await post(valid);
    assert.equal(created.status, 201);
    const { view } = await created.json() as { view: Record<string, unknown> };
    assert.equal(view.name, "Saved comparison");
    assert.equal(view.primaryTarget, "r/datascience");
    assert.deepEqual(view.compareTargets, ["r/machinelearning"]);
    assert.deepEqual(view.keywords, ["llm"]);
    assert.deepEqual(view.seriesIds, ["heat_price"]);
    assert.equal("userId" in view, false);
    assert.equal(view.createdAt, now);
    assert.equal(((await (await list(cookies[1])).json()) as { views: unknown[] }).views.length, 0);
    assert.equal(((await (await list(cookies[0], "?limit=1")).json()) as { views: unknown[] }).views.length, 1);
    for (const limit of ["0", "51", "abc"]) assert.equal((await list(cookies[0], `?limit=${limit}`)).status, 400);
    for (const [body, errorCode] of [
      [null, "invalid_request_body"],
      [{ ...valid, viewKind: "unknown" }, "invalid_request_body"],
      [{ ...valid, name: "x" }, "invalid_request_body"],
      [{ ...valid, routePath: "https://example.test" }, "invalid_request_body"],
      [{ ...valid, primaryTarget: "bad!" }, "invalid_subreddit"],
      [{ ...valid, keywords: "not-an-array" }, "invalid_request_body"],
      [{ ...valid, compareTargets: Array.from({ length: 7 }, (_, i) => `topic${i}`) }, "invalid_request_body"],
      [{ ...valid, seriesIds: ["unknown"] }, "invalid_query_param"],
    ] as const) {
      const response = await post(body);
      assert.equal(response.status, 400, JSON.stringify(body));
      const result = await response.json() as { errorCode: string };
      assert.equal(result.errorCode, errorCode);
    }
    assert.equal((await fetch(base + path, { method: "PUT", headers: { cookie: cookies[0] } })).status, 404);
    const rejectedOrigin = await fetch(base + path, {
      method: "POST", headers: { cookie: cookies[0], origin: "https://untrusted.example", "content-type": "application/json" }, body: JSON.stringify(valid),
    });
    assert.equal(rejectedOrigin.status, 403);
    const audit = await repositories.appAuditRepository.list({ limit: 100 });
    assert.ok(audit.items.some(entry => entry.action === "workbench.saved_view.create" && entry.outcome === "succeeded"));
  } finally {
    await stopServer(server);
  }
});

test("saved views report missing storage without attempting writes", async () => {
  const server = createApiServer({
    repositories: { ...createApiTestRepositories(), savedWorkbenchViewRepository: undefined },
    createConnector: () => new RedditMockConnector(), logger: () => {},
  });
  const base = await startServer(server);
  try {
    const response = await fetch(base + path);
    assert.equal(response.status, 501);
    assert.equal((await response.json() as { errorCode: string }).errorCode, "feature_not_ready");
  } finally { await stopServer(server); }
});
