import assert from "node:assert/strict";
import test from "node:test";
import { createApiServer } from "../../apps/api/src/create-api-server";
import { RedditMockConnector } from "../../src/connectors/reddit/reddit-mock.connector";
import {
  createApiTestRepositories,
  getJson,
  optionsRequest,
  postJson,
  startServer,
  stopServer,
} from "./api-server.helpers";

test("api server rate limits repeated trend queries", async () => {
  const repos = createApiTestRepositories();
  const server = createApiServer({
    repositories: repos,
    createConnector: () => new RedditMockConnector(),
    rateLimit: {
      enabled: true,
      points: 1,
      durationSeconds: 60,
    },
  });

  const baseUrl = await startServer(server);
  try {
    const first = await getJson<{ ok: boolean }>(`${baseUrl}/v1/trends/market`);
    assert.equal(first.status, 200);
    assert.equal(first.body.ok, true);

    const second = await getJson<{ ok: boolean; errorCode: string }>(`${baseUrl}/v1/trends/market`);
    assert.equal(second.status, 429);
    assert.equal(second.body.ok, false);
    assert.equal(second.body.errorCode, "rate_limited");
  } finally {
    await stopServer(server);
  }
});

test("api server rate limits authenticated trend queries without 503 fallback", async () => {
  const repos = createApiTestRepositories();
  const server = createApiServer({
    repositories: repos,
    createConnector: () => new RedditMockConnector(),
    auth: {
      bearerToken: "test-token",
    },
    rateLimit: {
      enabled: true,
      points: 1,
      durationSeconds: 60,
    },
  });

  const baseUrl = await startServer(server);
  try {
    const first = await getJson<{ ok: boolean }>(`${baseUrl}/v1/trends/market`, {
      authorization: "Bearer test-token",
    });
    assert.equal(first.status, 200);
    assert.equal(first.body.ok, true);

    const second = await getJson<{ ok: boolean; errorCode: string }>(`${baseUrl}/v1/trends/market`, {
      authorization: "Bearer test-token",
    });
    assert.equal(second.status, 429);
    assert.equal(second.body.ok, false);
    assert.equal(second.body.errorCode, "rate_limited");
  } finally {
    await stopServer(server);
  }
});

test("api server enforces bearer auth on /v1 routes", async () => {
  const fixedNow = "2026-04-10T12:00:00.000Z";
  const repos = createApiTestRepositories();
  const server = createApiServer({
    repositories: repos,
    createConnector: () => new RedditMockConnector(),
    now: () => fixedNow,
    auth: {
      bearerToken: "test-token",
    },
  });

  const baseUrl = await startServer(server);
  try {
    const noTokenResult = await postJson<{ ok: boolean; errorCode: string }>(
      `${baseUrl}/v1/targets/subreddit`,
      { subreddit: "datascience" },
    );
    assert.equal(noTokenResult.status, 401);
    assert.equal(noTokenResult.body.ok, false);
    assert.equal(noTokenResult.body.errorCode, "unauthorized");

    const wrongTokenResult = await postJson<{ ok: boolean; errorCode: string }>(
      `${baseUrl}/v1/targets/subreddit`,
      { subreddit: "datascience" },
      { authorization: "Bearer wrong-token" },
    );
    assert.equal(wrongTokenResult.status, 401);
    assert.equal(wrongTokenResult.body.ok, false);
    assert.equal(wrongTokenResult.body.errorCode, "unauthorized");

    const okResult = await postJson<{ ok: boolean; canonicalName: string }>(
      `${baseUrl}/v1/targets/subreddit`,
      { subreddit: "datascience" },
      { authorization: "Bearer test-token" },
    );
    assert.equal(okResult.status, 200);
    assert.equal(okResult.body.ok, true);
    assert.equal(okResult.body.canonicalName, "r/datascience");

    const healthz = await getJson<{ ok: boolean }>(`${baseUrl}/healthz`);
    assert.equal(healthz.status, 200);
    assert.equal(healthz.body.ok, true);
  } finally {
    await stopServer(server);
  }
});

test("api server supports CORS preflight and blocks unknown origins", async () => {
  const repos = createApiTestRepositories();
  const server = createApiServer({
    repositories: repos,
    createConnector: () => new RedditMockConnector(),
    cors: {
      allowedOrigins: ["https://frontend.example.com"],
    },
  });

  const baseUrl = await startServer(server);
  try {
    const preflight = await optionsRequest(`${baseUrl}/v1/targets/subreddit`, {
      origin: "https://frontend.example.com",
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type,authorization",
    });
    assert.equal(preflight.status, 204);
    assert.equal(
      preflight.headers.get("access-control-allow-origin"),
      "https://frontend.example.com",
    );
    assert.equal(preflight.headers.get("access-control-allow-methods"), "GET, POST, OPTIONS");

    const blocked = await postJson<{ ok: boolean; errorCode: string }>(
      `${baseUrl}/v1/targets/subreddit`,
      { subreddit: "datascience" },
      { origin: "https://evil.example.com" },
    );
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.ok, false);
    assert.equal(blocked.body.errorCode, "cors_origin_not_allowed");
  } finally {
    await stopServer(server);
  }
});
