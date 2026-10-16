import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PostgresClient } from "../../src/storage/postgres/postgres-client";
import { runMigrations } from "../../src/storage/schema/run-migrations";
import { PostgresContentRepository } from "../../src/storage/repositories/postgres/postgres-content.repository";
import { PostgresPostSearchDocumentRepository } from "../../src/storage/repositories/postgres/postgres-post-search-document.repository";

const connectionString = process.env.TEST_SOURCE_DATABASE_URL;
test("PostgreSQL keyword summaries count the whole stored scope with Unicode literals, English boundaries, exclusions and bounded samples", { skip: !connectionString }, async () => {
  const url = new URL(connectionString!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && /^\/source_validation_[a-z0-9_]+$/.test(url.pathname), "Use a dedicated loopback source_validation_* database");
  const db = new PostgresClient({ connectionString, max: 2 });
  try {
    await runMigrations({ db });
    const targetId = randomUUID(), canonicalSubreddit = `r/keyword_${randomUUID().slice(0, 8)}`;
    await db.query("INSERT INTO monitor_target(id,source_id,target_type,canonical_name,status,config_json) VALUES($1,'11111111-1111-1111-1111-111111111111','subreddit',$2,'paused','{}')", [targetId, canonicalSubreddit]);
    const repo = new PostgresPostSearchDocumentRepository(db), contentRepo = new PostgresContentRepository(db);
    const rows = Array.from({ length: 2205 }, (_, index) => ({
      id: randomUUID(), source: "reddit" as const, targetId, externalId: `t3_keyword_${randomUUID().replaceAll("-", "")}`, kind: "post" as const,
      title: `智能体 AI evaluation case ${index}`, bodyText: "Sufficiently long body to qualify a complete indexed research example.",
      permalink: `/r/test/comments/${index}`, createdAtSource: "2026-10-10T01:00:00.000Z", firstSeenAt: "2026-10-12T01:00:00.000Z", lastSeenAt: "2026-10-12T01:00:00.000Z",
    }));
    await contentRepo.upsertMany(rows);
    await repo.upsertMany(rows.map((row) => ({ contentId: row.id, targetId, canonicalSubreddit, title: row.title, bodySnippet: row.bodyText, permalink: row.permalink, createdAtSource: row.createdAtSource })));
    const excluded = { ...rows[0]!, id: randomUUID(), externalId: `t3_keyword_${randomUUID().replaceAll("-", "")}`, title: "智能体广告 AI evaluation fixture" };
    const polluted = { ...rows[0]!, id: randomUUID(), externalId: `t3_keyword_${randomUUID().replaceAll("-", "")}`, title: "Airflow infrastructure fixture" };
    await contentRepo.upsertMany([excluded, polluted]);
    await repo.upsertMany([excluded, polluted].map((row) => ({ contentId: row.id, targetId, canonicalSubreddit, title: row.title, bodySnippet: row.bodyText, permalink: row.permalink, createdAtSource: row.createdAtSource })));
    const summary = await repo.summarizeSearch({ canonicalSubreddit, tokens: ["智能体"], negativeTokens: ["广告"], sampleLimit: 2 });
    assert.equal(summary.totalScopeDocs, 2207);
    assert.equal(summary.supportCount, 2205);
    assert.equal(summary.qualifiedCount, 2205);
    assert.equal(summary.documents.length, 2);
    const english = await repo.summarizeSearch({ canonicalSubreddit, tokens: ["ai"], sampleLimit: 3 });
    assert.equal(english.supportCount, 2206);
    assert.equal(english.candidateCount, 2207);
    const window = await repo.summarizeSearch({ canonicalSubreddit, tokens: ["ai"], sampleLimit: 1, createdAtFrom: "2026-10-10T01:00:00.000Z", createdAtTo: "2026-10-10T02:00:00.000Z" });
    assert.equal(window.totalScopeDocs, 2207);
    assert.equal(window.supportCount, 2206);
    assert.equal((await repo.summarizeSearch({ canonicalSubreddit, tokens: ["ai"], sampleLimit: 1, createdAtTo: "2026-10-10T01:00:00.000Z" })).totalScopeDocs, 0);
    const missing = Array.from({ length: 3 }, (_, index) => ({ ...rows[0]!, id: randomUUID(), externalId: `t3_keyword_${randomUUID().replaceAll("-", "")}`, title: `AI historical unindexed fixture ${index}` }));
    await contentRepo.upsertMany(missing);
    assert.equal(await repo.seedFromContent(2), 2);
    assert.equal(await repo.seedFromContent(2), 1, "later batches must reach older missing rows instead of reselecting indexed rows");
    assert.equal(await repo.seedFromContent(2), 0);
    await contentRepo.upsertMany([{ ...missing[0]!, title: "AI historical updated fixture" }]);
    assert.equal(await repo.seedFromContent(2), 1, "an updated content field should invalidate only its index document");
    assert.equal(await repo.seedFromContent(2), 0);
  } finally { await db.close(); }
});
