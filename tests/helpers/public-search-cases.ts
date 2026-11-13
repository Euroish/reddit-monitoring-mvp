import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { CollectedContent } from "../../src/connectors/shared/content-provider.interface";
import type { SourceContentRepository } from "../../src/domain/repositories/source-content-repository";
import { SourceContentError } from "../../src/domain/source-content-error";
import { SourceContentService } from "../../src/application/services/source-content.service";
import { DemoContentProvider } from "../../src/connectors/demo/demo-content.connector";
import { stableUuidFromString } from "../../src/shared/ids/stable-id";
import { FIXED_CONTENT_NOW } from "./source-content-fixtures";
export async function publicSearchFixture(repo:SourceContentRepository){const now=FIXED_CONTENT_NOW,provider=new DemoContentProvider("reddit",()=>now),service=new SourceContentService(repo,provider,()=>now),source=await service.createSource({platform:"reddit",provider:"demo_reddit",contentKind:"post",target:{type:"community",community:"search_fixture"}}),window={from:"2026-10-12T00:00:00.000Z",to:now};
  const page=await provider.collectPage({source,...window,limit:1,checkpoint:null}),base=page.items[0];
  const records:CollectedContent[]=[
    {...base,id:stableUuidFromString("reddit:content:search-a"),externalId:"search_a",title:"ＣＡＦÉ　🙂 needle",text:"x".repeat(400)+" Café\t society 🎯 资本市场 ,.% punctuation",observation:{...base.observation,sourceObservedAt:"2026-10-12T09:40:00.000Z",evidenceKey:"a"}},
    {...base,id:stableUuidFromString("reddit:content:search-b"),externalId:"search_b",title:"café empty",text:null,observation:{...base.observation,evidenceKey:"b"}},
    {...base,id:stableUuidFromString("reddit:content:search-c"),externalId:"search_c",title:"needle CAFÉ",text:"mice running",observation:{...base.observation,evidenceKey:"c"}},
    {...base,id:stableUuidFromString("reddit:content:search-d"),externalId:"search_d",title:null,text:"no title",observation:{...base.observation,evidenceKey:"d"}},
  ];
  const commit=async(items:CollectedContent[],origin=source)=>{await repo.enqueue({id:randomUUID(),sourceId:origin.id,now,...window,pageSize:100,maxPages:1});const claim=await repo.claim(now);assert.ok(claim);await repo.commitPage(claim,{items,nextCheckpoint:null,exhausted:true,coverage:"unknown",warning:null},now);};await commit(records);return {repo,service,source,records,commit};}
export async function verifyPublicSearch(repo:SourceContentRepository){const fixture=await publicSearchFixture(repo),{service,records}=fixture;const count=async(input:Parameters<typeof service.normalizeQuery>[0])=>(await repo.contentStats(service.normalizeQuery(input))).total;
  assert.equal(await count({query:"ＣＡＦÉ needle",searchMode:"terms",searchScope:"title"}),2);assert.equal(await count({query:"café needle",searchMode:"literal",searchScope:"title"}),0);assert.equal(await count({query:"café 🙂 needle",searchMode:"phrase",searchScope:"title"}),1);assert.equal(await count({query:"society 🎯",searchScope:"text"}),1);assert.equal(await count({query:"资本市场",searchMode:"terms",searchScope:"text"}),1);assert.equal(await count({query:"资本市场 absent",searchMode:"terms"}),0);assert.equal(await count({query:"mouse",searchMode:"terms"}),0,"No stemming or old OR fallback");assert.equal(await count({query:".%",searchScope:"text"}),1,"Punctuation is literal, never a SQL wildcard");
  assert.equal(await count({query:"café",searchScope:"title_text",exclusions:["SOCIETY"]}),2);assert.equal(await count({query:"café",searchScope:"title",exclusions:["society"]}),3,"Exclusions apply to the selected text scope only");const query=service.normalizeQuery({query:"café",searchScope:"title",limit:1}),page=await repo.listContent(query);assert.ok(page.nextCursor);assert.equal(page.searchCoverage!.candidateCount,4);assert.equal(page.searchCoverage!.indexed,4);assert.equal(page.searchCoverage!.textPresent,3);assert.equal(page.searchCoverage!.textMissing,1);
  for(const changed of [{searchMode:"phrase" as const},{searchScope:"text" as const},{exclusions:["needle"]}])await assert.rejects(repo.listContent({...query,...changed,cursor:page.nextCursor!}),/changed query/);
  for(const bad of [{searchMode:"or"},{searchScope:"body"},{exclusions:Array(11).fill("x")},{exclusions:[""]}])assert.throws(()=>service.normalizeQuery(bad as never),error=>error instanceof SourceContentError&&error.kind === "invalid_request");
  const docCoverage=await repo.searchCoverage(records.map(item=>item.id));assert.equal(docCoverage.indexed,4);assert.equal(docCoverage.textMissing,1);assert.equal(docCoverage.state,"complete");
  const known=records[0];await fixture.commit([{...known,title:"Unknown older snapshot",observation:{...known.observation,sourceObservedAt:null,timeBasis:"unknown",maturity:"unknown",evidenceKey:"unknown-version"}}]);
  assert.equal((await repo.getContent(known.id))!.title,known.title);
  return fixture;}
