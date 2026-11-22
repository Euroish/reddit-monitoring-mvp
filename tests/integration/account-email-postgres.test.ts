import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../../apps/api/src/app";
import { bootstrapOwner } from "../../src/modules/access/sql";
import { testDatabase } from "../helpers/database";

const origin = "https://accounts.example.test";
const secret = "fixture-account-email-session-secret";
const initialPassword = "a-long-unique-initial-password";
const nextPassword = "another-long-unique-test-password";

test("PG16 email ownership, password reset, invitation binding, and atomic challenge consumption", async (t) => {
  const db = await testDatabase();
  t.after(db.close);
  await bootstrapOwner(db.pool, initialPassword, "owner@example.test");
  const sent = new Map<string, { token: string; purpose: string }>();
  const app = await buildApp({
    pool: db.pool, sessionSecret: secret, origin, publicRead: true,
    accountEmail: {
      publicRegistration: false,
      provider: {
        siteKey: "fixture-site-key",
        verify: async (proof, purpose) => proof === "fixture-" + purpose,
        send: async (email, purpose, token) => { sent.set(email, { token, purpose }); return true; },
      },
    },
  });
  t.after(() => app.close());
  const post = (url: string, payload: object, cookie?: string, remoteAddress?: string) =>
    app.inject({ method: "POST", url, payload, headers: { origin, ...(cookie ? { cookie } : {}) }, remoteAddress });
  const login = (email: string, password: string) => post("/v1/auth/login", { email, password });
  const owner = await login("owner@example.test", initialPassword);
  assert.equal(owner.statusCode, 200);
  const ownerCookie = String(owner.headers["set-cookie"]).split(";")[0];
  const email = "viewer@example.test";
  const invite = await post("/v1/access/invites", { role: "viewer", email }, ownerCookie);
  assert.equal(invite.statusCode, 200);
  const invitations = await app.inject({ url: "/v1/access/invites", headers: { cookie: ownerCookie } });
  assert.equal(invitations.statusCode, 200);
  assert.equal(invitations.json().invites[0].emailBound, true);
  assert.equal(invitations.json().invites[0].status, "active");
  assert.equal(invitations.body.includes(email), false);
  const code = invite.json().code;
  const start = (recipient: string, proof = "fixture-register") =>
    post("/v1/auth/email/register/start", { email: recipient, invite: code, proof });
  assert.equal((await start(email, "bad")).statusCode, 422);
  assert.deepEqual((await start("other@example.test")).json(), { accepted: true });
  assert.equal(sent.size, 0);
  assert.equal((await post("/v1/auth/register", { email, password: initialPassword, invite: code })).statusCode, 403);
  assert.deepEqual((await start(email)).json(), { accepted: true });
  assert.equal((await db.pool.query("SELECT 1 FROM app_user WHERE email=$1", [email])).rowCount, 0);
  const registration = sent.get(email)!;
  assert.equal(registration.purpose, "register");
  const stored = await db.pool.query("SELECT token_hash FROM app_auth_challenge WHERE email=$1", [email]);
  assert.match(stored.rows[0].token_hash, /^[a-f0-9]{64}$/);
  assert.notEqual(stored.rows[0].token_hash, registration.token);
  const finish = (password: string) => post("/v1/auth/email/register/finish", { token: registration.token, password });
  assert.equal((await finish("passwordpassword")).statusCode, 422);
  const results = await Promise.all([finish(initialPassword), finish(initialPassword)]);
  assert.deepEqual(results.map((response) => response.statusCode).sort(), [200, 422]);
  assert.ok(results.every((response) => response.headers["set-cookie"] === undefined));
  const viewer = await login(email, initialPassword);
  assert.equal(viewer.statusCode, 200);
  const cookie = String(viewer.headers["set-cookie"]).split(";")[0];
  const reset = (recipient: string) => post("/v1/auth/email/reset/start", { email: recipient, proof: "fixture-reset" });
  assert.deepEqual((await reset("owner@example.test")).json(), { accepted: true });
  assert.equal(sent.has("owner@example.test"), false);
  await db.pool.query("UPDATE app_auth_challenge SET created_at=created_at-interval '3 minutes' WHERE email=$1", [email]);
  assert.deepEqual((await reset(email)).json(), { accepted: true });
  const resetToken = sent.get(email)!.token;
  const complete = () => post("/v1/auth/email/reset/finish", { token: resetToken, password: nextPassword });
  assert.equal((await complete()).statusCode, 200);
  assert.equal((await complete()).statusCode, 422);
  assert.equal((await app.inject({ url: "/v1/auth/session", headers: { cookie } })).json().user, null);
  const auth = await post("/v1/auth/login", { email, password: nextPassword }, undefined, "192.0.2.44");
  assert.equal(auth.statusCode, 200);
  const viewerAudit = await db.pool.query("SELECT action FROM app_audit_log WHERE actor_user_id=$1", [auth.json().user.userId]);
  assert.ok(viewerAudit.rows.some((entry) => entry.action === "auth.password_reset"));
});
