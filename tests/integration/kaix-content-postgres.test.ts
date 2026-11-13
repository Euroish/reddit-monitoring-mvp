import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PostgresClient } from "../../src/storage/postgres/postgres-client";
import { runMigrations } from "../../src/storage/schema/run-migrations";
import { PostgresSourceContentRepository } from "../../src/storage/repositories/postgres/postgres-source-content.repository";
import { verifyKaixPipeline } from "../helpers/kaix-content-fixtures";
import { createApiServer } from "../../apps/api/src/create-api-server";
import { RedditMockConnector } from "../../src/connectors/reddit/reddit-mock.connector";
import { createApiTestRepositories, startServer, stopServer } from "./api-server.helpers";

const connectionString = process.env.TEST_SOURCE_DATABASE_URL;
test("native SQL kaix uses paid budgets, canonical Reddit identity, observations, search, statistics and export", { skip: !connectionString }, async () => {
  const url = new URL(connectionString!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && /^\/source_validation_[a-z0-9_]+$/.test(url.pathname));
  const adminUrl = new URL(url); adminUrl.pathname = "/postgres";
  const admin = new PostgresClient({ connectionString: adminUrl.href, max: 1 });
  const database = `source_validation_kaix_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  await admin.query(`CREATE DATABASE "${database}"`);
  url.pathname = `/${database}`;
  const db = new PostgresClient({ connectionString: url.href, max: 2 });
  try {
    await runMigrations({ db });
    const { service, source } = await verifyKaixPipeline(new PostgresSourceContentRepository(db));
    const server = createApiServer({ repositories: createApiTestRepositories(), sourceContent: service, createConnector: () => new RedditMockConnector(), auth: { bearerToken: "kaix-fixture-token" }, logger: () => {} });
    const base = await startServer(server), headers = { authorization: "Bearer kaix-fixture-token" };
    try {
      const list = await fetch(`${base}/v1/content?provider=kaix&sourceId=${source.id}`, { headers });
      assert.equal(list.status, 200); const body = await list.json(); assert.equal(body.items[0].externalId, "t3_kaix123");
      const detail = await fetch(`${base}/v1/content/${body.items[0].id}`, { headers }); assert.equal(detail.status, 200);
      const sources = await fetch(`${base}/v1/sources`, { headers }); assert.equal((await sources.json()).capabilities.find((cap: { provider: string }) => cap.provider === "kaix").enabled, true);
      const csv = await fetch(`${base}/v1/content/export?format=csv&provider=kaix&sourceId=${source.id}`, { headers });
      assert.equal(csv.status, 200); assert.equal(csv.headers.get("x-export-count"), "1"); assert.ok((await csv.text()).includes("t3_kaix123"));
    } finally { await stopServer(server); }
  }
  finally { await db.close(); try { await admin.query(`DROP DATABASE "${database}"`); } finally { await admin.close(); } }
});
