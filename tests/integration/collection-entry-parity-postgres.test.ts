import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { twitterApis } from "../../src/connectors/x/twitterapis";
import { buildApp } from "../../apps/api/src/app";
import { bootstrapOwner } from "../../src/modules/access/index";
import { KaixContentConnector } from "../../src/connectors/reddit/kaix-content.connector";
import { redCrawler } from "../../src/connectors/reddit/red-crawler";
import { testDatabase } from "../helpers/database";

test("PG16 collection entry parity: constraints, atomic rejection, and relative-window replay", async t => {
  const db = await testDatabase();
  t.after(db.close);
  await bootstrapOwner(db.pool, "fixture-password-123", "owner@example.test");
  const origin = "http://parity.test";
  const app = await buildApp({ pool: db.pool, origin, secureCookies: false, publicRegistration: true,
    sessionSecret: "parity-secret".repeat(4), providers: [
      new KaixContentConnector({ networkEnabled: true, apiToken: "fixture" }),
      redCrawler({ SOURCE_NETWORK_ENABLED: "true", APIFY_API_TOKEN: "fixture" }),
      twitterApis({ SOURCE_NETWORK_ENABLED: "true", TWITTERAPIS_API_KEY: "fixture" }),
    ] });
  t.after(() => app.close());
  async function login(email: string) {
    const result = await app.inject({ method: "POST", url: "/v1/auth/login", headers: { origin },
      payload: { email, password: "fixture-password-123" } });
    assert.equal(result.statusCode, 200, result.body);
    return { origin, cookie: result.headers["set-cookie"]!.toString().split(";")[0] };
  }
  const owner = await login("owner@example.test");
  const registration = await app.inject({ method: "POST", url: "/v1/auth/register", headers: { origin },
    payload: { email: "viewer@example.test", password: "fixture-password-123" } });
  assert.equal(registration.statusCode, 200, registration.body);
  const viewer = await login("viewer@example.test");
  const created = await app.inject({ method: "POST", url: "/v1/intelligence/monitors", headers: owner,
    payload: { kind: "community_bundle", name: "Parity", config: { platforms: ["reddit"], subreddits: ["audit"] },
      dailyItemBudget: 10000 } });
  assert.equal(created.statusCode, 200, created.body);
  const monitorId = created.json().monitor.id as string;
  await db.pool.query(`UPDATE intel_monitor SET owner_user_id=(SELECT id FROM app_user WHERE email='viewer@example.test') WHERE id=$1`, [monitorId]);
  const sourceId = (await db.pool.query("SELECT collection_source_id FROM intel_monitor_source WHERE monitor_id=$1", [monitorId])).rows[0].collection_source_id;
  const collect = (headers: typeof owner, key: string, payload: object) => app.inject({ method: "POST",
    url: `/v1/intelligence/monitors/${monitorId}/collect`, headers: { ...headers, "idempotency-key": key }, payload });
  const valid = { lookbackHours: 12, limitPerSource: 20, includeComments: true, maxCommentsPerPost: 2 };
  t.beforeEach(async () => {
    await db.pool.query("DELETE FROM source_collection_job; DELETE FROM user_provider_usage; DELETE FROM source_provider_usage");
    await db.pool.query(`UPDATE plan_collection_policy SET manual_collect_enabled=true,allowed_providers='{kaix}',
      max_lookback_days=1,max_batch_limit=20,max_comments_per_post=2,daily_requests=100,daily_resources=10000 WHERE plan_tier='free'`);
  });

  await t.test("monitor authorization scopes lists, detail, analytics and mutations", async () => {
    const staff = await app.inject({ method: "POST", url: "/v1/intelligence/monitors", headers: owner,
      payload: { kind: "keyword", name: "Staff monitor", config: { platforms: ["reddit"], keywords: ["staff"] } } });
    assert.equal(staff.statusCode, 200, staff.body);
    const staffId = staff.json().monitor.id as string;
    const list = await app.inject({ url: "/v1/intelligence/monitors", headers: viewer });
    assert.equal(list.statusCode, 200, list.body);
    assert.deepEqual(list.json().monitors.map((monitor: { id: string }) => monitor.id), [monitorId]);
    const staffPath = `/v1/intelligence/monitors/${staffId}`;
    for (const url of [staffPath, `${staffPath}/overview`, `${staffPath}/posts`, `/v1/intelligence/communities?monitorId=${staffId}`]) {
      assert.equal((await app.inject({ url, headers: viewer })).statusCode, 404);
    }
    assert.equal((await app.inject({ method: "PATCH", url: staffPath, headers: viewer,
      payload: { revision: 1, name: "Denied" } })).statusCode, 404);
    assert.equal((await app.inject({ method: "DELETE", url: staffPath, headers: viewer,
      payload: { revision: 1 } })).statusCode, 404);
    assert.equal((await app.inject({ url: `/v1/intelligence/monitors/${monitorId}`, headers: owner })).statusCode, 200);
    const key = await app.inject({ method: "POST", url: "/v1/access/keys", headers: owner,
      payload: { label: "Scoped monitor reader", scopes: ["read"], allowedSourceIds: [sourceId], expiresInDays: 7 } });
    assert.equal(key.statusCode, 200, key.body);
    const machine = { authorization: `Bearer ${key.json().token}` };
    const machineList = await app.inject({ url: "/v1/intelligence/monitors", headers: machine });
    assert.equal(machineList.statusCode, 200, machineList.body);
    assert.deepEqual(machineList.json().monitors, []);
  });

  await t.test("manual and monitor routes enforce the same personal lookback", async () => {
    const to = new Date();
    const direct = await app.inject({ method: "POST", url: `/v1/sources/${sourceId}/collect`,
      headers: { ...viewer, "idempotency-key": "direct-lookback" },
      payload: { from: new Date(to.getTime() - 48 * 3600000).toISOString(), to: to.toISOString(), limit: 10 } });
    const monitor = await collect(viewer, "monitor-lookback", { lookbackHours: 48, limitPerSource: 10 });
    assert.equal(direct.statusCode, 422, direct.body);
    assert.equal(monitor.statusCode, direct.statusCode, monitor.body);
    assert.equal((await db.pool.query("SELECT 1 FROM source_collection_job")).rowCount, 0);
    assert.equal((await db.pool.query("SELECT 1 FROM user_provider_usage")).rowCount, 0);
  });

  await t.test("monitor entry cannot bypass provider node limits even as owner", async () => {
    const result = await collect(owner, "nodes", { lookbackHours: 1, limitPerSource: 100,
      includeComments: true, maxCommentsPerPost: 20 });
    assert.equal(result.statusCode, 422, result.body);
    assert.match(result.json().error.message, /2000 nodes/);
    assert.equal((await db.pool.query("SELECT 1 FROM source_collection_job")).rowCount, 0);
  });

  await t.test("concurrent replay uses client intent once, including after quota and budget changes", async () => {
    const attempts = await Promise.all([collect(viewer, "stable-window", valid), collect(viewer, "stable-window", valid)]);
    for (const result of attempts) assert.equal(result.statusCode, 200, result.body);
    assert.deepEqual(attempts[0].json().jobIds, attempts[1].json().jobIds);
    const before = (await db.pool.query("SELECT request_json,payload_hash FROM source_collection_job")).rows;
    assert.equal(before.length, 1);
    assert.match(before[0].payload_hash, /^[a-f0-9]{64}$/);
    assert.deepEqual((await db.pool.query("SELECT requests_reserved,resources_reserved FROM user_provider_usage")).rows,
      [{ requests_reserved: 1, resources_reserved: 60 }]);
    await db.pool.query("UPDATE plan_collection_policy SET manual_collect_enabled=false WHERE plan_tier='free'");
    await db.pool.query("INSERT INTO source_provider_usage(provider,day,requests,resources_reserved) VALUES('kaix',(NOW() AT TIME ZONE 'UTC')::date,0,100000)");
    const replay = await collect(viewer, "stable-window", valid);
    assert.equal(replay.statusCode, 200, replay.body);
    assert.deepEqual(replay.json().jobIds, attempts[0].json().jobIds);
    assert.deepEqual((await db.pool.query("SELECT request_json,payload_hash FROM source_collection_job")).rows, before);
    const changed = await collect(viewer, "stable-window", { ...valid, lookbackHours: 1 });
    assert.equal(changed.statusCode, 409, changed.body);
    const otherActor = await collect(owner, "stable-window", valid);
    assert.equal(otherActor.statusCode, 409, otherActor.body);
    assert.deepEqual((await db.pool.query("SELECT requests_reserved,resources_reserved FROM user_provider_usage")).rows,
      [{ requests_reserved: 1, resources_reserved: 60 }]);
  });

  await t.test("refresh replay verifies the persisted requester before returning a historical job", async () => {
    const source = await app.inject({ method: "POST", url: "/v1/sources", headers: owner,
      payload: { platform: "x", primaryProvider: "twitterapis", deliveryMode: "pull", label: "Refresh history",
        contentKind: "post", target: { type: "account", account: "audit" } } });
    assert.equal(source.statusCode, 200, source.body);
    const contentId = randomUUID();
    const jobId = randomUUID();
    const userId = (await db.pool.query("SELECT id FROM app_user WHERE email='owner@example.test'")).rows[0].id;
    // Persisted replay must not depend on content still being retained or on
    // current provider readiness, but it must retain its original requester.
    await db.pool.query(
      `INSERT INTO source_collection_job(id,collection_source_id,status,purpose,operation,provider,from_at,to_at,
        page_size,max_pages,next_run_at,created_at,request_key,request_json,requested_by_user_id,requested_by_client_kind)
       VALUES($1,$2,'succeeded','refresh','hydrate','twitterapis',NOW()-interval '1 second',NOW(),1,1,NOW(),NOW(),
        'refresh:requester',$3,$4,'browser')`,
      [jobId, source.json().source.id, { contentIds: [contentId], externalIds: ["123"] }, userId],
    );
    const replay = (headers: typeof owner) => app.inject({ method: "POST",
      url: `/v1/sources/${source.json().source.id}/refresh`,
      headers: { ...headers, "idempotency-key": "requester" }, payload: { contentIds: [contentId] } });
    const own = await replay(owner);
    assert.equal(own.statusCode, 200, own.body);
    assert.equal(own.json().jobId, jobId);
    const other = await replay(viewer);
    assert.equal(other.statusCode, 409, other.body);
    assert.equal((await db.pool.query("SELECT 1 FROM source_collection_job")).rowCount, 1);
  });

  await t.test("monitor budget rejection rolls back newly queued jobs and personal reservations", async () => {
    await db.pool.query("UPDATE intel_monitor SET daily_item_budget=20 WHERE id=$1", [monitorId]);
    const result = await collect(viewer, "monitor-budget", valid);
    assert.equal(result.statusCode, 422, result.body);
    assert.equal((await db.pool.query("SELECT 1 FROM source_collection_job")).rowCount, 0);
    assert.equal((await db.pool.query("SELECT 1 FROM user_provider_usage")).rowCount, 0);
  });

  await t.test("source provisioning requires a staff browser and respects administrative source state", async () => {
    const path = "/v1/intelligence/monitors";
    const config = { platforms: ["reddit"], subreddits: ["paused_example"] };
    const payload = { kind: "community_bundle", name: "Paused source", config };
    const create = (headers: typeof owner) => app.inject({ method: "POST", url: path, headers, payload });
    assert.equal((await create(viewer)).statusCode, 403);
    const createdStaff = await create(owner);
    assert.equal(createdStaff.statusCode, 200, createdStaff.body);
    const { id: pausedSourceId, revision } = (await db.pool.query(
      `SELECT cs.id, cs.revision FROM intel_monitor_source ms JOIN collection_source cs ON cs.id=ms.collection_source_id
       WHERE ms.monitor_id=$1`, [createdStaff.json().monitor.id])).rows[0];
    const pause = await app.inject({ method: "PATCH", url: `/v1/sources/${pausedSourceId}`, headers: owner,
      payload: { revision, state: "paused" } });
    assert.equal(pause.statusCode, 200, pause.body);
    assert.equal((await create(owner)).statusCode, 409);
    assert.equal((await db.pool.query("SELECT state FROM collection_source WHERE id=$1", [pausedSourceId])).rows[0].state, "paused");
    const ownedMonitor = `${path}/${monitorId}`;
    assert.equal((await app.inject({ method: "PATCH", url: ownedMonitor, headers: viewer,
      payload: { revision: 1, config } })).statusCode, 403);
    const disable = await app.inject({ method: "PATCH", url: ownedMonitor, headers: viewer,
      payload: { revision: 1, enabled: false } });
    assert.equal(disable.statusCode, 200, disable.body);
    assert.equal((await app.inject({ method: "PATCH", url: ownedMonitor, headers: viewer,
      payload: { revision: 2, enabled: true } })).statusCode, 403);
  });

  await t.test("managed schedules follow active references and retain operator-managed sources", async () => {
    const path = "/v1/intelligence/monitors";
    const config = { platforms: ["reddit"], subreddits: ["shared_schedule"] };
    async function create(name: string, scheduleIntervalHours: number, enabled: boolean) {
      const result = await app.inject({ method: "POST", url: path, headers: owner,
        payload: { kind: "community_bundle", name, config, scheduleIntervalHours, enabled } });
      assert.equal(result.statusCode, 200, result.body);
      return result.json().monitor.id as string;
    }
    const slower = await create("Initially disabled", 8, false);
    const sharedSourceId = (await db.pool.query("SELECT collection_source_id FROM intel_monitor_source WHERE monitor_id=$1", [slower])).rows[0].collection_source_id;
    const sourceState = async () => (await db.pool.query(
      "SELECT monitor_managed,schedule,next_due_at FROM collection_source WHERE id=$1", [sharedSourceId])).rows[0];
    assert.equal((await sourceState()).schedule.enabled, false);
    assert.equal((await sourceState()).next_due_at, null);
    const faster = await create("Faster", 4, true);
    assert.equal((await sourceState()).schedule.cadenceSeconds, 4 * 3600);
    const enable = await app.inject({ method: "PATCH", url: `${path}/${slower}`, headers: owner,
      payload: { revision: 1, enabled: true } });
    assert.equal(enable.statusCode, 200, enable.body);
    const remove = (id: string, revision: number) => app.inject({ method: "DELETE", url: `${path}/${id}`, headers: owner,
      payload: { revision } });
    const deleted = await remove(faster, 1);
    assert.equal(deleted.statusCode, 200, deleted.body);
    assert.equal((await sourceState()).schedule.cadenceSeconds, 8 * 3600);
    const jobId = randomUUID();
    await db.pool.query(`INSERT INTO source_collection_job(id,collection_source_id,status,purpose,operation,provider,from_at,to_at,
      page_size,max_pages,next_run_at,created_at) VALUES($1,$2,'queued','scheduled','radar','kaix',now()-interval '1 minute',now(),20,1,now(),now())`,
    [jobId, sharedSourceId]);
    const retarget = await app.inject({ method: "PATCH", url: `${path}/${slower}`, headers: owner,
      payload: { revision: 2, config: { ...config, subreddits: ["new_schedule"] } } });
    assert.equal(retarget.statusCode, 200, retarget.body);
    assert.equal((await sourceState()).schedule.enabled, false);
    assert.equal((await sourceState()).next_due_at, null);
    assert.equal((await db.pool.query("SELECT status FROM source_collection_job WHERE id=$1", [jobId])).rows[0].status, "cancelled");

    await db.pool.query("UPDATE collection_source SET monitor_managed=false,schedule=jsonb_set(schedule,'{enabled}','true') WHERE id=$1", [sharedSourceId]);
    const operatorReference = await create("Existing operator source", 2, true);
    assert.equal((await remove(operatorReference, 1)).statusCode, 200);
    assert.equal((await sourceState()).schedule.enabled, true);
  });
});
