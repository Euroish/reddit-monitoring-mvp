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
import { jobRoutes } from "../../../src/modules/collection/jobs";
import { refreshRoutes } from "../../../src/modules/collection/refresh";
import { collectionRoutes } from "../../../src/modules/collection/routes";
import {
  createCredentialVault,
  credentialRoutes,
  type CredentialVault,
} from "../../../src/modules/collection/credentials";
import { policyRoutes } from "../../../src/modules/collection/policy";
import { contentRoutes } from "../../../src/modules/content/routes";
import { docsRoutes } from "../../../src/modules/content/docs";
import { workspaceRoutes } from "../../../src/modules/workspace/routes";
import { projectRoutes } from "../../../src/modules/projects/routes";
import { fail } from "../../../src/storage/db";

declare module "fastify" {
  interface FastifyRequest {
    actor: Actor | null;
  }
}
const PUBLIC_GUEST_ACTOR: Actor = {
  sessionId: "00000000-0000-0000-0000-000000000000",
  userId: "00000000-0000-0000-0000-000000000000",
  email: "",
  role: "viewer",
  planTier: "free",
  clientKind: "browser",
  scopes: ["read"],
  allowedSourceIds: null,
};
const DOC_READ_ROUTES = [
  "/v1/docs",
  "/v1/docs/:slug",
  "/v1/docs/:slug/file",
];
const PUBLIC_READ_ROUTES = new Set([
  "/v1/public/sources",
  "/v1/content/stories",
  "/v1/content",
  "/v1/content/feed",
  "/v1/content/facets",
  "/v1/content/:id",
  "/v1/content/:id/thread",
  ...DOC_READ_ROUTES,
]);
export async function buildApp(options: {
  pool: Pool;
  sessionSecret: string;
  origin: string;
  secureCookies?: boolean;
  providers?: ContentProvider[];
  credentialVault?: CredentialVault;
  logger?: boolean;
  rateLimitMax?: number;
  trustProxy?: false | 1;
  publicRead?: boolean;
  publicRegistration?: boolean;
}) {
  if (options.sessionSecret.length < 32)
    throw new Error("SESSION_SECRET must have at least 32 characters");
  const origin = new URL(options.origin).origin;
  const app = Fastify({
    forceCloseConnections: "idle",
    keepAliveTimeout: 5000,
    requestTimeout: 30_000,
    connectionTimeout: 10_000,
    bodyLimit: 16 * 1024 * 1024,
    trustProxy: options.trustProxy === 1 ? (_address, hop) => hop < 1 : false,
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
  app.addHook("onRoute", (route) => {
    route.schema ??= {};
    route.schema.operationId ??= `${Array.isArray(route.method) ? route.method[0] : route.method}_${route.url.replace(/[^a-zA-Z0-9]/g, "_")}`;
  });
  await app.register(rateLimit, {
    hook: "onRequest",
    global: true,
    max: options.rateLimitMax ?? 120,
    timeWindow: "1 minute",
    allowList: (request) => request.routeOptions?.url === "/healthz",
  });
  app.setErrorHandler((error, request, reply) => {
    const failure = error as Error & { code?: string; statusCode?: number };
    const code = failure.code;
    const statusCode =
      failure.statusCode ??
      (code === "23505" || code === "23503"
        ? 409
        : ["57014", "55P03", "53300", "08006", "57P01"].includes(code ?? "")
          ? 503
          : 500);
    const message =
      statusCode === 500 ? "Internal server error" : failure.message;
    reply.code(statusCode).send({
      error: {
        code:
          message === "cursor_scope_changed" ? message :
            statusCode === 503 ? "temporarily_unavailable" : `http_${statusCode}`,
        message,
        requestId: request.id,
        retryable: statusCode === 503,
      },
    });
  });
  app.addHook("preParsing", async (request) => {
    const route = request.routeOptions.url ?? request.url.split("?")[0],
      method = request.method;
    const publicRoute =
      (["GET", "HEAD"].includes(method) &&
        ["/healthz", "/readyz", "/v1/auth/session"].includes(route)) ||
      (method === "POST" &&
        ["/v1/auth/login", "/v1/auth/register"].includes(route));
    const publicReadRoute =
      Boolean(options.publicRead) &&
      ["GET", "HEAD"].includes(method) &&
      PUBLIC_READ_ROUTES.has(route);
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
    if (!request.actor && publicReadRoute && !request.headers.authorization)
      request.actor = PUBLIC_GUEST_ACTOR;
    if (!publicRoute && !request.actor) fail(401, "Authentication required");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(method) &&
      kind !== "machine" &&
      request.headers.origin !== origin
    )
      fail(403, "Same-origin request required");
    const actor = request.actor;
    if (!actor || publicRoute) return;
    const viewerAllowedPost =
      method === "POST" &&
      [
        "/v1/auth/logout",
        "/v1/sources/:id/collect",
        "/v1/sources/:id/refresh",
        "/v1/projects/:id/hydrate",
        "/v1/source-jobs/:id/cancel",
        "/v1/source-jobs/:id/retry",
        "/v1/source-jobs/:id/continue",
      ].includes(route);
    if (
      actor.role === "viewer" &&
      !["GET", "HEAD"].includes(method) &&
      !route.startsWith("/v1/workspace/") &&
      !viewerAllowedPost
    )
      fail(403, "Administrator access required");
    if (actor.clientKind === "machine") {
      const isRead = ["GET", "HEAD"].includes(method);
      const scope =
        route === "/v1/content/export"
          ? "export"
          : route.endsWith("/ingest")
            ? "ingest"
            : (route.endsWith("/collect") || route.endsWith("/hydrate") || route === "/v1/sources/:id/refresh")
              ? "collect"
              : route.startsWith("/v1/source-jobs")
                ? ["GET", "HEAD"].includes(method)
                  ? "read"
                  : "collect"
                : route.endsWith("/unblock")
                  ? "collect"
                  : route.startsWith("/v1/content") || DOC_READ_ROUTES.includes(route)
                    ? isRead
                      ? "read"
                      : null
                    : route === "/v1/public/sources"
                      ? ["GET", "HEAD"].includes(method)
                        ? "read"
                        : null
                      : route.startsWith("/v1/sources")
                      ? ["GET", "HEAD"].includes(method)
                        ? "read"
                        : "sources:write"
                      : route.startsWith("/v1/projects")
                        ? ["GET", "HEAD"].includes(method)
                          ? "read"
                          : "projects:write"
                        : null;
      if (
        route.startsWith("/v1/access/") ||
        route.startsWith("/v1/workspace/") ||
        route.startsWith("/v1/sources/credentials") ||
        route.startsWith("/v1/quotas") ||
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
  await accessRoutes(app, options.pool, cookie, {
    publicRead: Boolean(options.publicRead),
    publicRegistration: Boolean(options.publicRegistration),
  });
  const vault =
    options.credentialVault ??
    createCredentialVault(options.pool, options.sessionSecret);
  await credentialRoutes(app, vault);
  await policyRoutes(app, options.pool, providers);
  await collectionRoutes(app, options.pool, providers);
  await refreshRoutes(app, options.pool, providers);
  await jobRoutes(app, options.pool);
  const shutdown = new AbortController();
  app.addHook("preClose", async () => {
    shutdown.abort();
  });
  await contentRoutes(app, options.pool, shutdown.signal);
  await docsRoutes(app, options.pool);
  await projectRoutes(app, options.pool, providers);
  await workspaceRoutes(app, options.pool);
  app.get("/v1/openapi.json", async () => app.swagger());
  app.get("/v1/capabilities", async () => ({
    providers: providers.map((provider) => provider.capability),
    operations: [
      "ingest",
      "radar",
      "hydrate",
      "refresh_by_ids",
      "source_preview",
      "thread",
      "search",
      "content_facets",
      "stories",
      "story_heat",
      "daily_digest",
      "stream_export",
      "saved_queries",
      "annotations",
    ],
    maxIngestItems: 100,
    maxIngestBytes: 1048576,
    maxOnlineItems: 2000,
    threadAware: true,
    automaticHydration: false,
  }));
  return app;
}
