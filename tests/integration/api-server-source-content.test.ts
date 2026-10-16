import assert from "node:assert/strict";
import test from "node:test";
import { createApiServer } from "../../apps/api/src/create-api-server";
import { SourceContentService } from "../../src/application/services/source-content.service";
import { InMemorySourceContentRepository } from "../../src/storage/repositories/in-memory/source-content.repository";
import { RedditMockConnector } from "../../src/connectors/reddit/reddit-mock.connector";
import { PasswordHashingService } from "../../src/application/services/password-hashing.service";
import { createApiTestRepositories,startServer,stopServer } from "./api-server.helpers";
import { fixtureConnector,FIXED_CONTENT_NOW,syntheticRedditPost } from "../helpers/source-content-fixtures";
import type { ContentListResponse,ContentStatsResponse,CollectionSourceResponse,SourceJobResponse } from "../../packages/contracts/src/http";

test("Source API authenticates reads, queues asynchronously, queries persisted content and matches statistical scope",async()=>{
  const urls:URL[]=[], service=new SourceContentService(new InMemorySourceContentRepository(),fixtureConnector([{rows:[syntheticRedditPost()]}],urls),()=>FIXED_CONTENT_NOW);
  const server=createApiServer({repositories:createApiTestRepositories(),createConnector:()=>new RedditMockConnector(),sourceContent:service,auth:{bearerToken:"source-test-token"},logger:()=>{}}),base=await startServer(server);
  const headers={authorization:"Bearer source-test-token","content-type":"application/json"};
  try{
    assert.equal((await fetch(`${base}/v1/content`)).status,401);
    const created=await fetch(`${base}/v1/sources`,{method:"POST",headers,body:JSON.stringify({platform:"reddit",provider:"arctic_shift",contentKind:"post",target:{type:"community",community:"testcommunity"}})});assert.equal(created.status,201);
    const source=(await created.json() as CollectionSourceResponse).source;
    const queued=await fetch(`${base}/v1/sources/${source.id}/collect`,{method:"POST",headers,body:JSON.stringify({from:"2026-10-09",to:FIXED_CONTENT_NOW})});assert.equal(queued.status,202);const job=(await queued.json() as SourceJobResponse).job;
    assert.equal(urls.length,0);await service.workOnce();assert.equal(urls.length,1);
    const result=await fetch(`${base}/v1/content?query=${encodeURIComponent("人工智能")}&sourceId=${source.id}`,{headers});assert.equal(result.status,200);
    const list=await result.json() as ContentListResponse;assert.equal(list.items.length,1);assert.equal(list.coverage,"stored_sample");assert.equal(list.items[0].observations[0].maturity,"refreshed");
    const stats=await (await fetch(`${base}/v1/content/stats?query=${encodeURIComponent("不存在")}`,{headers})).json() as ContentStatsResponse;assert.equal(stats.total,0);assert.equal(stats.daily.length,0);
    const completed=await (await fetch(`${base}/v1/source-jobs/${job.id}`,{headers})).json() as SourceJobResponse;assert.equal(completed.job.status,"succeeded");
    assert.equal((await fetch(`${base}/v1/content?limit=101`,{headers})).status,400);
    assert.equal((await fetch(`${base}/v1/sources`,{method:"POST",headers,body:"{"})).status,400);
  }finally{await stopServer(server);}
});

test("Source API viewer session can query but cannot create, collect, retry or continue",async()=>{
  const repos=createApiTestRepositories(), password=new PasswordHashingService(),userId="33333333-3333-4333-8333-333333333333";
  await repos.appUserRepository.create({id:userId,email:"source-viewer@example.com",displayName:"Viewer",role:"viewer",status:"active",createdAt:FIXED_CONTENT_NOW,updatedAt:FIXED_CONTENT_NOW},{userId,passwordHash:await password.hashPassword("fixture-password"),passwordAlgo:password.passwordAlgo,updatedAt:FIXED_CONTENT_NOW});
  const service=new SourceContentService(new InMemorySourceContentRepository(),fixtureConnector([{rows:[]}]),()=>FIXED_CONTENT_NOW);
  const server=createApiServer({repositories:repos,createConnector:()=>new RedditMockConnector(),sourceContent:service,auth:{bearerToken:"source-test-token"},now:()=>FIXED_CONTENT_NOW,logger:()=>{}}),base=await startServer(server);
  try{
    const login=await fetch(`${base}/auth/login`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:"source-viewer@example.com",password:"fixture-password"})});assert.equal(login.status,200);
    const cookie=login.headers.get("set-cookie")!.split(";")[0];
    assert.equal((await fetch(`${base}/v1/content`,{headers:{cookie}})).status,200);
    for(const path of ["/v1/sources",`/v1/sources/${userId}/collect`,`/v1/source-jobs/${userId}/retry`,`/v1/source-jobs/${userId}/continue`])assert.equal((await fetch(base+path,{method:"POST",headers:{cookie,"content-type":"application/json"},body:"{}"})).status,403);
    assert.equal((await service.repository.listSources()).length,0);
  }finally{await stopServer(server);}
});
