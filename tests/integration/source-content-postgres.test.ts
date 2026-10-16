import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PostgresClient } from "../../src/storage/postgres/postgres-client";
import { runMigrations } from "../../src/storage/schema/run-migrations";
import { PostgresSourceContentRepository } from "../../src/storage/repositories/postgres/postgres-source-content.repository";
import { PostgresContentRepository } from "../../src/storage/repositories/postgres/postgres-content.repository";
import { stableUuidFromString } from "../../src/shared/ids/stable-id";
import { SourceContentService } from "../../src/application/services/source-content.service";
import type { CollectedContent } from "../../src/connectors/shared/content-provider.interface";
import { fixtureConnector,FIXED_CONTENT_NOW,syntheticRedditPost } from "../helpers/source-content-fixtures";

const connectionString=process.env.TEST_SOURCE_DATABASE_URL;
test("PostgreSQL source pages are atomic, discoveries deduplicate, older observations cannot replace newer, and heterogeneous fields round-trip",{skip:!connectionString},async()=>{
  const url=new URL(connectionString!);
  assert.ok(["127.0.0.1","localhost"].includes(url.hostname) && /^\/source_validation_[a-z0-9_]+$/.test(url.pathname),"Use a dedicated loopback source_validation_* database");
  const db=new PostgresClient({connectionString,max:2});
  try{
    await runMigrations({db});
    const repo=new PostgresSourceContentRepository(db),community=`fixture_${randomUUID().slice(0,8)}`,external=randomUUID().replaceAll("-","").slice(0,10);
    const row=syntheticRedditPost({id:external,subreddit:community});
    const legacyTarget=randomUUID(),legacyContentId=stableUuidFromString(`reddit:content:t3_${external}`),legacyRepo=new PostgresContentRepository(db);
    await db.query("INSERT INTO monitor_target(id,source_id,target_type,canonical_name,status,config_json) VALUES($1,'11111111-1111-1111-1111-111111111111','subreddit',$2,'paused','{}')",[legacyTarget,`r/${community}`]);
    const legacyContent={id:legacyContentId,source:"reddit" as const,targetId:legacyTarget,externalId:`t3_${external}`,kind:"post" as const,title:"Legacy fixture",permalink:`/r/${community}/comments/${external}/`,createdAtSource:new Date(row.created_utc*1000).toISOString(),firstSeenAt:FIXED_CONTENT_NOW,lastSeenAt:FIXED_CONTENT_NOW};
    await legacyRepo.upsertMany([legacyContent]);await legacyRepo.upsertMany([{...legacyContent,title:"Legacy upsert still works"}]);
    assert.equal((await legacyRepo.findRecentByTarget(legacyTarget,10))[0].title,"Legacy upsert still works");
    const provider=fixtureConnector([{rows:[row]},{rows:[row]},{rows:[{...row,score:999,_meta:{retrieved_2nd_on:row.created_utc+30*3600}}]}]);
    const service=new SourceContentService(repo,provider,()=>FIXED_CONTENT_NOW);
    const a=await service.createSource({platform:"reddit",provider:"arctic_shift",contentKind:"post",target:{type:"community",community}});
    const b=await service.createSource({platform:"reddit",provider:"arctic_shift",contentKind:"post",target:{type:"community",community,query:"人工智能"}});
    const window={from:"2026-10-09",to:FIXED_CONTENT_NOW};
    await service.enqueue(a.id,window);await service.workOnce();await service.enqueue(b.id,window);await service.workOnce();await service.enqueue(a.id,window);await service.workOnce();
    const saved=await repo.listContent({sourceId:a.id});assert.equal(saved.items.length,1);assert.equal(saved.items[0].observations[0].metrics["reddit.score"],7);
    assert.equal(saved.items[0].id,legacyContentId);assert.match(saved.items[0].url!,/^https:\/\//);
    assert.equal((await db.query("SELECT target_id FROM content WHERE id=$1",[legacyContentId])).rows[0].target_id,legacyTarget);
    assert.equal((await repo.listContent({query:community})).items.length,0);
    assert.equal((await repo.contentStats({sourceId:a.id,query:"人工智能"})).total,1);
    assert.deepEqual((await repo.contentStats({sourceId:a.id})).daily,[{day:"2026-10-10",count:1}]);
    assert.equal((await repo.contentStats({sourceId:a.id,query:"不存在"})).total,0);
    const counts=await db.query(`SELECT COUNT(*)::int AS n FROM content_discovery WHERE content_id=$1`,[saved.items[0].id]);assert.equal(counts.rows[0].n,2);
    const queued=await service.enqueue(a.id,window),claimed=await repo.claim(FIXED_CONTENT_NOW);assert.ok(claimed);assert.equal(claimed.job.id,queued.id);
    const page=await fixtureConnector([{rows:[syntheticRedditPost({id:"bad"+external,subreddit:community})]}]).collectPage({source:a,from:"2026-10-09",to:FIXED_CONTENT_NOW,limit:25,checkpoint:null});
    const invalid:CollectedContent={...page.items[0],id:randomUUID(),platform:"x",platformDetails:{platform:"x",conversationId:null,isReply:null,isRepost:null,isQuote:null,sensitive:null}};
    await assert.rejects(repo.commitPage(claimed,{...page,items:[page.items[0],invalid]},FIXED_CONTENT_NOW),/identity mismatch/);
    assert.equal((await repo.listContent({sourceId:a.id})).items.length,1);assert.equal((await repo.getJob(queued.id))!.pagesCommitted,0);await repo.failJob(claimed,"Fixture rollback verified",null,FIXED_CONTENT_NOW);

    // Synthetic contract fixtures prove storage compatibility, not real X/Instagram/web connectors.
    const samples: { platform: CollectedContent["platform"]; kind: CollectedContent["kind"]; details: CollectedContent["platformDetails"]; metrics: Record<string,number|null>; publishedAt: string|null }[] = [
      {platform:"x" as const,kind:"post" as const,details:{platform:"x" as const,conversationId:"18446744073709551615",isReply:true,isRepost:false,isQuote:true,sensitive:null},metrics:{"x.likes":0},publishedAt:FIXED_CONTENT_NOW},
      {platform:"instagram" as const,kind:"video" as const,details:{platform:"instagram" as const,mediaProduct:"reel" as const,caption:"中文 caption",carouselIds:["child-1"]},metrics:{"instagram.plays":null},publishedAt:FIXED_CONTENT_NOW},
      {platform:"web" as const,kind:"article" as const,details:{platform:"web" as const,publisher:null,canonicalUrl:null,feedUrl:"https://example.test/feed"},metrics:{"web.rank":3},publishedAt:null},
    ];
    for(const sample of samples){
      await db.query("INSERT INTO source(id,code,name) VALUES($1,$2,$2) ON CONFLICT(code) DO NOTHING",[randomUUID(),sample.platform]);
      const source=await repo.createSource({id:randomUUID(),platform:sample.platform,provider:"synthetic_contract_fixture",label:"Contract fixture",target:{type:"account",account:community},contentKind:sample.kind,createdAt:FIXED_CONTENT_NOW});
      await repo.enqueue({id:randomUUID(),sourceId:source.id,now:FIXED_CONTENT_NOW,from:"2026-10-09T00:00:00Z",to:FIXED_CONTENT_NOW,pageSize:25,maxPages:1});
      const claim=await repo.claim(FIXED_CONTENT_NOW);assert.ok(claim);
      const content:CollectedContent={id:randomUUID(),platform:sample.platform,kind:sample.kind,externalId:"18446744073709551615",title:null,text:null,url:null,author:null,language:"zh-CN",publishedAt:sample.publishedAt,fetchedAt:FIXED_CONTENT_NOW,availability:"unknown",references:[],media:[{type:"video",url:"https://example.test/video",previewUrl:null,altText:null,durationSeconds:12}],platformDetails:sample.details,observation:{sourceId:source.id,provider:source.provider,sourceObservedAt:null,fetchedAt:FIXED_CONTENT_NOW,timeBasis:"unknown",maturity:"unknown",metrics:sample.metrics,evidenceKey:"synthetic"}};
      await repo.commitPage(claim,{items:[content],nextCheckpoint:null,exhausted:true,coverage:"unknown",warning:null},FIXED_CONTENT_NOW);
      const result=(await repo.listContent({sourceId:source.id})).items[0];assert.equal(result.externalId,"18446744073709551615");assert.equal(result.title,null);assert.equal(result.author,null);assert.equal(result.publishedAt,sample.publishedAt);assert.deepEqual(result.platformDetails,sample.details);assert.deepEqual(result.media,content.media);
      assert.equal((await repo.contentStats({sourceId:source.id})).unknownPublishedAtCount,sample.publishedAt===null ? 1 : 0);
    }
  }finally{await db.close();}
});
