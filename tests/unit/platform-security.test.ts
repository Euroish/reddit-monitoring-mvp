import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { buildApp } from "../../apps/api/src/app";
import { createLoginThrottle } from "../../src/modules/access/login-throttle";
import { hashPassword, verifyPassword } from "../../src/modules/access/password";

const origin = "https://security.example.test";
const sessionSecret = "security-fixture-session-secret-only";
const login = { email: "viewer@example.test", password: "fixture-password" };
const machine = "Bearer " + "a".repeat(43);

test("auth validates browser identity, origin, payload size and cookie format before DB access", async (t) => {
  let queries = 0;
  const pool = { async query() { queries++; throw new Error("unexpected DB query"); } } as unknown as Pool;
  const app = await buildApp({ pool, origin, sessionSecret });
  t.after(() => app.close());
  const bad = await app.inject({ method: "POST", url: "/v1/auth/login", headers: { authorization: machine }, payload: login });
  assert.equal(bad.statusCode, 403);
  assert.equal(bad.headers["cache-control"], "no-store");
  assert.equal((await app.inject({ method: "POST", url: "/v1/auth/login", payload: login })).statusCode, 403);
  assert.equal((await app.inject({ method: "POST", url: "/v1/auth/login", headers: { origin }, payload: "test" })).statusCode, 415);
  assert.equal((await app.inject({ method: "POST", url: "/v1/auth/login", headers: { origin }, payload: { ...login, password: "a".repeat(8192) } })).statusCode, 413);
  const cookie = "app_session=" + "a".repeat(43) + "." + "é".repeat(64);
  const logout = await app.inject({ method: "POST", url: "/v1/auth/logout", headers: { origin, cookie } });
  assert.equal(logout.statusCode, 200);
  assert.match(String(logout.headers["set-cookie"]), /HttpOnly; SameSite=Lax; Path=\/; Secure; Max-Age=0/);
  assert.equal((await app.inject({ method: "POST", url: "/v1/auth/register", headers: { origin }, payload: login })).statusCode, 403);
  assert.equal(queries, 0);
});

test("proxy trust is tied to the direct Caddy address and AI authorization responses are private", async (t) => {
  const pool = { async query() { return { rows: [] }; } } as unknown as Pool;
  const app = await buildApp({ pool, origin, sessionSecret, publicRead: true, trustedProxyAddress: "10.0.0.2", rateLimitMax: 1 });
  t.after(() => app.close());
  const get = (ip: string, forwarded: string) => app.inject({
    method: "GET", url: "/v1/ai/events", remoteAddress: ip, headers: { "x-forwarded-for": forwarded },
  });
  const publicRead = await get("10.0.0.2", "198.51.100.1");
  assert.equal(publicRead.statusCode, 200);
  assert.equal(publicRead.headers["cache-control"], "no-store");
  assert.equal((await get("::ffff:10.0.0.2", "2001:db8::2")).statusCode, 200);
  assert.equal((await get("10.0.0.2", "203.0.113.9, 198.51.100.1")).statusCode, 429);
  assert.equal((await get("10.0.0.3", "198.51.100.3")).statusCode, 200);
  assert.equal((await get("10.0.0.3", "198.51.100.4")).statusCode, 429);
  const admin = await app.inject({ method: "GET", url: "/v1/admin/ai/history/status", remoteAddress: "10.0.0.5" });
  assert.equal(admin.statusCode, 401);
  assert.equal(admin.headers["cache-control"], "no-store");
});

test("both scrypt generations verify and extra concurrent work is rejected", async () => {
  const legacy = await hashPassword(login.password);
  const stronger = await hashPassword(login.password, true);
  assert.match(stronger, /^scrypt:v2:32768:8:3:/);
  assert.equal(await verifyPassword(login.password, legacy), true);
  assert.equal(await verifyPassword(login.password, stronger.replace(":32768:", ":262144:")), false);
  const first = verifyPassword(login.password, stronger);
  const second = verifyPassword("incorrect", stronger);
  await assert.rejects(hashPassword(login.password), { statusCode: 503 });
  assert.deepEqual(await Promise.all([first, second]), [true, false]);
});

test("account limiter keeps account budgets independent and bounds new-account state", () => {
  const limit = createLoginThrottle(sessionSecret);
  for (let i = 0; i < 10; i++) assert.equal(limit(login.email), 0);
  assert.ok(limit(login.email) > 0);
  for (let i = 0; i < 4095; i++) assert.equal(limit(i + "@example.test"), 0);
  assert.ok(limit("additional@example.test") > 0);
  assert.ok(limit(login.email) > 0);
});
