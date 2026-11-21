import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../../apps/api/src/app";
import { bootstrapOwner } from "../../src/modules/access/sql";
import { createCredentialVault } from "../../src/modules/collection/credentials";
import { KaixContentConnector } from "../../src/connectors/reddit/kaix-content.connector";
import { redCrawler } from "../../src/connectors/reddit/red-crawler";
import { webSource } from "../../src/connectors/web/sources";
import { twitterApis } from "../../src/connectors/x/twitterapis";
import { workOnce } from "../../src/modules/collection/worker";
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

test("PG16 provider credentials, Apify aggregation, dynamic Free/Pro policies, quota enforcement and job isolation", async (t) => {
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
  const kaixProvider = new KaixContentConnector({ networkEnabled: true, getApiToken: () => vault.getSecret("kaix") });
  const redProvider = redCrawler(env, fetch, () => vault.getSecret("red_crawler"));
  const newsnowProvider = webSource("newsnow", env);

  const app = await buildApp({
    pool: db.pool,
    sessionSecret: SESSION_SECRET,
    origin: ORIGIN,
    secureCookies: false,
    providers: [xProvider, kaixProvider, redProvider, newsnowProvider],
    credentialVault: vault,
    publicRead: true,
  });
  t.after(() => app.close());

  const ownerCookie = await loginCookie(app, "owner@localhost", "owner-password-123");

  const adminInv = (await app.inject({ method: "POST", url: "/v1/access/invites", headers: { cookie: ownerCookie, origin: ORIGIN }, payload: { role: "admin" } })).json<{ code: string }>();
  const freeInv = (await app.inject({ method: "POST", url: "/v1/access/invites", headers: { cookie: ownerCookie, origin: ORIGIN }, payload: { role: "viewer" } })).json<{ code: string }>();
  const proInv = (await app.inject({ method: "POST", url: "/v1/access/invites", headers: { cookie: ownerCookie, origin: ORIGIN }, payload: { role: "viewer" } })).json<{ code: string }>();

  await app.inject({ method: "POST", url: "/v1/auth/register", headers: { origin: ORIGIN }, payload: { email: "admin@localhost", password: "admin-password-123", invite: adminInv.code } });
  await app.inject({ method: "POST", url: "/v1/auth/register", headers: { origin: ORIGIN }, payload: { email: "free@localhost", password: "viewer-password-123", invite: freeInv.code } });
  await app.inject({ method: "POST", url: "/v1/auth/register", headers: { origin: ORIGIN }, payload: { email: "pro@localhost", password: "viewer-password-123", invite: proInv.code } });

  const usersRes = await app.inject({ method: "GET", url: "/v1/access/users", headers: { cookie: ownerCookie } });
  const users = usersRes.json<{ users: Array<{ id: string; email: string; role: string }> }>().users;
  const ownerUser = users.find((u) => u.email === "owner@localhost")!;
  const adminUser = users.find((u) => u.email === "admin@localhost")!;
  const freeUser = users.find((u) => u.email === "free@localhost")!;
  const proUser = users.find((u) => u.email === "pro@localhost")!;

  await app.inject({ method: "PATCH", url: `/v1/access/users/${proUser.id}`, headers: { cookie: ownerCookie, origin: ORIGIN }, payload: { planTier: "pro" } });

  const adminCookie = await loginCookie(app, "admin@localhost", "admin-password-123");
  const freeCookie = await loginCookie(app, "free@localhost", "viewer-password-123");
  const proCookie = await loginCookie(app, "pro@localhost", "viewer-password-123");

  // Machine key isolation
  const mkRes = await app.inject({
    method: "POST",
    url: "/v1/access/keys",
    headers: { cookie: ownerCookie, origin: ORIGIN },
    payload: { label: "agent-key", scopes: ["read", "sources:write", "collect"], allowedSourceIds: [], expiresInDays: 7 },
  });
  const machineToken = mkRes.json<{ token: string }>().token;
  for (const path of ["/v1/sources/credentials", "/v1/quotas/summary", "/v1/access/users"]) {
    assert.equal((await app.inject({ method: "GET", url: path, headers: { authorization: `Bearer ${machineToken}` } })).statusCode, 403);
  }
  assert.equal((await app.inject({ method: "GET", url: "/v1/sources/credentials", headers: { cookie: freeCookie } })).statusCode, 403);

  // Unified Apify credential covers both kaix and red_crawler
  assert.equal(kaixProvider.capability.enabled, false);
  assert.equal(redProvider.capability.enabled, false);
  const putApify = await app.inject({
    method: "PUT",
    url: "/v1/sources/credentials/apify",
    headers: { cookie: adminCookie, origin: ORIGIN },
    payload: { apiKey: "apify-unified-token-1234" },
  });
  assert.equal(putApify.statusCode, 200);
  assert.equal(kaixProvider.capability.enabled, true);
  assert.equal(redProvider.capability.enabled, true);
  await app.inject({ method: "DELETE", url: "/v1/sources/credentials/apify", headers: { cookie: ownerCookie, origin: ORIGIN } });
  assert.equal(kaixProvider.capability.enabled, false);

  // Create a free newsnow source as admin
  const srcRes = await app.inject({
    method: "POST",
    url: "/v1/sources",
    headers: { cookie: adminCookie, origin: ORIGIN },
    payload: {
      platform: "web",
      primaryProvider: "newsnow",
      label: "HN Policy Test",
      target: { type: "search", query: "hackernews" },
      contentKind: "article",
      deliveryMode: "pull",
    },
  });
  assert.equal(srcRes.statusCode, 200);
  const sourceId = srcRes.json<{ source: { id: string } }>().source.id;

  const collectBody = {
    from: "2026-11-19T00:00:00.000Z",
    to: "2026-11-20T00:00:00.000Z",
    limit: 5,
  };

  // Anonymous guest isolation with publicRead=true: public directory readable, private routes & POST rejected with 401
  assert.equal((await app.inject({ method: "GET", url: "/v1/public/sources" })).statusCode, 200);
  assert.equal((await app.inject({ method: "GET", url: "/v1/quotas/summary" })).statusCode, 401);
  assert.equal((await app.inject({
    method: "POST",
    url: `/v1/sources/${sourceId}/collect`,
    headers: { origin: ORIGIN, "idempotency-key": "k-guest-deny" },
    payload: collectBody,
  })).statusCode, 401);

  // Default-deny: both free and pro are initially disabled for manual collect
  assert.equal((await app.inject({
    method: "POST",
    url: `/v1/sources/${sourceId}/collect`,
    headers: { cookie: freeCookie, origin: ORIGIN, "idempotency-key": "k-free-deny" },
    payload: collectBody,
  })).statusCode, 403);
  assert.equal((await app.inject({
    method: "POST",
    url: `/v1/sources/${sourceId}/collect`,
    headers: { cookie: proCookie, origin: ORIGIN, "idempotency-key": "k-pro-deny" },
    payload: collectBody,
  })).statusCode, 403);

  // Admin cannot modify plan policies or owner quota; Owner can
  assert.equal((await app.inject({
    method: "PUT",
    url: "/v1/quotas/plans/free",
    headers: { cookie: adminCookie, origin: ORIGIN },
    payload: { manualCollectEnabled: true, allowedProviders: ["newsnow"], allowedSourceIds: null, dailyRequests: 1, dailyResources: 10, maxBatchLimit: 10, maxCommentsPerPost: 0, revision: 1 },
  })).statusCode, 403);
  assert.equal((await app.inject({
    method: "PUT",
    url: `/v1/quotas/users/${ownerUser.id}`,
    headers: { cookie: adminCookie, origin: ORIGIN },
    payload: { dailyRequests: 5 },
  })).statusCode, 403);

  assert.equal((await app.inject({
    method: "PUT",
    url: "/v1/quotas/plans/free",
    headers: { cookie: ownerCookie, origin: ORIGIN },
    payload: { manualCollectEnabled: true, allowedProviders: ["newsnow"], allowedSourceIds: null, dailyRequests: 1, dailyResources: 10, maxBatchLimit: 10, maxCommentsPerPost: 0, revision: 1 },
  })).statusCode, 200);

  // Free user can submit 1 authorized collect job; idempotent replay returns same job; 2nd job hits 429
  const freeOk = await app.inject({
    method: "POST",
    url: `/v1/sources/${sourceId}/collect`,
    headers: { cookie: freeCookie, origin: ORIGIN, "idempotency-key": "k-free-1" },
    payload: collectBody,
  });
  assert.equal(freeOk.statusCode, 200);
  const jobId = freeOk.json<{ jobId: string }>().jobId;

  const freeReplay = await app.inject({
    method: "POST",
    url: `/v1/sources/${sourceId}/collect`,
    headers: { cookie: freeCookie, origin: ORIGIN, "idempotency-key": "k-free-1" },
    payload: collectBody,
  });
  assert.equal(freeReplay.statusCode, 200);
  assert.equal(freeReplay.json<{ jobId: string }>().jobId, jobId);

  assert.equal((await app.inject({
    method: "POST",
    url: `/v1/sources/${sourceId}/collect`,
    headers: { cookie: freeCookie, origin: ORIGIN, "idempotency-key": "k-free-2" },
    payload: collectBody,
  })).statusCode, 429);

  // Job isolation: pro user cannot see or cancel free user's job; admin can see all
  const proRecent = await app.inject({ method: "GET", url: "/v1/source-jobs/recent", headers: { cookie: proCookie } });
  assert.equal(proRecent.json<{ jobs: unknown[] }>().jobs.length, 0);
  assert.equal((await app.inject({ method: "POST", url: `/v1/source-jobs/${jobId}/cancel`, headers: { cookie: proCookie, origin: ORIGIN }, payload: {} })).statusCode, 403);

  const adminRecent = await app.inject({ method: "GET", url: "/v1/source-jobs/recent", headers: { cookie: adminCookie } });
  assert.ok(adminRecent.json<{ jobs: Array<{ id: string; requesterEmail: string | null }> }>().jobs.some((j) => j.id === jobId && j.requesterEmail === "free@localhost"));

  // Admin can set quota override for viewer without changing planTier
  assert.equal((await app.inject({
    method: "PUT",
    url: `/v1/quotas/users/${freeUser.id}`,
    headers: { cookie: adminCookie, origin: ORIGIN },
    payload: { dailyRequests: 3 },
  })).statusCode, 200);
  // Free user cancels their queued job, then submits a new one under the updated override
  assert.equal((await app.inject({
    method: "POST",
    url: `/v1/source-jobs/${jobId}/cancel`,
    headers: { cookie: freeCookie, origin: ORIGIN },
    payload: {},
  })).statusCode, 200);
  const queued = await app.inject({
    method: "POST",
    url: `/v1/sources/${sourceId}/collect`,
    headers: { cookie: freeCookie, origin: ORIGIN, "idempotency-key": "k-free-3" },
    payload: collectBody,
  });
  assert.equal(queued.statusCode, 200, queued.body);
  await db.pool.query("UPDATE plan_collection_policy SET max_batch_limit=1 WHERE plan_tier='free'");
  assert.equal(await workOnce(db.pool, [newsnowProvider]), true);
  const dispatched = await db.pool.query("SELECT status,request_count FROM source_collection_job WHERE id=$1", [queued.json().jobId]);
  assert.deepEqual(dispatched.rows, [{ status: "cancelled", request_count: 0 }]);

  await db.pool.query(`UPDATE plan_collection_policy SET allowed_providers=ARRAY['kaix'],max_batch_limit=50 WHERE plan_tier='free'`);
  const mockKaix = new KaixContentConnector({ networkEnabled: true, apiToken: "synthetic-fixture" });
  const redditApp = await buildApp({
    pool: db.pool, sessionSecret: SESSION_SECRET, origin: ORIGIN, secureCookies: false, providers: [mockKaix],
  });
  t.after(() => redditApp.close());
  const commentSrc = await redditApp.inject({
    method: "POST", url: "/v1/sources", headers: { cookie: ownerCookie, origin: ORIGIN },
    payload: {
      platform: "reddit", primaryProvider: "kaix", label: "Comment policy fixture", contentKind: "comment",
      target: { type: "post", postId: "t3_root123" }, deliveryMode: "pull",
    },
  });
  assert.equal(commentSrc.statusCode, 200, commentSrc.body);
  const denied = await redditApp.inject({
    method: "POST", url: `/v1/sources/${commentSrc.json().source.id}/collect`,
    headers: { cookie: freeCookie, origin: ORIGIN, "idempotency-key": "comment-policy" },
    payload: collectBody,
  });
  assert.equal(denied.statusCode, 422, denied.body);
  assert.match(denied.body, /Comment hydration exceeds/);
  await db.pool.query("UPDATE plan_collection_policy SET max_comments_per_post=10,daily_resources=32,daily_requests=10 WHERE plan_tier='free'");
  await db.pool.query("UPDATE app_user SET quota_override=NULL WHERE id=$1", [freeUser.id]);
  const postCollect = await redditApp.inject({
    method: "POST", url: `/v1/sources/${commentSrc.json().source.id}/collect`,
    headers: { cookie: freeCookie, origin: ORIGIN, "idempotency-key": "post-collect-retry" },
    payload: { ...collectBody, limit: 10, includeComments: true },
  });
  assert.equal(postCollect.statusCode, 200, postCollect.body);
  const retry = await redditApp.inject({
    method: "POST", url: `/v1/source-jobs/${postCollect.json().jobId}/retry`,
    headers: { cookie: freeCookie, origin: ORIGIN },
    payload: {},
  });
  assert.equal(retry.statusCode, 200, retry.body);
  const kaixUsage = await db.pool.query("SELECT resources_reserved FROM user_provider_usage WHERE user_id=$1 AND provider='kaix'", [freeUser.id]);
  assert.deepEqual(kaixUsage.rows, [{ resources_reserved: 22 }]);
  assert.equal(adminUser.role, "admin");
});
