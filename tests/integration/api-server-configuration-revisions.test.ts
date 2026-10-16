import assert from "node:assert/strict";
import test from "node:test";
import { createApiServer } from "../../apps/api/src/create-api-server";
import { SourceContentService } from "../../src/application/services/source-content.service";
import { InMemorySourceContentRepository } from "../../src/storage/repositories/in-memory/source-content.repository";
import { DemoContentProvider } from "../../src/connectors/demo/demo-content.connector";
import { RedditMockConnector } from "../../src/connectors/reddit/reddit-mock.connector";
import { createApiTestRepositories,startServer,stopServer } from "./api-server.helpers";
import { FIXED_CONTENT_NOW } from "../helpers/source-content-fixtures";
import type { CollectionSourceResponse,SourceListResponse,SourceProviderBudget } from "../../packages/contracts/src/http";

test("source configuration HTTP CAS returns revisions, rejects stale mutations, and preserves blind-client compatibility",async()=>{
  const service=new SourceContentService(new InMemorySourceContentRepository(),new DemoContentProvider("reddit",()=>FIXED_CONTENT_NOW),()=>FIXED_CONTENT_NOW),server=createApiServer({repositories:createApiTestRepositories(),createConnector:()=>new RedditMockConnector(),sourceContent:service,auth:{bearerToken:"revision-token"},logger:()=>{}}),base=await startServer(server),headers={authorization:"Bearer revision-token","content-type":"application/json"};
  const mutate=(path:string,method:string,body:unknown)=>fetch(base+path,{method,headers,body:JSON.stringify(body)});
  try{
    const created=await mutate("/v1/sources","POST",{platform:"reddit",provider:"demo_reddit",contentKind:"post",target:{type:"community",community:"revision_api"}}),source=(await created.json() as CollectionSourceResponse).source;assert.equal(created.status,201);assert.equal(source.revision,1);
    const responses=await Promise.all([mutate(`/v1/sources/${source.id}`,"PATCH",{label:"A",expectedRevision:1}),mutate(`/v1/sources/${source.id}`,"PATCH",{label:"B",expectedRevision:1})]);assert.deepEqual(responses.map(item=>item.status).sort(),[200,409]);const saved=(await service.repository.getSource(source.id))!;assert.equal(saved.revision,2);
    const stale=await mutate(`/v1/sources/${source.id}`,"PATCH",{label:"Stale",expectedRevision:1});assert.equal(stale.status,409);assert.equal((await stale.json() as {errorCode:string}).errorCode,"source_conflict");assert.deepEqual(await service.repository.getSource(source.id),saved);
    await service.enqueue(source.id,{from:"2026-10-12T08:00:00Z",to:FIXED_CONTENT_NOW});const queued=(await service.listJobs({sourceId:source.id}))[0];assert.equal((await mutate(`/v1/sources/${source.id}/pause`,"POST",{expectedRevision:1})).status,409);assert.equal((await service.getJob(queued.id)).status,"queued");
    const pause=await mutate(`/v1/sources/${source.id}/pause`,"POST",{expectedRevision:2});assert.equal(pause.status,200);assert.equal((await pause.json() as CollectionSourceResponse).source.revision,3);assert.equal((await service.getJob(queued.id)).status,"cancelled");assert.equal((await mutate(`/v1/sources/${source.id}/resume`,"POST",{expectedRevision:2})).status,409);
    assert.equal((await mutate(`/v1/sources/${source.id}/resume`,"POST",{expectedRevision:3})).status,200);assert.equal((await mutate(`/v1/sources/${source.id}/pause`,"POST",{expectedRevision:0})).status,400);assert.equal((await mutate(`/v1/sources/${source.id}/pause`,"POST",{label:"Unexpected"})).status,400);
    const blind=await mutate(`/v1/sources/${source.id}`,"PATCH",{group:"Legacy compatible"});assert.equal(blind.status,200);assert.equal((await blind.json() as CollectionSourceResponse).source.revision,5);
    const settings={enabled:true,dailyRequests:10,monthlyRequests:100,dailyResources:250,monthlyResources:2500},budgets=await Promise.all([mutate("/v1/source-provider-budgets/demo_reddit","PUT",{...settings,expectedRevision:0}),mutate("/v1/source-provider-budgets/demo_reddit","PUT",{...settings,dailyRequests:20,expectedRevision:0})]);assert.deepEqual(budgets.map(item=>item.status).sort(),[200,409]);const winner=budgets.find(item=>item.status===200)!;assert.equal((await winner.json() as {budget:SourceProviderBudget}).budget.revision,1);
    const changed=await mutate("/v1/source-provider-budgets/demo_reddit","PUT",{...settings,minimumIntervalMs:1000,expectedRevision:1});assert.equal(changed.status,200);assert.equal((await changed.json() as {budget:SourceProviderBudget}).budget.revision,2);assert.equal((await mutate("/v1/source-provider-budgets/demo_reddit","PUT",{...settings,enabled:false,expectedRevision:1})).status,409);
    const listed=await (await fetch(base+"/v1/sources",{headers})).json() as SourceListResponse;assert.equal(listed.sources[0].revision,5);assert.equal(listed.providers![0].budget.revision,2);assert.equal(listed.providers![0].budget.enabled,true);
  }finally{await stopServer(server);}
});
