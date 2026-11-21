import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { buildApp } from "../../apps/api/src/app";
import { provisionMfa } from "../../src/modules/access/mfa-sql";
import { bootstrapOwner } from "../../src/modules/access/sql";
import { testDatabase } from "../helpers/database";

function fixtureCode(seed: Buffer, step: number) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", seed).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

test("PG16 administrator MFA pre-auth challenge, step-up, replay defense and break-glass recovery", async (t) => {
  const db = await testDatabase();
  t.after(db.close);
  const origin = "https://mfa.example.test";
  const password = "fixture-administrator-password";
  const email = "owner@example.test";
  const key = Buffer.alloc(32, 2);
  const seed = Buffer.alloc(20, 7);
  await bootstrapOwner(db.pool, password, email);
  const userId = (await db.pool.query("SELECT id FROM app_user WHERE email=$1", [email])).rows[0].id;
  const app = await buildApp({
    pool: db.pool, origin, sessionSecret: "fixture-administrator-mfa-session-key", mfa: { key, required: true },
  });
  t.after(() => app.close());
  const post = (url: string, payload?: object, cookie?: string) => app.inject({
    method: "POST", url, payload, headers: { origin, ...(cookie ? { cookie } : {}) },
  });
  const login = () => post("/v1/auth/login", { email, password });
  assert.equal((await login()).statusCode, 403);
  const step = Math.floor(Date.now() / 30_000);
  await provisionMfa(db.pool, userId, seed, key, step - 2, false);
  const preAuth = await login();
  assert.equal(preAuth.statusCode, 202);
  assert.equal(preAuth.headers["set-cookie"], undefined);
  const challenge = preAuth.json().challenge;
  assert.equal((await post("/v1/access/invites", { role: "viewer" }, "app_session=" + challenge)).statusCode, 401);
  const complete = (pending: string, code: string) => post("/v1/auth/mfa/complete", { challenge: pending, code });
  const initialCode = fixtureCode(seed, step);
  const session = await complete(challenge, initialCode);
  assert.equal(session.statusCode, 200);
  assert.equal((await complete(challenge, initialCode)).statusCode, 401);
  const cookie = String(session.headers["set-cookie"]).split(";")[0];
  const codes = await post("/v1/auth/mfa/recovery-codes", undefined, cookie);
  assert.equal(codes.statusCode, 200);
  assert.equal(codes.json().codes.length, 8);
  await db.pool.query("UPDATE app_session SET mfa_step_up_at=NOW()-interval '6 minutes' WHERE user_id=$1", [userId]);
  assert.equal((await post("/v1/access/invites", { role: "viewer" }, cookie)).statusCode, 403);
  assert.equal((await post("/v1/auth/mfa/step-up", { code: initialCode }, cookie)).statusCode, 403);
  const stepUpCode = fixtureCode(seed, step + 1);
  assert.equal((await post("/v1/auth/mfa/step-up", { code: stepUpCode }, cookie)).statusCode, 200);
  assert.equal((await post("/v1/access/invites", { role: "viewer" }, cookie)).statusCode, 200);
  const recovery = codes.json().codes[0];
  const recoverySession = await complete((await login()).json().challenge, recovery);
  assert.equal(recoverySession.statusCode, 200);
  const recoveryCookie = String(recoverySession.headers["set-cookie"]).split(";")[0];
  assert.equal((await post("/v1/access/invites", { role: "viewer" }, recoveryCookie)).statusCode, 403);
  assert.equal((await complete((await login()).json().challenge, recovery)).statusCode, 401);
  await provisionMfa(db.pool, userId, Buffer.alloc(20, 9), key, step, true);
  assert.equal((await app.inject({ url: "/v1/auth/session", headers: { cookie } })).json().user, null);
});
