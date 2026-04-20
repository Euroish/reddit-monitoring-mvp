import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApiServer } from "../../apps/api/src/create-api-server";
import type {
  ApiErrorResponse,
  ApiReadinessResponse,
  AuthLoginResponse,
  AuthLogoutResponse,
  AuthMeResponse,
  CreateInviteResponse,
  MarketTrendResponse,
  RegisterAppUserResponse,
  TriggerPhase1RunResponse,
} from "../../packages/contracts/src/http";
import { PasswordHashingService } from "../../src/application/services/password-hashing.service";
import { RedditMockConnector } from "../../src/connectors/reddit/reddit-mock.connector";
import type { AppUserRole, AppUserStatus } from "../../src/domain/entities/app-user";
import {
  createApiTestRepositories,
  getJson,
  postJson,
  startServer,
  stopServer,
} from "./api-server.helpers";

async function seedAppUser(args: {
  repos: ReturnType<typeof createApiTestRepositories>;
  email: string;
  password: string;
  role: AppUserRole;
  status?: AppUserStatus;
  nowIso?: string;
}): Promise<void> {
  const nowIso = args.nowIso ?? "2026-04-20T02:00:00.000Z";
  const passwordHashingService = new PasswordHashingService();
  const userId = randomUUID();
  await args.repos.appUserRepository.create(
    {
      id: userId,
      email: args.email.toLowerCase(),
      displayName: args.email.split("@")[0],
      role: args.role,
      status: args.status ?? "active",
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      userId,
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
    body: (await response.json()) as AuthLoginResponse | ApiErrorResponse,
    cookie: response.headers.get("set-cookie"),
  };
}

test("auth login, me, logout issue and revoke postgres-backed session cookies", async () => {
  const fixedNow = "2026-04-20T02:00:00.000Z";
  const repos = createApiTestRepositories();
  await seedAppUser({
    repos,
    email: "Owner@example.com",
    password: "correct horse battery staple",
    role: "owner",
    nowIso: fixedNow,
  });

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
    const loginResult = await login(baseUrl, "owner@example.com", "correct horse battery staple");
    assert.equal(loginResult.status, 200);
    assert.equal(loginResult.body.ok, true);
    assert.equal(loginResult.body.user.email, "owner@example.com");
    assert.equal(loginResult.body.user.role, "owner");
    assert.match(loginResult.cookie ?? "", /rm_session=/);
    assert.match(loginResult.cookie ?? "", /HttpOnly/);
    assert.match(loginResult.cookie ?? "", /SameSite=Lax/);

    const me = await getJson<AuthMeResponse>(`${baseUrl}/auth/me`, {
      cookie: loginResult.cookie ?? "",
    });
    assert.equal(me.status, 200);
    assert.equal(me.body.ok, true);
    assert.equal(me.body.user.email, "owner@example.com");

    const logout = await postJson<AuthLogoutResponse>(
      `${baseUrl}/auth/logout`,
      {},
      {
        cookie: loginResult.cookie ?? "",
      },
    );
    assert.equal(logout.status, 200);
    assert.equal(logout.body.ok, true);

    const afterLogout = await getJson<ApiErrorResponse>(`${baseUrl}/auth/me`, {
      cookie: loginResult.cookie ?? "",
    });
    assert.equal(afterLogout.status, 401);
    assert.equal(afterLogout.body.errorCode, "unauthorized");
  } finally {
    await stopServer(server);
  }
});

test("v1 routes accept session cookies while preserving bearer compatibility", async () => {
  const fixedNow = "2026-04-20T02:00:00.000Z";
  const repos = createApiTestRepositories();
  await seedAppUser({
    repos,
    email: "viewer@example.com",
    password: "viewer-password",
    role: "viewer",
    nowIso: fixedNow,
  });

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
    const loginResult = await login(baseUrl, "viewer@example.com", "viewer-password");
    assert.equal(loginResult.status, 200);

    const sessionMarket = await getJson<MarketTrendResponse>(`${baseUrl}/v1/trends/market`, {
      cookie: loginResult.cookie ?? "",
    });
    assert.equal(sessionMarket.status, 200);
    assert.equal(sessionMarket.body.ok, true);

    const bearerMarket = await getJson<MarketTrendResponse>(`${baseUrl}/v1/trends/market`, {
      authorization: "Bearer test-token",
    });
    assert.equal(bearerMarket.status, 200);
    assert.equal(bearerMarket.body.ok, true);
  } finally {
    await stopServer(server);
  }
});

test("ops write routes require owner or admin session roles but still allow bearer", async () => {
  const fixedNow = "2026-04-20T02:00:00.000Z";
  const repos = createApiTestRepositories();
  await seedAppUser({
    repos,
    email: "viewer@example.com",
    password: "viewer-password",
    role: "viewer",
    nowIso: fixedNow,
  });
  await seedAppUser({
    repos,
    email: "admin@example.com",
    password: "admin-password",
    role: "admin",
    nowIso: fixedNow,
  });

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
    const viewerLogin = await login(baseUrl, "viewer@example.com", "viewer-password");
    const viewerRun = await postJson<ApiErrorResponse>(
      `${baseUrl}/v1/runs/reddit-phase1`,
      { mode: "mock" },
      {
        cookie: viewerLogin.cookie ?? "",
      },
    );
    assert.equal(viewerRun.status, 403);
    assert.equal(viewerRun.body.errorCode, "forbidden");

    const adminLogin = await login(baseUrl, "admin@example.com", "admin-password");
    const adminRun = await postJson<TriggerPhase1RunResponse>(
      `${baseUrl}/v1/runs/reddit-phase1`,
      { mode: "mock" },
      {
        cookie: adminLogin.cookie ?? "",
      },
    );
    assert.equal(adminRun.status, 202);
    assert.equal(adminRun.body.ok, true);

    const bearerRun = await postJson<TriggerPhase1RunResponse>(
      `${baseUrl}/v1/runs/reddit-phase1`,
      { mode: "mock" },
      {
        authorization: "Bearer test-token",
      },
    );
    assert.equal(bearerRun.status, 202);
    assert.equal(bearerRun.body.ok, true);
  } finally {
    await stopServer(server);
  }
});

test("ops readiness requires owner or admin session and preserves not-ready payloads", async () => {
  const fixedNow = "2026-04-20T02:00:00.000Z";
  const repos = createApiTestRepositories();
  await seedAppUser({
    repos,
    email: "viewer@example.com",
    password: "viewer-password",
    role: "viewer",
    nowIso: fixedNow,
  });
  await seedAppUser({
    repos,
    email: "admin@example.com",
    password: "admin-password",
    role: "admin",
    nowIso: fixedNow,
  });
  await seedAppUser({
    repos,
    email: "owner@example.com",
    password: "owner-password",
    role: "owner",
    nowIso: fixedNow,
  });

  repos.monitorTargetRepository.findActiveSubreddits = async () => {
    throw new Error("storage unavailable");
  };

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
    const unauthenticated = await getJson<ApiErrorResponse>(`${baseUrl}/v1/ops/readyz`);
    assert.equal(unauthenticated.status, 401);
    assert.equal(unauthenticated.body.errorCode, "unauthorized");

    const viewerLogin = await login(baseUrl, "viewer@example.com", "viewer-password");
    const viewerReady = await getJson<ApiErrorResponse>(`${baseUrl}/v1/ops/readyz`, {
      cookie: viewerLogin.cookie ?? "",
    });
    assert.equal(viewerReady.status, 403);
    assert.equal(viewerReady.body.errorCode, "forbidden");

    const bearerReady = await getJson<ApiErrorResponse>(`${baseUrl}/v1/ops/readyz`, {
      authorization: "Bearer test-token",
    });
    assert.equal(bearerReady.status, 403);
    assert.equal(bearerReady.body.errorCode, "forbidden");

    const adminLogin = await login(baseUrl, "admin@example.com", "admin-password");
    const adminReady = await getJson<ApiReadinessResponse>(`${baseUrl}/v1/ops/readyz`, {
      cookie: adminLogin.cookie ?? "",
    });
    assert.equal(adminReady.status, 200);
    assert.equal(adminReady.body.ok, false);
    assert.equal(adminReady.body.status, "not_ready");
    assert.deepEqual(adminReady.body.degradedReasons, ["storage_unavailable"]);

    const ownerLogin = await login(baseUrl, "owner@example.com", "owner-password");
    const ownerReady = await getJson<ApiReadinessResponse>(`${baseUrl}/v1/ops/readyz`, {
      cookie: ownerLogin.cookie ?? "",
    });
    assert.equal(ownerReady.status, 200);
    assert.equal(ownerReady.body.status, "not_ready");

    const publicReady = await getJson<ApiReadinessResponse>(`${baseUrl}/readyz`);
    assert.equal(publicReady.status, 503);
    assert.equal(publicReady.body.status, "not_ready");
  } finally {
    await stopServer(server);
  }
});

test("auth rejects invalid credentials and inactive users without creating sessions", async () => {
  const repos = createApiTestRepositories();
  await seedAppUser({
    repos,
    email: "pending@example.com",
    password: "pending-password",
    role: "viewer",
    status: "pending",
  });

  const server = createApiServer({
    repositories: repos,
    createConnector: () => new RedditMockConnector(),
  });

  const baseUrl = await startServer(server);
  try {
    const wrongPassword = await login(baseUrl, "pending@example.com", "wrong");
    assert.equal(wrongPassword.status, 401);
    assert.equal(wrongPassword.body.ok, false);
    assert.equal(wrongPassword.body.errorCode, "invalid_credentials");

    const pending = await login(baseUrl, "pending@example.com", "pending-password");
    assert.equal(pending.status, 401);
    assert.equal(pending.body.ok, false);
    assert.equal(pending.body.errorCode, "invalid_credentials");
    assert.equal(repos.appSessionRepository.all().length, 0);
  } finally {
    await stopServer(server);
  }
});

test("api rejects oversized JSON request bodies", async () => {
  const repos = createApiTestRepositories();
  const server = createApiServer({
    repositories: repos,
    createConnector: () => new RedditMockConnector(),
  });

  const baseUrl = await startServer(server);
  try {
    const response = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email: "oversized@example.com",
        password: "x".repeat(1_048_576),
      }),
    });
    const body = (await response.json()) as ApiErrorResponse;
    assert.equal(response.status, 413);
    assert.equal(body.errorCode, "request_body_too_large");
  } finally {
    await stopServer(server);
  }
});

test("invite registration creates pending user, activation enables login", async () => {
  const fixedNow = "2026-04-20T03:00:00.000Z";
  const repos = createApiTestRepositories();
  await seedAppUser({
    repos,
    email: "owner@example.com",
    password: "owner-password",
    role: "owner",
    nowIso: fixedNow,
  });

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
    const ownerLogin = await login(baseUrl, "owner@example.com", "owner-password");
    const invite = await postJson<CreateInviteResponse>(
      `${baseUrl}/auth/invites`,
      {
        roleOnAccept: "viewer",
        maxUses: 1,
      },
      {
        cookie: ownerLogin.cookie ?? "",
      },
    );
    assert.equal(invite.status, 201);
    assert.equal(invite.body.ok, true);
    assert.equal(invite.body.invite.roleOnAccept, "viewer");
    assert.equal(typeof invite.body.code, "string");
    assert.notEqual(repos.appInviteRepository.all()[0]?.codeHash, invite.body.code);

    const registered = await postJson<RegisterAppUserResponse>(
      `${baseUrl}/auth/register`,
      {
        email: "new-user@example.com",
        password: "new-user-password",
        inviteCode: invite.body.code,
        displayName: "New User",
      },
    );
    assert.equal(registered.status, 201);
    assert.equal(registered.body.ok, true);
    assert.equal(registered.body.user.email, "new-user@example.com");
    assert.equal(registered.body.user.role, "viewer");
    assert.equal(registered.body.user.status, "pending");

    const pendingLogin = await login(baseUrl, "new-user@example.com", "new-user-password");
    assert.equal(pendingLogin.status, 401);
    assert.equal(pendingLogin.body.ok, false);
    assert.equal(pendingLogin.body.errorCode, "invalid_credentials");

    const activated = await postJson<AuthMeResponse>(
      `${baseUrl}/auth/users/${encodeURIComponent(registered.body.user.id)}/activate`,
      {},
      {
        authorization: "Bearer test-token",
      },
    );
    assert.equal(activated.status, 200);
    assert.equal(activated.body.ok, true);
    assert.equal(activated.body.user.status, "active");

    const activeLogin = await login(baseUrl, "new-user@example.com", "new-user-password");
    assert.equal(activeLogin.status, 200);
    assert.equal(activeLogin.body.ok, true);
  } finally {
    await stopServer(server);
  }
});

test("invite registration rejects exhausted and expired invites", async () => {
  const fixedNow = "2026-04-20T03:00:00.000Z";
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
    const invite = await postJson<CreateInviteResponse>(
      `${baseUrl}/auth/invites`,
      {
        maxUses: 1,
      },
      {
        authorization: "Bearer test-token",
      },
    );
    assert.equal(invite.status, 201);

    const first = await postJson<RegisterAppUserResponse>(
      `${baseUrl}/auth/register`,
      {
        email: "first@example.com",
        password: "first-password",
        inviteCode: invite.body.code,
      },
    );
    assert.equal(first.status, 201);

    const exhausted = await postJson<ApiErrorResponse>(
      `${baseUrl}/auth/register`,
      {
        email: "second@example.com",
        password: "second-password",
        inviteCode: invite.body.code,
      },
    );
    assert.equal(exhausted.status, 400);
    assert.equal(exhausted.body.errorCode, "invite_unavailable");

    const expiredInvite = await postJson<CreateInviteResponse>(
      `${baseUrl}/auth/invites`,
      {
        expiresAt: "2026-04-19T03:00:00.000Z",
      },
      {
        authorization: "Bearer test-token",
      },
    );
    assert.equal(expiredInvite.status, 201);
    const expired = await postJson<ApiErrorResponse>(
      `${baseUrl}/auth/register`,
      {
        email: "expired@example.com",
        password: "expired-password",
        inviteCode: expiredInvite.body.code,
      },
    );
    assert.equal(expired.status, 400);
    assert.equal(expired.body.errorCode, "invalid_invite");
  } finally {
    await stopServer(server);
  }
});

test("viewer session cannot create invites or activate users", async () => {
  const fixedNow = "2026-04-20T03:00:00.000Z";
  const repos = createApiTestRepositories();
  await seedAppUser({
    repos,
    email: "viewer@example.com",
    password: "viewer-password",
    role: "viewer",
    nowIso: fixedNow,
  });

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
    const viewerLogin = await login(baseUrl, "viewer@example.com", "viewer-password");
    const invite = await postJson<ApiErrorResponse>(
      `${baseUrl}/auth/invites`,
      {},
      {
        cookie: viewerLogin.cookie ?? "",
      },
    );
    assert.equal(invite.status, 403);
    assert.equal(invite.body.errorCode, "forbidden");

    const activate = await postJson<ApiErrorResponse>(
      `${baseUrl}/auth/users/${randomUUID()}/activate`,
      {},
      {
        cookie: viewerLogin.cookie ?? "",
      },
    );
    assert.equal(activate.status, 403);
    assert.equal(activate.body.errorCode, "forbidden");
  } finally {
    await stopServer(server);
  }
});
