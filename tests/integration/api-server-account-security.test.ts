import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApiServer } from "../../apps/api/src/create-api-server";
import { PasswordHashingService } from "../../src/application/services/password-hashing.service";
import { RedditMockConnector } from "../../src/connectors/reddit/reddit-mock.connector";
import { DemoContentProvider } from "../../src/connectors/demo/demo-content.connector";
import { SourceContentService } from "../../src/application/services/source-content.service";
import { InMemorySourceContentRepository } from "../../src/storage/repositories/in-memory/source-content.repository";
import type { AppUser } from "../../src/domain/entities/app-user";
import { createApiTestRepositories, startServer, stopServer } from "./api-server.helpers";

const now = "2026-10-13T01:00:00.000Z", password = "Original-fixture-password-12", changedPassword = "Changed-fixture-password-12";
async function fixture(sourceContent?: SourceContentService) {
  const repos = createApiTestRepositories(), hashes = new PasswordHashingService();
  const seed = async (role: AppUser["role"] = "viewer") => {
    const user: AppUser = { id: randomUUID(), email: `${randomUUID()}@example.test`, role, status: "active", createdAt: now, updatedAt: now };
    await repos.appUserRepository.create(user, { userId: user.id, passwordHash: await hashes.hashPassword(password), passwordAlgo: hashes.passwordAlgo, updatedAt: now });
    return user;
  };
  const server = createApiServer({ repositories: repos, sourceContent, createConnector: () => new RedditMockConnector(), now: () => now, auth: { bearerToken: "synthetic-machine-token" }, logger: () => {} });
  const base = await startServer(server);
  const request = async (path: string, method = "GET", body?: unknown, cookie?: string, machine = false) => {
    const response = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(machine ? { authorization: "Bearer synthetic-machine-token" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json(), cookie: response.headers.get("set-cookie") ?? "" };
  };
  const login = async (user: AppUser, secret = password) => request("/auth/login", "POST", { email: user.email, password: secret });
  return { repos, seed, server, request, login };
}

test("HTTP password bounds and reauthentication invalidate every previous session without persisting credentials", async () => {
  const f = await fixture();
  try {
    const user = await f.seed(), a = await f.login(user), b = await f.login(user);
    assert.equal(a.status, 200);
    for (const newPassword of ["x".repeat(11), "x".repeat(129)]) assert.equal((await f.request("/auth/password", "POST", { currentPassword: password, newPassword }, a.cookie)).status, 400);
    assert.equal((await f.request("/auth/password", "POST", { currentPassword: "wrong-secret", newPassword: changedPassword }, a.cookie)).status, 401);
    assert.equal((await f.request("/auth/sessions", "GET", undefined, a.cookie)).body.sessions.length, 2);
    const changed = await f.request("/auth/password", "POST", { currentPassword: password, newPassword: changedPassword }, a.cookie);
    assert.equal(changed.status, 200); assert.equal(changed.body.reauthenticate, true); assert.ok(changed.cookie.includes("Max-Age=0"));
    for (const cookie of [a.cookie, b.cookie]) assert.equal((await f.request("/auth/me", "GET", undefined, cookie)).status, 401);
    assert.equal((await f.login(user)).status, 401); assert.equal((await f.login(user, changedPassword)).status, 200);
    const audit = await f.repos.appAuditRepository.list({ action: "account.password.change" });
    assert.equal(audit.items.filter(row => row.outcome === "succeeded").length, 1);
    assert.equal(audit.items.filter(row => row.outcome === "failed").length, 3);
    assert.ok(audit.items.every(row => row.resourceId === user.id));
    const serialized = JSON.stringify(audit);
    for (const secret of [password, changedPassword, "wrong-secret", "currentPassword", "newPassword", "tokenHash"]) assert.equal(serialized.includes(secret), false);
  } finally { await stopServer(f.server); }
});

test("HTTP sessions are user-scoped, identify the current session, and reject machine bearer ownership", async () => {
  const f = await fixture();
  try {
    const user = await f.seed(), other = await f.seed(), a = await f.login(user), b = await f.login(user), otherLogin = await f.login(other);
    const sessions = (await f.request("/auth/sessions", "GET", undefined, a.cookie)).body.sessions;
    assert.equal(sessions.length, 2); assert.equal(sessions.filter((row: { current: boolean }) => row.current).length, 1);
    assert.ok(sessions.every((row: object) => !("tokenHash" in row) && !("credentialVersion" in row) && !("userId" in row)));
    const current = sessions.find((row: { current: boolean }) => row.current), second = sessions.find((row: { current: boolean }) => !row.current);
    const otherSession = (await f.request("/auth/sessions", "GET", undefined, otherLogin.cookie)).body.sessions[0];
    assert.equal((await f.request(`/auth/sessions/${otherSession.id}`, "DELETE", undefined, a.cookie)).status, 404);
    assert.equal((await f.request("/auth/sessions", "GET", undefined, undefined, true)).status, 401);
    assert.equal((await f.request(`/auth/sessions/${current.id}`, "DELETE", undefined, undefined, true)).status, 401);
    assert.equal((await f.request("/auth/password", "POST", { currentPassword: password, newPassword: changedPassword }, undefined, true)).status, 401);
    const revoked = await f.request(`/auth/sessions/${second.id}`, "DELETE", undefined, a.cookie);
    assert.equal(revoked.status, 200); assert.equal(revoked.body.currentSessionRevoked, false);
    assert.equal((await f.request("/auth/me", "GET", undefined, b.cookie)).status, 401);
    const selfRevoked = await f.request(`/auth/sessions/${current.id}`, "DELETE", undefined, a.cookie);
    assert.equal(selfRevoked.body.currentSessionRevoked, true); assert.ok(selfRevoked.cookie.includes("Max-Age=0"));
    const next = await f.login(user), extra = await f.login(user);
    const all = await f.request("/auth/sessions/revoke-all", "POST", {}, next.cookie);
    assert.equal(all.status, 200); assert.equal(all.body.currentSessionRevoked, true);
    for (const cookie of [next.cookie, extra.cookie]) assert.equal((await f.request("/auth/me", "GET", undefined, cookie)).status, 401);
    assert.equal((await f.request("/auth/me", "GET", undefined, otherLogin.cookie)).status, 200);
  } finally { await stopServer(f.server); }
});

test("HTTP role, status, activation and invites consistently enforce owner/admin policy and protect the last owner", async () => {
  const f = await fixture();
  try {
    const owner = await f.seed("owner"), admin = await f.seed("admin"), viewer = await f.seed(), ownerLogin = await f.login(owner), adminLogin = await f.login(admin), viewerLogin = await f.login(viewer);
    for (const roleOnAccept of ["owner", "admin"]) assert.equal((await f.request("/auth/invites", "POST", { roleOnAccept }, adminLogin.cookie)).status, 403);
    assert.equal((await f.request("/auth/invites", "POST", { roleOnAccept: "viewer" }, adminLogin.cookie)).status, 201);
    assert.equal((await f.request(`/auth/users/${owner.id}/status`, "POST", { status: "disabled" }, adminLogin.cookie)).status, 403);
    assert.equal((await f.request(`/auth/users/${admin.id}/activate`, "POST", {}, adminLogin.cookie)).status, 403);
    assert.equal((await f.request(`/auth/users/${viewer.id}/role`, "POST", { role: "admin" }, adminLogin.cookie)).status, 403);
    assert.equal((await f.request(`/auth/users/${owner.id}/status`, "POST", { status: "disabled" }, ownerLogin.cookie)).body.errorCode, "self_change");
    assert.equal((await f.request(`/auth/users/${owner.id}/role`, "POST", { role: "viewer" }, undefined, true)).body.errorCode, "last_owner");
    assert.equal((await f.request(`/auth/users/${viewer.id}/status`, "POST", { status: "disabled" }, adminLogin.cookie)).status, 200);
    assert.equal((await f.request("/auth/me", "GET", undefined, viewerLogin.cookie)).status, 401);
    assert.equal((await f.request(`/auth/users/${viewer.id}/activate`, "POST", {}, adminLogin.cookie)).status, 200);
    assert.equal((await f.request("/auth/me", "GET", undefined, viewerLogin.cookie)).status, 401, "Reactivation must not resurrect revoked credentials");
    assert.equal((await f.request(`/auth/users/${admin.id}/role`, "POST", { role: "viewer" }, ownerLogin.cookie)).status, 200);
    assert.equal((await f.request("/auth/me", "GET", undefined, adminLogin.cookie)).status, 401, "Role changes revoke existing sessions");
  } finally { await stopServer(f.server); }
});

test("HTTP audit is durable before a target write, paginated, role-protected and excludes invite secrets", async () => {
  const f = await fixture();
  try {
    const owner = await f.seed("owner"), viewer = await f.seed(), ownerLogin = await f.login(owner), viewerLogin = await f.login(viewer);
    const original = f.repos.monitorTargetRepository.upsert.bind(f.repos.monitorTargetRepository);
    f.repos.monitorTargetRepository.upsert = async target => {
      const pending = await f.repos.appAuditRepository.list({ outcome: "attempted", action: "target.create" });
      assert.equal(pending.items.length, 1); assert.equal(pending.items[0].actorUserId, owner.id);
      return original(target);
    };
    assert.equal((await f.request("/v1/targets/subreddit", "POST", { subreddit: "auditfixture" }, ownerLogin.cookie)).status, 200);
    const invite = await f.request("/auth/invites", "POST", { roleOnAccept: "viewer", code: "190123", maxUses: 2 }, ownerLogin.cookie);
    assert.equal(invite.status, 201);
    assert.equal((await f.request("/auth/invites", "POST", {}, viewerLogin.cookie)).status, 403);
    assert.equal((await f.request("/v1/ops/audit", "GET", undefined, viewerLogin.cookie)).status, 403);
    assert.equal((await f.request("/v1/ops/audit", "GET", undefined, undefined, true)).status, 403);
    assert.equal((await f.request("/v1/ops/audit?limit=101", "GET", undefined, ownerLogin.cookie)).status, 400);
    assert.equal((await f.request("/v1/ops/audit?outcome=unknown", "GET", undefined, ownerLogin.cookie)).status, 400);
    assert.equal((await f.request(`/v1/ops/audit?actorId=${"-".repeat(36)}`, "GET", undefined, ownerLogin.cookie)).status, 400);
    const first = await f.request("/v1/ops/audit?limit=1", "GET", undefined, ownerLogin.cookie);
    assert.equal(first.body.entries.length, 1); assert.ok(first.body.nextCursor);
    const second = await f.request(`/v1/ops/audit?limit=100&cursor=${first.body.nextCursor}`, "GET", undefined, ownerLogin.cookie);
    assert.equal(new Set([...first.body.entries, ...second.body.entries].map(row => row.id)).size, 3);
    const all = await f.request("/v1/ops/audit", "GET", undefined, ownerLogin.cookie);
    assert.equal(JSON.stringify(all.body).includes("190123"), false);
    assert.equal(all.body.entries.find((row: { action: string; outcome: string }) => row.action === "account.invite.create" && row.outcome === "succeeded").changes.after.maxUses, 2);
  } finally { await stopServer(f.server); }
});

test("HTTP audit intent failure blocks mutation; completion failure preserves attempted and reports unknown outcome", async () => {
  const f = await fixture();
  try {
    const owner = await f.seed("owner"), signedIn = await f.login(owner);
    const begin = f.repos.appAuditRepository.begin.bind(f.repos.appAuditRepository);
    f.repos.appAuditRepository.begin = async () => { throw new Error("fixture storage failure"); };
    const blocked = await f.request("/v1/targets/subreddit", "POST", { subreddit: "blockedfixture" }, signedIn.cookie);
    assert.equal(blocked.status, 503); assert.equal(blocked.body.errorCode, "audit_unavailable");
    assert.equal(await f.repos.monitorTargetRepository.findByCanonicalName("r/blockedfixture"), null);
    f.repos.appAuditRepository.begin = begin;
    f.repos.appAuditRepository.complete = async () => { throw new Error("fixture result failure"); };
    const unknown = await f.request("/v1/targets/subreddit", "POST", { subreddit: "unknownfixture" }, signedIn.cookie);
    assert.equal(unknown.status, 503); assert.equal(unknown.body.errorCode, "audit_result_unknown");
    assert.ok(await f.repos.monitorTargetRepository.findByCanonicalName("r/unknownfixture"), "The write may have succeeded; no rollback is claimed");
    const audit = await f.request("/v1/ops/audit?outcome=attempted", "GET", undefined, signedIn.cookie);
    assert.equal(audit.body.entries.length, 1); assert.equal(audit.body.entries[0].completedAt, null);
  } finally { await stopServer(f.server); }
});

test("HTTP source settings, lifecycle, jobs and budgets produce attributed success and failure audits with bounded metadata", async () => {
  const service = new SourceContentService(new InMemorySourceContentRepository(), new DemoContentProvider("reddit", () => now), () => now), f = await fixture(service);
  try {
    const owner = await f.seed("owner"), signedIn = await f.login(owner);
    const created = await f.request("/v1/sources", "POST", { platform: "reddit", provider: "demo_reddit", contentKind: "post", target: { type: "community", community: "auditfixture" }, password: "NEVER_AUDIT_PASSWORD", token: "NEVER_AUDIT_TOKEN", code: "NEVER_AUDIT_CODE", rawPayload: { text: "NEVER_AUDIT_RAW" } }, signedIn.cookie);
    assert.equal(created.status, 201); const id = created.body.source.id;
    const schedule = { enabled: false, cadenceSeconds: 600, overlapSeconds: 720, initialLookbackHours: 24, maxCatchupHours: 12, pageSize: 10, maxPages: 2, recheckLookbackHours: 18, recheckCadenceSeconds: 3600 };
    const refresh = { enabled: false, afterHours: 48, minIntervalHours: 12, maxAttempts: 4, batchSize: 9 };
    assert.equal((await f.request(`/v1/sources/${id}`, "PATCH", { group: "Research", schedule, refresh, expectedRevision: created.body.source.revision }, signedIn.cookie)).status, 200);
    assert.equal((await f.request("/v1/source-provider-budgets/demo_reddit", "PUT", { enabled: true, dailyRequests: 10, monthlyRequests: 100, dailyResources: 50, monthlyResources: 500, minimumIntervalMs: 5000 }, signedIn.cookie)).status, 200);
    const queued = await f.request(`/v1/sources/${id}/collect`, "POST", { from: "2026-10-12T00:00:00.000Z", to: now }, signedIn.cookie); assert.equal(queued.status, 202);
    assert.equal((await f.request(`/v1/source-jobs/${queued.body.job.id}/cancel`, "POST", {}, signedIn.cookie)).status, 200);
    assert.equal((await f.request(`/v1/sources/${id}/pause`, "POST", {}, signedIn.cookie)).status, 200);
    assert.equal((await f.request(`/v1/sources/${id}/collect`, "POST", {}, signedIn.cookie)).status, 409);
    const audit = (await f.request("/v1/ops/audit", "GET", undefined, signedIn.cookie)).body.entries;
    assert.equal(audit.length, 7); assert.ok(audit.every((row: { actorUserId: string; actorType: string }) => row.actorUserId === owner.id && row.actorType === "session"));
    assert.deepEqual(audit.filter((row: { outcome: string }) => row.outcome === "succeeded").map((row: { action: string }) => row.action).sort(), ["source.budget.update", "source.collect", "source.create", "source.job.cancel", "source.pause", "source.update"]);
    assert.equal(audit.find((row: { action: string }) => row.action === "source.budget.update").changes.after.dailyRequests, 10);
    assert.equal(audit.find((row: { action: string }) => row.action === "source.budget.update").changes.after.minimumIntervalMs, 5000);
    assert.deepEqual(audit.find((row: { action: string }) => row.action === "source.update").changes.after.schedule, schedule);
    assert.deepEqual(audit.find((row: { action: string }) => row.action === "source.update").changes.after.refresh, refresh);
    assert.equal(audit.find((row: { action: string }) => row.action === "source.pause").changes.after.state, "paused");
    assert.equal(audit.find((row: { outcome: string }) => row.outcome === "failed").changes.after.errorCode, "source_conflict");
    const serialized = JSON.stringify(audit);
    for (const secret of [password, "NEVER_AUDIT_PASSWORD", "NEVER_AUDIT_TOKEN", "NEVER_AUDIT_CODE", "NEVER_AUDIT_RAW", "rawPayload", "tokenHash", "passwordHash"]) assert.equal(serialized.includes(secret), false);
  } finally { await stopServer(f.server); }
});
