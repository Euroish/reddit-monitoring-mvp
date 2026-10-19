import test from "node:test";
import assert from "node:assert/strict";
import { InMemorySourceContentRepository } from "../../src/storage/repositories/in-memory/source-content.repository";
import { InMemoryContentPersonalRepository } from "../../src/storage/repositories/in-memory/content-personal.repository";
import { verifyPublicWorkspace,verifyPersonalWorkspace } from "../helpers/content-workspace-cases";
test("public content details and advanced filters share stored scope, latest metrics and stable bound cursors", async t => {
  const repository = new InMemorySourceContentRepository();
  const lookup = t.mock.method(repository, "findContentsByIdentity");
  await verifyPublicWorkspace(repository);
  assert.equal(lookup.mock.callCount(), 1, "All reference identities are fetched in one batch");
  assert.equal(lookup.mock.calls[0].arguments[1].length, 20);
});
test("personal saved queries and annotations isolate accounts and enforce revisions, limits and bound pagination",async()=>{await verifyPersonalWorkspace(new InMemorySourceContentRepository(),new InMemoryContentPersonalRepository());});
