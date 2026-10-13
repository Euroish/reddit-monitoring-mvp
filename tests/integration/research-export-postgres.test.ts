import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PostgresClient } from "../../src/storage/postgres/postgres-client";
import { runMigrations } from "../../src/storage/schema/run-migrations";
import { PostgresSourceContentRepository } from "../../src/storage/repositories/postgres/postgres-source-content.repository";
import { PostgresResearchExportRepository } from "../../src/storage/repositories/postgres/postgres-research-export.repository";
import { SourceContentService } from "../../src/application/services/source-content.service";
import { ResearchExportService, RESEARCH_EXPORT_MAX_BYTES } from "../../src/application/services/research-export.service";
import { ResearchExportError } from "../../src/storage/research-export-query";
import { DemoContentProvider } from "../../src/connectors/demo/demo-content.connector";
import { commitResearchItems, createResearchSource, RESEARCH_NOW, researchItem } from "../helpers/research-export-fixtures";
import type { ResearchFreezeInput, ResearchSnapshotContext, ResearchSnapshot } from "../../src/domain/repositories/research-export-repository";

const connectionString = process.env.TEST_SOURCE_DATABASE_URL;
test("native research freeze uses one repeatable-read snapshot across interleaved content/observation/source changes and survives live deletion", { skip: !connectionString }, async () => {
  const url = new URL(connectionString!); assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && /^\/source_validation_[a-z0-9_]+$/.test(url.pathname), "Use an isolated loopback source_validation_* database");
  const database = `source_validation_research_${randomUUID().replaceAll("-", "").slice(0, 12)}`, adminUrl = new URL(url); adminUrl.pathname = "/postgres";
  const admin = new PostgresClient({ connectionString: adminUrl.href, max: 1 }); try { await admin.query(`CREATE DATABASE "${database}"`); } finally { await admin.close(); } url.pathname = `/${database}`;
  const db = new PostgresClient({ connectionString: url.href, max: 3 }), writer = new PostgresClient({ connectionString: url.href, max: 2 }), observer = new PostgresClient({ connectionString: url.href, max: 1 });
  try {
    await runMigrations({ db });
    const userId = randomUUID(), otherId = randomUUID();
    for (const id of [userId, otherId]) await db.query("INSERT INTO app_user(id,email,role,status) VALUES($1,$2,'viewer','active')", [id, `${id}@example.test`]);
    const source = new PostgresSourceContentRepository(db), writeSource = new PostgresSourceContentRepository(writer), origin = await createResearchSource(source), originalItems = Array.from({ length: 205 }, (_, index) => researchItem(origin, index));
    await commitResearchItems(source, origin, originalItems);
    await writer.query("INSERT INTO content_observation(content_id,collection_source_id,provider,source_observed_at,fetched_at,time_basis,maturity,metrics,evidence_key) VALUES($1,$2,'demo_reddit',NULL,$3,'unknown','unknown','{\"reddit.score\":888}'::jsonb,'later-unknown-source-time')", [originalItems[0].id, origin.id, "2026-10-13T02:00:00.000Z"]);
    let interleaved = false, isolation = "";
    const overBudgetContentReads = new Set<string>();
    const overBudgetSourceReads = new Set<string>();
    class InterleavedRepository extends PostgresResearchExportRepository {
      override freeze(input: ResearchFreezeInput, capture: (context: ResearchSnapshotContext) => Promise<ResearchSnapshot>) {
        return super.freeze(input, context => {
          const list = context.content.listContent.bind(context.content);
          const listSources = context.content.listSourcesForResearch.bind(context.content);
          context.content.listSourcesForResearch = async query => {
            if (input.name.includes("budget rejection")) overBudgetSourceReads.add(input.name);
            return listSources(query);
          };
          context.content.listContent = async query => {
            if (input.name.includes("budget rejection")) overBudgetContentReads.add(input.name);
            const page = await list(query);
            if (!interleaved) {
              interleaved = true;
              await writer.query("UPDATE content SET title='Concurrent changed title',body_text='Concurrent changed body' WHERE id=$1", [originalItems[0].id]);
              await writer.query("UPDATE content_observation SET metrics='{\"reddit.score\":99,\"reddit.comments\":4}'::jsonb WHERE content_id=$1", [originalItems[0].id]);
              await writer.withTransaction(async client => {
                await client.query("DELETE FROM content_discovery WHERE content_id=$1", [originalItems[2].id]);
                await client.query("DELETE FROM content_observation WHERE content_id=$1", [originalItems[2].id]);
                await client.query("DELETE FROM content WHERE id=$1", [originalItems[2].id]);
              });
              await writeSource.updateSource(origin.id, { label: "Concurrent changed label" }, RESEARCH_NOW);
              await commitResearchItems(writeSource, origin, [researchItem(origin, 9000)]);
            }
            return page;
          };
          return capture(context);
        });
      }
    }
    const content = new SourceContentService(source, new DemoContentProvider("reddit", () => RESEARCH_NOW), () => RESEARCH_NOW);
    const repository = new InterleavedRepository(db, async (client, ids) => {
      isolation = (await client.query("SHOW transaction_isolation")).rows[0].transaction_isolation;
      return (await new PostgresSourceContentRepository({ query: client.query.bind(client), withTransaction: async callback => callback(client) }).searchCoverage(ids)).indexed;
    });
    const service = new ResearchExportService(repository, content, () => RESEARCH_NOW), frozen = await service.create(userId, { name: "Native consistent set", query: { sourceId: origin.id } });
    assert.equal(isolation, "repeatable read"); assert.equal(interleaved, true); assert.equal(frozen.total, 205); assert.equal(frozen.manifest.coverage.indexed, 205); assert.equal(frozen.manifest.sources[0].label, "Original research label");
    const all = []; let cursor: string | undefined;
    do { const page = await service.pageContent(userId, frozen.id, { limit: 61, cursor }); assert.equal(page.total, 205); assert.deepEqual(page.manifest, frozen.manifest); all.push(...page.items); cursor = page.nextCursor ?? undefined; } while (cursor);
    assert.equal(all.length, 205); assert.equal(new Set(all.map(item => item.id)).size, 205);
    const original = all.find(item => item.externalId === "900719925474099312345")!; assert.equal(original.title, "=SUM(A1:A2)"); assert.equal(original.observations[0].metrics["reddit.score"], 0); assert.equal(original.observations[0].metrics["reddit.comments"], null);
    assert.equal(original.observations[0].sourceObservedAt, RESEARCH_NOW, "Known source time is selected before a later fetch with unknown source time");
    assert.ok(all.some(item => item.id === originalItems[2].id)); assert.ok(!all.some(item => item.externalId === "research_9000")); assert.equal(all.find(item => item.externalId === "research_1")!.text, null);
    for (const marker of ["NEVER_FREEZE_RAW", "NEVER_FREEZE_TOKEN"]) assert.equal(JSON.stringify(all).includes(marker), false);
    class FailedMemberRepository extends PostgresResearchExportRepository {
      override freeze(input: ResearchFreezeInput, capture: (context: ResearchSnapshotContext) => Promise<ResearchSnapshot>) {
        return super.freeze(input, async context => {
          const snapshot = await capture(context);
          // Force a storage failure in the second member batch, after the parent and first batch were inserted.
          snapshot.items[100] = snapshot.items[0]; return snapshot;
        });
      }
    }
    await assert.rejects(new ResearchExportService(new FailedMemberRepository(db), content, () => RESEARCH_NOW).create(userId, { name: "Forced member rollback", query: { sourceId: origin.id } }), (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "23505"));
    assert.equal(Number((await observer.query("SELECT COUNT(*) AS n FROM research_export")).rows[0].n), 1);
    assert.equal(Number((await observer.query("SELECT COUNT(*) AS n FROM research_export_member")).rows[0].n), 205, "The parent and already inserted member batch were rolled back atomically");
    await writer.withTransaction(async client => {
      const ids = originalItems.map(item => item.id);
      await client.query("DELETE FROM content_discovery WHERE content_id=ANY($1::uuid[])", [ids]);
      await client.query("DELETE FROM content_observation WHERE content_id=ANY($1::uuid[])", [ids]);
      await client.query("DELETE FROM content WHERE id=ANY($1::uuid[])", [ids]);
    });
    assert.equal((await service.pageContent(userId, frozen.id, { limit: 100 })).total, 205); assert.equal(Number((await observer.query("SELECT COUNT(*) AS n FROM research_export_member WHERE export_id=$1", [frozen.id])).rows[0].n), 205);
    assert.equal(await repository.get(otherId, frozen.id), null); assert.equal(await repository.page(otherId, frozen.id, { limit: 100 }), null); assert.equal(await repository.delete(otherId, frozen.id), false);
    const first = await service.pageContent(userId, frozen.id, { limit: 1 }); assert.ok(first.nextCursor); await assert.rejects(service.pageContent(otherId, frozen.id, { cursor: first.nextCursor! }), /Cursor does not belong/);
    const next = await service.create(userId, { name: "Second native set", query: { sourceId: origin.id } }); assert.equal(next.total, 1);
    await assert.rejects(service.pageContent(userId, next.id, { cursor: first.nextCursor! }), /Cursor does not belong/);
    assert.deepEqual(await service.delete(userId, frozen.id), { deleted: true }); assert.equal(Number((await observer.query("SELECT COUNT(*) AS n FROM research_export_member WHERE export_id=$1", [frozen.id])).rows[0].n), 0);
    // Real partial coverage is measurable and is represented explicitly for non-search snapshots.
    await writer.query("DELETE FROM public_content_search_document WHERE content_id=$1", [researchItem(origin, 9000).id]);
    const partial = await service.create(userId, { name: "Measured partial", query: { sourceId: origin.id } }); assert.equal(partial.manifest.coverage.indexed, 0); assert.ok(partial.manifest.limitations.some(item => item.includes("partial")));
    const countBefore = Number((await observer.query("SELECT COUNT(*) AS n FROM research_export")).rows[0].n);
    await assert.rejects(service.create(userId, { name: "Incomplete search rejected", query: { sourceId: origin.id, query: "Research" } }), error => error instanceof Error && /coverage is incomplete/.test(error.message));
    await commitResearchItems(writeSource, origin, [researchItem(origin, 9001), researchItem(origin, 9002)]);
    await assert.rejects(service.create(userId, { name: "Row budget rejection", query: { sourceId: origin.id }, maxRows: 2 }), error => error instanceof ResearchExportError && error.status === 413);
    const large = "你".repeat(Math.ceil(RESEARCH_EXPORT_MAX_BYTES / 3)); await writer.query("UPDATE content SET body_text=$2 WHERE id=$1", [researchItem(origin, 9000).id, large]);
    await assert.rejects(service.create(userId, { name: "UTF8 budget rejection", query: { sourceId: origin.id } }), error => error instanceof ResearchExportError && error.status === 413);
    assert.equal(overBudgetContentReads.has("UTF8 budget rejection"), false, "Oversized body must be rejected by SQL scalar preflight before materializing a content page");
    const media = [{ type: "image", url: `https://example.test/${large}`, previewUrl: null, altText: null, durationSeconds: null }];
    await writer.query("UPDATE content SET body_text='small',content_media=$2::jsonb WHERE id=$1", [researchItem(origin, 9000).id, JSON.stringify(media)]);
    await assert.rejects(service.create(userId, { name: "JSON budget rejection", query: { sourceId: origin.id } }), error => error instanceof ResearchExportError && error.status === 413);
    assert.equal(overBudgetContentReads.has("JSON budget rejection"), false, "Oversized media JSON must be rejected before listContent too");
    await writer.query("UPDATE content SET content_media='[]'::jsonb WHERE id=$1", [researchItem(origin, 9000).id]);
    await writer.query("UPDATE content_observation SET metrics=$2::jsonb WHERE content_id=$1", [researchItem(origin, 9000).id, JSON.stringify({ "reddit.score": 0, "provider.raw_blob": large })]);
    await assert.rejects(service.create(userId, { name: "Observation budget rejection", query: { sourceId: origin.id } }), error => error instanceof ResearchExportError && error.status === 413);
    assert.equal(overBudgetContentReads.has("Observation budget rejection"), false, "Oversized scoped observation JSON must be rejected before listContent");
    await writer.query("UPDATE content_observation SET metrics='{\"reddit.score\":0}'::jsonb WHERE content_id=$1", [researchItem(origin, 9000).id]);
    await writer.query("UPDATE collection_source SET label=$2 WHERE id=$1", [origin.id, large]);
    await assert.rejects(service.create(userId, { name: "Source budget rejection", query: { sourceId: origin.id } }), error => error instanceof ResearchExportError && error.status === 413);
    assert.equal(overBudgetContentReads.has("Source budget rejection"), false); assert.equal(overBudgetSourceReads.has("Source budget rejection"), false, "Oversized source metadata is also refused before materialization");
    assert.equal(Number((await observer.query("SELECT COUNT(*) AS n FROM research_export")).rows[0].n), countBefore, "All rejected freezes leave no parent snapshot");
    assert.equal(Number((await observer.query("SELECT COUNT(*) AS n FROM research_export_member m LEFT JOIN research_export e ON e.id=m.export_id WHERE e.id IS NULL")).rows[0].n), 0);
    console.log(JSON.stringify({ scope: "native isolated frozen research", database, isolation, frozenMembers: 205, pagesStable: true, liveDeletionIndependent: true, budgetRejectionsAtomic: true, ownershipScoped: true, realSourceRequests: 0 }));
  } finally { await db.close(); await writer.close(); await observer.close(); }
});
