import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import type {SourceContentRepository} from "../../src/domain/repositories/source-content-repository";
import {workspaceFixture} from "./content-workspace-cases";
import {FIXED_CONTENT_NOW} from "./source-content-fixtures";

export async function verifyResearchPreflight(repo:SourceContentRepository){
  const fixture=await workspaceFixture(repo),{service,alpha,beta,x,root}=fixture;
  const empty=await repo.createSource({id:randomUUID(),platform:"reddit",provider:"demo_reddit",label:"No selected members",target:{type:"community",community:"empty_research"},contentKind:"post",createdAt:FIXED_CONTENT_NOW});
  const selected=service.normalizeQuery({platform:"reddit",kind:"post",provider:"demo_reddit",sourceGroup:"Research",author:"ALICE",language:"en",metricKey:"reddit.score",minMetric:0,maxMetric:0,query:"COLLECTED %",searchMode:"terms",searchScope:"text",exclusions:["absent phrase"]});
  const first=await repo.researchPayloadPreflight(selected);assert.equal(first.total,(await repo.contentStats(selected)).total);assert.equal(first.total,1);assert.equal(first.sourceCount,1);assert.deepEqual((await repo.listSourcesForResearch(selected)).map(source=>source.id),[alpha.id]);
  const page=await repo.listContent(selected);assert.equal(page.items[0].id,root.id);assert.equal(page.items[0].observations.length,1);assert.ok(first.contentBytes>=Buffer.byteLength(JSON.stringify(page.items),"utf8"));
  const allPosts={kind:"post" as const},all=await repo.researchPayloadPreflight(allPosts);assert.equal(all.total,4);assert.equal(all.sourceCount,3);assert.deepEqual(new Set((await repo.listSourcesForResearch(allPosts)).map(source=>source.id)),new Set([alpha.id,beta.id,x.id]));
  assert.equal((await repo.listSourcesForResearch({sourceId:empty.id})).length,0,"A configured stream without selected members is not fetched for the manifest");
  const excluded={...selected,exclusions:["collected"]};assert.equal((await repo.researchPayloadPreflight(excluded)).total,0);assert.equal((await repo.listSourcesForResearch(excluded)).length,0);
  const betaScope={sourceId:beta.id,kind:"post" as const,metricKey:"reddit.score",minMetric:90};assert.equal((await repo.researchPayloadPreflight(betaScope)).total,1);assert.deepEqual((await repo.listSourcesForResearch(betaScope)).map(source=>source.id),[beta.id]);
  assert.equal((await repo.researchPayloadPreflight({...betaScope,maxMetric:0})).total,0,"Scoped metric zero cannot be borrowed from the other provider");
  return fixture;
}
