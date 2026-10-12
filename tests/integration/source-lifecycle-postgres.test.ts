import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PostgresClient } from "../../src/storage/postgres/postgres-client";
import { runMigrations } from "../../src/storage/schema/run-migrations";
import { PostgresSourceContentRepository } from "../../src/storage/repositories/postgres/postgres-source-content.repository";
import { SourceContentService } from "../../src/application/services/source-content.service";
import { DemoContentProvider } from "../../src/connectors/demo/demo-content.connector";
import { FIXED_CONTENT_NOW } from "../helpers/source-content-fixtures";
import { defaultProviderBudget } from "../../src/storage/source-lifecycle";

const connectionString=process.env.TEST_SOURCE_DATABASE_URL;
test("PostgreSQL lifecycle migration, scheduler progress, cancellation fencing, content merge and concurrent provider budgets",{skip:!connectionString},async()=>{
  const url=new URL(connectionString!);assert.ok(["127.0.0.1","localhost"].includes(url.hostname)&&/^\/source_validation_[a-z0-9_]+$/.test(url.pathname),"Use a dedicated loopback source_validation_* database");
  const db=new PostgresClient({connectionString,max:5});let now=FIXED_CONTENT_NOW;
  try{
    await runMigrations({db});
    const repo=new PostgresSourceContentRepository(db),provider=new DemoContentProvider("reddit",()=>now),service=new SourceContentService(repo,provider,()=>now),target=`fixture_${randomUUID().slice(0,8)}`;
    await repo.setProviderBudget(defaultProviderBudget("demo_reddit"),now);
    const source=await service.createSource({platform:"reddit",provider:"demo_reddit",contentKind:"post",target:{type:"community",community:target}});
    await service.updateSource(source.id,{group:"SQL fixture",schedule:{enabled:true,initialLookbackHours:6,maxCatchupHours:6,pageSize:100,maxPages:2}});
    await service.workOnce();const first=(await repo.listJobs({sourceId:source.id}))[0];assert.equal(first.status,"succeeded");assert.equal(first.purpose,"scheduled");assert.equal(first.recordsInserted,12);assert.equal((await repo.getSource(source.id))!.incrementalTo,now);assert.equal(await service.workOnce(),false);
    now=new Date(Date.parse(now)+3600000).toISOString();await service.workOnce();const second=(await repo.listJobs({sourceId:source.id}))[0];assert.equal(Date.parse(second.from),Date.parse(first.to)-300000);assert.equal(second.status,"succeeded");assert.equal((await repo.getSource(source.id))!.incrementalTo,now);
    const b=await service.createSource({platform:"reddit",provider:"demo_reddit",contentKind:"post",target:{type:"community",community:target+"b"}}),window={from:"2026-10-12T08:00:00.000Z",to:now};
    const queued=await service.enqueue(b.id,window),claim=await repo.claim(now);assert.ok(claim);assert.equal(claim.job.id,queued.id);
    const page=await provider.collectPage({source:b,...window,limit:25,checkpoint:null}),newest=page.items[0];newest.publishedAt=null;newest.language=null;newest.media=[{type:"image",url:"https://example.test/new.png",previewUrl:null,altText:null,durationSeconds:null}];newest.references=[{kind:"post",externalId:"root",relation:"quote"}];
    await repo.commitPage(claim,{...page,items:[newest,newest]},now);assert.equal((await repo.getJob(queued.id))!.recordsInserted,1);assert.equal((await repo.getJob(queued.id))!.recordsUpdated,0);
    await service.enqueue(b.id,window);const older=await repo.claim(now);assert.ok(older);
    const old={...newest,publishedAt:"2026-10-12T08:30:00.000Z",language:"zh",media:[],references:[],observation:{...newest.observation,sourceObservedAt:"2026-10-12T08:00:00.000Z",evidenceKey:"older"}};
    await repo.commitPage(older,{...page,items:[old]},now);const result=(await repo.listContent({sourceId:b.id})).items[0];assert.deepEqual(result.media,newest.media);assert.deepEqual(result.references,newest.references);assert.equal(result.publishedAt,old.publishedAt);assert.equal(result.language,"zh");assert.equal((await repo.getJob(older.job.id))!.recordsUpdated,1);
    const pending=await service.enqueue(b.id,window),lease=await repo.claim(now);assert.ok(lease);await service.setSourceState(b.id,"paused");assert.equal((await repo.getJob(pending.id))!.status,"cancelled");await assert.rejects(repo.commitPage(lease,{...page,items:[]},now),/lease lost/);assert.equal((await repo.contentStats({sourceId:b.id})).total,1);await service.setSourceState(b.id,"active");
    await service.updateSource(b.id,{refresh:{enabled:true,afterHours:1,batchSize:5}});assert.equal(await repo.scheduleDue(now,["demo_reddit"],5,["reddit:demo_reddit"]),1);const refresh=await repo.claim(now);assert.ok(refresh);assert.equal(refresh.job.purpose,"refresh");assert.deepEqual(refresh.job.refreshIds,[newest.externalId]);
    await repo.commitPage(refresh,await provider.refreshIds({source:(await repo.getSource(b.id))!,externalIds:refresh.job.refreshIds}),now);assert.equal((await repo.listContent({sourceId:b.id})).items[0].observations[0].maturity,"refreshed");assert.equal((await db.query("SELECT refresh_attempts FROM content_discovery WHERE collection_source_id=$1",[b.id])).rows[0].refresh_attempts,1);assert.equal(await repo.scheduleDue(now,["demo_reddit"],5,["reddit:demo_reddit"]),0);
    const usage=(await repo.providerUsage(now)).find(item=>item.provider==="demo_reddit")!;
    await repo.setProviderBudget({provider:"demo_reddit",enabled:true,dailyRequests:usage.dailyRequests+1,monthlyRequests:usage.monthlyRequests+1,dailyResources:usage.dailyResources+25,monthlyResources:usage.monthlyResources+25});
    const reservations=await Promise.all(Array.from({length:4},()=>repo.reserveUsage("demo_reddit",25,now)));assert.equal(reservations.filter(item=>item.allowed).length,1);const spent=(await repo.providerUsage(now)).find(item=>item.provider==="demo_reddit")!;assert.equal(spent.dailyRequests,usage.dailyRequests+1);assert.equal(spent.dailyResources,usage.dailyResources+25);
    await repo.heartbeat({id:"sql-fixture-worker",startedAt:FIXED_CONTENT_NOW,lastHeartbeatAt:FIXED_CONTENT_NOW,state:"active",lastJobId:second.id});const ops=await service.ops();assert.equal(ops.workers.find(item=>item.id==="sql-fixture-worker")!.stale,true);assert.equal(ops.sources.find(item=>item.sourceId===source.id)!.lastSuccessAgeHours,0);
    assert.equal((await repo.reserveUsage("paid_fixture",1,now)).allowed,false);
  }finally{await db.close();}
});
