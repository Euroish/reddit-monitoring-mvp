import assert from "node:assert/strict";
import test from "node:test";
import { createApiServer } from "../../apps/api/src/create-api-server";
import { SourceContentService } from "../../src/application/services/source-content.service";
import { InMemorySourceContentRepository } from "../../src/storage/repositories/in-memory/source-content.repository";
import { DemoContentProvider } from "../../src/connectors/demo/demo-content.connector";
import { RedditMockConnector } from "../../src/connectors/reddit/reddit-mock.connector";
import { PasswordHashingService } from "../../src/application/services/password-hashing.service";
import { createApiTestRepositories,startServer,stopServer } from "./api-server.helpers";
import { FIXED_CONTENT_NOW } from "../helpers/source-content-fixtures";
import type { CollectionSourceResponse, SourceJobResponse, SourceJobsResponse, SourceOpsResponse } from "../../packages/contracts/src/http";

test("source lifecycle API edits schedules, lists/cancels jobs and persists provider budgets without external requests",async()=>{
  const service=new SourceContentService(new InMemorySourceContentRepository(),new DemoContentProvider("reddit",()=>FIXED_CONTENT_NOW),()=>FIXED_CONTENT_NOW),server=createApiServer({repositories:createApiTestRepositories(),createConnector:()=>new RedditMockConnector(),sourceContent:service,auth:{bearerToken:"lifecycle-token"},logger:()=>{}}),base=await startServer(server),headers={authorization:"Bearer lifecycle-token","content-type":"application/json"};
  try{
    const created=await fetch(`${base}/v1/sources`,{method:"POST",headers,body:JSON.stringify({platform:"reddit",provider:"demo_reddit",contentKind:"post",target:{type:"community",community:"fixture"}})}),source=(await created.json() as CollectionSourceResponse).source;assert.equal(created.status,201);
    const edited=await fetch(`${base}/v1/sources/${source.id}`,{method:"PATCH",headers,body:JSON.stringify({group:"Research",schedule:{enabled:true,cadenceSeconds:600,pageSize:1}})});assert.equal(edited.status,200);assert.equal((await edited.json() as CollectionSourceResponse).source.schedule.enabled,true);
    const budget=await fetch(`${base}/v1/source-provider-budgets/demo_reddit`,{method:"PUT",headers,body:JSON.stringify({enabled:true,dailyRequests:10,monthlyRequests:100,dailyResources:250,monthlyResources:2500})});assert.equal(budget.status,200);
    await service.workOnce();const jobs=await (await fetch(`${base}/v1/source-jobs?sourceId=${source.id}`,{headers})).json() as SourceJobsResponse;assert.equal(jobs.jobs.length,1);assert.equal(jobs.jobs[0].purpose,"scheduled");
    const queued=await fetch(`${base}/v1/sources/${source.id}/collect`,{method:"POST",headers,body:JSON.stringify({from:"2026-10-09",to:FIXED_CONTENT_NOW})});
    // The still-active scheduled page budget makes a different manual window conflict.
    assert.equal(queued.status,409);
    const cancelled=await fetch(`${base}/v1/source-jobs/${jobs.jobs[0].id}/cancel`,{method:"POST",headers,body:"{}"});assert.equal(cancelled.status,200);assert.equal((await cancelled.json() as SourceJobResponse).job.status,"cancelled");
    assert.equal((await fetch(`${base}/v1/sources/${source.id}/pause`,{method:"POST",headers,body:"{}"})).status,200);
    assert.equal((await fetch(`${base}/v1/sources/${source.id}/collect`,{method:"POST",headers,body:"{}"})).status,409);
    assert.equal((await fetch(`${base}/v1/sources/${source.id}/resume`,{method:"POST",headers,body:"{}"})).status,200);
    const ops=await (await fetch(`${base}/v1/source-ops`,{headers})).json() as SourceOpsResponse;assert.equal(ops.ops.providers[0].budget.dailyRequests,10);assert.equal(ops.ops.providers[0].dailyRequests,1);
    assert.equal((await fetch(`${base}/v1/source-jobs?limit=101`,{headers})).status,400);assert.equal((await fetch(`${base}/v1/source-jobs?status=invalid`,{headers})).status,400);
    assert.equal((await fetch(`${base}/v1/source-ops`)).status,401);
  }finally{await stopServer(server);}
});

test("viewer cannot mutate source lifecycle, cancellation or provider budgets",async()=>{
  const repos=createApiTestRepositories(),password=new PasswordHashingService(),id="33333333-3333-4333-8333-333333333333";
  await repos.appUserRepository.create({id,email:"lifecycle-viewer@example.test",displayName:"Viewer",role:"viewer",status:"active",createdAt:FIXED_CONTENT_NOW,updatedAt:FIXED_CONTENT_NOW},{userId:id,passwordHash:await password.hashPassword("fixture-password"),passwordAlgo:password.passwordAlgo,updatedAt:FIXED_CONTENT_NOW});
  const service=new SourceContentService(new InMemorySourceContentRepository(),new DemoContentProvider("reddit"),()=>FIXED_CONTENT_NOW),server=createApiServer({repositories:repos,createConnector:()=>new RedditMockConnector(),sourceContent:service,auth:{bearerToken:"lifecycle-token"},now:()=>FIXED_CONTENT_NOW,logger:()=>{}}),base=await startServer(server);
  try{
    const login=await fetch(`${base}/auth/login`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:"lifecycle-viewer@example.test",password:"fixture-password"})}),cookie=login.headers.get("set-cookie")!.split(";")[0],headers={cookie,"content-type":"application/json"};
    for(const [method,path] of [["PATCH",`/v1/sources/${id}`],["POST",`/v1/sources/${id}/pause`],["POST",`/v1/sources/${id}/archive`],["POST",`/v1/source-jobs/${id}/cancel`],["PUT","/v1/source-provider-budgets/demo_reddit"]])assert.equal((await fetch(base+path,{method,headers,body:"{}"})).status,403);
    assert.equal((await fetch(`${base}/v1/source-jobs`,{headers})).status,200);
  }finally{await stopServer(server);}
});
