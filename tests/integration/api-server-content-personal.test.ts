import assert from "node:assert/strict";
import test from "node:test";
import { contentHttpFixture } from "../helpers/content-http-fixture";
import { stopServer } from "./api-server.helpers";

test("HTTP viewer saved queries are private across A/B, enforce create/update/delete revisions and reject machine sessions", async () => {
  const f = await contentHttpFixture();
  try {
    assert.equal(f.a.status, 200); assert.equal(f.b.status, 200);
    const privateQuery = "private_saved_query_sentinel", privateName = "private_saved_name_sentinel";
    const created = await f.request("/v1/content-saved-queries", "POST", { name: privateName, query: { query: privateQuery, sourceId: f.origin.id }, expectedRevision: 0 }, f.a.cookie);
    assert.equal(created.status, 201); const view = created.body.savedQuery; assert.equal(view.revision, 1);
    assert.equal((await f.request("/v1/content-saved-queries", "GET", undefined, f.a.cookie)).body.queries.length, 1);
    assert.deepEqual((await f.request("/v1/content-saved-queries", "GET", undefined, f.b.cookie)).body.queries, []);
    assert.equal((await f.request(`/v1/content-saved-queries/${view.id}`, "PATCH", { name: "B attempted access", query: {}, expectedRevision: 1 }, f.b.cookie)).status, 404);
    assert.equal((await f.request(`/v1/content-saved-queries/${view.id}`, "DELETE", { expectedRevision: 1 }, f.b.cookie)).status, 404);
    const updated = await f.request(`/v1/content-saved-queries/${view.id}`, "PATCH", { name: privateName, query: { query: privateQuery, language: "en" }, expectedRevision: 1 }, f.a.cookie);
    assert.equal(updated.status, 200); assert.equal(updated.body.savedQuery.revision, 2);
    const stale = await f.request(`/v1/content-saved-queries/${view.id}`, "PATCH", { name: "Stale update", query: {}, expectedRevision: 1 }, f.a.cookie);
    assert.equal(stale.status, 409); assert.equal(stale.body.errorCode, "personal_conflict");
    assert.equal((await f.request(`/v1/content-saved-queries/${view.id}`, "DELETE", { expectedRevision: 1 }, f.a.cookie)).status, 409);
    assert.equal((await f.request(`/v1/content-saved-queries/${view.id}`, "DELETE", undefined, f.a.cookie)).status, 400, "DELETE must receive and validate its JSON revision body");
    for (const [method, path, body] of [["GET", "/v1/content-saved-queries", undefined], ["POST", "/v1/content-saved-queries", { name: "Machine", query: {}, expectedRevision: 0 }], ["DELETE", `/v1/content-saved-queries/${view.id}`, { expectedRevision: 2 }]] as const) assert.equal((await f.request(path, method, body, undefined, true)).status, 401);
    assert.equal((await f.request("/v1/content-saved-queries")).status, 401);
    assert.equal((await f.request(`/v1/content-saved-queries/${view.id}`, "DELETE", { expectedRevision: 2 }, f.a.cookie)).status, 200);
    assert.deepEqual((await f.request("/v1/content-saved-queries", "GET", undefined, f.a.cookie)).body.queries, []);
    const audit = await f.repos.appAuditRepository.list();
    const creation = audit.items.find(row => row.action === "content.saved_query.post" && row.outcome === "succeeded");
    assert.equal(creation?.actorUserId, f.users[0].id); assert.equal(creation?.resourceId, view.id);
    const serialized = JSON.stringify(audit); assert.equal(serialized.includes(privateQuery), false); assert.equal(serialized.includes(privateName), false);
  } finally { await stopServer(f.server); }
});

test("HTTP content notes/favorites remain personal, preserve drafts through conflicts and leave no private text in audits", async () => {
  const f = await contentHttpFixture();
  try {
    const id = f.items[0].id, aNote = "private_annotation_A_sentinel", bNote = "private_annotation_B_sentinel";
    const a = await f.request(`/v1/content/${id}/annotation`, "PUT", { note: aNote, favorite: true, expectedRevision: 0 }, f.a.cookie);
    assert.equal(a.status, 200); assert.equal(a.body.annotation.revision, 1);
    assert.equal((await f.request(`/v1/content/${id}/annotation`, "GET", undefined, f.b.cookie)).body.annotation, null);
    const b = await f.request(`/v1/content/${id}/annotation`, "PUT", { note: bNote, favorite: false, expectedRevision: 0 }, f.b.cookie); assert.equal(b.status, 200);
    assert.equal((await f.request(`/v1/content/${id}/annotation`, "GET", undefined, f.a.cookie)).body.annotation.note, aNote);
    assert.equal((await f.request(`/v1/content/${id}/annotation`, "GET", undefined, f.b.cookie)).body.annotation.note, bNote);
    const changed = await f.request(`/v1/content/${id}/annotation`, "PUT", { note: aNote + "_updated", expectedRevision: 1 }, f.a.cookie); assert.equal(changed.status, 200); assert.equal(changed.body.annotation.revision, 2); assert.equal(changed.body.annotation.favorite, true);
    const stale = await f.request(`/v1/content/${id}/annotation`, "PUT", { note: "stale_private_note", expectedRevision: 1 }, f.a.cookie); assert.equal(stale.status, 409);
    assert.equal((await f.request(`/v1/content/${id}/annotation`, "GET", undefined, f.a.cookie)).body.annotation.note, aNote + "_updated");
    assert.equal((await f.request("/v1/content-annotations?favorite=true", "GET", undefined, f.a.cookie)).body.items.length, 1);
    assert.equal((await f.request("/v1/content-annotations?favorite=true", "GET", undefined, f.b.cookie)).body.items.length, 0);
    for (const [method, path, body] of [["GET", `/v1/content/${id}/annotation`, undefined], ["PUT", `/v1/content/${id}/annotation`, { note: "Machine note", expectedRevision: 0 }], ["GET", "/v1/content-annotations", undefined], ["DELETE", `/v1/content/${id}/annotation`, { expectedRevision: 2 }]] as const) assert.equal((await f.request(path, method, body, undefined, true)).status, 401);
    assert.equal((await f.request(`/v1/content/${id}/annotation`, "DELETE", { expectedRevision: 1 }, f.a.cookie)).status, 409);
    assert.equal((await f.request(`/v1/content/${id}/annotation`, "DELETE", { expectedRevision: 2 }, f.a.cookie)).status, 200);
    assert.equal((await f.request(`/v1/content/${id}/annotation`, "GET", undefined, f.a.cookie)).body.annotation, null);
    assert.equal((await f.request(`/v1/content/${id}/annotation`, "GET", undefined, f.b.cookie)).body.annotation.note, bNote);
    const audit = await f.repos.appAuditRepository.list(); assert.ok(audit.items.some(row => row.action === "content.annotation.put" && row.outcome === "succeeded" && row.actorUserId === f.users[0].id && row.resourceId === id));
    for (const marker of [aNote, bNote, "stale_private_note", "Machine note"]) assert.equal(JSON.stringify(audit).includes(marker), false);
  } finally { await stopServer(f.server); }
});
