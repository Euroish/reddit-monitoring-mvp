import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../../apps/api/src/app";
import { bootstrapOwner } from "../../src/modules/access/sql";
import { testDatabase } from "../helpers/database";

test("document routes preserve revisions, attachment metadata and read/write boundaries", async t => {
  const db = await testDatabase();
  t.after(db.close);
  await bootstrapOwner(db.pool, "fixture-password-123", "owner@example.test");
  const origin = "http://docs.test";
  const app = await buildApp({
    pool: db.pool, origin, secureCookies: false, sessionSecret: "docs-fixture".repeat(4),
    providers: [], publicRead: true, publicRegistration: true,
  });
  t.after(() => app.close());
  const login = await app.inject({ method: "POST", url: "/v1/auth/login", headers: { origin },
    payload: { email: "owner@example.test", password: "fixture-password-123" } });
  assert.equal(login.statusCode, 200, login.body);
  const headers = { origin, cookie: login.headers["set-cookie"]!.toString().split(";")[0] };
  const pdf = Buffer.from("%PDF-1.7\nfixture\n%%EOF");
  const file = { name: "说明.pdf", mime: "application/pdf", dataBase64: pdf.toString("base64") };
  const create = (payload: object) => app.inject({ method: "POST", url: "/v1/docs", headers,
    payload: { title: "A document", category: "feature", kind: "markdown", ...payload } });
  const created = await create({ kind: "file", file });
  assert.equal(created.statusCode, 200, created.body);
  const doc = created.json().doc;
  assert.equal(doc.fileSize, pdf.length);
  assert.equal(doc.revision, 1);
  assert.ok(!("file_bytes" in doc));
  const get = await app.inject({ url: `/v1/docs/${doc.slug}` });
  assert.equal(get.statusCode, 200, get.body);
  assert.equal(get.json().doc.fileSize, pdf.length);

  const updated = await app.inject({ method: "PATCH", url: `/v1/docs/${doc.id}`, headers,
    payload: { title: "Updated", pinned: true, expectedRevision: 1 } });
  assert.equal(updated.statusCode, 200, updated.body);
  assert.equal(updated.json().doc.revision, 2);
  assert.equal(updated.json().doc.fileSize, pdf.length);
  const stale = await app.inject({ method: "PATCH", url: `/v1/docs/${doc.id}`, headers,
    payload: { title: "Stale overwrite", expectedRevision: 1 } });
  assert.equal(stale.statusCode, 409, stale.body);
  const legacy = await app.inject({ method: "PATCH", url: `/v1/docs/${doc.id}`, headers,
    payload: { summary: "Legacy clients may omit the revision" } });
  assert.equal(legacy.statusCode, 200, legacy.body);
  const downloaded = await app.inject({ url: `/v1/docs/${doc.slug}/file` });
  assert.equal(downloaded.statusCode, 200, downloaded.body);
  assert.deepEqual(downloaded.rawPayload, pdf);
  assert.equal(downloaded.headers["content-type"], "application/pdf");
  assert.equal(downloaded.headers["x-content-type-options"], "nosniff");
  assert.equal(downloaded.headers["cache-control"], "private, no-store");
  assert.match(String(downloaded.headers["content-security-policy"]), /sandbox/);

  const draft = await create({ kind: "file", file, status: "draft" });
  assert.equal(draft.statusCode, 200, draft.body);
  const draftSlug = draft.json().doc.slug;
  assert.equal((await app.inject({ url: `/v1/docs/${draftSlug}` })).statusCode, 404);
  assert.equal((await app.inject({ url: `/v1/docs/${draftSlug}`, headers })).statusCode, 200);
  assert.equal((await app.inject({ url: `/v1/docs/${draftSlug}/file` })).statusCode, 404);
  assert.equal((await app.inject({ url: `/v1/docs/${draftSlug}/file`, headers })).statusCode, 200);
  const publicList = await app.inject({ url: "/v1/docs" });
  assert.equal(publicList.json().docs.length, 1);

  const key = await app.inject({ method: "POST", url: "/v1/access/keys", headers,
    payload: { label: "Docs reader", scopes: ["read"], allowedSourceIds: [], expiresInDays: 1 } });
  assert.equal(key.statusCode, 200, key.body);
  const machineHeaders = { authorization: `Bearer ${key.json().token}` };
  assert.equal((await app.inject({ url: `/v1/docs/${doc.slug}`, headers: machineHeaders })).statusCode, 200);
  assert.equal((await app.inject({ url: `/v1/docs/${draftSlug}`, headers: machineHeaders })).statusCode, 404);
  assert.equal((await app.inject({ method: "PATCH", url: `/v1/docs/${doc.id}`, headers: machineHeaders,
    payload: { pinned: false } })).statusCode, 403);
  const registration = await app.inject({ method: "POST", url: "/v1/auth/register", headers: { origin },
    payload: { email: "viewer@example.test", password: "fixture-password-123" } });
  assert.equal(registration.statusCode, 200, registration.body);
  const viewerHeaders = { origin, cookie: registration.headers["set-cookie"]!.toString().split(";")[0] };
  assert.equal((await app.inject({ method: "DELETE", url: `/v1/docs/${doc.id}`, headers: viewerHeaders })).statusCode, 403);

  assert.equal((await create({ title: " " })).statusCode, 400);
  assert.equal((await create({ kind: "file", file: { ...file, mime: "text/html" } })).statusCode, 400);
  assert.equal((await create({ kind: "file", file: { ...file, dataBase64: Buffer.from("<html>bad</html>").toString("base64") } })).statusCode, 400);
  const converted = await app.inject({ method: "PATCH", url: `/v1/docs/${doc.id}`, headers,
    payload: { kind: "markdown", bodyMd: "Now a page", expectedRevision: 3 } });
  assert.equal(converted.statusCode, 200, converted.body);
  assert.equal(converted.json().doc.fileSize, null);
  assert.equal((await app.inject({ url: `/v1/docs/${doc.slug}/file` })).statusCode, 404);
  const linked = await app.inject({ method: "PATCH", url: `/v1/docs/${doc.id}`, headers,
    payload: { kind: "link", externalUrl: "https://example.test/guide", expectedRevision: 4 } });
  assert.equal(linked.statusCode, 200, linked.body);
  assert.equal(linked.json().doc.bodyMd, "");

  const openapi = await app.inject({ url: "/v1/openapi.json", headers });
  assert.equal(openapi.statusCode, 200, openapi.body);
  const paths = openapi.json().paths;
  assert.ok(paths["/v1/docs/{slug}"].get.responses["200"].content["application/json"].schema);
  assert.ok(paths["/v1/docs/{slug}/file"].get.responses["200"].content["application/pdf"].schema);
  const deleted = await app.inject({ method: "DELETE", url: `/v1/docs/${doc.id}`, headers });
  assert.equal(deleted.statusCode, 200, deleted.body);
  assert.equal((await app.inject({ url: `/v1/docs/${doc.slug}` })).statusCode, 404);
});
