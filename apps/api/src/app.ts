import { createHmac, timingSafeEqual } from "node:crypto";
import { BlockList, isIP } from "node:net";
import Fastify from "fastify";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import swagger from "@fastify/swagger";
import rateLimit from "@fastify/rate-limit";
import type { Pool } from "pg";
import type { Actor } from "../../../packages/contracts/src/source-content";
import type { ContentProvider } from "../../../src/connectors/shared/content-provider.interface";
import { findActor } from "../../../src/modules/access/sql";
import { createLoginThrottle } from "../../../src/modules/access/login-throttle";
import { accessRoutes } from "../../../src/modules/access/routes";
import type { AccountEmailProvider } from "../../../src/modules/access/email-provider";
import { emailRoutes } from "../../../src/modules/access/email-routes";
import { mfaRoutes } from "../../../src/modules/access/mfa-routes";
import { requireRecentMfa } from "../../../src/modules/access/mfa-sql";
import { resolveRoutePolicy } from "./route-policy";
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
import { aiRoutes } from "../../../src/modules/ai/index";
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
export async function buildApp(options: {
  pool: Pool;
  sessionSecret: string;
  origin: string;
  secureCookies?: boolean;
  providers?: ContentProvider[];
  credentialVault?: CredentialVault;
  logger?: boolean;
  rateLimitMax?: number;
  trustedProxyAddress?: string;
  publicRead?: boolean;
  publicRegistration?: boolean;
  accountEmail?: { provider: AccountEmailProvider; publicRegistration: boolean };
  mfa?: { key: Buffer; required: boolean };
  strongerPasswords?: boolean;
  authThrottleKey?: string;
}) {
  if (options.sessionSecret.length < 32)
    throw new Error("SESSION_SECRET must have at least 32 characters");
  const origin = new URL(options.origin).origin;
  const proxyAddress = options.trustedProxyAddress;
  const proxies = new BlockList();
  if (proxyAddress) {
    const family = isIP(proxyAddress);
    if (!family) throw new Error("TRUST_PROXY_ADDRESS must be a single IP address");
    proxies.addAddress(proxyAddress, family === 6 ? "ipv6" : "ipv4");
  }
  const app = Fastify({
    forceCloseConnections: "idle",
    keepAliveTimeout: 5000,
    requestTimeout: 30_000,
    connectionTimeout: 10_000,
    bodyLimit: 16 * 1024 * 1024,
    trustProxy: proxyAddress
      ? (address, hop) => hop === 0 && proxies.check(address, isIP(address) === 6 ? "ipv6" : "ipv4")
      : false,
    logger: options.logger
      ? {
          serializers: {
            req: (request) => ({ method: request.method, route: request.routeOptions?.url }),
          },
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
  const cookie = (token: string, maxAge?: number) =>
    `app_session=${token}.${sign(token)}; HttpOnly; SameSite=Lax; Path=/${options.secureCookies === false ? "" : "; Secure"}${maxAge === undefined ? "" : `; Max-Age=${maxAge}`}`;
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
  app.addHook("onRequest", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
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
    if (statusCode === 503) reply.header("Retry-After", 1);
    const message = statusCode === 500 ? "Internal server error"
      : failure.statusCode !== undefined ? failure.message
      : statusCode === 409 ? "Resource conflict" : "Temporarily unavailable";
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
    const route = request.routeOptions.url ?? request.url.split("?")[0];
    const method = request.method;
    const policy = resolveRoutePolicy(method, route, {
      publicRead: Boolean(options.publicRead),
      accountEmailEnabled: Boolean(options.accountEmail),
      mfaEnabled: Boolean(options.mfa),
      declarative: request.routeOptions.config?.auth,
    });
    if (policy.browserOnlyAuthRoute && request.headers.authorization !== undefined)
      fail(403, "Browser session required");
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS" &&
      request.headers.authorization === undefined && request.headers.origin !== origin)
      fail(403, "Same-origin request required");
    if (policy.credentialSubmission) {
      const contentType = request.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase();
      if (contentType !== "application/json") fail(415, "Expected application/json");
      return;
    }
    let token: string | undefined;
    let kind: "browser" | "machine" = "browser";
    if (request.headers.authorization !== undefined) {
      kind = "machine";
      token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization)?.[1];
      if (!token) fail(401, "Invalid bearer token");
    } else {
      const value = request.headers.cookie
        ?.split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith("app_session="))
        ?.slice(12);
      const signed = value && /^([A-Za-z0-9_-]{43})\.([a-f0-9]{64})$/.exec(value);
      if (signed && timingSafeEqual(Buffer.from(signed[2], "hex"), Buffer.from(sign(signed[1]), "hex")))
        token = signed[1];
    }
    request.actor = token ? await findActor(options.pool, token, kind, options.mfa?.required) : null;
    if (!request.actor && policy.publicReadRoute && !request.headers.authorization)
      request.actor = PUBLIC_GUEST_ACTOR;
    if (!policy.publicRoute && !request.actor) fail(401, "Authentication required");
    const actor = request.actor;
    if (!actor || policy.publicRoute) return;
    if (actor.role === "viewer" && !policy.viewerAllowed)
      fail(403, "Administrator access required");
    if (actor.clientKind === "browser" && actor.role !== "viewer" && policy.requiresRecentMfa)
      await requireRecentMfa(options.pool, actor, Boolean(options.mfa?.required));
    if (actor.clientKind === "machine") {
      if (!policy.machineAllowed || (policy.machineScope && !actor.scopes.includes(policy.machineScope)))
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
    strongerPasswords: options.strongerPasswords,
    accountEmail: options.accountEmail,
    mfa: options.mfa,
    limitLogin: createLoginThrottle(options.authThrottleKey ?? options.sessionSecret),
  });
  if (options.accountEmail) await emailRoutes(app, options.pool, options.accountEmail.provider, {
    publicRegistration: options.accountEmail.publicRegistration,
    strongerPasswords: options.strongerPasswords,
  });
  if (options.mfa) await mfaRoutes(app, options.pool, options.mfa.key, cookie);
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
  await aiRoutes(app, options.pool);
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
