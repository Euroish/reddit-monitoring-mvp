import assert from "node:assert/strict";
import test from "node:test";
import { handleSourceContentRoute } from "../../apps/api/src/source-content-routes";
import { ContentPersonalService } from "../../src/application/services/content-personal.service";
import { InMemoryContentPersonalRepository } from "../../src/storage/repositories/in-memory/content-personal.repository";
import { InMemorySourceContentRepository } from "../../src/storage/repositories/in-memory/source-content.repository";
import { publicSearchFixture } from "../helpers/public-search-cases";
import { WORKSPACE_USER_A } from "../helpers/content-workspace-cases";
test("public route mode/scope/repeated exclusions use one range for list, stats and export with text coverage",async()=>{
  const {service}=await publicSearchFixture(new InMemorySourceContentRepository()),call=(path:string)=>handleSourceContentRoute({method:"GET",url:new URL(`http://localhost${path}`),requestId:"fixture",service}),params="query=CAF%C3%89+needle&searchMode=terms&searchScope=title";
  const list=await call(`/v1/content?${params}`),stats=await call(`/v1/content/stats?${params}`),exported=await call(`/v1/content/export?${params}`);assert.equal((list.body as any).items.length,2);assert.equal((stats.body as any).total,2);assert.equal((exported.body as any).exportedCount,2);assert.equal((exported.body as any).searchCoverage.indexed,4);assert.equal((list.body as any).searchCoverage.textMissing,1);
  const excluded=await call("/v1/content?query=caf%C3%A9&exclusions=society&exclusions=mice");assert.equal((excluded.body as any).items.length,1);
  for(const invalid of ["searchMode=or","searchScope=snippet","exclusions="])assert.equal((await call(`/v1/content?${invalid}`)).statusCode,400);
});
test("saved query canonicalization retains search mode/scope/exclusions with NFKC and normalized whitespace",async()=>{
  const {service}=await publicSearchFixture(new InMemorySourceContentRepository()),personal=new ContentPersonalService(new InMemoryContentPersonalRepository(),service);
  const saved=await personal.saveQuery(WORKSPACE_USER_A,{name:"Unicode terms",query:{query:"ＣＡＦÉ\t needle",searchMode:"terms",searchScope:"title",exclusions:[" SOCIETY\n x ","society x"]},expectedRevision:0});assert.equal(saved.query.query,"café needle");assert.equal(saved.query.searchMode,"terms");assert.equal(saved.query.searchScope,"title");assert.deepEqual(saved.query.exclusions,["society x"]);
});
