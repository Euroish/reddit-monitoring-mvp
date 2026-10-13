import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApiServer } from "../../apps/api/src/create-api-server";
import { PasswordHashingService } from "../../src/application/services/password-hashing.service";
import { RedditMockConnector } from "../../src/connectors/reddit/reddit-mock.connector";
import { PostgresClient } from "../../src/storage/postgres/postgres-client";
import { createPostgresRepositoryBundle } from "../../src/storage/repositories/postgres/postgres-repository-bundle";
import { runMigrations } from "../../src/storage/schema/run-migrations";
import { startServer, stopServer } from "./api-server.helpers";

const connectionString = process.env.TEST_SOURCE_DATABASE_URL;
test("native HTTP invite, activation, password, sessions and audit work across independent PostgreSQL connections", { skip: !connectionString }, async () => {
  const url = new URL(connectionString!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && /^\/source_validation_[a-z0-9_]+$/.test(url.pathname), "Use an isolated loopback source_validation_* database");
  const database = `source_validation_account_http_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const adminUrl = new URL(url); adminUrl.pathname = "/postgres";
  const admin = new PostgresClient({ connectionString: adminUrl.href, max: 1 });
  try { await admin.query(`CREATE DATABASE "${database}"`); } finally { await admin.close(); }
  url.pathname = `/${database}`;
  const db = new PostgresClient({ connectionString: url.href, max: 3 }), observer = new PostgresClient({ connectionString: url.href, max: 1 });
  const repos = createPostgresRepositoryBundle(db), now = "2026-10-13T01:00:00.000Z", password = "Native-fixture-password-12", changedPassword = "Changed-native-password-12";
  const server = createApiServer({ repositories: repos, createConnector: () => new RedditMockConnector(), now: () => now, auth: { bearerToken: "native-synthetic-token" }, logger: () => {} });
  let started = false;
  try {
    await runMigrations({ db });
    const ownerId = randomUUID(), hashes = new PasswordHashingService();
    await repos.appUserRepository.create({ id: ownerId, email: "native-owner@example.test", role: "owner", status: "active", createdAt: now, updatedAt: now }, { userId: ownerId, passwordHash: await hashes.hashPassword(password), passwordAlgo: hashes.passwordAlgo, updatedAt: now });
    const base = await startServer(server); started = true;
    const request = async (path: string, method = "GET", body?: unknown, cookie?: string) => {
      const response = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json(), cookie: response.headers.get("set-cookie") ?? "" };
    };
    const owner = await request("/auth/login", "POST", { email: "native-owner@example.test", password }); assert.equal(owner.status, 200);
    const invite = await request("/auth/invites", "POST", { roleOnAccept: "viewer", code: "871902" }, owner.cookie); assert.equal(invite.status, 201);
    const registered = await request("/auth/register", "POST", { email: "native-viewer@example.test", password, inviteCode: invite.body.code });
    assert.equal(registered.status, 201); assert.equal(registered.body.user.status, "pending");
    assert.equal((await request("/auth/login", "POST", { email: "native-viewer@example.test", password })).status, 401);
    assert.equal((await request(`/auth/users/${registered.body.user.id}/activate`, "POST", {}, owner.cookie)).status, 200);
    assert.equal(Number((await observer.query("SELECT credential_version FROM app_user WHERE id=$1", [registered.body.user.id])).rows[0].credential_version), 1);
    const login = () => request("/auth/login", "POST", { email: "native-viewer@example.test", password });
    const a = await login(), b = await login(); assert.equal(a.status, 200); assert.equal(b.status, 200);
    const sessions = await request("/auth/sessions", "GET", undefined, a.cookie); assert.equal(sessions.body.sessions.length, 2); assert.equal(sessions.body.sessions.filter((row: { current: boolean }) => row.current).length, 1);
    const changed = await request("/auth/password", "POST", { currentPassword: password, newPassword: changedPassword }, a.cookie);
    assert.equal(changed.status, 200); assert.equal(changed.body.reauthenticate, true);
    for (const cookie of [a.cookie, b.cookie]) assert.equal((await request("/auth/me", "GET", undefined, cookie)).status, 401);
    const next = await request("/auth/login", "POST", { email: "native-viewer@example.test", password: changedPassword }); assert.equal(next.status, 200);
    assert.equal((await request("/auth/sessions/revoke-all", "POST", {}, next.cookie)).body.currentSessionRevoked, true);
    assert.equal((await request("/auth/me", "GET", undefined, next.cookie)).status, 401);
    const audit = await request("/v1/ops/audit", "GET", undefined, owner.cookie); assert.equal(audit.status, 200);
    assert.deepEqual(audit.body.entries.map((row: { action: string }) => row.action).sort(), ["account.invite.create", "account.password.change", "account.sessions.revoke_all", "account.user.activate"]);
    const observed = await observer.query("SELECT action,outcome,meta_json FROM app_audit_log ORDER BY action");
    assert.equal(observed.rows.length, 4); assert.ok(observed.rows.every(row => row.outcome === "succeeded"));
    const serialized = JSON.stringify(observed.rows);
    for (const secret of [password, changedPassword, "871902", "currentPassword", "tokenHash", "passwordHash"]) assert.equal(serialized.includes(secret), false);
    assert.equal(Number((await observer.query("SELECT credential_version FROM app_user WHERE id=$1", [registered.body.user.id])).rows[0].credential_version), 3);
    console.log(JSON.stringify({ scope: "native isolated synthetic HTTP account/audit", database, inviteActivation: true, oldSessionsRejected: true, auditDurable: true, realSourceRequests: 0 }));
  } finally { if (started) await stopServer(server); await db.close(); await observer.close(); }
});
