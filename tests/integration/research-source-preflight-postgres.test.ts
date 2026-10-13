import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import type {QueryResultRow} from "pg";
import {PostgresClient} from "../../src/storage/postgres/postgres-client";
import {PostgresSourceContentRepository} from "../../src/storage/repositories/postgres/postgres-source-content.repository";
import {runMigrations} from "../../src/storage/schema/run-migrations";
import {verifyResearchPreflight} from "../helpers/research-preflight-cases";

const connectionString=process.env.TEST_SOURCE_DATABASE_URL;
test("native research preflight returns scalar bytes before fetching large scoped JSON and shares exact filters",{skip:!connectionString},async()=>{
  const url=new URL(connectionString!);assert.ok(["localhost","127.0.0.1"].includes(url.hostname)&&/^\/source_validation_[a-z0-9_]+$/.test(url.pathname));
  const adminUrl=new URL(url);adminUrl.pathname="/postgres";const admin=new PostgresClient({connectionString:adminUrl.href,max:1}),database=`source_validation_preflight_${randomUUID().replaceAll("-","").slice(0,12)}`;
  try{await admin.query(`CREATE DATABASE "${database}"`);}finally{await admin.close();}url.pathname=`/${database}`;const db=new PostgresClient({connectionString:url.href,max:3});
  try{
    await runMigrations({db});const repo=new PostgresSourceContentRepository(db),fixture=await verifyResearchPreflight(repo),{root,alpha,beta}=fixture;
    const huge="你".repeat(800000),base=await repo.researchPayloadPreflight({sourceId:alpha.id});
    await db.query("UPDATE content SET content_media=jsonb_build_array(jsonb_build_object('type','image','url','https://example.test/media','previewUrl',NULL,'altText',$2::text,'durationSeconds',NULL)) WHERE id=$1",[root.id,huge]);
    let scalarResultBytes=0,statement="";
    const measured=new PostgresSourceContentRepository({query:async<T extends QueryResultRow=QueryResultRow>(sql:string,params?:unknown[])=>{statement=sql;const result=await db.query<T>(sql,params);scalarResultBytes=Buffer.byteLength(JSON.stringify(result.rows),"utf8");return result;},withTransaction:db.withTransaction.bind(db)});
    const media=await measured.researchPayloadPreflight({sourceId:alpha.id});assert.ok(media.contentBytes>base.contentBytes+2000000);assert.ok(scalarResultBytes<2000,"Large JSON is measured by SQL, not transferred to Node during preflight");assert.match(statement,/octet_length/);assert.ok(!/\b(INSERT|UPDATE|DELETE|CREATE|ALTER)\b/i.test(statement));
    await db.query("UPDATE collection_source SET label=$2 WHERE id=$1",[beta.id,huge]);
    assert.equal((await measured.researchPayloadPreflight({sourceId:alpha.id})).sourceBytes,base.sourceBytes,"An unrelated large source is not fetched or counted");
    assert.ok((await measured.researchPayloadPreflight({sourceId:beta.id})).sourceBytes>2000000);assert.ok(scalarResultBytes<2000);
    // Progress metadata is intentionally present in the source transport; its bytes
    // do not change the selected content or include unrelated sources.
    assert.deepEqual((await repo.listSourcesForResearch({sourceId:alpha.id})).map(source=>source.id),[alpha.id]);
    console.log(JSON.stringify({scope:"native scalar research preflight",database,largeJsonTransferredDuringPreflight:false,memberScopedSources:true,realSourceRequests:0}));
  }finally{await db.close();}
});
