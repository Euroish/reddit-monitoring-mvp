import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { buildApp } from "../../apps/api/src/app";
import { bootstrapOwner, createLoginSession, createSession, findActor, hashPassword, pruneExpiredBrowserSessions } from "../../src/modules/access/sql";
import { testDatabase } from "../helpers/database";

const origin = "https://security.example.test";
const password = "security-fixture-password";

test("PG16 rehash, session issuance version check, idle timeouts and machine expiry isolation", async (t) => {
  const db = await testDatabase();
  t.after(db.close);
  await bootstrapOwner(db.pool, password, "owner@example.test");
  const viewerId = randomUUID();
  await db.pool.query("INSERT INTO app_user(id,email,role,status) VALUES($1,$2,'viewer','active')", [viewerId, "viewer@example.test"]);
  await db.pool.query("INSERT INTO app_user_password(user_id,password_hash,password_algo) VALUES($1,$2,'scrypt')", [viewerId, await hashPassword(password)]);
  const app = await buildApp({ pool: db.pool, origin, sessionSecret: password.repeat(2), strongerPasswords: true });
  t.after(() => app.close());
  const login = (email: string, remember: boolean) => app.inject({
    method: "POST", url: "/v1/auth/login", headers: { origin }, payload: { email, password, remember },
  });
  const owner = await login("owner@example.test", true);
  assert.equal(owner.statusCode, 200);
  const ownerCookie = String(owner.headers["set-cookie"]);
  assert.doesNotMatch(ownerCookie, /Max-Age/);
  const readSession = (cookie: string) => app.inject({ url: "/v1/auth/session", headers: { cookie: cookie.split(";")[0] } });
  const ownerSession = owner.json().user.sessionId;
  await db.pool.query("UPDATE app_session SET last_seen_at=NOW()-interval '31 minutes' WHERE id=$1", [ownerSession]);
  assert.equal((await readSession(ownerCookie)).json().user, null);

  const viewer = await login("viewer@example.test", true);
  assert.equal(viewer.statusCode, 200);
  const viewerCookie = String(viewer.headers["set-cookie"]);
  assert.match(viewerCookie, /Max-Age=2592000/);
  const hash = await db.pool.query("SELECT password_hash FROM app_user_password WHERE user_id=$1", [viewerId]);
  assert.match(hash.rows[0].password_hash, /^scrypt:v2:/);
  await db.pool.query("UPDATE app_session SET last_seen_at=NOW()-interval '6 minutes' WHERE id=$1", [viewer.json().user.sessionId]);
  assert.equal((await readSession(viewerCookie)).json().user.userId, viewerId);
  assert.equal((await db.pool.query("SELECT last_seen_at>NOW()-interval '1 minute' AS touched FROM app_session WHERE id=$1", [viewer.json().user.sessionId])).rows[0].touched, true);

  const machine = await createSession(db.pool, viewerId, "machine", ["read"], null, 2);
  await db.pool.query("UPDATE app_session SET last_seen_at=NOW()-interval '10 days' WHERE id=$1", [machine.id]);
  assert.equal((await findActor(db.pool, machine.token, "machine"))?.userId, viewerId);
  const auth = { cookie: viewerCookie.split(";")[0], origin };
  const another = await login("viewer@example.test", false);
  const anotherCookie = String(another.headers["set-cookie"]);
  const list = await app.inject({ url: "/v1/auth/sessions", headers: auth });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().sessions.length, 2);
  assert.deepEqual(Object.keys(list.json().sessions[0]).sort(), ["createdAt", "current", "expiresAt", "id", "label", "lastSeenAt"]);
  assert.equal(list.json().sessions[0].current, true);
  const invalid = await app.inject({ method: "POST", url: "/v1/access/invites", headers: {
    cookie: ownerCookie.split(";")[0], authorization: "",
  }, payload: { role: "viewer" } });
  assert.equal(invalid.statusCode, 401);
  const revoke = (id: string) => app.inject({ method: "DELETE", url: "/v1/auth/sessions/" + id, headers: auth });
  assert.equal((await revoke(ownerSession)).statusCode, 200);
  assert.equal((await db.pool.query("SELECT 1 FROM app_session WHERE id=$1", [ownerSession])).rowCount, 1);
  assert.equal((await revoke(another.json().user.sessionId)).statusCode, 200);
  assert.equal((await readSession(anotherCookie)).json().user, null);
  const logoutAll = await app.inject({ method: "POST", url: "/v1/auth/logout-all", headers: auth });
  assert.equal(logoutAll.statusCode, 200);
  assert.match(String(logoutAll.headers["set-cookie"]), /Max-Age=0/);
  assert.equal((await readSession(viewerCookie)).json().user, null);
  assert.equal((await findActor(db.pool, machine.token, "machine"))?.userId, viewerId);
  const events = await db.pool.query("SELECT action FROM app_audit_log WHERE actor_user_id=$1", [viewerId]);
  assert.ok(events.rows.some((event) => event.action === "auth.sessions.revoked"));
  await db.pool.query("UPDATE app_user SET credential_version=1 WHERE id=$1", [viewerId]);
  await assert.rejects(createLoginSession(db.pool, viewerId, 0, ["read"]), { statusCode: 401 });
  assert.equal((await readSession(viewerCookie)).json().user, null);
  assert.equal(await findActor(db.pool, machine.token, "machine"), null);
  await db.pool.query("UPDATE app_session SET expires_at=NOW()-interval '1 minute' WHERE id=ANY($1::uuid[])", [[machine.id, ownerSession]]);
  await pruneExpiredBrowserSessions(db.pool);
  assert.equal((await db.pool.query("SELECT 1 FROM app_session WHERE id=$1", [ownerSession])).rowCount, 0);
  assert.equal((await db.pool.query("SELECT 1 FROM app_session WHERE id=$1", [machine.id])).rowCount, 1);
});
