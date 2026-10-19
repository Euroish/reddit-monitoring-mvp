import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PostgresClient } from "../../src/storage/postgres/postgres-client";
import { runMigrations } from "../../src/storage/schema/run-migrations";
import { PostgresSourceContentRepository } from "../../src/storage/repositories/postgres/postgres-source-content.repository";
import { PostgresResearchExportRepository } from "../../src/storage/repositories/postgres/postgres-research-export.repository";
import { ResearchExportService } from "../../src/application/services/research-export.service";
import { createApiServer } from "../../apps/api/src/create-api-server";
import { RedditMockConnector } from "../../src/connectors/reddit/reddit-mock.connector";
import { createApiTestRepositories, startServer, stopServer } from "./api-server.helpers";
import { BLUESKY_NOW, verifyBlueskyPipeline } from "../helpers/bluesky-content-fixtures";

const connectionString = process.env.TEST_SOURCE_DATABASE_URL;
test("PostgreSQL Bluesky pages, public API/export and frozen research preserve AT identities and nullable metrics", { skip: !connectionString }, async () => {
  const url = new URL(connectionString!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && /^\/source_validation_[a-z0-9_]+$/.test(url.pathname));
  const adminUrl = new URL(url); adminUrl.pathname = "/postgres";
  const admin = new PostgresClient({ connectionString: adminUrl.href, max: 1 });
  const database = `source_validation_bluesky_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  try { await admin.query(`CREATE DATABASE "${database}"`); } finally { await admin.close(); }
  url.pathname = `/${database}`;
  const db = new PostgresClient({ connectionString: url.href, max: 3 });
  try {
    assert.ok((await runMigrations({ db })).includes("040_bluesky_platform.sql"));
    assert.deepEqual(await runMigrations({ db }), []);
    const { service, root } = await verifyBlueskyPipeline(new PostgresSourceContentRepository(db));
    const userId = randomUUID();
    await db.query("INSERT INTO app_user(id,email,role,status) VALUES($1,'bluesky-fixture@example.test','viewer','active')", [userId]);
    const research = new ResearchExportService(new PostgresResearchExportRepository(db), service, () => BLUESKY_NOW);
    const frozen = await research.create(userId, { name: "Bluesky fixture", query: { platform: "bluesky" } });
    const members = await research.pageContent(userId, frozen.id);
    assert.equal(members.total, 3);
    assert.ok(members.items.some(item => item.observations[0].metrics["bluesky.likes"] === 0));
    assert.ok(members.items.some(item => item.platformDetails.platform === "bluesky" && item.platformDetails.cid === "synthetic-cid-root"));
    assert.ok(members.manifest.metricDefinitions.some(metric => metric.key === "bluesky.likes"));
    const server = createApiServer({ repositories: createApiTestRepositories(), sourceContent: service, createConnector: () => new RedditMockConnector(), auth: { bearerToken: "bluesky-fixture-token" }, logger: () => {} });
    const base = await startServer(server), headers = { authorization: "Bearer bluesky-fixture-token" };
    try {
      const list = await fetch(`${base}/v1/content?platform=bluesky&metricKey=bluesky.likes&minMetric=0&maxMetric=0`, { headers });
      assert.equal(list.status, 200); assert.equal((await list.json()).items[0].externalId, root.externalId);
      const detail = await fetch(`${base}/v1/content/${root.id}`, { headers }); assert.equal(detail.status, 200);
      const csv = await fetch(`${base}/v1/content/export?format=csv&platform=bluesky`, { headers });
      assert.equal(csv.status, 200); assert.equal(csv.headers.get("x-export-count"), "3"); assert.ok((await csv.text()).includes("at://did:plc:syntheticfixture/"));
    } finally { await stopServer(server); }
  } finally { await db.close(); }
});
