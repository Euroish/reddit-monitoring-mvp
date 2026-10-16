import assert from "node:assert/strict";
import test from "node:test";
import { SourceContentService, SourceContentError } from "../../src/application/services/source-content.service";
import { InMemorySourceContentRepository } from "../../src/storage/repositories/in-memory/source-content.repository";
import { DemoContentProvider } from "../../src/connectors/demo/demo-content.connector";
import { fixtureConnector,FIXED_CONTENT_NOW,syntheticRedditPost } from "../helpers/source-content-fixtures";
import type { ContentProvider } from "../../src/connectors/shared/content-provider.interface";
import { ContentProviderError } from "../../src/connectors/shared/content-provider.interface";
const input={platform:"reddit" as const,provider:"arctic_shift",contentKind:"post" as const,target:{type:"community" as const,community:"testcommunity"}};
const window={from:"2026-10-09T00:00:00Z",to:FIXED_CONTENT_NOW};

test("72-hour simulated cadence persists incremental windows, overlap, interruption and pause/resume without external requests",async()=>{
  const start=Date.parse(FIXED_CONTENT_NOW);let now=FIXED_CONTENT_NOW;
  const repo=new InMemorySourceContentRepository(),provider=new DemoContentProvider("reddit",()=>now),service=new SourceContentService(repo,provider,()=>now);
  const source=await service.createSource({...input,provider:"demo_reddit"});
  await service.updateSource(source.id,{group:"Research",schedule:{enabled:true,initialLookbackHours:6,maxCatchupHours:6,pageSize:100,maxPages:2}});
  let queuedAtPause:string|null=null;
  for(let hour=0;hour<=72;hour++){
    now=new Date(start+hour*3600000).toISOString();
    if(hour===12){await service.setSourceState(source.id,"paused");queuedAtPause=(await repo.getSource(source.id))!.incrementalTo;}
    if(hour===18)await service.setSourceState(source.id,"active");
    if(hour===24){await repo.scheduleDue(now,[],20);const interrupted=await repo.claim(now);assert.ok(interrupted);now=new Date(Date.parse(now)+121000).toISOString();}
    for(let tick=0;tick<4&&await service.workOnce();tick++){/* Drain bounded scheduled/recheck pages at this simulated hour. */}
    if(hour>=12&&hour<18)assert.equal((await repo.getSource(source.id))!.incrementalTo,queuedAtPause);
  }
  const saved=(await repo.getSource(source.id))!,jobs=await repo.listJobs({sourceId:source.id,limit:100});
  assert.equal(saved.incrementalTo,now);assert.equal(saved.group,"Research");assert.ok(jobs.length>50);assert.ok(jobs.every(item=>["scheduled","recheck"].includes(item.purpose)&&item.status==="succeeded"));
  const ordered=jobs.filter(item=>item.purpose==="scheduled").sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
  assert.equal(Date.parse(ordered[1].from),Date.parse(ordered[0].to)-300000);
  assert.ok((await repo.contentStats({sourceId:source.id})).total>120);assert.ok((await service.ops()).providers[0].monthlyRequests>50);
});

test("source lifecycle edits preserve identity, cancel leases, archive keeps collected results, and invalid config fails",async()=>{
  const repo=new InMemorySourceContentRepository(),service=new SourceContentService(repo,fixtureConnector([{rows:[syntheticRedditPost()]}]),()=>FIXED_CONTENT_NOW),source=await service.createSource(input);
  await service.updateSource(source.id,{label:"Renamed",group:"中文",schedule:{cadenceSeconds:600}});
  const renamed=(await repo.getSource(source.id))!;assert.equal(renamed.label,"Renamed");assert.equal(renamed.schedule.enabled,false);assert.deepEqual(renamed.target,source.target);
  await service.enqueue(source.id,window);await service.workOnce();
  const task=await service.enqueue(source.id,window),lease=await repo.claim(FIXED_CONTENT_NOW);assert.ok(lease);
  await service.setSourceState(source.id,"paused");assert.equal((await repo.getJob(task.id))!.status,"cancelled");
  await assert.rejects(repo.commitPage(lease,{items:[],nextCheckpoint:null,exhausted:true,coverage:"unknown",warning:null},FIXED_CONTENT_NOW),/lease lost/);
  await assert.rejects(service.enqueue(source.id,window),(error:unknown)=>error instanceof SourceContentError&&error.status===409);
  await service.setSourceState(source.id,"archived");assert.equal((await repo.listContent({sourceId:source.id})).items.length,1);
  await assert.rejects(service.updateSource(source.id,{schedule:{pageSize:101}}),/Invalid pageSize/);
  await assert.rejects(service.updateSource(source.id,{target:{type:"search",query:"new"}} as never),/identity/);
});

test("continue rejects an unrelated active job and repeats only its own active continuation",async()=>{
  const repo=new InMemorySourceContentRepository(),service=new SourceContentService(repo,fixtureConnector([{rows:[syntheticRedditPost()]}]),()=>FIXED_CONTENT_NOW),source=await service.createSource(input);
  const task=await service.enqueue(source.id,{...window,pageSize:1,maxPages:1});await service.workOnce();
  const other=await service.enqueue(source.id,{from:"2026-10-08",to:FIXED_CONTENT_NOW});
  await assert.rejects(service.continueJob(task.id),(error:unknown)=>error instanceof SourceContentError&&error.status===409);
  await service.cancelJob(other.id);const continued=await service.continueJob(task.id),again=await service.continueJob(task.id);assert.equal(again.id,continued.id);assert.equal(continued.parentJobId,task.id);
});

test("provider budget reserves attempted pages including retries and resumes next UTC day without advancing checkpoint",async()=>{
  let now=FIXED_CONTENT_NOW;const urls:URL[]=[],repo=new InMemorySourceContentRepository(),service=new SourceContentService(repo,fixtureConnector([{status:429,error:"Limited",headers:{"retry-after":"5"}}],urls),()=>now),source=await service.createSource(input);
  await service.setProviderBudget("arctic_shift",{enabled:true,dailyRequests:1,monthlyRequests:10,dailyResources:100,monthlyResources:1000});
  const task=await service.enqueue(source.id,window);await service.workOnce();now=new Date(Date.parse(now)+6000).toISOString();await service.workOnce();
  assert.equal(urls.length,1);const deferred=await service.getJob(task.id);assert.equal(deferred.status,"retrying");assert.equal(deferred.checkpoint,null);assert.equal(deferred.attempts,0);assert.match(deferred.error!,/budget/);
  assert.equal((await service.ops()).providers[0].dailyResources,100);
  now="2026-10-13T00:00:00.000Z";await service.workOnce();assert.equal(urls.length,2);assert.equal((await service.ops()).providers[0].monthlyRequests,2);
});

test("unconfigured paid provider defaults to disabled zero budget and cannot send a request",async()=>{
  const repo=new InMemorySourceContentRepository(),base=new DemoContentProvider("x"),provider:ContentProvider={capability:{...base.capability,provider:"paid_fixture"},normalizeTarget:base.normalizeTarget.bind(base),collectPage:async()=>{assert.fail("No upstream request permitted");}};
  const service=new SourceContentService(repo,provider,()=>FIXED_CONTENT_NOW),source=await service.createSource({platform:"x",provider:"paid_fixture",contentKind:"post",target:{type:"account",account:"fixture"}});
  const task=await service.enqueue(source.id,window);await service.workOnce();assert.equal((await service.getJob(task.id)).status,"retrying");assert.equal((await service.ops()).providers[0].budget.enabled,false);assert.equal((await service.ops()).providers[0].monthlyRequests,0);
});

test("mature archive refresh uses bounded IDs and preserves genuine zero while moving maturity from metadata",async()=>{
  const urls:URL[]=[],repo=new InMemorySourceContentRepository(),provider=fixtureConnector([{rows:[syntheticRedditPost({_meta:{},score:0})]},{rows:[syntheticRedditPost({score:9})]}],urls),service=new SourceContentService(repo,provider,()=>FIXED_CONTENT_NOW),source=await service.createSource(input);
  await service.updateSource(source.id,{refresh:{enabled:true,batchSize:5}});await service.enqueue(source.id,window);await service.workOnce();
  assert.equal((await repo.listContent({})).items[0].observations[0].metrics["reddit.score"],0);await service.workOnce();
  assert.match(urls[1].pathname,/posts\/ids$/);assert.equal(urls[1].searchParams.get("ids"),"abc123");const content=(await repo.listContent({})).items[0];assert.equal(content.observations[0].maturity,"refreshed");assert.equal(content.observations[0].metrics["reddit.score"],9);assert.equal(await service.workOnce(),false);
});

test("unavailable refresh IDs consume bounded retry slots and do not cause infinite refresh jobs",async()=>{
  let now=FIXED_CONTENT_NOW,calls=0;const repo=new InMemorySourceContentRepository(),base=fixtureConnector([{rows:[syntheticRedditPost({_meta:{}})]}]);
  const provider:ContentProvider={capability:base.capability,normalizeTarget:base.normalizeTarget.bind(base),collectPage:base.collectPage.bind(base),refreshIds:async()=>{calls++;return {items:[],exhausted:true,nextCheckpoint:null,coverage:"partial",warning:"Unavailable fixture ID"};}};
  const service=new SourceContentService(repo,provider,()=>now),source=await service.createSource(input);await service.updateSource(source.id,{refresh:{enabled:true,maxAttempts:2,minIntervalHours:1}});await service.enqueue(source.id,window);await service.workOnce();await service.workOnce();
  now=new Date(Date.parse(now)+3600000).toISOString();await service.workOnce();now=new Date(Date.parse(now)+3600000).toISOString();assert.equal(await service.workOnce(),false);assert.equal(calls,2);
});

test("job progress deduplicates repeated identities and older content cannot replace media or references",async()=>{
  const repo=new InMemorySourceContentRepository(),base=fixtureConnector([{rows:[syntheticRedditPost()]}]),source=await new SourceContentService(repo,base,()=>FIXED_CONTENT_NOW).createSource(input);
  const page=await base.collectPage({source,...window,limit:25,checkpoint:null}),newest=page.items[0];newest.media=[{type:"image",url:"https://example.test/new.png",previewUrl:null,altText:null,durationSeconds:null}];newest.references=[{kind:"post",externalId:"t3_root",relation:"quote"}];
  const first=await repo.enqueue({id:crypto.randomUUID(),sourceId:source.id,now:FIXED_CONTENT_NOW,...window,pageSize:25,maxPages:1});const claim=await repo.claim(FIXED_CONTENT_NOW);assert.ok(claim);await repo.commitPage(claim,{...page,items:[newest,newest]},FIXED_CONTENT_NOW);const progress=(await repo.getJob(first.id))!;assert.equal(progress.recordsInserted,1);assert.equal(progress.recordsUpdated,0);assert.equal(progress.recordsProcessed,2);
  const old={...newest,language:"zh",publishedAt:null,media:[],references:[],observation:{...newest.observation,sourceObservedAt:"2026-10-10T09:00:00Z",evidenceKey:"older"}};
  await repo.enqueue({id:crypto.randomUUID(),sourceId:source.id,now:FIXED_CONTENT_NOW,...window,pageSize:25,maxPages:1});const older=await repo.claim(FIXED_CONTENT_NOW);assert.ok(older);await repo.commitPage(older,{...page,items:[old]},FIXED_CONTENT_NOW);const result=(await repo.listContent({})).items[0];assert.deepEqual(result.media,newest.media);assert.deepEqual(result.references,newest.references);assert.equal(result.language,"zh");assert.equal(result.publishedAt,newest.publishedAt);
});

test("operations report worker staleness separately from success age and latest-publication age",async()=>{
  const repo=new InMemorySourceContentRepository(),service=new SourceContentService(repo,fixtureConnector([{rows:[]}]),()=>FIXED_CONTENT_NOW),source=await service.createSource(input);await service.enqueue(source.id,window);
  await repo.heartbeat({id:"fixture-worker",startedAt:"2026-10-12T09:00:00Z",lastHeartbeatAt:"2026-10-12T09:00:00Z",state:"active",lastJobId:null});const ops=await service.ops();assert.equal(ops.workers[0].stale,true);assert.equal(ops.queue[0].count,1);assert.equal(ops.sources[0].lastSuccessAgeHours,null);assert.equal(ops.sources[0].latestPublishedAgeHours,null);
});

test("bounded backfill yields between pages so another source's due window finishes",async()=>{
  const repo=new InMemorySourceContentRepository(),provider=new DemoContentProvider("reddit",()=>FIXED_CONTENT_NOW),service=new SourceContentService(repo,provider,()=>FIXED_CONTENT_NOW);
  const backfill=await service.createSource({...input,provider:"demo_reddit",target:{type:"community",community:"backfill"}}),live=await service.createSource({...input,provider:"demo_reddit",target:{type:"community",community:"incremental"}});
  const manual=await service.enqueue(backfill.id,{...window,pageSize:1,maxPages:20});await service.updateSource(live.id,{schedule:{enabled:true,initialLookbackHours:6,pageSize:100}});
  await service.workOnce();await service.workOnce();assert.equal((await repo.listJobs({sourceId:live.id}))[0].status,"succeeded");assert.equal((await repo.getJob(manual.id))!.pagesCommitted,1);
});

test("the next scheduled cadence resumes a failed page checkpoint and keeps the failure in history",async()=>{
  let now=FIXED_CONTENT_NOW,calls=0;const repo=new InMemorySourceContentRepository(),base=new DemoContentProvider("reddit",()=>now),provider:ContentProvider={capability:base.capability,normalizeTarget:base.normalizeTarget.bind(base),collectPage:async request=>{calls++;if(calls>=2&&calls<=4)throw new ContentProviderError("Temporary fixture failure",true,5);return base.collectPage(request);}};
  const service=new SourceContentService(repo,provider,()=>now),source=await service.createSource({...input,provider:"demo_reddit"});await service.updateSource(source.id,{schedule:{enabled:true,cadenceSeconds:60,initialLookbackHours:6,pageSize:2,maxPages:5}});
  for(let i=0;i<4;i++){await service.workOnce();now=new Date(Date.parse(now)+6000).toISOString();}
  const failed=(await repo.listJobs({sourceId:source.id}))[0];assert.equal(failed.status,"failed");assert.ok(failed.checkpoint);assert.equal(failed.recordsInserted,2);
  now=new Date(Date.parse(FIXED_CONTENT_NOW)+61000).toISOString();for(let i=0;i<5;i++){await service.workOnce();now=new Date(Date.parse(now)+6000).toISOString();}
  const finished=(await repo.listJobs({sourceId:source.id}))[0];assert.equal(finished.status,"succeeded");assert.equal(finished.parentJobId,failed.id);assert.equal(finished.recordsInserted,10);assert.equal((await repo.getJob(failed.id))!.status,"failed");assert.equal((await repo.contentStats({sourceId:source.id})).total,12);
});

test("fixed-size paid pages reserve at least their provider upper bound, and an explicit raised budget wakes blocked jobs",async()=>{
  let calls=0;const repo=new InMemorySourceContentRepository(),base=new DemoContentProvider("x",()=>FIXED_CONTENT_NOW),provider:ContentProvider={capability:{...base.capability,provider:"paid_fixture",requestResourceUpperBound:20},normalizeTarget:base.normalizeTarget.bind(base),collectPage:async request=>{calls++;const page=await base.collectPage(request);return {...page,items:page.items.map(item=>({...item,observation:{...item.observation,provider:"paid_fixture"}})),nextCheckpoint:null,exhausted:true};}};
  const service=new SourceContentService(repo,provider,()=>FIXED_CONTENT_NOW),source=await service.createSource({platform:"x",provider:"paid_fixture",contentKind:"post",target:{type:"account",account:"fixture"}}),task=await service.enqueue(source.id,{...window,pageSize:1});
  await service.setProviderBudget("paid_fixture",{enabled:true,dailyRequests:1,monthlyRequests:1,dailyResources:10,monthlyResources:10});await service.workOnce();assert.equal(calls,0);
  await service.setProviderBudget("paid_fixture",{enabled:true,dailyRequests:1,monthlyRequests:1,dailyResources:20,monthlyResources:20});await service.workOnce();assert.equal(calls,1);assert.equal((await service.getJob(task.id)).status,"succeeded");assert.equal((await service.ops()).providers[0].dailyResources,20);
});

test("a disabled provider does not schedule formerly enabled cadence or consume its budget",async()=>{
  const repo=new InMemorySourceContentRepository(),base=new DemoContentProvider("reddit",()=>FIXED_CONTENT_NOW),enabled=new SourceContentService(repo,base,()=>FIXED_CONTENT_NOW),source=await enabled.createSource({...input,provider:"demo_reddit"});await enabled.updateSource(source.id,{schedule:{enabled:true}});
  const provider:ContentProvider={capability:{...base.capability,enabled:false},normalizeTarget:base.normalizeTarget.bind(base),collectPage:async()=>{assert.fail("Disabled providers cannot issue requests");}},disabled=new SourceContentService(repo,provider,()=>FIXED_CONTENT_NOW);
  assert.equal(await disabled.workOnce(),false);assert.deepEqual(await repo.listJobs({sourceId:source.id}),[]);assert.equal((await disabled.ops()).providers[0].dailyRequests,0);assert.equal((await repo.getSource(source.id))!.incrementalTo,null);
});

test("snapshot providers cannot enable an archive-maturity refresh schedule",async()=>{
  const service=new SourceContentService(new InMemorySourceContentRepository(),new DemoContentProvider("x"),()=>FIXED_CONTENT_NOW),source=await service.createSource({platform:"x",provider:"demo_x",contentKind:"post",target:{type:"account",account:"fixture"}});
  await assert.rejects(service.updateSource(source.id,{refresh:{enabled:true}}),(error:unknown)=>error instanceof SourceContentError&&error.status===400&&/archive observations only/.test(error.message));assert.equal((await service.repository.getSource(source.id))!.refresh.enabled,false);
});
