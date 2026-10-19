import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { MonitorTarget } from "../../src/domain/entities/monitor-target";
import type { MonitorTargetRepository } from "../../src/domain/repositories/monitor-target-repository";
import type { SourceContentRepository } from "../../src/domain/repositories/source-content-repository";
import { SourceContentError } from "../../src/domain/source-content-error";
import { SourceContentService } from "../../src/application/services/source-content.service";
import { DemoContentProvider } from "../../src/connectors/demo/demo-content.connector";
import { FIXED_CONTENT_NOW } from "./source-content-fixtures";

const now=FIXED_CONTENT_NOW,window={from:"2026-10-12T08:00:00.000Z",to:now};
const input={platform:"reddit" as const,provider:"demo_reddit",contentKind:"post" as const,target:{type:"community" as const,community:"revision_fixture"}};
const conflict=(error:unknown)=>error instanceof SourceContentError&&error.kind === "conflict";
function target(name:string):MonitorTarget{return {id:randomUUID(),source:"reddit",targetType:"subreddit",canonicalName:`r/${name}`,status:"active",config:{notes:"Original",collection:{live:{favorite:false}}},createdAt:now,updatedAt:now};}
export const configurationRevisionCases:{name:string;run:(sources:SourceContentRepository,targets:MonitorTargetRepository)=>Promise<void>}[]=[
  {name:"source CAS admits one concurrent edit and stale pause cannot cancel a worker lease",run:async repo=>{
    const provider=new DemoContentProvider("reddit",()=>now),service=new SourceContentService(repo,provider,()=>now),source=await service.createSource(input);assert.equal(source.revision,1);
    const results=await Promise.allSettled([service.updateSource(source.id,{label:"First edit",expectedRevision:1}),service.updateSource(source.id,{label:"Second edit",expectedRevision:1})]);assert.equal(results.filter(item=>item.status==="fulfilled").length,1);const rejected=results.find(item=>item.status==="rejected")!;assert.ok(rejected.status==="rejected"&&conflict(rejected.reason));
    const saved=(await repo.getSource(source.id))!;assert.equal(saved.revision,2);assert.ok(["First edit","Second edit"].includes(saved.label));
    const job=await service.enqueue(source.id,window),claim=await repo.claim(now);assert.ok(claim);assert.equal(claim.job.id,job.id);const page=await provider.collectPage({source:saved,...window,checkpoint:null,limit:25});
    await assert.rejects(service.setSourceState(source.id,"paused",1),conflict);assert.equal((await repo.getJob(job.id))!.status,"running");assert.equal((await repo.getSource(source.id))!.state,"active");
    await service.setSourceState(source.id,"paused",2);assert.equal((await repo.getJob(job.id))!.status,"cancelled");assert.equal((await repo.getSource(source.id))!.revision,3);await assert.rejects(repo.commitPage(claim,page,now),/lease lost/);assert.equal((await repo.contentStats({sourceId:source.id})).total,0);
    const resumed=await service.setSourceState(source.id,"active",3);assert.equal(resumed.revision,4);await service.enqueue(source.id,window);await service.workOnce();const after=(await repo.getSource(source.id))!;assert.equal(after.revision,4,"Collection progress does not invalidate a configuration edit");assert.equal(after.lastSuccessAt,now);assert.ok((await repo.contentStats({sourceId:source.id})).total>0);
    const blind=await service.updateSource(source.id,{group:"Legacy blind edit"});assert.equal(blind.revision,5);await assert.rejects(service.updateSource(source.id,{group:"Stale",expectedRevision:4}),conflict);assert.equal((await repo.getSource(source.id))!.group,"Legacy blind edit");
  }},
  {name:"provider budgets use revision zero for first-create CAS and reserve usage never changes a persisted configuration revision",run:async repo=>{
    const service=new SourceContentService(repo,new DemoContentProvider("reddit",()=>now),()=>now);await service.createSource(input);const defaults=(await service.ops()).providers[0];assert.equal(defaults.budget.revision,0);
    const base={enabled:true,dailyRequests:10,monthlyRequests:100,dailyResources:250,monthlyResources:2500,minimumIntervalMs:1000};
    const created=await Promise.allSettled([service.setProviderBudget("demo_reddit",{...base,expectedRevision:0}),service.setProviderBudget("demo_reddit",{...base,dailyRequests:20,expectedRevision:0})]);assert.equal(created.filter(item=>item.status==="fulfilled").length,1);const rejected=created.find(item=>item.status==="rejected")!;assert.ok(rejected.status==="rejected"&&conflict(rejected.reason));assert.equal((await service.ops()).providers[0].budget.revision,1);
    const updated=await Promise.allSettled([service.setProviderBudget("demo_reddit",{...base,dailyRequests:30,expectedRevision:1}),service.setProviderBudget("demo_reddit",{...base,dailyRequests:40,expectedRevision:1})]);assert.equal(updated.filter(item=>item.status==="fulfilled").length,1);const stored=(await service.ops()).providers[0].budget;assert.equal(stored.revision,2);assert.ok([30,40].includes(stored.dailyRequests));
    assert.equal((await repo.reserveUsage("demo_reddit",25,now)).allowed,true);const reserved=(await service.ops()).providers[0];assert.equal(reserved.budget.revision,2);assert.equal(reserved.dailyRequests,1);assert.equal(reserved.dailyResources,25);
    await assert.rejects(service.setProviderBudget("demo_reddit",{...base,enabled:false,expectedRevision:1}),conflict);assert.deepEqual((await service.ops()).providers[0],reserved);
    const {minimumIntervalMs:_spacing,...legacy}=base,blind=await service.setProviderBudget("demo_reddit",legacy);assert.equal(blind.revision,3);assert.equal(blind.minimumIntervalMs,1000);assert.equal((await service.ops()).providers[0].dailyRequests,1);
  }},
  {name:"default budget materialization rejects a stale first-create token without undoing its reserved resources",run:async repo=>{
    const service=new SourceContentService(repo,new DemoContentProvider("reddit",()=>now),()=>now);await service.createSource(input);assert.equal((await service.ops()).providers[0].budget.revision,0);assert.equal((await repo.reserveUsage("demo_reddit",25,now)).allowed,true);
    await assert.rejects(service.setProviderBudget("demo_reddit",{enabled:false,dailyRequests:0,monthlyRequests:0,dailyResources:0,monthlyResources:0,expectedRevision:0}),conflict);const usage=(await service.ops()).providers[0];assert.equal(usage.budget.revision,1);assert.equal(usage.budget.enabled,true);assert.equal(usage.dailyRequests,1);assert.equal(usage.dailyResources,25);
  }},
  {name:"monitor-target CAS, immutable read copies, and legacy upsert revision increments preserve the winning configuration",run:async (_repo,targets)=>{
    const source=await targets.upsert(target("target_revision"));assert.equal(source.revision,1);source.config.notes="Caller-only mutation";assert.equal((await targets.findById(source.id))!.config.notes,"Original");
    const copy=(await targets.findById(source.id))!,results=await Promise.all([targets.updateIfRevision({...copy,status:"paused",config:{notes:"First"}},1),targets.updateIfRevision({...copy,config:{notes:"Second"}},1)]);assert.equal(results.filter(Boolean).length,1);const winner=(await targets.findById(source.id))!;assert.equal(winner.revision,2);
    assert.equal(await targets.updateIfRevision({...copy,config:{notes:"Stale"}},1),null);assert.deepEqual(await targets.findById(source.id),winner);
    const blind=await targets.upsert({...winner,config:{notes:"Legacy blind"}});assert.equal(blind.revision,3);assert.equal(await targets.updateIfRevision({...winner,config:{notes:"Stale again"}},2),null);assert.equal((await targets.findById(source.id))!.config.notes,"Legacy blind");
  }},
  {name:"atomic target batches reject stale or missing members before any write and overlapping reversed batches have one winner",run:async (_repo,targets)=>{
    const first=await targets.upsert(target("bulk_first")),second=await targets.upsert(target("bulk_second")),edited=await targets.updateIfRevision({...second,config:{notes:"Concurrent edit"}},1);assert.ok(edited);
    const stale=await targets.updateManyIfRevisions([{target:{...first,status:"paused"},expectedRevision:1},{target:{...second,status:"paused"},expectedRevision:1}]);assert.equal(stale,null);assert.equal((await targets.findById(first.id))!.revision,1);assert.equal((await targets.findById(first.id))!.status,"active");assert.deepEqual(await targets.findById(second.id),edited);
    const missing=await targets.updateManyIfRevisions([{target:{...first,status:"paused"},expectedRevision:1},{target:target("missing"),expectedRevision:1}]);assert.equal(missing,null);assert.equal((await targets.findById(first.id))!.revision,1);
    const batch=[{target:{...first,status:"paused" as const,config:{notes:"Batch A"}},expectedRevision:1},{target:{...edited,status:"paused" as const,config:{notes:"Batch A"}},expectedRevision:2}],other=[...batch].reverse().map(item=>({...item,target:{...item.target,status:"active" as const,config:{notes:"Batch B"}}}));
    const results=await Promise.all([targets.updateManyIfRevisions(batch),targets.updateManyIfRevisions(other)]);assert.equal(results.filter(Boolean).length,1);const savedFirst=(await targets.findById(first.id))!,savedSecond=(await targets.findById(second.id))!;assert.equal(savedFirst.revision,2);assert.equal(savedSecond.revision,3);assert.equal(savedFirst.config.notes,savedSecond.config.notes);assert.equal(savedFirst.status,savedSecond.status);
    assert.equal(await targets.updateManyIfRevisions([{target:savedFirst,expectedRevision:2},{target:savedFirst,expectedRevision:2}]),null,"Duplicate identities cannot be written twice in one revision batch");
  }},
  {name:"invalid revision input is rejected without changing source or budget configuration",run:async repo=>{
    const service=new SourceContentService(repo,new DemoContentProvider("reddit"),()=>now),source=await service.createSource(input);for(const expectedRevision of [0,-1,1.5,2147483647]){await assert.rejects(service.updateSource(source.id,{label:"Invalid",expectedRevision}),error=>error instanceof SourceContentError&&error.kind === "invalid_request");await assert.rejects(service.setSourceState(source.id,"paused",expectedRevision),error=>error instanceof SourceContentError&&error.kind === "invalid_request");}
    for(const expectedRevision of [-1,1.5,2147483647])await assert.rejects(service.setProviderBudget("demo_reddit",{enabled:true,dailyRequests:10,monthlyRequests:100,dailyResources:250,monthlyResources:2500,expectedRevision}),error=>error instanceof SourceContentError&&error.kind === "invalid_request");assert.equal((await repo.getSource(source.id))!.revision,1);assert.equal((await service.ops()).providers[0].budget.revision,0);
  }},
];
