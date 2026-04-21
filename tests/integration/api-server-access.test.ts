import assert from "node:assert/strict";
import test from "node:test";
import { createApiServer } from "../../apps/api/src/create-api-server";
import type {
  ApiErrorResponse,
  ApiHealthResponse,
  CreateSubredditTargetResponse,
  MarketTrendResponse,
} from "../../packages/contracts/src/http";
import { RedditMockConnector } from "../../src/connectors/reddit/reddit-mock.connector";
import { PasswordHashingService } from "../../src/application/services/password-hashing.service";
import {
  createApiTestRepositories,
  getJson,
  optionsRequest,
  postJson,
  startServer,
  stopServer,
} from "./api-server.helpers";

async function seedSessionUser(args: {
  repos: ReturnType<typeof createApiTestRepositories>;
  id: string;
  email: string;
  password: string;
  role: "owner" | "admin" | "viewer";
  nowIso?: string;
}) {
  const nowIso = args.nowIso ?? "2026-04-21T09:00:00.000Z";
  const passwordHashingService = new PasswordHashingService();
  await args.repos.appUserRepository.create(
    {
      id: args.id,
      email: args.email,
      displayName: args.email.split("@")[0],
      role: args.role,
      status: "active",
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      userId: args.id,
      passwordHash: await passwordHashingService.hashPassword(args.password),
      passwordAlgo: passwordHashingService.passwordAlgo,
      updatedAt: nowIso,
    },
  );
}

async function login(baseUrl: string, email: string, password: string) {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  return {
    status: response.status,
    cookie: response.headers.get("set-cookie"),
  };
}

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
    const first = await getJson<MarketTrendResponse>(`${baseUrl}/v1/trends/market`);
    assert.equal(first.status, 200);
    assert.equal(first.body.ok, true);

    const second = await getJson<ApiErrorResponse>(`${baseUrl}/v1/trends/market`);
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
    const first = await getJson<MarketTrendResponse>(`${baseUrl}/v1/trends/market`, {
      authorization: "Bearer test-token",
    });
    assert.equal(first.status, 200);
    assert.equal(first.body.ok, true);

    const second = await getJson<ApiErrorResponse>(`${baseUrl}/v1/trends/market`, {
      authorization: "Bearer test-token",
    });
    assert.equal(second.status, 429);
    assert.equal(second.body.ok, false);
    assert.equal(second.body.errorCode, "rate_limited");
  } finally {
    await stopServer(server);
  }
});

test("api server rate limits session traffic by user instead of shared IP", async () => {
  const repos = createApiTestRepositories();
  await seedSessionUser({
    repos,
    id: "00000000-0000-4000-8000-000000000101",
    email: "viewer-a@example.com",
    password: "viewer-password-a",
    role: "viewer",
  });
  await seedSessionUser({
    repos,
    id: "00000000-0000-4000-8000-000000000102",
    email: "viewer-b@example.com",
    password: "viewer-password-b",
    role: "viewer",
  });

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
    const viewerA = await login(baseUrl, "viewer-a@example.com", "viewer-password-a");
    const viewerB = await login(baseUrl, "viewer-b@example.com", "viewer-password-b");
    assert.equal(viewerA.status, 200);
    assert.equal(viewerB.status, 200);

    const viewerAFirst = await getJson<MarketTrendResponse>(`${baseUrl}/v1/trends/market`, {
      cookie: viewerA.cookie ?? "",
    });
    assert.equal(viewerAFirst.status, 200);

    const viewerASecond = await getJson<ApiErrorResponse>(`${baseUrl}/v1/trends/market`, {
      cookie: viewerA.cookie ?? "",
    });
    assert.equal(viewerASecond.status, 429);
    assert.equal(viewerASecond.body.errorCode, "rate_limited");

    const viewerBFirst = await getJson<MarketTrendResponse>(`${baseUrl}/v1/trends/market`, {
      cookie: viewerB.cookie ?? "",
    });
    assert.equal(viewerBFirst.status, 200);
    assert.equal(viewerBFirst.body.ok, true);
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
    const noTokenResult = await postJson<ApiErrorResponse>(
      `${baseUrl}/v1/targets/subreddit`,
      { subreddit: "datascience" },
    );
    assert.equal(noTokenResult.status, 401);
    assert.equal(noTokenResult.body.ok, false);
    assert.equal(noTokenResult.body.errorCode, "unauthorized");

    const wrongTokenResult = await postJson<ApiErrorResponse>(
      `${baseUrl}/v1/targets/subreddit`,
      { subreddit: "datascience" },
      { authorization: "Bearer wrong-token" },
    );
    assert.equal(wrongTokenResult.status, 401);
    assert.equal(wrongTokenResult.body.ok, false);
    assert.equal(wrongTokenResult.body.errorCode, "unauthorized");

    const okResult = await postJson<CreateSubredditTargetResponse>(
      `${baseUrl}/v1/targets/subreddit`,
      { subreddit: "datascience" },
      { authorization: "Bearer test-token" },
    );
    assert.equal(okResult.status, 200);
    assert.equal(okResult.body.ok, true);
    assert.equal(okResult.body.canonicalName, "r/datascience");

    const healthz = await getJson<ApiHealthResponse>(`${baseUrl}/healthz`);
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

    const blocked = await postJson<ApiErrorResponse>(
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
