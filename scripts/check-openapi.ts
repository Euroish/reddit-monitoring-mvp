import assert from "node:assert/strict";
import type { Pool } from "pg";
import { buildApp } from "../apps/api/src/app";

const stubPool = {
  query: async () => ({ rows: [], rowCount: 0 }),
  connect: async () => {
    throw new Error("Stub pool should not connect during OpenAPI contract verification");
  },
} as unknown as Pool;

async function main(): Promise<void> {
  const app = await buildApp({
    pool: stubPool,
    origin: "http://127.0.0.1:3000",
    sessionSecret: "openapi-contract-verification-fixture-secret",
    providers: [],
    publicRead: true,
    publicRegistration: false,
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
    ]) {
      assert.ok(routeKeys.includes(requiredRoute), `Missing expected route in OpenAPI spec: ${requiredRoute}`);
    }

    // Security invariant: /v1/content/* endpoints registered on the public read plane must not silently expose DELETE.
    for (const [route, ops] of Object.entries(paths)) {
      if (route.startsWith("/v1/content")) {
        const methods = Object.keys(ops).map((m) => m.toUpperCase());
        assert.equal(
          methods.includes("DELETE"),
          false,
          `Unexpected DELETE method on content route ${route}`,
        );
      }
    }

    console.log(`OpenAPI contract check passed: ${spec.openapi}, ${routeKeys.length} registered paths verified.`);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
