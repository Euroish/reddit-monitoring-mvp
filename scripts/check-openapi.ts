import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import type { Pool } from "pg";
import { buildApp } from "../apps/api/src/app";
import { resolveRoutePolicy } from "../apps/api/src/route-policy";

const stubPool = {
  query: async () => ({ rows: [], rowCount: 0 }),
  connect: async () => {
    throw new Error("Stub pool should not connect during OpenAPI contract verification");
  },
} as unknown as Pool;

const stubEmailProvider = {
  siteKey: "fixture-turnstile-site-key",
  verify: async () => false,
  send: async () => false,
};

function openApiToFastifyRoute(pathKey: string): string {
  return pathKey.replace(/\{([^}]+)\}/g, ":$1");
}

async function main(): Promise<void> {
  const app = await buildApp({
    pool: stubPool,
    origin: "http://127.0.0.1:3000",
    sessionSecret: "openapi-contract-verification-fixture-secret",
    providers: [],
    publicRead: true,
    publicRegistration: false,
    accountEmail: { provider: stubEmailProvider, publicRegistration: false },
    mfa: { key: Buffer.alloc(32, 7), required: true },
  });

  try {
    await app.ready();
    const spec = app.swagger() as {
      openapi?: string;
      info?: { title?: string };
      paths?: Record<string, Record<string, unknown>>;
    };

    assert.ok(spec.openapi?.startsWith("3."), `Expected OpenAPI 3.x spec, got ${spec.openapi}`);
    const paths = spec.paths ?? {};
    const routeKeys = Object.keys(paths).sort();
    assert.ok(routeKeys.length >= 20, `Expected >= 20 API routes in OpenAPI spec, got ${routeKeys.length}`);

    for (const requiredRoute of [
      "/healthz",
      "/readyz",
      "/v1/capabilities",
      "/v1/openapi.json",
      "/v1/content",
      "/v1/content/stories",
      "/v1/sources",
      "/v1/projects",
      "/v1/ai/events",
    ]) {
      assert.ok(routeKeys.includes(requiredRoute), `Missing expected route in OpenAPI spec: ${requiredRoute}`);
    }

    const summaryCounts = new Map<string, number>();
    let operationCount = 0;

    for (const [openApiPath, ops] of Object.entries(paths)) {
      const fastifyRoute = openApiToFastifyRoute(openApiPath);
      for (const methodKey of Object.keys(ops)) {
        const method = methodKey.toUpperCase();
        if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) continue;
        operationCount++;

        const policy = resolveRoutePolicy(method, fastifyRoute, {
          publicRead: true,
          accountEmailEnabled: true,
          mfaEnabled: true,
        });
        summaryCounts.set(policy.summaryClass, (summaryCounts.get(policy.summaryClass) ?? 0) + 1);

        // INV-001: /v1/content/* endpoints must never expose DELETE or write machine scopes.
        if (fastifyRoute.startsWith("/v1/content")) {
          assert.notEqual(method, "DELETE", `Unexpected DELETE method on content route ${fastifyRoute}`);
          if (method !== "GET" && fastifyRoute !== "/v1/content/export") {
            assert.equal(
              policy.machineAllowed,
              false,
              `Content mutation route ${method} ${fastifyRoute} must not be machine-accessible`,
            );
          }
        }

        // INV-001: Admin, access, auth, workspace, credentials, and quota routes must never allow machine keys.
        if (
          fastifyRoute.startsWith("/v1/admin/") ||
          fastifyRoute.startsWith("/v1/access/") ||
          fastifyRoute.startsWith("/v1/auth/") ||
          fastifyRoute.startsWith("/v1/workspace/") ||
          fastifyRoute.startsWith("/v1/quotas") ||
          fastifyRoute.startsWith("/v1/sources/credentials")
        ) {
          assert.equal(
            policy.machineAllowed,
            false,
            `Sensitive route ${method} ${fastifyRoute} must deny machine API keys`,
          );
        }

        // INV-001: Admin mutations under /v1/admin/, /v1/access/, /v1/quotas, /v1/sources/credentials must require MFA.
        if (
          ["POST", "PUT", "PATCH", "DELETE"].includes(method) &&
          (fastifyRoute.startsWith("/v1/admin/") ||
            fastifyRoute.startsWith("/v1/access/") ||
            fastifyRoute.startsWith("/v1/quotas") ||
            fastifyRoute.startsWith("/v1/sources/credentials"))
        ) {
          assert.equal(
            policy.requiresRecentMfa,
            true,
            `Privileged write ${method} ${fastifyRoute} must require recent MFA`,
          );
        }

        // INV-001: Mutating routes must never be classified as publicRead.
        if (method !== "GET") {
          assert.equal(
            policy.publicReadRoute,
            false,
            `Mutating route ${method} ${fastifyRoute} must never be public_read`,
          );
        }
      }
    }

    const summaryLines = [
      "### OpenAPI & Route Auth Contract Audit",
      "",
      `- **OpenAPI**: \`${spec.openapi}\` · \`${routeKeys.length}\` paths · \`${operationCount}\` operations verified (with email + MFA routes mounted)`,
      `- **Access breakdown**: ${[...summaryCounts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `\`${k}\`=${v}`).join(", ")}`,
    ];
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryLines.join("\n") + "\n");
    }
    console.log(
      `OpenAPI & route-auth contract check passed: ${spec.openapi}, ${routeKeys.length} paths (${operationCount} operations) verified.`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
