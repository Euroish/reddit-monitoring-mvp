import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PostgresClient } from "../../src/storage/postgres/postgres-client";
import { runMigrations } from "../../src/storage/schema/run-migrations";
import { PostgresSourceContentRepository } from "../../src/storage/repositories/postgres/postgres-source-content.repository";
import { FIXED_CONTENT_NOW } from "../helpers/source-content-fixtures";

const connectionString=process.env.TEST_SOURCE_DATABASE_URL;
test("native registered request timing accumulates fractional milliseconds and rejects a cancelled lease",{skip:!connectionString},async()=>{
  const url=new URL(connectionString!);assert.ok(["127.0.0.1","localhost"].includes(url.hostname)&&/^\/source_validation_[a-z0-9_]+$/.test(url.pathname),"Use a dedicated loopback source_validation_* database");const db=new PostgresClient({connectionString,max:2});
  try{await runMigrations({db});const repo=new PostgresSourceContentRepository(db),source=await repo.createSource({id:randomUUID(),platform:"reddit",provider:"timing_fixture",contentKind:"post",target:{type:"community",community:`fixture_${randomUUID().slice(0,8)}`},label:"Timing fixture",createdAt:FIXED_CONTENT_NOW}),queued=await repo.enqueue({id:randomUUID(),sourceId:source.id,from:"2026-10-09",to:FIXED_CONTENT_NOW,pageSize:25,maxPages:1,now:FIXED_CONTENT_NOW}),claim=await repo.claim(FIXED_CONTENT_NOW);assert.ok(claim);assert.equal(claim.job.id,queued.id);await repo.recordRequestAttempt(claim,10.5);await repo.recordRequestAttempt(claim,2.25);const measured=(await repo.getJob(queued.id))!;assert.equal(measured.requestCount,2);assert.equal(measured.requestDurationMs,12.75);await repo.cancelJob(queued.id,FIXED_CONTENT_NOW);await repo.recordRequestAttempt(claim,99);const fenced=(await repo.getJob(queued.id))!;assert.equal(fenced.requestCount,2);assert.equal(fenced.requestDurationMs,12.75);}finally{await db.close();}
});
