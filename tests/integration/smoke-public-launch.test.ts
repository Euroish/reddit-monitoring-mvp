import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import test from "node:test";

import { createApiServer } from "../../apps/api/src/create-api-server";
import { runPublicLaunchSmoke } from "../../scripts/smoke-public-launch";
import { PasswordHashingService } from "../../src/application/services/password-hashing.service";
import { RedditMockConnector } from "../../src/connectors/reddit/reddit-mock.connector";
import { createApiTestRepositories, startServer, stopServer } from "./api-server.helpers";

async function seedAppUser(args: {
  repos: ReturnType<typeof createApiTestRepositories>;
  email: string;
  password: string;
  role: "owner" | "admin" | "viewer";
  nowIso?: string;
}): Promise<void> {
  const nowIso = args.nowIso ?? "2026-04-22T12:00:00.000Z";
  const passwordHashingService = new PasswordHashingService();
  const userId = randomUUID();
  await args.repos.appUserRepository.create(
    {
      id: userId,
      email: args.email.toLowerCase(),
      displayName: args.email.split("@")[0],
      role: args.role,
      status: "active",
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

async function readRequestBody(req: IncomingMessage): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return undefined;
  }
  return Buffer.concat(chunks);
}

async function createPublicLaunchProxy(apiBaseUrl: string): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (!req.url || !req.method) {
      res.statusCode = 400;
      res.end();
      return;
    }

    const incomingUrl = new URL(req.url, "http://127.0.0.1");
    if (incomingUrl.pathname === "/readyz") {
      res.statusCode = 403;
      res.end();
      return;
    }
    const upstreamPath = incomingUrl.pathname.startsWith("/api/")
      ? incomingUrl.pathname.slice("/api".length)
      : incomingUrl.pathname;
    const upstreamUrl = new URL(`${apiBaseUrl}${upstreamPath}${incomingUrl.search}`);
    const body = await readRequestBody(req);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) {
        headers.set(key, value.join(", "));
      } else if (typeof value === "string") {
        headers.set(key, value);
      }
    }
    headers.set("host", upstreamUrl.host);

    const response = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body: body ? new Uint8Array(body) : undefined,
      redirect: "manual",
    });

    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });
    const responseBody = Buffer.from(await response.arrayBuffer());
    res.end(responseBody);
  });

  const baseUrl = await startServer(server);
  return { server, baseUrl };
}

test("public launch smoke proves authenticated cookie and credentialed CORS flow", async () => {
  const fixedNow = "2026-04-22T12:00:00.000Z";
  const repos = createApiTestRepositories();
  await seedAppUser({
    repos,
    email: "owner@example.com",
    password: "launch-password",
    role: "owner",
    nowIso: fixedNow,
  });

  const apiServer = createApiServer({
    repositories: repos,
    createConnector: () => new RedditMockConnector(),
    now: () => fixedNow,
    auth: {
      bearerToken: "test-token",
      sessionCookieSecure: true,
    },
    cors: {
      allowedOrigins: ["https://public.example.com"],
    },
  });

  const apiBaseUrl = await startServer(apiServer);
  const publicProxy = await createPublicLaunchProxy(apiBaseUrl);

  try {
    const result = await runPublicLaunchSmoke({
      ...process.env,
      PUBLIC_BASE_URL: publicProxy.baseUrl,
      PUBLIC_ALLOW_HTTP: "true",
      PUBLIC_LOGIN_EMAIL: "owner@example.com",
      PUBLIC_LOGIN_PASSWORD: "launch-password",
      PUBLIC_ALLOWED_ORIGIN: "https://public.example.com",
      PUBLIC_BLOCKED_ORIGIN: "https://blocked-origin.example",
    });
    assert.equal(result.event, "public_launch_smoke.passed");
    assert.deepEqual(result.checks, [
      "healthz.public_ok",
      "readyz.not_public",
      "cors.allowed_origin",
      "cors.blocked_origin",
      "auth.secure_cookie",
      "auth.login_cors_credentials",
      "auth.session_me",
      "auth.me_cors_credentials",
      "auth.logout_clears_cookie",
      "auth.logout_cors_credentials",
    ]);
  } finally {
    await stopServer(publicProxy.server);
    await stopServer(apiServer);
  }
});
