import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Pool } from "pg";
import type { Actor } from "../../packages/contracts/src/source-content";
import { buildApp } from "../../apps/api/src/app";
import { resolveRoutePolicy } from "../../apps/api/src/route-policy";
import { canonical } from "../../src/modules/content/batch";
import { compileContentFilter, decodeCursor } from "../../src/modules/content/search";
import { auditTableReadOwnership, auditTableWriteOwnership } from "../../scripts/check-table-ownership";
import { diversifyStories } from "../../src/modules/content/stories";

const origin = "https://invariants.example.test";
const sessionSecret = "route-auth-invariants-fixture-secret-key";

function makePrng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

test("INV-001: route policy blocks machine keys on all privileged/auth/workspace surfaces and enforces MFA on admin writes", () => {
  const blockedForMachine: Array<[string, string]> = [
    ["GET", "/v1/admin/ai/queue"],
    ["POST", "/v1/admin/ai/candidates/00000000-0000-0000-0000-000000000001/publish"],
    ["GET", "/v1/access/users"],
    ["PATCH", "/v1/access/users/00000000-0000-0000-0000-000000000001"],
    ["GET", "/v1/workspace/queries"],
    ["POST", "/v1/workspace/queries"],
    ["GET", "/v1/quotas/summary"],
    ["PUT", "/v1/quotas/plans/free"],
    ["GET", "/v1/sources/credentials"],
    ["PUT", "/v1/sources/credentials/kaix"],
    ["POST", "/v1/auth/login"],
    ["POST", "/v1/auth/mfa/step-up"],
  ];

  for (const [method, route] of blockedForMachine) {
    const policy = resolveRoutePolicy(method, route, {
      publicRead: true,
      accountEmailEnabled: true,
      mfaEnabled: true,
    });
    assert.equal(policy.machineAllowed, false, `${method} ${route} must reject machine keys`);
    assert.equal(policy.machineScope, null, `${method} ${route} must not assign a machine scope`);
  }

  for (const [method, route] of [
    ["POST", "/v1/admin/ai/events"],
    ["DELETE", "/v1/access/keys/:id"],
    ["PUT", "/v1/quotas/plans/:tier"],
    ["PUT", "/v1/sources/credentials/:provider"],
  ] as const) {
    const policy = resolveRoutePolicy(method, route, { mfaEnabled: true });
    assert.equal(policy.requiresRecentMfa, true, `${method} ${route} must require recent MFA`);
    assert.equal(policy.viewerAllowed, false, `${method} ${route} must reject viewer role`);
  }

  // Declarative config.auth overrides work without modifying app.ts route lists.
  const declarative = resolveRoutePolicy("POST", "/v1/custom/action", {
    declarative: { access: "admin_mfa", machineScope: null, browserOnly: true },
  });
  assert.equal(declarative.requiresRecentMfa, true);
  assert.equal(declarative.viewerAllowed, false);
  assert.equal(declarative.machineAllowed, false);
  assert.equal(declarative.browserOnlyAuthRoute, true);

  const declarativeAdminGet = resolveRoutePolicy("GET", "/v1/custom/admin-report", {
    declarative: { access: "admin", browserOnly: true },
  });
  assert.equal(declarativeAdminGet.viewerAllowed, false);
  assert.equal(declarativeAdminGet.machineAllowed, false);
});

test("INV-001: unauthenticated requests to protected routes are rejected before DB access", async (t) => {
  let dbCalls = 0;
  const pool = {
    async query() {
      dbCalls++;
      return { rows: [], rowCount: 0 };
    },
  } as unknown as Pool;

  const app = await buildApp({
    pool,
    origin,
    sessionSecret,
    publicRead: true,
    mfa: { key: Buffer.alloc(32, 9), required: true },
  });
  t.after(() => app.close());

  for (const [method, url] of [
    ["GET", "/v1/sources"],
    ["GET", "/v1/projects"],
    ["GET", "/v1/workspace/queries"],
    ["GET", "/v1/access/users"],
    ["GET", "/v1/admin/ai/queue"],
    ["GET", "/v1/quotas/summary"],
    ["GET", "/v1/sources/credentials"],
  ] as const) {
    const res = await app.inject({ method, url });
    assert.equal(res.statusCode, 401, `${method} ${url} must return 401 without credentials`);
  }
  assert.equal(dbCalls, 0, "Unauthenticated rejection must occur before querying PostgreSQL");
});

test("INV-008: table write-ownership audit rejects unauthorized cross-module writes", () => {
  const dir = mkdtempSync(join(tmpdir(), "table-ownership-"));
  try {
    mkdirSync(join(dir, "src", "modules", "access"), { recursive: true });
    mkdirSync(join(dir, "src", "modules", "billing"), { recursive: true });
    writeFileSync(
      join(dir, "src", "modules", "access", "sql.ts"),
      `export const q = "UPDATE app_session SET expires_at = NOW()";`,
    );
    writeFileSync(
      join(dir, "src", "modules", "billing", "sql.ts"),
      `export const q = "DELETE FROM app_session WHERE id = $1";`,
    );
    const result = auditTableWriteOwnership(dir);
    assert.ok(result.violations.length >= 1, "Expected cross-module write violation on app_session");
    assert.match(result.violations[0], /app_session/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Property invariants: decodeCursor, compileContentFilter, and canonical hold across randomized inputs", () => {
  const next = makePrng(20261122);
  const alphabet = "abcXYZ019_%\\'\"`;--[]() \t\n";
  const randomText = (maxLen: number) => {
    const len = 1 + Math.floor(next() * maxLen);
    let out = "";
    for (let i = 0; i < len; i++) out += alphabet[Math.floor(next() * alphabet.length)];
    return out;
  };

  // 1. decodeCursor rejects arbitrary malformed tokens and mismatched signatures cleanly (400/409/422).
  for (let i = 0; i < 60; i++) {
    const garbage = Buffer.from(randomText(40)).toString("base64url");
    assert.throws(() => decodeCursor(garbage, "sig-a"), (err: unknown) => {
      const status = (err as { statusCode?: number }).statusCode;
      return status === 400 || status === 409 || status === 422;
    });
  }
  const validCursor = Buffer.from(
    JSON.stringify({ signature: "sig-a", id: "00000000-0000-0000-0000-000000000001", time: null }),
  ).toString("base64url");
  assert.throws(() => decodeCursor(validCursor, "sig-b"), (err: unknown) => {
    return (err as { statusCode?: number; message?: string }).statusCode === 409;
  });

  // 2. compileContentFilter always parameterizes arbitrary search strings and intersects allowedSourceIds.
  const restrictedActor: Actor = {
    sessionId: "00000000-0000-0000-0000-000000000001",
    userId: "00000000-0000-0000-0000-000000000002",
    email: "scoped@example.test",
    role: "viewer",
    planTier: "free",
    clientKind: "machine",
    scopes: ["read"],
    allowedSourceIds: ["00000000-0000-0000-0000-000000000010"],
  };
  let compiledOk = 0;
  for (let i = 0; i < 60; i++) {
    const query = i % 2 === 0 ? `ai${randomText(20)}` : randomText(20);
    try {
      const compiled = compileContentFilter(restrictedActor, {
        query,
        sourceId: "00000000-0000-0000-0000-000000000099",
      });
      compiledOk++;
      assert.ok(!compiled.text.includes(";--"), "Raw SQL fragment must never be interpolated into SQL predicate");
      assert.ok(
        compiled.discovery.includes("00000000-0000-0000-0000-000000000010") ||
          compiled.values.some((v) => Array.isArray(v) && v.includes("00000000-0000-0000-0000-000000000010")),
        "Restricted actor allowedSourceIds must always be enforced in compiled query",
      );
    } catch (err) {
      assert.equal((err as { statusCode?: number }).statusCode, 422);
    }
  }
  assert.ok(compiledOk >= 25, `Expected >= 25 valid compiled filters, got ${compiledOk}`);

  // 3. canonical JSON serialization is deterministic regardless of object key order.
  for (let i = 0; i < 50; i++) {
    const a = { z: i, a: { b: randomText(8), a: [i, true, null] }, m: "ok" };
    const b = { m: "ok", a: { a: [i, true, null], b: a.a.b }, z: i };
    assert.equal(canonical(a), canonical(b));
    assert.equal(canonical(JSON.parse(canonical(a))), canonical(a));
  }
});

test("INV-008: table read-ownership audit rejects unauthorized cross-module reads while permitting contracted shared reads", () => {
  const dir = mkdtempSync(join(tmpdir(), "table-read-ownership-"));
  try {
    mkdirSync(join(dir, "src", "modules", "content"), { recursive: true });
    mkdirSync(join(dir, "src", "modules", "ai"), { recursive: true });
    writeFileSync(
      join(dir, "src", "modules", "content", "search.ts"),
      `export const q = "SELECT c.id FROM content c JOIN source s ON s.id=c.source_id JOIN collection_source cs ON cs.id=c.id";`,
    );
    const allowed = auditTableReadOwnership(dir);
    assert.deepEqual(allowed.violations, []);

    writeFileSync(
      join(dir, "src", "modules", "ai", "leak.ts"),
      `export const q = "SELECT id FROM content WHERE title IS NOT NULL";`,
    );
    const denied = auditTableReadOwnership(dir);
    assert.ok(denied.violations.length >= 1);
    assert.match(denied.violations[0], /content/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PERF: diversifyStories preserves sliding-window diversity and scales sub-quadratically to 5,000 items", () => {
  const mkItem = (idx: number, sid: string, tier: "T1" | "T1_5" | "T2" = "T1") => ({
    storyKey: `story-${idx}`,
    representative: {
      id: `00000000-0000-0000-0000-${String(idx).padStart(12, "0")}`,
      url: null,
      platform: "web" as const,
      sourceId: sid,
      title: `Story ${idx}`,
      author: null,
      publishedAt: "2026-11-20T00:00:00.000Z",
      tier,
      thumbnail: null,
      sourceLabel: sid,
      discoveredAt: "2026-11-20T00:00:00.000Z",
    },
    excerpt: null,
    related: [],
    relatedCount: 0,
    tierBreakdown: { T1: 1, T1_5: 0, T2: 0 },
    sparkline48h: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    sourceCount: 1,
    heat48h: 5000 - idx,
    change6h: null,
    trend: "new" as const,
    badges: [],
    updatedAt: "2026-11-20T00:00:00.000Z",
  });

  const small = [
    mkItem(1, "s1"),
    mkItem(2, "s1"),
    mkItem(3, "s1"),
    mkItem(4, "s2"),
    mkItem(5, "s3"),
    mkItem(6, "s4"),
  ];
  const ordered = diversifyStories(small, 2, 12);
  assert.equal(ordered.length, 6);
  // Third s1 item is pushed to wave 1 after s2, s3, s4 when enough sources exist.
  assert.equal(ordered[2].representative.sourceId, "s2");

  const large = Array.from({ length: 5000 }, (_, i) => mkItem(i, `src-${i % 40}`));
  const t0 = performance.now();
  const res = diversifyStories(large, 2, 12);
  const elapsedMs = performance.now() - t0;
  assert.equal(res.length, 5000);
  assert.ok(elapsedMs < 500, `Expected O(N log S) diversifyStories < 500ms, took ${elapsedMs.toFixed(1)}ms`);
});
