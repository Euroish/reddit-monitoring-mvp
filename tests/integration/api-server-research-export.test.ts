import assert from "node:assert/strict";
import test from "node:test";
import { ResearchExportService } from "../../src/application/services/research-export.service";
import { InMemoryResearchExportRepository } from "../../src/storage/repositories/in-memory/research-export.repository";
import { contentHttpFixture } from "../helpers/content-http-fixture";
import { commitResearchItems, RESEARCH_NOW, researchItem } from "../helpers/research-export-fixtures";
import { stopServer } from "./api-server.helpers";

test("HTTP research freezes full scoped members, returns stable JSON/CSV denominators after live changes and isolates personal exports", async () => {
  const f = await contentHttpFixture((source, content) => ({ researchExports: new ResearchExportService(new InMemoryResearchExportRepository(source), content, () => RESEARCH_NOW) }));
  try {
    const privateName = "private_research_name_sentinel", privateQuery = "private_research_exclusion_sentinel";
    const created = await f.request("/v1/research-exports", "POST", { name: privateName, query: { sourceId: f.origin.id, exclusions: [privateQuery], searchMode: "literal", searchScope: "title_text" } }, f.a.cookie);
    assert.equal(created.status, 201); const frozen = created.body.researchExport, id = frozen.id;
    assert.equal(frozen.total, 5); assert.equal(frozen.manifest.total, 5); assert.equal(frozen.manifest.coverage.indexed, 5); assert.equal(frozen.manifest.query.searchMode, "literal");
    assert.equal((await f.request("/v1/research-exports", "GET", undefined, f.a.cookie)).body.exports.length, 1); assert.deepEqual((await f.request("/v1/research-exports", "GET", undefined, f.b.cookie)).body.exports, []);
    for (const [method, path] of [["GET", `/v1/research-exports/${id}`], ["GET", `/v1/research-exports/${id}/content`], ["DELETE", `/v1/research-exports/${id}`]] as const) assert.equal((await f.request(path, method, undefined, f.b.cookie)).status, 404);
    const first = await f.request(`/v1/research-exports/${id}/content?limit=2`, "GET", undefined, f.a.cookie); assert.equal(first.status, 200); assert.equal(first.body.total, 5); assert.ok(first.body.nextCursor);
    await commitResearchItems(f.source, f.origin, [researchItem(f.origin, 0, { title: "Updated live title", text: "Updated live body" }), researchItem(f.origin, 9000)]);
    await f.source.updateSource(f.origin.id, { label: "Updated live label" }, RESEARCH_NOW);
    const all = [...first.body.items]; let cursor = first.body.nextCursor;
    while (cursor) { const page = await f.request(`/v1/research-exports/${id}/content?limit=2&cursor=${cursor}`, "GET", undefined, f.a.cookie); assert.equal(page.status, 200); assert.equal(page.body.total, 5); assert.deepEqual(page.body.manifest, frozen.manifest); all.push(...page.body.items); cursor = page.body.nextCursor; }
    assert.equal(all.length, 5); assert.equal(new Set(all.map(item => item.id)).size, 5); assert.equal(all.find(item => item.externalId === "900719925474099312345").title, "=SUM(A1:A2)"); assert.ok(!all.some(item => item.externalId === "research_9000"));
    const csv = await fetch(`${f.base}/v1/research-exports/${id}/export?format=csv&limit=100`, { headers: { cookie: f.a.cookie } });
    assert.equal(csv.status, 200); assert.equal(csv.headers.get("x-export-total-matching"), "5"); assert.equal(csv.headers.get("x-export-count"), "5"); assert.equal(csv.headers.get("x-export-next-cursor"), ""); assert.equal(csv.headers.get("x-export-scope"), "frozen_members");
    const text = await csv.text(); assert.ok(text.includes("'900719925474099312345")); assert.ok(text.includes("'=SUM(A1:A2)")); assert.ok(text.includes('"payload_json"')); assert.ok(text.includes('""reddit.score"":0')); assert.ok(text.includes('""reddit.comments"":null')); assert.equal(text.includes("Updated live label"), false);
    const audit = await f.repos.appAuditRepository.list(), creation = audit.items.find(row => row.action === "content.research_export.post" && row.outcome === "succeeded"); assert.equal(creation?.actorUserId, f.users[0].id); assert.equal(creation?.resourceId, id);
    const serialized = JSON.stringify(audit); assert.equal(serialized.includes(privateName), false); assert.equal(serialized.includes(privateQuery), false);
    assert.equal((await f.request(`/v1/research-exports/${id}`, "DELETE", undefined, f.a.cookie)).status, 200); assert.equal((await f.request(`/v1/research-exports/${id}`, "GET", undefined, f.a.cookie)).status, 404);
  } finally { await stopServer(f.server); }
});

test("HTTP research rejects machine ownership, cross-export cursors and oversized complete sets without partial records", async () => {
  const f = await contentHttpFixture((source, content) => ({ researchExports: new ResearchExportService(new InMemoryResearchExportRepository(source), content, () => RESEARCH_NOW) }));
  try {
    assert.equal((await f.request("/v1/research-exports")).status, 401);
    for (const [method, path, body] of [["GET", "/v1/research-exports", undefined], ["POST", "/v1/research-exports", { name: "Machine", query: {} }]] as const) assert.equal((await f.request(path, method, body, undefined, true)).status, 401);
    const tooLarge = await f.request("/v1/research-exports", "POST", { name: "Too large", query: {}, maxRows: 4 }, f.a.cookie); assert.equal(tooLarge.status, 413); assert.equal(tooLarge.body.errorCode, "research_export_limit"); assert.deepEqual((await f.request("/v1/research-exports", "GET", undefined, f.a.cookie)).body.exports, []);
    const a = await f.request("/v1/research-exports", "POST", { name: "A", query: {} }, f.a.cookie), b = await f.request("/v1/research-exports", "POST", { name: "B", query: {} }, f.a.cookie); assert.equal(a.status, 201); assert.equal(b.status, 201);
    const aId = a.body.researchExport.id, bId = b.body.researchExport.id, page = await f.request(`/v1/research-exports/${aId}/content?limit=1`, "GET", undefined, f.a.cookie); assert.ok(page.body.nextCursor);
    assert.equal((await f.request(`/v1/research-exports/${bId}/content?cursor=${page.body.nextCursor}`, "GET", undefined, f.a.cookie)).status, 400);
    assert.equal((await f.request(`/v1/research-exports/${aId}/content?cursor=${page.body.nextCursor}`, "GET", undefined, f.b.cookie)).status, 400);
    for (const [method, path] of [["GET", `/v1/research-exports/${aId}/content`], ["GET", `/v1/research-exports/${aId}/export?format=csv`], ["DELETE", `/v1/research-exports/${aId}`]] as const) assert.equal((await f.request(path, method, undefined, undefined, true)).status, 401);
    const audit = await f.repos.appAuditRepository.list(); assert.ok(audit.items.some(row => row.action === "content.research_export.post" && row.outcome === "failed" && row.actorUserId === f.users[0].id));
    assert.equal((await f.request("/v1/research-exports", "POST", { name: "Unknown fields", query: { raw: "private_raw" } }, f.a.cookie)).status, 400);
    assert.equal(JSON.stringify(await f.repos.appAuditRepository.list()).includes("private_raw"), false);
  } finally { await stopServer(f.server); }
});

test("HTTP research refuses unmeasurable index coverage with 503 and leaves no frozen snapshot", async () => {
  const f = await contentHttpFixture((source, content) => ({ researchExports: new ResearchExportService(new InMemoryResearchExportRepository(source, async () => null), content, () => RESEARCH_NOW) }));
  try {
    const result = await f.request("/v1/research-exports", "POST", { name: "Unavailable coverage", query: {} }, f.a.cookie);
    assert.equal(result.status, 503); assert.equal(result.body.errorCode, "research_export_unavailable"); assert.match(result.body.error.message, /coverage cannot be measured/);
    assert.deepEqual((await f.request("/v1/research-exports", "GET", undefined, f.a.cookie)).body.exports, []);
    const audit = await f.repos.appAuditRepository.list(); assert.ok(audit.items.some(row => row.action === "content.research_export.post" && row.outcome === "failed"));
  } finally { await stopServer(f.server); }
});
