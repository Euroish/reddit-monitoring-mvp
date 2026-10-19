import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { SourceContentError } from "../../src/domain/source-content-error";
import { sourceContentErrorStatus } from "../../apps/api/src/source-content-error";
import { matchSourceContentRoute, handleSourceContentRoute } from "../../apps/api/src/source-content-routes";
import { SourceContentService } from "../../src/application/services/source-content.service";
import { InMemorySourceContentRepository } from "../../src/storage/repositories/in-memory/source-content.repository";
import { fixtureConnector } from "../helpers/source-content-fixtures";

function imports(path: string) {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest);
  return source.statements.filter(ts.isImportDeclaration).map(statement => {
    assert.ok(ts.isStringLiteral(statement.moduleSpecifier));
    return statement.moduleSpecifier.text;
  });
}

test("content domain rules and storage errors do not depend on application services or infrastructure", () => {
  for (const path of ["src/domain/source-content-error.ts", "src/domain/public-content-search.ts"]) {
    assert.ok(imports(path).every(value => !/\/(application|storage|runtime|apps)\//.test(value)), path);
  }
  for (const path of [
    "src/storage/content-personal-query.ts",
    "src/storage/source-content-query.ts",
    "src/storage/repositories/in-memory/source-content.repository.ts",
    "src/storage/repositories/postgres/postgres-source-content.repository.ts",
  ]) {
    assert.ok(imports(path).every(value => !value.includes("application/services")), path);
  }
  assert.ok(!imports("src/application/services/source-content.service.ts").some(value => value.includes("storage/public-content-search")));
});

test("source failures acquire HTTP statuses only at the API boundary", () => {
  const cases = [
    ["invalid_request", 400], ["not_found", 404], ["conflict", 409], ["unavailable", 503],
  ] as const;
  for (const [kind, status] of cases) {
    const error = new SourceContentError("Preserved message", kind);
    assert.equal(error.kind, kind);
    assert.equal(error.message, "Preserved message");
    assert.equal("status" in error, false);
    assert.equal(sourceContentErrorStatus(error), status);
  }
  assert.equal(new SourceContentError("Invalid input").kind, "invalid_request");
});

test("extracted content reads translate asynchronous storage failures through the common dispatcher", async t => {
  const repository = new InMemorySourceContentRepository();
  const service = new SourceContentService(repository, fixtureConnector([{ rows: [] }]));
  const cases = [
    ["invalid_request", 400, "invalid_source_request"],
    ["not_found", 404, "source_not_found"],
    ["conflict", 409, "source_conflict"],
    ["unavailable", 503, "public_search_unavailable"],
  ] as const;
  for (const [kind, statusCode, errorCode] of cases) {
    const mocked = t.mock.method(repository, "listContent", async () => {
      throw new SourceContentError("Storage failure", kind);
    });
    const response = await handleSourceContentRoute({
      method: "GET", url: new URL("http://localhost/v1/content"), requestId: "boundary-test", service,
    });
    assert.deepEqual(response, {
      statusCode, body: { ok: false, requestId: "boundary-test", error: "Storage failure", errorCode },
    });
    mocked.mock.restore();
  }
});

test("content read routes keep reserved paths ahead of detail and retain read-only permissions", () => {
  for (const [path, action] of [
    ["/v1/content", "content"], ["/v1/content/stats", "stats"],
    ["/v1/content/workbench", "workbench"], ["/v1/content/export", "export"],
    ["/v1/content/fixture-id", "detail"],
  ]) {
    const route = matchSourceContentRoute("GET", path);
    assert.equal(route?.action, action);
    assert.equal(route?.write, false);
    assert.equal(matchSourceContentRoute("POST", path), undefined);
  }
});
