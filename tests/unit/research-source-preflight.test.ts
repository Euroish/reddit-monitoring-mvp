import test from "node:test";
import assert from "node:assert/strict";
import {InMemorySourceContentRepository} from "../../src/storage/repositories/in-memory/source-content.repository";
import {verifyResearchPreflight} from "../helpers/research-preflight-cases";
import {FIXED_CONTENT_NOW} from "../helpers/source-content-fixtures";

test("research preflight and member-scoped sources use the same search/advanced/observation filters",async()=>{await verifyResearchPreflight(new InMemorySourceContentRepository());});
test("research memory preflight metadata and payload remain in the synchronous frozen read view",async()=>{
  const repo=new InMemorySourceContentRepository(),fixture=await verifyResearchPreflight(repo),snapshot=repo.snapshotForResearch();
  const before=await snapshot.researchPayloadPreflight({sourceId:fixture.alpha.id});
  await repo.updateSource(fixture.alpha.id,{label:"Changed after snapshot"},FIXED_CONTENT_NOW);
  assert.deepEqual(await snapshot.researchPayloadPreflight({sourceId:fixture.alpha.id}),before);
  assert.equal((await snapshot.listSourcesForResearch({sourceId:fixture.alpha.id}))[0].label,"alpha");
  assert.equal((await repo.listSourcesForResearch({sourceId:fixture.alpha.id}))[0].label,"Changed after snapshot");
});
