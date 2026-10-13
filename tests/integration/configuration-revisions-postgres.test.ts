import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PostgresClient } from "../../src/storage/postgres/postgres-client";
import { runMigrations } from "../../src/storage/schema/run-migrations";
import { PostgresSourceContentRepository } from "../../src/storage/repositories/postgres/postgres-source-content.repository";
import { PostgresMonitorTargetRepository } from "../../src/storage/repositories/postgres/postgres-monitor-target.repository";
import { DemoContentProvider } from "../../src/connectors/demo/demo-content.connector";
import { configurationRevisionCases } from "../helpers/configuration-revision-cases";
import { FIXED_CONTENT_NOW } from "../helpers/source-content-fixtures";

const connectionString=process.env.TEST_SOURCE_DATABASE_URL;
async function isolatedDatabase(run:(db:PostgresClient)=>Promise<void>){
  const url=new URL(connectionString!);assert.ok(["127.0.0.1","localhost"].includes(url.hostname)&&/^\/source_validation_[a-z0-9_]+$/.test(url.pathname),"Use an isolated loopback source_validation_* database");
  const adminUrl=new URL(url);adminUrl.pathname="/postgres";const admin=new PostgresClient({connectionString:adminUrl.href,max:1}),database=`source_validation_cas_${randomUUID().replaceAll("-","").slice(0,12)}`;
  try{await admin.query(`CREATE DATABASE "${database}"`);}finally{await admin.close();}url.pathname=`/${database}`;const db=new PostgresClient({connectionString:url.href,max:5,queryTimeoutMs:10000});
  try{const applied=await runMigrations({db});assert.ok(applied.includes("035_source_configuration_revisions.sql"));assert.deepEqual(await runMigrations({db}),[]);await run(db);}finally{await db.close();}
}
for(const item of configurationRevisionCases)test(`PostgreSQL: ${item.name}`,{skip:!connectionString},()=>isolatedDatabase(db=>item.run(new PostgresSourceContentRepository(db),new PostgresMonitorTargetRepository(db))));

test("PostgreSQL pause/page commit share source-before-job lock order and enforce both serial cancellation outcomes",{skip:!connectionString},()=>isolatedDatabase(async db=>{
  const now=FIXED_CONTENT_NOW,repo=new PostgresSourceContentRepository(db),provider=new DemoContentProvider("reddit",()=>now),window={from:"2026-10-12T08:00:00.000Z",to:now};
  const waitForLocks=async(count:number)=>{for(let attempt=0;attempt<100;attempt++){const result=await db.query(`SELECT COUNT(*)::integer AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'`);if(result.rows[0].count>=count)return;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error(`Expected ${count} coordinated lock waiters`);};
  for(const pauseFirst of [true,false]){
    const source=await repo.createSource({id:randomUUID(),platform:"reddit",provider:"demo_reddit",label:"Lock-order fixture",target:{type:"community",community:`lock_${pauseFirst}`},contentKind:"post",createdAt:now}),job=await repo.enqueue({id:randomUUID(),sourceId:source.id,now,...window,pageSize:25,maxPages:1}),claim=await repo.claim(now);assert.ok(claim);assert.equal(claim.job.id,job.id);const page=await provider.collectPage({source,...window,limit:25,checkpoint:null});
    let release!:()=>void,started!:()=>void;const unlocked=new Promise<void>(resolve=>release=resolve),locked=new Promise<void>(resolve=>started=resolve);
    const gate=db.withTransaction(async client=>{await client.query("SELECT id FROM collection_source WHERE id=$1 FOR UPDATE",[source.id]);started();await unlocked;});await locked;
    const pause=()=>repo.setSourceState(source.id,"paused",now,1).then(value=>({value}),error=>({error}));
    const commit=()=>repo.commitPage(claim,page,now).then(()=>({success:true as const}),error=>({error}));
    let paused:ReturnType<typeof pause>|undefined,committed:ReturnType<typeof commit>|undefined;
    try{if(pauseFirst)paused=pause();else committed=commit();await waitForLocks(1);if(pauseFirst)committed=commit();else paused=pause();await waitForLocks(2);}finally{release();await gate;}
    const pauseResult=await paused!,commitResult=await committed!;assert.ok("value" in pauseResult);assert.equal(pauseResult.value!.state,"paused");assert.equal(pauseResult.value!.revision,2);assert.equal((await repo.getSource(source.id))!.revision,2,"Worker progress never invalidates the pause token");
    if(pauseFirst){assert.ok("error" in commitResult&&/lease lost/.test(String(commitResult.error)));assert.equal((await repo.getJob(job.id))!.status,"cancelled");assert.equal((await repo.contentStats({sourceId:source.id})).total,0);}
    else{assert.ok("success" in commitResult);assert.equal((await repo.getJob(job.id))!.status,"succeeded");assert.equal((await repo.contentStats({sourceId:source.id})).total,4);}
  }
}));
