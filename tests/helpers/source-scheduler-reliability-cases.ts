import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { CollectionSource, SourceCollectionJob } from "../../packages/contracts/src/source-content";
import { SourceContentError, SourceContentService } from "../../src/application/services/source-content.service";
import { DemoContentProvider } from "../../src/connectors/demo/demo-content.connector";
import { ArcticShiftContentConnector } from "../../src/connectors/reddit/arctic-shift-content.connector";
import type { CollectedPage } from "../../src/connectors/shared/content-provider.interface";
import type { SourceContentRepository } from "../../src/domain/repositories/source-content-repository";
import { FIXED_CONTENT_NOW, syntheticRedditPost } from "./source-content-fixtures";

const now=FIXED_CONTENT_NOW,window={from:"2026-10-09T00:00:00.000Z",to:now};
const empty:CollectedPage={items:[],nextCheckpoint:null,exhausted:true,coverage:"unknown",warning:null};
const offset=(milliseconds:number)=>new Date(Date.parse(now)+milliseconds).toISOString();
async function source(repo:SourceContentRepository,index:number,provider="demo_reddit"):Promise<CollectionSource>{return repo.createSource({id:`00000000-0000-4000-8000-${String(index).padStart(12,"0")}`,platform:"reddit",provider,label:`Offline scheduling ${index}`,target:{type:"community",community:`scheduling_${index}`},contentKind:"post",createdAt:now});}

export const schedulerReliabilityCases:{name:string;run:(repo:SourceContentRepository)=>Promise<void>}[]=[
  {name:"100 mixed sources receive bounded 3:1 dispatch slots with no repeated or lost claim",run:async repo=>{
    const ids=new Set<string>();
    for(let index=1;index<=100;index++){
      const item=await source(repo,index),purpose:SourceCollectionJob["purpose"]=index<=60?"scheduled":index<=75?"recheck":index<=90?"manual":"refresh";
      const task=await repo.enqueue({id:randomUUID(),sourceId:item.id,now,...window,pageSize:25,maxPages:1,purpose});ids.add(task.id);
    }
    for(let slot=1;slot<=100;slot++){
      const claimed=await repo.claim(now);assert.ok(claimed,`Runnable source must advance in slot ${slot}`);assert.ok(ids.delete(claimed.job.id),"Each job is claimed exactly once");
      assert.equal(["manual","refresh"].includes(claimed.job.purpose),slot%4===0,`Background sources get each fourth slot; foreground gets other slots (${slot})`);
      await repo.commitPage(claimed,empty,now);
    }
    assert.equal(ids.size,0);assert.equal(await repo.claim(now),null);
  }},
  {name:"same-source manual backfill coexists with cadence, keeps checkpoints, and has only one running lease",run:async repo=>{
    let clock=now;const provider=new DemoContentProvider("reddit",()=>clock),service=new SourceContentService(repo,provider,()=>clock),item=await source(repo,201);
    const manual=await service.enqueue(item.id,{...window,pageSize:2,maxPages:20});
    await service.updateSource(item.id,{schedule:{enabled:true,initialLookbackHours:6,maxCatchupHours:6,cadenceSeconds:60,recheckLookbackHours:0,pageSize:100}});
    assert.equal(await repo.scheduleDue(clock,[],20),1);assert.equal((await repo.listJobs({sourceId:item.id})).filter(task=>["queued","running"].includes(task.status)).length,2);
    assert.equal((await service.enqueue(item.id,{...window,pageSize:2,maxPages:20})).id,manual.id);
    await assert.rejects(service.enqueue(item.id,{...window,pageSize:3,maxPages:20}),(error:unknown)=>error instanceof SourceContentError&&error.status===409);
    const concurrent=await Promise.all([repo.claim(clock),repo.claim(clock)]),claimed=concurrent.find(Boolean)!;assert.equal(concurrent.filter(Boolean).length,1);assert.equal(claimed.job.purpose,"scheduled");
    await repo.commitPage(claimed,empty,clock);
    const history=await repo.claim(clock);assert.ok(history);assert.equal(history.job.id,manual.id);await repo.commitPage(history,{...empty,exhausted:false,nextCheckpoint:{offset:2}},clock);
    clock=offset(61000);assert.equal(await repo.scheduleDue(clock,[],20),1);const next=await repo.claim(clock);assert.ok(next);assert.equal(next.job.purpose,"scheduled");assert.deepEqual((await repo.getJob(manual.id))!.checkpoint,{offset:2});
    await service.setSourceState(item.id,"paused");assert.equal((await repo.getJob(next.job.id))!.status,"cancelled");assert.equal((await repo.getJob(manual.id))!.status,"cancelled");await assert.rejects(repo.commitPage(next,empty,clock),/lease lost/);
    await service.setSourceState(item.id,"active");assert.equal(await repo.scheduleDue(clock,[],20),1);assert.equal((await repo.listJobs({sourceId:item.id})).filter(task=>task.status==="queued").length,1);
  }},
  {name:"minimum provider interval is atomic across workers and cannot bypass conservative daily budgets",run:async repo=>{
    const budget={provider:"interval_fixture",enabled:true,dailyRequests:2,monthlyRequests:10,dailyResources:40,monthlyResources:200,minimumIntervalMs:1000};await repo.setProviderBudget(budget,now);
    const results=await Promise.all(Array.from({length:10},()=>repo.reserveUsage(budget.provider,20,now)));assert.equal(results.filter(item=>item.allowed).length,1);assert.equal(results.filter(item=>item.reason==="interval").length,9);assert.ok(results.filter(item=>!item.allowed).every(item=>item.retryAt===offset(1000)));
    const {minimumIntervalMs:_interval,...oldClient}=budget;assert.equal((await repo.setProviderBudget(oldClient,now)).minimumIntervalMs,1000,"Omitted spacing must preserve the configured interval");
    assert.equal((await repo.reserveUsage(budget.provider,20,offset(999))).reason,"interval");assert.equal((await repo.reserveUsage(budget.provider,20,offset(1000))).allowed,true);assert.equal((await repo.reserveUsage(budget.provider,20,offset(2000))).reason,"budget");
    const usage=(await repo.providerUsage(offset(2000))).find(item=>item.provider===budget.provider)!;assert.equal(usage.dailyRequests,2);assert.equal(usage.dailyResources,40);assert.equal(usage.lastReservationAt,offset(1000));
  }},
  {name:"request spacing defers a job without attempts, reservations, or adapter calls and survives budget updates",run:async repo=>{
    let clock=now,calls=0;const base=new DemoContentProvider("reddit",()=>clock),service=new SourceContentService(repo,{capability:base.capability,normalizeTarget:base.normalizeTarget.bind(base),collectPage:async request=>{calls++;return {...await base.collectPage(request),nextCheckpoint:null,exhausted:true};}},()=>clock);
    await service.setProviderBudget("demo_reddit",{enabled:true,dailyRequests:10,monthlyRequests:100,dailyResources:1000,monthlyResources:10000,minimumIntervalMs:1000});
    const first=await source(repo,301),second=await source(repo,302);await service.enqueue(first.id,window);const task=await service.enqueue(second.id,window);await service.workOnce();await service.workOnce();assert.equal(calls,1);
    const jobs=await repo.listJobs({status:"retrying"});assert.equal(jobs.length,1);const deferred=jobs[0];assert.equal(deferred.attempts,0);assert.equal(deferred.requestCount,0);assert.match(deferred.error!,/request spacing/);assert.equal((await repo.providerUsage(clock))[0].dailyRequests,1);
    await service.setProviderBudget("demo_reddit",{enabled:true,dailyRequests:10,monthlyRequests:100,dailyResources:1000,monthlyResources:10000});await service.workOnce();assert.equal(calls,1,"Waking a job cannot bypass the retained spacing gate");clock=offset(1000);await service.workOnce();assert.equal(calls,2);assert.equal((await repo.getJob(task.id))!.status,"succeeded");
    const ops=await service.ops();assert.equal(ops.requests!.registeredCount,2);assert.equal(ops.requests!.scope,"retained_jobs");assert.ok(ops.requests!.totalDurationMs>=0);
  }},
  {name:"a publication arriving late is discovered by bounded retrospective recheck without regressing the incremental high water",run:async repo=>{
    let clock=now,visible=false;const requested:URL[]=[];
    const published=Date.parse(now)/1000-7200,row=syntheticRedditPost({id:"late123",subreddit:"scheduling_401",created_utc:published,retrieved_on:published+30,_meta:{}});
    const provider=new ArcticShiftContentConnector(async input=>{const url=new URL(String(input));requested.push(url);const rows=visible&&published>Number(url.searchParams.get("after"))&&published<Number(url.searchParams.get("before"))?[row]:[];return new Response(JSON.stringify({data:rows}));},1000,()=>clock);
    const service=new SourceContentService(repo,provider,()=>clock),item=await source(repo,401,"arctic_shift");await service.updateSource(item.id,{schedule:{enabled:true,cadenceSeconds:60,initialLookbackHours:6,maxCatchupHours:6,recheckLookbackHours:12,recheckCadenceSeconds:60,pageSize:100}});
    for(let tick=0;tick<2;tick++)await service.workOnce();assert.equal((await repo.contentStats({sourceId:item.id})).total,0);assert.equal((await repo.getSource(item.id))!.incrementalTo,now);
    clock=offset(3600000);visible=true;for(let tick=0;tick<2;tick++)await service.workOnce();const tasks=await repo.listJobs({sourceId:item.id});assert.equal(tasks.filter(task=>task.recordsInserted>0).length,1);assert.equal(tasks.find(task=>task.recordsInserted>0)!.purpose,"recheck");assert.equal((await repo.contentStats({sourceId:item.id})).total,1);assert.equal((await repo.getSource(item.id))!.incrementalTo,clock);assert.equal((await repo.getSource(item.id))!.coverage,"unknown");assert.equal(requested.length,4);
    const recheck=tasks.find(task=>task.createdAt===clock&&task.purpose==="recheck")!;assert.equal(Date.parse(recheck.to)-Date.parse(recheck.from),12*3600000);
  }},
  {name:"zero lookback disables automatic rechecks and disabled candidates cannot occupy the first scheduler page",run:async repo=>{
    const service=new SourceContentService(repo,new DemoContentProvider("reddit"),()=>now);
    for(let index=501;index<=521;index++){const item=await source(repo,index);await service.updateSource(item.id,{schedule:{enabled:true,initialLookbackHours:6,recheckLookbackHours:0}});if(index<=520){assert.equal(await repo.scheduleDue(now,[],20),1);const claimed=await repo.claim(now);assert.ok(claimed);assert.equal(claimed.job.sourceId,item.id);await repo.commitPage(claimed,empty,now);}}
    assert.equal(await repo.scheduleDue(now,[],20),1,"Disabled retrospective candidates must be filtered before limiting the scheduler page");
    const task=(await repo.listJobs({sourceId:"00000000-0000-4000-8000-000000000521"}))[0];assert.ok(task);assert.equal(task.purpose,"scheduled");assert.equal((await repo.listJobs({})).filter(item=>item.purpose==="recheck").length,0);
    await assert.rejects(service.updateSource(task.sourceId,{schedule:{recheckLookbackHours:169}}),/Invalid recheckLookbackHours/);await assert.rejects(service.updateSource(task.sourceId,{schedule:{recheckLookbackHours:-1}}),/Invalid recheckLookbackHours/);
  }},
  {name:"bounded recheck continuation resumes the frozen window and checkpoint while a newer scheduled window advances",run:async repo=>{
    let clock=now;const provider=new DemoContentProvider("reddit",()=>clock),service=new SourceContentService(repo,provider,()=>clock),item=await source(repo,601);await service.updateSource(item.id,{schedule:{enabled:true,cadenceSeconds:60,initialLookbackHours:1,maxCatchupHours:6,recheckLookbackHours:12,recheckCadenceSeconds:60,pageSize:10,maxPages:1}});
    await service.workOnce();await service.workOnce();const previous=(await repo.listJobs({sourceId:item.id})).find(task=>task.purpose==="recheck")!;assert.equal(previous.status,"succeeded");assert.equal(previous.exhausted,false);assert.deepEqual(previous.checkpoint,{offset:10});assert.equal((await repo.getSource(item.id))!.incrementalTo,now);
    clock=offset(61000);await service.workOnce();await service.workOnce();const child=(await repo.listJobs({sourceId:item.id})).find(task=>task.parentJobId===previous.id)!;assert.ok(child);assert.equal(child.from,previous.from);assert.equal(child.to,previous.to);assert.deepEqual(child.checkpoint,{offset:20});assert.equal((await repo.getSource(item.id))!.incrementalTo,clock);
    clock=offset(122000);await service.workOnce();await service.workOnce();const last=(await repo.listJobs({sourceId:item.id})).find(task=>task.parentJobId===child.id)!;assert.equal(last.exhausted,true);assert.equal(last.checkpoint,null);assert.equal(last.to,now);assert.equal((await repo.getSource(item.id))!.incrementalTo,clock);
  }},
];
