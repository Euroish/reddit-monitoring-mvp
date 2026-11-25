import { createHmac, timingSafeEqual } from "node:crypto";
import { BlockList, isIP } from "node:net";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import Fastify, { type FastifyRequest } from "fastify";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import type { Pool } from "pg";
import type { Actor } from "../../../packages/contracts/src/access";
import type { ContentProvider } from "../../../src/connectors/shared/content-provider.interface";
import {
  createLoginThrottle,
  emailRoutes,
  findActor,
  mfaRoutes,
  registerAccessModule,
  requireRecentMfa,
  type AccountEmailProvider,
} from "../../../src/modules/access/index";
import {
  createAiCredentialVault,
  registerAiModule,
  type AiCredentialVault,
} from "../../../src/modules/ai/index";
import {
  allSourcesExist,
  assertBrowserExportAllowed,
  contentVisibility,
  createCredentialVault,
  credentialRoutes,
  jobRoutes,
  policyRoutes,
  refreshRoutes,
  registerCollectionModule,
  readCollectionWorkerHealth,
  type CredentialLookupName,
  type CredentialVault,
} from "../../../src/modules/collection/index";
import { registerContentModule } from "../../../src/modules/content/index";
import { registerDocsModule } from "../../../src/modules/docs/index";
import { registerFeedModule } from "../../../src/modules/feed/index";
import { registerIntelligenceModule } from "../../../src/modules/intelligence/index";
import {
  assertProjectWritable,
  listProjectBatchIds,
  registerProjectsModule,
  removeBatchFromAllProjectsInTx,
  resolveProjectScope,
} from "../../../src/modules/projects/index";
import { registerWorkspaceModule } from "../../../src/modules/workspace/index";
import type { DeclarativeRouteAuth } from "../../../src/platform/route-auth";
import { fail } from "../../../src/shared/errors";
import { resolveRoutePolicy } from "./route-policy";

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

function mapErrorStatus(code?: string, statusCode?: number) {
  if (code === "FST_ERR_HANDLER_TIMEOUT") return 503;
  if (statusCode !== undefined) return statusCode;
  if (code === "23505" || code === "23503") return 409;
  if (["57014", "55P03", "53300", "08006", "57P01"].includes(code ?? "")) return 503;
  return 500;
}

function extractRequestToken(
  request: FastifyRequest,
  sign: (token: string) => string,
): { token?: string; kind: "browser" | "machine" } {
  if (request.headers.authorization !== undefined) {
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization)?.[1];
    if (!token) fail(401, "Invalid bearer token");
    return { token, kind: "machine" };
  }
  const value = request.headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("app_session="))
    ?.slice(12);
  const signed = value && /^([A-Za-z0-9_-]{43})\.([a-f0-9]{64})$/.exec(value);
  const valid = signed && timingSafeEqual(Buffer.from(signed[2], "hex"), Buffer.from(sign(signed[1]), "hex"));
  return { token: valid ? signed[1] : undefined, kind: "browser" };
}

async function authorizeAuthenticatedRequest(
  request: FastifyRequest,
  policy: ReturnType<typeof resolveRoutePolicy>,
  options: { pool: Pool; mfa?: { key: Buffer; required: boolean } },
) {
  const actor = request.actor;
  if (!actor || policy.publicRoute) return;
  if (actor.role === "viewer" && !policy.viewerAllowed) fail(403, "Administrator access required");
  if (actor.clientKind === "browser" && actor.role !== "viewer" && policy.requiresRecentMfa) {
    await requireRecentMfa(options.pool, actor, Boolean(options.mfa?.required));
  }
  if (actor.clientKind === "machine") {
    if (!policy.machineAllowed || (policy.machineScope && !actor.scopes.includes(policy.machineScope))) {
      fail(403, "API key scope does not permit this operation");
    }
  }
}

export async function buildApp(options: {
  pool: Pool;
  sessionSecret: string;
  origin: string;
  secureCookies?: boolean;
  providers?: ContentProvider[];
  credentialVault?: CredentialVault;
  aiCredentialVault?: AiCredentialVault;
  logger?: boolean;
  rateLimitMax?: number;
  trustedProxyAddress?: string;
  publicRead?: boolean;
  publicRegistration?: boolean;
  accountEmail?: { provider: AccountEmailProvider; publicRegistration: boolean };
  mfa?: { key: Buffer; required: boolean };
  strongerPasswords?: boolean;
  authThrottleKey?: string;
  onRouteAuth?: (method: string, url: string, auth: DeclarativeRouteAuth) => void;
}) {
  if (options.sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must have at least 32 characters");
  }
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
    // Request reception is bounded separately; do not reset an active handler's socket.
    connectionTimeout: 0,
    bodyLimit: 16 * 1024 * 1024,
    trustProxy: proxyAddress
      ? (address, hop) => hop === 0 && proxies.check(address, isIP(address) === 6 ? "ipv6" : "ipv4")
      : false,
    logger: options.logger
      ? {
          serializers: { req: (request) => ({ method: request.method, route: request.routeOptions?.url }) },
          redact: ["req.headers.authorization", "req.headers.cookie", "res.headers.set-cookie"],
        }
      : false,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: "array" } },
  });
  const bodyValidator = addFormats(new Ajv({ coerceTypes: false, removeAdditional: false, strict: false }));
  const queryValidator = addFormats(new Ajv({ coerceTypes: "array", removeAdditional: false, strict: false }));
  app.setValidatorCompiler(({ schema, httpPart }) =>
    (httpPart === "body" ? bodyValidator : queryValidator).compile(schema),
  );
  const providers = options.providers ?? [];
  const sign = (token: string) => createHmac("sha256", options.sessionSecret).update(token).digest("hex");
  const cookie = (token: string, maxAge?: number) =>
    `app_session=${token}.${sign(token)}; HttpOnly; SameSite=Lax; Path=/${options.secureCookies === false ? "" : "; Secure"}${maxAge === undefined ? "" : `; Max-Age=${maxAge}`}`;

  app.decorateRequest("actor", null);
  await app.register(swagger, {
    openapi: {
      info: { title: "Monitoring workbench", version: "1.0.0" },
      components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } },
      security: [{ bearerAuth: [] }],
    },
  });
  app.addHook("onRoute", (route) => {
    route.schema ??= {};
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    route.schema.operationId ??= `${methods[0]}_${route.url.replace(/[^a-zA-Z0-9]/g, "_")}`;
    const auth = route.config?.auth;
    if (!auth) throw new Error(`Route ${methods.join(",")} ${route.url} must declare config.auth`);
    for (const m of methods) options.onRouteAuth?.(m.toUpperCase(), route.url, auth);
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
    const statusCode = mapErrorStatus(failure.code, failure.statusCode);
    if (statusCode === 503) reply.header("Retry-After", 1);
    const message =
      statusCode === 500
        ? "Internal server error"
        : failure.statusCode !== undefined && failure.code !== "FST_ERR_HANDLER_TIMEOUT"
          ? failure.message
          : statusCode === 409
            ? "Resource conflict"
            : "Temporarily unavailable";
    reply.code(statusCode).send({
      error: {
        code: message === "cursor_scope_changed" ? message : statusCode === 503 ? "temporarily_unavailable" : `http_${statusCode}`,
        message,
        requestId: request.id,
        retryable: statusCode === 503,
      },
    });
  });

  app.addHook("preParsing", async (request) => {
    const matchedUrl = request.routeOptions?.url;
    const declarative = request.routeOptions?.config?.auth;
    if (matchedUrl && !declarative) fail(500, "Route missing declarative auth policy");
    const route = matchedUrl ?? request.url.split("?")[0];
    const method = request.method;
    const policy = resolveRoutePolicy(method, route, {
      publicRead: Boolean(options.publicRead),
      accountEmailEnabled: Boolean(options.accountEmail),
      mfaEnabled: Boolean(options.mfa),
      declarative,
    });
    if (policy.browserOnlyAuthRoute && request.headers.authorization !== undefined) {
      fail(403, "Browser session required");
    }
    if (
      method !== "GET" &&
      method !== "HEAD" &&
      method !== "OPTIONS" &&
      request.headers.authorization === undefined &&
      request.headers.origin !== origin
    ) {
      fail(403, "Same-origin request required");
    }
    if (policy.credentialSubmission) {
      const contentType = request.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase();
      if (contentType !== "application/json") fail(415, "Expected application/json");
      return;
    }
    const { token, kind } = extractRequestToken(request, sign);
    request.actor = token ? await findActor(options.pool, token, kind, options.mfa?.required) : null;
    if (!request.actor && policy.publicReadRoute && !request.headers.authorization) {
      request.actor = PUBLIC_GUEST_ACTOR;
    }
    if (!policy.publicRoute && !request.actor) fail(401, "Authentication required");
    await authorizeAuthenticatedRequest(request, policy, options);
  });

  app.get("/healthz", { config: { auth: { access: "public" } } }, async () => ({ ok: true }));
  app.get("/readyz", { config: { auth: { access: "public" } } }, async () => {
    await options.pool.query("SELECT 1");
    return { ok: true };
  });

  await registerAccessModule(app, options.pool, cookie, {
    publicRead: Boolean(options.publicRead),
    publicRegistration: Boolean(options.publicRegistration),
    strongerPasswords: options.strongerPasswords,
    accountEmail: options.accountEmail,
    mfa: options.mfa,
    limitLogin: createLoginThrottle(options.authThrottleKey ?? options.sessionSecret),
    validateSourceIds: allSourcesExist,
  });
  if (options.accountEmail) {
    await emailRoutes(app, options.pool, options.accountEmail.provider, {
      publicRegistration: options.accountEmail.publicRegistration,
      strongerPasswords: options.strongerPasswords,
    });
  }
  if (options.mfa) await mfaRoutes(app, options.pool, options.mfa.key, cookie);

  const vault = options.credentialVault ?? createCredentialVault(options.pool, options.sessionSecret);
  await credentialRoutes(app, vault);
  await policyRoutes(app, options.pool, providers);
  const credentialed = new Set(["kaix", "red_crawler", "twitterapis", "scrapebadger"]);
  const getCredentialState = (providerName: string): "ok" | "missing" | "network_disabled" => {
    const matched = providers.find((item) => item.capability.provider === providerName);
    if (matched?.capability.enabled) return "ok";
    if (
      credentialed.has(providerName) &&
      !vault.getSecret(providerName as CredentialLookupName) &&
      (process.env.SOURCE_NETWORK_ENABLED === "true" || providers.some((item) => item.capability.enabled))
    ) {
      return "missing";
    }
    return "network_disabled";
  };
  await registerCollectionModule(app, options.pool, providers, assertProjectWritable, listProjectBatchIds, {
    onBatchDiscarded: removeBatchFromAllProjectsInTx,
    getCredentialState,
  });
  await refreshRoutes(app, options.pool, providers);
  await jobRoutes(app, options.pool, listProjectBatchIds);

  const shutdown = new AbortController();
  app.addHook("preClose", async () => {
    shutdown.abort();
  });
  await registerContentModule(app, options.pool, shutdown.signal,
    actor => assertBrowserExportAllowed(options.pool, actor), resolveProjectScope, contentVisibility);
  await registerDocsModule(app, options.pool);
  const aiVault = options.aiCredentialVault ?? createAiCredentialVault(options.pool, options.sessionSecret);
  await registerAiModule(app, options.pool, readCollectionWorkerHealth, aiVault);
  await registerProjectsModule(app, options.pool, providers);
  await registerWorkspaceModule(app, options.pool, contentVisibility);
  await registerFeedModule(app, options.pool, contentVisibility);
  await registerIntelligenceModule(app, options.pool, providers, assertProjectWritable);

  app.get(
    "/v1/openapi.json",
    { config: { auth: { access: "authenticated", machineOpen: true } } },
    async () => app.swagger(),
  );
  app.get(
    "/v1/capabilities",
    { config: { auth: { access: "authenticated", machineOpen: true } } },
    async () => ({
      providers: providers.map((provider) => provider.capability),
      operations: [
        "ingest", "radar", "hydrate", "refresh_by_ids", "source_preview",
        "thread", "search", "content_facets", "stories", "story_heat",
        "daily_digest", "stream_export", "saved_queries", "annotations",
        "feed_stream", "feed_hot", "feed_events", "intel_monitors", "intel_authors", "intel_communities",
      ],
      maxIngestItems: 100,
      maxIngestBytes: 1048576,
      maxOnlineItems: 2000,
      threadAware: true,
      automaticHydration: false,
    }),
  );
  return app;
}
