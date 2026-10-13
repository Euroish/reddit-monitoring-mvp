import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApiServer } from "../../apps/api/src/create-api-server";
import { RedditMockConnector } from "../../src/connectors/reddit/reddit-mock.connector";
import { createApiTestRepositories,startServer,stopServer } from "./api-server.helpers";
import { FIXED_CONTENT_NOW } from "../helpers/source-content-fixtures";
import type { MonitorTarget } from "../../src/domain/entities/monitor-target";
import type { UpdateSubredditTargetResponse,BulkUpdateSubredditTargetsResponse } from "../../packages/contracts/src/http";
function target(name:string):MonitorTarget{return {id:randomUUID(),source:"reddit",targetType:"subreddit",canonicalName:`r/${name}`,status:"active",config:{notes:"Original"},createdAt:FIXED_CONTENT_NOW,updatedAt:FIXED_CONTENT_NOW};}

test("target PATCH accepts one concurrent revision update, rejects invalid/stale tokens, and keeps legacy blind writes",async()=>{
  const repos=createApiTestRepositories(),source=await repos.monitorTargetRepository.upsert(target("target_cas")),server=createApiServer({repositories:repos,createConnector:()=>new RedditMockConnector(),auth:{bearerToken:"target-cas-token"},logger:()=>{}}),base=await startServer(server),headers={authorization:"Bearer target-cas-token","content-type":"application/json"};
  const patch=(body:unknown)=>fetch(base+"/v1/targets/subreddit/target_cas",{method:"PATCH",headers,body:JSON.stringify(body)});
  try{
    const responses=await Promise.all([patch({notes:"A",expectedRevision:1}),patch({notes:"B",expectedRevision:1})]);assert.deepEqual(responses.map(item=>item.status).sort(),[200,409]);const saved=(await repos.monitorTargetRepository.findById(source.id))!;assert.equal(saved.revision,2);const winner=responses.find(item=>item.status===200)!;assert.equal((await winner.json() as UpdateSubredditTargetResponse).target.revision,2);
    const stale=await patch({status:"paused",notes:"Stale",expectedRevision:1});assert.equal(stale.status,409);assert.equal((await stale.json() as {errorCode:string}).errorCode,"target_conflict");assert.deepEqual(await repos.monitorTargetRepository.findById(source.id),saved);
    for(const expectedRevision of [0,-1,1.5,2147483647,"1"])assert.equal((await patch({notes:"Invalid",expectedRevision})).status,400);
    const blind=await patch({notes:"Legacy"});assert.equal(blind.status,200);assert.equal((await blind.json() as UpdateSubredditTargetResponse).target.revision,3);assert.equal((await repos.monitorTargetRepository.findById(source.id))!.config.notes,"Legacy");
  }finally{await stopServer(server);}
});

test("target bulk CAS rejects a bad member atomically and overlapping reversed HTTP batches admit a single complete winner",async()=>{
  const repos=createApiTestRepositories(),first=await repos.monitorTargetRepository.upsert(target("target_bulk_a")),second=await repos.monitorTargetRepository.upsert(target("target_bulk_b"));await repos.monitorTargetRepository.updateIfRevision({...second,config:{notes:"Concurrent B"}},1);
  const server=createApiServer({repositories:repos,createConnector:()=>new RedditMockConnector(),auth:{bearerToken:"target-bulk-token"},logger:()=>{}}),base=await startServer(server),headers={authorization:"Bearer target-bulk-token","content-type":"application/json"},names=[first.canonicalName,second.canonicalName];
  const bulk=(body:unknown)=>fetch(base+"/v1/targets/subreddit/bulk-update",{method:"POST",headers,body:JSON.stringify(body)}),snapshot=()=>Promise.all(names.map(name=>repos.monitorTargetRepository.findByCanonicalName(name)));
  try{
    const before=await snapshot(),stale=await bulk({canonicalNames:names,patch:{status:"paused"},expectedRevisions:{[names[0]]:1,[names[1]]:1}});assert.equal(stale.status,409);assert.deepEqual(await snapshot(),before);
    assert.equal((await bulk({canonicalNames:names,patch:{notes:"Invalid"},expectedRevisions:{[names[0]]:1}})).status,400);assert.deepEqual(await snapshot(),before);
    assert.equal((await bulk({canonicalNames:names,patch:{notes:"Ambiguous revision",expectedRevision:1}})).status,400,"A revision supplied through patch must never silently become a blind batch");assert.deepEqual(await snapshot(),before);
    assert.equal((await bulk({canonicalNames:names,patch:{notes:"Ambiguous revision",expectedRevision:1},expectedRevisions:{[names[0]]:1,[names[1]]:2}})).status,400);assert.deepEqual(await snapshot(),before);
    const missing=await bulk({canonicalNames:[names[0],"r/missing_target"],patch:{status:"paused"},expectedRevisions:{[names[0]]:1,"r/missing_target":1}});assert.equal(missing.status,409);assert.deepEqual(await snapshot(),before);
    const expectedRevisions={[names[0]]:1,[names[1]]:2},responses=await Promise.all([bulk({canonicalNames:names,patch:{notes:"Batch A",status:"paused"},expectedRevisions}),bulk({canonicalNames:[...names].reverse(),patch:{notes:"Batch B",status:"active"},expectedRevisions})]);assert.deepEqual(responses.map(item=>item.status).sort(),[200,409]);const after=await snapshot();assert.equal(after[0]!.revision,2);assert.equal(after[1]!.revision,3);assert.equal(after[0]!.config.notes,after[1]!.config.notes);assert.equal(after[0]!.status,after[1]!.status);const succeeded=await responses.find(item=>item.status===200)!.json() as BulkUpdateSubredditTargetsResponse;assert.equal(succeeded.targets.length,2);assert.deepEqual(succeeded.targets.map(item=>item.revision).sort(),[2,3]);
  }finally{await stopServer(server);}
});
