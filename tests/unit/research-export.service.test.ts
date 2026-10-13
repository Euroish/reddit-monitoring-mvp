import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { ResearchExportService, researchExportCsv, RESEARCH_EXPORT_MAX_BYTES } from "../../src/application/services/research-export.service";
import { SourceContentService } from "../../src/application/services/source-content.service";
import { DemoContentProvider } from "../../src/connectors/demo/demo-content.connector";
import { InMemorySourceContentRepository } from "../../src/storage/repositories/in-memory/source-content.repository";
import { InMemoryResearchExportRepository } from "../../src/storage/repositories/in-memory/research-export.repository";
import { ResearchExportError } from "../../src/storage/research-export-query";
import { handleResearchExportRoute, matchResearchExportRoute } from "../../apps/api/src/research-export-routes";
import { commitResearchItems, createResearchSource, RESEARCH_NOW, researchItem } from "../helpers/research-export-fixtures";
import type { ResearchFreezeInput, ResearchSnapshotContext, ResearchSnapshot } from "../../src/domain/repositories/research-export-repository";

async function fixture(count = 3) {
  const source = new InMemorySourceContentRepository(), origin = await createResearchSource(source);
  await commitResearchItems(source, origin, Array.from({ length: count }, (_, index) => researchItem(origin, index, index === 3 ? { text: "" } : {})));
  const content = new SourceContentService(source, new DemoContentProvider("reddit", () => RESEARCH_NOW), () => RESEARCH_NOW), repository = new InMemoryResearchExportRepository(source), service = new ResearchExportService(repository, content, () => RESEARCH_NOW);
  return { source, origin, content, repository, service, userId: randomUUID(), otherId: randomUUID() };
}
const limitFailure = (error: unknown) => error instanceof ResearchExportError && error.status === 413;

test("research export freezes the full matching set, null/zero/string identities, manifest and cursor pages independently of live updates", async () => {
  const f = await fixture(205);
  const frozen = await f.service.create(f.userId, { name: "Research frozen set", query: { sourceId: f.origin.id } });
  assert.equal(frozen.total, 205); assert.equal(frozen.manifest.total, 205); assert.equal(frozen.manifest.scope, "frozen_stored_sample");
  assert.equal(frozen.manifest.sources[0].label, "Original research label"); assert.equal(frozen.manifest.coverage.textMissing, 101); assert.equal(frozen.manifest.coverage.textPresent, 104);
  assert.equal(frozen.manifest.coverage.indexed, 205);
  assert.equal(frozen.manifest.metricDefinitions.find(item => item.key === "reddit.score")?.unit, "count");
  const first = await f.service.pageContent(f.userId, frozen.id, { limit: 73 });
  await commitResearchItems(f.source, f.origin, [researchItem(f.origin, 0, { title: "Changed live title", text: "Changed live body" }), researchItem(f.origin, 9000)]);
  await f.source.updateSource(f.origin.id, { label: "Changed live source" }, RESEARCH_NOW);
  const all = [...first.items]; let cursor = first.nextCursor;
  while (cursor) { const page = await f.service.pageContent(f.userId, frozen.id, { limit: 73, cursor }); assert.equal(page.total, 205); assert.deepEqual(page.manifest, frozen.manifest); all.push(...page.items); cursor = page.nextCursor; }
  assert.equal(all.length, 205); assert.equal(new Set(all.map(item => item.id)).size, 205);
  const big = all.find(item => item.externalId === "900719925474099312345")!;
  assert.equal(big.title, "=SUM(A1:A2)"); assert.equal(big.observations[0].metrics["reddit.score"], 0); assert.equal(big.observations[0].metrics["reddit.comments"], null);
  assert.equal(all.find(item => item.externalId === "research_1")?.publishedAt, null);
  assert.equal(all.find(item => item.externalId === "research_3")?.text, "", "Known empty body stays distinct from null/missing body");
  assert.equal((await f.content.repository.contentStats({ sourceId: f.origin.id })).total, 206);
  const serialized = JSON.stringify({ frozen, all }); for (const secret of ["NEVER_FREEZE_RAW", "NEVER_FREEZE_TOKEN", "provider.raw_payload", "provider.token"]) assert.equal(serialized.includes(secret), false);
  assert.equal(big.platformDetails.extensions?.["reddit.locked"], false);
  const csv = researchExportCsv({ ...first, items: all }); assert.ok(csv.includes("'900719925474099312345")); assert.ok(csv.includes("'=SUM(A1:A2)")); assert.ok(csv.includes('"payload_json"')); assert.ok(csv.includes('"null"')); assert.ok(csv.includes('""reddit.score"":0')); assert.ok(csv.includes('""reddit.comments"":null'));
});

test("memory snapshot is cloned synchronously once before mutation between source cursor reads", async () => {
  const f = await fixture(205); let changed = false;
  class InterleavedRepository extends InMemoryResearchExportRepository {
    override freeze(input: ResearchFreezeInput, capture: (context: ResearchSnapshotContext) => Promise<ResearchSnapshot>) {
      return super.freeze(input, context => {
        const list = context.content.listContent.bind(context.content);
        context.content.listContent = async query => {
          const page = await list(query);
          if (!changed) { changed = true; await commitResearchItems(f.source, f.origin, [researchItem(f.origin, 0, { title: "Concurrent replacement" }), researchItem(f.origin, 9000)]); }
          return page;
        };
        return capture(context);
      });
    }
  }
  const service = new ResearchExportService(new InterleavedRepository(f.source), f.content, () => RESEARCH_NOW);
  const frozen = await service.create(f.userId, { name: "Consistent memory", query: { sourceId: f.origin.id } }); assert.equal(changed, true); assert.equal(frozen.total, 205);
  const page = await service.pageContent(f.userId, frozen.id, { limit: 100 }); let all = page.items, cursor = page.nextCursor;
  while (cursor) { const next = await service.pageContent(f.userId, frozen.id, { limit: 100, cursor }); all = [...all, ...next.items]; cursor = next.nextCursor; }
  assert.equal(all.find(item => item.externalId === "900719925474099312345")!.title, "=SUM(A1:A2)"); assert.ok(!all.some(item => item.externalId === "research_9000"));
});

test("research export ownership applies to get/list/pages/delete and continuation scopes", async () => {
  const f = await fixture(), a = await f.service.create(f.userId, { name: "A", query: {} }), b = await f.service.create(f.userId, { name: "B", query: {} });
  assert.equal((await f.service.list(f.otherId)).exports.length, 0);
  for (const work of [() => f.service.get(f.otherId, a.id), () => f.service.pageContent(f.otherId, a.id), () => f.service.delete(f.otherId, a.id)]) await assert.rejects(work, error => error instanceof ResearchExportError && error.status === 404);
  const page = await f.service.pageContent(f.userId, a.id, { limit: 1 }); assert.ok(page.nextCursor);
  await assert.rejects(f.service.pageContent(f.otherId, a.id, { cursor: page.nextCursor! }), /Cursor does not belong/);
  await assert.rejects(f.service.pageContent(f.userId, b.id, { cursor: page.nextCursor! }), /Cursor does not belong/);
  const listed = await f.service.list(f.userId, { limit: 1 }); assert.ok(listed.nextCursor);
  await assert.rejects(f.service.list(f.otherId, { cursor: listed.nextCursor! }), /Cursor does not belong/);
  assert.deepEqual(await f.service.delete(f.userId, a.id), { deleted: true }); await assert.rejects(f.service.get(f.userId, a.id), /not found/);
  assert.equal((await f.service.get(f.userId, b.id)).total, 3);
});

test("complete-set row and UTF8 byte limits leave no partial export, and unmeasured index coverage is rejected", async () => {
  const f = await fixture();
  await assert.rejects(f.service.create(f.userId, { name: "Too many selected", query: {}, maxRows: 2 }), limitFailure); assert.equal((await f.service.list(f.userId)).exports.length, 0);
  const large = "你".repeat(Math.ceil(RESEARCH_EXPORT_MAX_BYTES / 3)); await commitResearchItems(f.source, f.origin, [researchItem(f.origin, 0, { text: large })]);
  await assert.rejects(f.service.create(f.userId, { name: "Too many UTF8 bytes", query: {} }), limitFailure); assert.equal((await f.service.list(f.userId)).exports.length, 0);
  const unavailable = new ResearchExportService(new InMemoryResearchExportRepository(f.source, async () => null), f.content, () => RESEARCH_NOW);
  // Narrow the query to a small member so coverage, rather than the byte budget, is the rejected condition.
  await assert.rejects(unavailable.create(f.userId, { name: "Unavailable coverage", query: { query: "Research 人工智能 2" } }), error => error instanceof ResearchExportError && error.status === 503);
});

test("default hard limit rejects 20001 matching members rather than freezing a truncated denominator", async () => {
  const f = await fixture(20001);
  await assert.rejects(f.service.create(f.userId, { name: "Hard-limit fixture", query: {} }), limitFailure);
  assert.equal((await f.service.list(f.userId)).exports.length, 0);
  await assert.rejects(f.service.create(f.userId, { name: "Cannot raise limit", query: {}, maxRows: 20001 }), /maxRows must be 1–20000/);
});

test("research route helper accepts viewer sessions, rejects machines/foreign IDs and serves fixed JSON/CSV page metadata", async () => {
  const f = await fixture(), actor = { type: "session" as const, userId: f.userId, role: "viewer" as const, email: "viewer@example.test" };
  const call = (method: string, path: string, body?: unknown, selectedActor = actor) => handleResearchExportRoute({ method, url: new URL(path, "http://localhost"), body, actor: selectedActor, requestId: "fixture-request", service: f.service });
  assert.equal(matchResearchExportRoute("POST", "/v1/research-exports")?.personal, true);
  for (const selected of [null, { type: "machine" as const }]) assert.equal((await handleResearchExportRoute({ method: "GET", url: new URL("http://localhost/v1/research-exports"), actor: selected, requestId: "r", service: f.service })).statusCode, 401);
  const created = await call("POST", "/v1/research-exports", { name: "Viewer export", query: {} }); assert.equal(created.statusCode, 201); const id = (created.body as { researchExport: { id: string } }).researchExport.id;
  assert.equal((await call("GET", `/v1/research-exports/${id}`, undefined, { ...actor, userId: f.otherId })).statusCode, 404);
  const json = await call("GET", `/v1/research-exports/${id}/content?limit=1`); assert.equal(json.statusCode, 200); assert.equal((json.body as { total: number }).total, 3);
  const csv = await call("GET", `/v1/research-exports/${id}/export?format=csv&limit=1`); assert.equal(csv.statusCode, 200); assert.equal(csv.headers?.["X-Export-Total-Matching"], "3"); assert.equal(csv.headers?.["X-Export-Count"], "1"); assert.ok(csv.headers?.["X-Export-Next-Cursor"]); assert.ok(csv.rawBody?.includes("research_export_manifest"));
  assert.equal((await call("GET", `/v1/research-exports/${id}/content?limit=101`)).statusCode, 400); assert.equal((await call("GET", `/v1/research-exports/${id}/export?format=raw`)).statusCode, 400);
  for (const query of [{ cursor: "fake" }, { token: "secret" }, { limit: 1 }]) assert.equal((await call("POST", "/v1/research-exports", { name: "Rejected", query })).statusCode, 400);
});
