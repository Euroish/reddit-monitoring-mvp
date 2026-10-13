import assert from "node:assert/strict";
import test from "node:test";
import { handleContentPersonalRoute,matchContentPersonalRoute } from "../../apps/api/src/content-personal-routes";
import { handleSourceContentRoute } from "../../apps/api/src/source-content-routes";
import { ContentPersonalService } from "../../src/application/services/content-personal.service";
import { InMemorySourceContentRepository } from "../../src/storage/repositories/in-memory/source-content.repository";
import { InMemoryContentPersonalRepository } from "../../src/storage/repositories/in-memory/content-personal.repository";
import { workspaceFixture,WORKSPACE_USER_A,WORKSPACE_USER_B } from "../helpers/content-workspace-cases";
import { FIXED_CONTENT_NOW } from "../helpers/source-content-fixtures";
import type { ApiActor } from "../../apps/api/src/auth-guard";
test("personal route metadata and handlers require sessions, allow viewer-owned writes and reject account impersonation",async()=>{
  const {service:content,root}=await workspaceFixture(new InMemorySourceContentRepository()),service=new ContentPersonalService(new InMemoryContentPersonalRepository(),content,()=>FIXED_CONTENT_NOW),viewer:ApiActor={type:"session",userId:WORKSPACE_USER_A,role:"viewer",email:"fixture@example.test"};
  const call=(method:string,path:string,body?:unknown,actor:ApiActor|null=viewer)=>handleContentPersonalRoute({method,url:new URL(`http://localhost${path}`),body,actor,requestId:"fixture",service});
  assert.equal(matchContentPersonalRoute("POST","/v1/content-saved-queries")!.personal,true);assert.equal(matchContentPersonalRoute("PUT",`/v1/content/${root.id}/annotation`)!.write,true);
  for(const actor of [null,{type:"machine"} as ApiActor])assert.equal((await call("POST","/v1/content-saved-queries",{name:"No",query:{},expectedRevision:0},actor)).statusCode,401);
  assert.equal((await call("POST","/v1/content-saved-queries",{name:"No",query:{},expectedRevision:0,userId:WORKSPACE_USER_B})).statusCode,400);
  const saved=await call("POST","/v1/content-saved-queries",{name:"Mine",query:{sort:"published_asc"},expectedRevision:0});assert.equal(saved.statusCode,201);const id=(saved.body as any).savedQuery.id;
  assert.equal((await call("PATCH",`/v1/content-saved-queries/${id}`,{name:"Foreign",query:{},expectedRevision:1},{...viewer,userId:WORKSPACE_USER_B})).statusCode,404);
  assert.equal((await call("PUT",`/v1/content/${root.id}/annotation`,{favorite:true,note:"Mine",expectedRevision:0})).statusCode,200);
  assert.equal((await call("GET","/v1/content-annotations?favorite=true")).statusCode,200);assert.equal((await call("GET","/v1/content-annotations?favorite=bad")).statusCode,400);
  assert.equal((await call("PUT",`/v1/content/${root.id}/annotation`,{note:"Stale",expectedRevision:0})).statusCode,409);
});
test("public content route detail and list/stats/export parse the same advanced scope without provider requests",async()=>{
  const {service,root}=await workspaceFixture(new InMemorySourceContentRepository()),call=(path:string)=>handleSourceContentRoute({method:"GET",url:new URL(`http://localhost${path}`),requestId:"fixture",service});
  const detail=await call(`/v1/content/${root.id}`);assert.equal(detail.statusCode,200);assert.equal((detail.body as any).children.length,20);
  const params="platform=reddit&kind=post&author=alice&language=en&sourceGroup=Research&provider=demo_reddit&metricKey=reddit.score&minMetric=0&maxMetric=0&sort=published_asc";
  const list=await call(`/v1/content?${params}`),stats=await call(`/v1/content/stats?${params}`),exported=await call(`/v1/content/export?${params}`);assert.equal((list.body as any).items.length,1);assert.equal((stats.body as any).total,1);assert.equal((exported.body as any).exportedCount,1);
  for(const invalid of ["metricKey=x.likes&platform=reddit","minMetric=1","metricKey=reddit.score&minMetric=NaN","sort=bad"])assert.equal((await call(`/v1/content?${invalid}`)).statusCode,400);
});
