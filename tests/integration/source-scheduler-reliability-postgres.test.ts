import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PostgresClient } from "../../src/storage/postgres/postgres-client";
import { runMigrations } from "../../src/storage/schema/run-migrations";
import { PostgresSourceContentRepository } from "../../src/storage/repositories/postgres/postgres-source-content.repository";
import { FIXED_CONTENT_NOW } from "../helpers/source-content-fixtures";
import { schedulerReliabilityCases } from "../helpers/source-scheduler-reliability-cases";
const connectionString=process.env.TEST_SOURCE_DATABASE_URL;
test("refresh candidates without eligible content cannot starve the 21st due source",{skip:!connectionString},async()=>{
  const url=new URL(connectionString!);assert.ok(["127.0.0.1","localhost"].includes(url.hostname)&&/^\/source_validation_[a-z0-9_]+$/.test(url.pathname));const adminUrl=new URL(url);adminUrl.pathname="/postgres";const admin=new PostgresClient({connectionString:adminUrl.href,max:1}),database=`source_validation_scheduler_${randomUUID().replaceAll("-","").slice(0,12)}`;try{await admin.query(`CREATE DATABASE "${database}"`);}finally{await admin.close();}url.pathname=`/${database}`;const db=new PostgresClient({connectionString:url.href,max:3});
  try{await runMigrations({db});const repo=new PostgresSourceContentRepository(db);for(let index=1;index<=21;index++){const id=`00000000-0000-4000-8000-${String(index).padStart(12,"0")}`;await repo.createSource({id,platform:"reddit",provider:"arctic_shift",label:`Scheduler fixture ${index}`,target:{type:"community",community:`scheduler_${index}`},contentKind:"post",createdAt:FIXED_CONTENT_NOW});await repo.updateSource(id,index<=20?{refresh:{enabled:true}}:{schedule:{enabled:true}},FIXED_CONTENT_NOW);}
    assert.ok(await repo.scheduleDue(FIXED_CONTENT_NOW,["arctic_shift"],20,["reddit:arctic_shift"])>=1,"The eligible 21st source must be admitted before limiting candidates");const jobs=await repo.listJobs({sourceId:"00000000-0000-4000-8000-000000000021"});assert.equal(jobs.filter(item=>item.purpose==="scheduled").length,1);assert.equal(jobs.filter(item=>item.purpose==="recheck").length,1);
  }finally{await db.close();}
});
for(const item of schedulerReliabilityCases)test(`PostgreSQL: ${item.name}`,{skip:!connectionString},async()=>{
  const url=new URL(connectionString!);assert.ok(["127.0.0.1","localhost"].includes(url.hostname)&&/^\/source_validation_[a-z0-9_]+$/.test(url.pathname));
  const adminUrl=new URL(url);adminUrl.pathname="/postgres";const admin=new PostgresClient({connectionString:adminUrl.href,max:1}),database=`source_validation_scheduler_${randomUUID().replaceAll("-","").slice(0,12)}`;
  try{await admin.query(`CREATE DATABASE "${database}"`);}finally{await admin.close();}url.pathname=`/${database}`;const db=new PostgresClient({connectionString:url.href,max:5});
  try{await runMigrations({db});assert.deepEqual(await runMigrations({db}),[],"Repeated migration must be a no-op");await item.run(new PostgresSourceContentRepository(db));}finally{await db.close();}
});
