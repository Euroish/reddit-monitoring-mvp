import { createHmac, timingSafeEqual } from "node:crypto";
import Fastify from "fastify";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import swagger from "@fastify/swagger";
import rateLimit from "@fastify/rate-limit";
import type { Pool } from "pg";
import type { Actor } from "../../../packages/contracts/src/source-content";
import type { ContentProvider } from "../../../src/connectors/shared/content-provider.interface";
import { findActor } from "../../../src/modules/access/sql";
import { accessRoutes } from "../../../src/modules/access/routes";
import { collectionRoutes } from "../../../src/modules/collection/routes";
import { contentRoutes } from "../../../src/modules/content/routes";
import { workspaceRoutes } from "../../../src/modules/workspace/routes";
import { projectRoutes } from "../../../src/modules/projects/routes";
import { fail } from "../../../src/storage/db";

declare module "fastify" {
  interface FastifyRequest {
    actor: Actor | null;
  }
}
export async function buildApp(options: {
  pool: Pool;
  sessionSecret: string;
  origin: string;
  secureCookies?: boolean;
  providers?: ContentProvider[];
  logger?: boolean;
  rateLimitMax?: number;
}) {
  if (options.sessionSecret.length < 32)
    throw new Error("SESSION_SECRET must have at least 32 characters");
  const origin = new URL(options.origin).origin;
  const app = Fastify({
    forceCloseConnections: "idle",
    bodyLimit: 16 * 1024 * 1024,
    trustProxy: false,
    logger: options.logger
      ? {
          redact: [
            "req.headers.authorization",
            "req.headers.cookie",
            "res.headers.set-cookie",
          ],
        }
      : false,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: "array" } },
  });
  const bodyValidator = addFormats(
    new Ajv({ coerceTypes: false, removeAdditional: false, strict: false }),
  );
  const queryValidator = addFormats(
    new Ajv({ coerceTypes: "array", removeAdditional: false, strict: false }),
  );
  app.setValidatorCompiler(({ schema, httpPart }) =>
    (httpPart === "body" ? bodyValidator : queryValidator).compile(schema),
  );
  const providers = options.providers ?? [];
  const sign = (token: string) =>
    createHmac("sha256", options.sessionSecret).update(token).digest("hex");
  const cookie = (token: string) =>
    `app_session=${token}.${sign(token)}; HttpOnly; SameSite=Lax; Path=/${options.secureCookies === false ? "" : "; Secure"}`;
  app.decorateRequest("actor", null);
  await app.register(swagger, {
    openapi: {
      info: { title: "Monitoring workbench", version: "1.0.0" },
      components: {
        securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
      },
      security: [{ bearerAuth: [] }],
    },
  });
  await app.register(rateLimit, {
    global: true,
    max: options.rateLimitMax ?? 120,
    timeWindow: "1 minute",
    allowList: (request) => request.routeOptions.url === "/healthz",
  });
  app.setErrorHandler((error, request, reply) => {
    const failure = error as Error & { code?: string; statusCode?: number };
    const code = failure.code;
    const statusCode =
      failure.statusCode ??
      (code === "23505" || code === "23503"
        ? 409
        : code === "57014"
          ? 503
          : 500);
    const message =
      statusCode === 500 ? "Internal server error" : failure.message;
    reply.code(statusCode).send({ error: { message, requestId: request.id } });
  });
  app.addHook("onRequest", async (request) => {
    const route = request.routeOptions.url ?? request.url.split("?")[0],
      method = request.method;
    const publicRoute =
      (method === "GET" && ["/healthz", "/v1/auth/session"].includes(route)) ||
      (method === "POST" &&
        ["/v1/auth/login", "/v1/auth/register"].includes(route));
    let token: string | undefined,
      kind: "browser" | "machine" = "browser";
    if (request.headers.authorization) {
      kind = "machine";
      token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(
        request.headers.authorization,
      )?.[1];
      if (!token) fail(401, "Invalid bearer token");
    } else {
      const value = request.headers.cookie
        ?.split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith("app_session="))
        ?.slice(12);
      if (value && value.length < 256) {
        const [raw, signature] = value.split(".");
        const expected = sign(raw);
        if (
          signature?.length === expected.length &&
          timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
        )
          token = raw;
      }
    }
    request.actor = token ? await findActor(options.pool, token, kind) : null;
    if (!publicRoute && !request.actor) fail(401, "Authentication required");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(method) &&
      kind !== "machine" &&
      request.headers.origin !== origin
    )
      fail(403, "Same-origin request required");
    const actor = request.actor;
    if (!actor || publicRoute) return;
    if (
      actor.role === "viewer" &&
      !["GET", "HEAD"].includes(method) &&
      !route.startsWith("/v1/workspace/") &&
      route !== "/v1/auth/logout"
    )
      fail(403, "Administrator access required");
    if (actor.clientKind === "machine") {
      const scope =
        route === "/v1/content/export"
          ? "content:export"
          : route.endsWith("/ingest")
            ? "content:ingest"
            : route.endsWith("/collect")
              ? "collection:run"
              : route.startsWith("/v1/content")
                ? "content:read"
                : route.startsWith("/v1/sources")
                  ? method === "GET"
                    ? "sources:read"
                    : "sources:write"
                  : route.startsWith("/v1/projects")
                    ? method === "GET"
                      ? "projects:read"
                      : "projects:write"
                    : null;
      if (
        route.startsWith("/v1/access/") ||
        route.startsWith("/v1/workspace/") ||
        (!scope && !["/v1/capabilities", "/v1/openapi.json"].includes(route)) ||
        (scope && !actor.scopes.includes(scope))
      )
        fail(403, "API key scope does not permit this operation");
    }
  });
  app.get("/healthz", async () => ({ ok: true }));
  app.get("/readyz", async () => {
    await options.pool.query("SELECT 1");
    return { ok: true };
  });
  await accessRoutes(app, options.pool, cookie);
  await collectionRoutes(app, options.pool, providers);
  const shutdown = new AbortController();
  app.addHook("preClose", async () => {
    shutdown.abort();
  });
  await contentRoutes(app, options.pool, shutdown.signal);
  await projectRoutes(app, options.pool);
  await workspaceRoutes(app, options.pool);
  app.get("/v1/openapi.json", async () => app.swagger());
  app.get("/v1/capabilities", async () => ({
    providers: providers.map((provider) => provider.capability),
    operations: [
      "ingest",
      "radar",
      "search",
      "stream_export",
      "saved_queries",
      "annotations",
    ],
    maxIngestItems: 100,
    maxIngestBytes: 1048576,
    maxOnlineItems: 2000,
    threadAware: false,
    automaticHydration: false,
  }));
  return app;
}
