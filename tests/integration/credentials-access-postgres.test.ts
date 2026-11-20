import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../../apps/api/src/app";
import { bootstrapOwner } from "../../src/modules/access/sql";
import { createCredentialVault } from "../../src/modules/collection/credentials";
import { twitterApis } from "../../src/connectors/x/twitterapis";
import { testDatabase } from "../helpers/database";

const ORIGIN = "http://localhost:3000";
const SESSION_SECRET = "synthetic-credential-test-secret-32chars";

async function loginCookie(app: Awaited<ReturnType<typeof buildApp>>, email: string, password: string) {
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    headers: { origin: ORIGIN },
    payload: { email, password },
  });
  assert.equal(res.statusCode, 200);
  return res.headers["set-cookie"]!.toString().split(";")[0];
}

test("PG16 provider credentials encryption, live reload, RBAC, machine isolation and user tier management", async (t) => {
  const db = await testDatabase();
  t.after(db.close);
  await bootstrapOwner(db.pool, "owner-password-123", "owner@localhost");

  const env = {
    SOURCE_NETWORK_ENABLED: "true",
    TWITTERAPIS_API_KEY: "env-twitter-secret-9999",
  } as unknown as NodeJS.ProcessEnv;

  const vault = createCredentialVault(db.pool, SESSION_SECRET, env);
  await vault.reload();
  const xProvider = twitterApis(env, fetch, () => vault.getSecret("twitterapis"));

  const app = await buildApp({
    pool: db.pool,
    sessionSecret: SESSION_SECRET,
    origin: ORIGIN,
    secureCookies: false,
    providers: [xProvider],
    credentialVault: vault,
  });
  t.after(() => app.close());

  const ownerCookie = await loginCookie(app, "owner@localhost", "owner-password-123");

  // 1. Register an admin and a viewer via invites
  const adminInvite = (
    await app.inject({
      method: "POST",
      url: "/v1/access/invites",
      headers: { cookie: ownerCookie, origin: ORIGIN },
      payload: { role: "admin" },
    })
  ).json<{ code: string }>();
  const viewerInvite = (
    await app.inject({
      method: "POST",
      url: "/v1/access/invites",
      headers: { cookie: ownerCookie, origin: ORIGIN },
      payload: { role: "viewer" },
    })
  ).json<{ code: string }>();

  await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    headers: { origin: ORIGIN },
    payload: { email: "admin@localhost", password: "admin-password-123", invite: adminInvite.code },
  });
  await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    headers: { origin: ORIGIN },
    payload: { email: "viewer@localhost", password: "viewer-password-123", invite: viewerInvite.code },
  });

  const adminCookie = await loginCookie(app, "admin@localhost", "admin-password-123");
  const viewerCookie = await loginCookie(app, "viewer@localhost", "viewer-password-123");

  // 2. Machine key with sources:write MUST be blocked from /v1/sources/credentials and /v1/access/*
  const mkRes = await app.inject({
    method: "POST",
    url: "/v1/access/keys",
    headers: { cookie: ownerCookie, origin: ORIGIN },
    payload: { label: "agent-key", scopes: ["read", "sources:write"], allowedSourceIds: [], expiresInDays: 7 },
  });
  assert.equal(mkRes.statusCode, 200);
  const machineToken = mkRes.json<{ token: string }>().token;

  for (const path of ["/v1/sources/credentials", "/v1/access/users"]) {
    const vBlocked = await app.inject({ method: "GET", url: path, headers: { cookie: viewerCookie } });
    assert.equal(vBlocked.statusCode, 403);
    const mBlocked = await app.inject({
      method: "GET",
      url: path,
      headers: { authorization: `Bearer ${machineToken}` },
    });
    assert.equal(mBlocked.statusCode, 403);
  }

  // 3. Initial env fallback & masked hint
  const list1 = await app.inject({
    method: "GET",
    url: "/v1/sources/credentials",
    headers: { cookie: adminCookie },
  });
  assert.equal(list1.statusCode, 200);
  const tw1 = list1.json<{ credentials: Array<{ provider: string; source: string; keyHint: string | null }> }>()
    .credentials.find((c) => c.provider === "twitterapis")!;
  assert.equal(tw1.source, "env");
  assert.equal(tw1.keyHint, "••••9999");
  assert.equal(xProvider.capability.enabled, true);

  // 4. Admin saves DB credential -> encrypted at rest, never returned in plaintext, hot reloads vault
  const dbSecret = "db-twitter-secret-abcd1234";
  const saveRes = await app.inject({
    method: "PUT",
    url: "/v1/sources/credentials/twitterapis",
    headers: { cookie: adminCookie, origin: ORIGIN },
    payload: { apiKey: dbSecret },
  });
  assert.equal(saveRes.statusCode, 200);
  assert.equal(saveRes.json<{ credential: { source: string; keyHint: string } }>().credential.source, "db");
  assert.equal(saveRes.json<{ credential: { keyHint: string } }>().credential.keyHint, "••••1234");
  assert.ok(!saveRes.body.includes(dbSecret), "Plaintext secret must never be returned");
  assert.equal(vault.getSecret("twitterapis"), dbSecret);

  const rawDbRow = (
    await db.pool.query<{ encrypted_secret: string }>(
      "SELECT encrypted_secret FROM source_provider_credential WHERE provider='twitterapis'",
    )
  ).rows[0];
  assert.ok(rawDbRow.encrypted_secret.startsWith("v1:"));
  assert.ok(!rawDbRow.encrypted_secret.includes(dbSecret), "DB must store AES-256-GCM ciphertext only");

  // 5. Dry probe without confirmPaidProbe makes zero external calls
  const dryProbe = await app.inject({
    method: "POST",
    url: "/v1/sources/credentials/twitterapis/test",
    headers: { cookie: adminCookie, origin: ORIGIN },
    payload: { confirmPaidProbe: false },
  });
  assert.equal(dryProbe.statusCode, 200);
  assert.equal(dryProbe.json<{ mode: string; ok: boolean }>().mode, "dry");
  assert.equal(dryProbe.json<{ ok: boolean }>().ok, true);

  // 6. Revoke DB credential -> falls back to env, audit log has zero plaintext
  const revokeRes = await app.inject({
    method: "DELETE",
    url: "/v1/sources/credentials/twitterapis",
    headers: { cookie: ownerCookie, origin: ORIGIN },
  });
  assert.equal(revokeRes.statusCode, 200);
  assert.equal(revokeRes.json<{ credential: { source: string } }>().credential.source, "env");
  assert.equal(vault.getSecret("twitterapis"), "env-twitter-secret-9999");

  const auditRows = (await db.pool.query("SELECT action, meta_json FROM app_audit_log")).rows;
  assert.ok(auditRows.some((r) => r.action === "collection.credential.saved"));
  assert.ok(auditRows.some((r) => r.action === "collection.credential.revoked"));
  assert.ok(!JSON.stringify(auditRows).includes(dbSecret), "Audit log must not contain plaintext");

  // 7. Role & planTier boundaries
  const usersRes = await app.inject({ method: "GET", url: "/v1/access/users", headers: { cookie: ownerCookie } });
  const viewerUser = usersRes.json<{ users: Array<{ id: string; email: string; role: string; planTier: string }> }>()
    .users.find((u) => u.email === "viewer@localhost")!;
  assert.equal(viewerUser.planTier, "free");

  // Admin cannot change viewer's planTier or role
  const adminTierAttempt = await app.inject({
    method: "PATCH",
    url: `/v1/access/users/${viewerUser.id}`,
    headers: { cookie: adminCookie, origin: ORIGIN },
    payload: { planTier: "pro" },
  });
  assert.equal(adminTierAttempt.statusCode, 403);

  // Owner can upgrade viewer's planTier and disable viewer -> immediately invalidates session
  const ownerUpgrade = await app.inject({
    method: "PATCH",
    url: `/v1/access/users/${viewerUser.id}`,
    headers: { cookie: ownerCookie, origin: ORIGIN },
    payload: { planTier: "pro", status: "disabled" },
  });
  assert.equal(ownerUpgrade.statusCode, 200);
  assert.equal(ownerUpgrade.json<{ user: { planTier: string; status: string } }>().user.planTier, "pro");

  const disabledSession = await app.inject({
    method: "GET",
    url: "/v1/sources",
    headers: { cookie: viewerCookie },
  });
  assert.equal(disabledSession.statusCode, 401);
});
