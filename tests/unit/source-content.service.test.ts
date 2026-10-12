import assert from "node:assert/strict";
import test from "node:test";
import { SourceContentService } from "../../src/application/services/source-content.service";
import { InMemorySourceContentRepository } from "../../src/storage/repositories/in-memory/source-content.repository";
import { fixtureConnector,FIXED_CONTENT_NOW,publishedSeconds,syntheticRedditPost } from "../helpers/source-content-fixtures";
import { ArcticShiftContentConnector } from "../../src/connectors/reddit/arctic-shift-content.connector";
import { encodeContentCursor } from "../../src/storage/source-content-query";
const sourceInput={platform:"reddit" as const,provider:"arctic_shift",contentKind:"post" as const,target:{type:"community" as const,community:"r/TestCommunity"}};
const window={from:"2026-10-09T00:00:00Z",to:FIXED_CONTENT_NOW,pageSize:25,maxPages:5};

test("Source service persists normalized targets, deduplicates active jobs and writes searchable Unicode content",async()=>{
  const repo=new InMemorySourceContentRepository(),service=new SourceContentService(repo,fixtureConnector([{rows:[syntheticRedditPost()]}]),()=>FIXED_CONTENT_NOW);
  const source=await service.createSource(sourceInput); assert.deepEqual(source.target,{type:"community",community:"testcommunity"});
  const first=await service.enqueue(source.id,window),again=await service.enqueue(source.id,window); assert.equal(first.id,again.id);
  await assert.rejects(service.enqueue(source.id,{...window,pageSize:10}),/already collecting/);
  assert.equal((await repo.listContent({})).items.length,0);
  await service.workOnce(); assert.equal((await service.getJob(first.id)).status,"succeeded");
  assert.equal((await repo.listContent(service.normalizeQuery({query:"人工智能"}))).items.length,1);
  const stats=await repo.contentStats(service.normalizeQuery({query:"不存在"})); assert.equal(stats.total,0); assert.equal(stats.daily.length,0);
});
test("Source service preserves committed checkpoint across retry and bounds transport attempts",async()=>{
  let now=FIXED_CONTENT_NOW; const repo=new InMemorySourceContentRepository();
  const service=new SourceContentService(repo,fixtureConnector([{rows:[syntheticRedditPost(),syntheticRedditPost({id:"abc124",created_utc:publishedSeconds-10})]},{status:429,error:"Limited",headers:{"retry-after":"5"}}]),()=>now);
  const source=await service.createSource(sourceInput),job=await service.enqueue(source.id,{...window,pageSize:2});
  await service.workOnce(); const checkpoint=(await service.getJob(job.id)).checkpoint; assert.ok(checkpoint);
  for(let attempt=0;attempt<3;attempt++){now=new Date(Date.parse(now)+6000).toISOString();await service.workOnce();}
  const failed=await service.getJob(job.id); assert.equal(failed.status,"failed"); assert.equal(failed.pagesCommitted,1); assert.deepEqual(failed.checkpoint,checkpoint);
  await service.retryJob(job.id); assert.deepEqual((await service.getJob(job.id)).checkpoint,checkpoint);
});
test("Source content discovery counts each identity once and keeps independent source observations",async()=>{
  const repo=new InMemorySourceContentRepository(),service=new SourceContentService(repo,fixtureConnector([{rows:[syntheticRedditPost()]}]),()=>FIXED_CONTENT_NOW);
  const a=await service.createSource(sourceInput),b=await service.createSource({...sourceInput,target:{...sourceInput.target,query:"人工智能"}});
  await service.enqueue(a.id,window);await service.workOnce();await service.enqueue(b.id,window);await service.workOnce();
  assert.equal((await repo.contentStats({})).total,1); assert.equal((await repo.listContent({})).items[0].observations.length,2);
  assert.equal((await repo.listContent({sourceId:a.id})).items[0].observations.length,1);
});
test("Source query cursor is stable on timestamp ties and rejects changed filters",async()=>{
  const repo=new InMemorySourceContentRepository(),service=new SourceContentService(repo,fixtureConnector([{rows:[syntheticRedditPost(),syntheticRedditPost({id:"abc124"}),syntheticRedditPost({id:"abc125"})]}]),()=>FIXED_CONTENT_NOW);
  const source=await service.createSource(sourceInput);await service.enqueue(source.id,window);await service.workOnce();
  const first=await repo.listContent({limit:1}),second=await repo.listContent({limit:1,cursor:first.nextCursor!}); assert.notEqual(first.items[0].id,second.items[0].id);
  await assert.rejects(repo.listContent({query:"changed",cursor:first.nextCursor!}),/changed query/);
  await assert.rejects(repo.listContent({cursor:encodeContentCursor({},FIXED_CONTENT_NOW,"-".repeat(36))}),/Invalid cursor/);
});
test("Source service rejects unimplemented platforms, arbitrary URLs and unbounded work",async()=>{
  const service=new SourceContentService(new InMemorySourceContentRepository(),fixtureConnector([{rows:[]}]),()=>FIXED_CONTENT_NOW);
  await assert.rejects(service.createSource({...sourceInput,platform:"x"}),/not enabled/);
  await assert.rejects(service.createSource({...sourceInput,target:{type:"community",community:"https://localhost"}}),/Invalid community/);
  const source=await service.createSource(sourceInput);await assert.rejects(service.enqueue(source.id,{...window,maxPages:21}),/1 to 20/);
  assert.throws(()=>service.normalizeQuery({limit:NaN}),/integer/);
});
test("Source leases recover after interruption and reject a stale worker commit",async()=>{
  const repo=new InMemorySourceContentRepository(),service=new SourceContentService(repo,fixtureConnector([{rows:[]}]),()=>FIXED_CONTENT_NOW);
  const source=await service.createSource(sourceInput);await service.enqueue(source.id,window);
  const original=await repo.claim(FIXED_CONTENT_NOW);assert.ok(original);assert.equal(await repo.claim(FIXED_CONTENT_NOW),null);
  const recovered=await repo.claim(new Date(Date.parse(FIXED_CONTENT_NOW)+121000).toISOString());assert.ok(recovered);
  await assert.rejects(repo.commitPage(original,{items:[],nextCheckpoint:null,exhausted:true,coverage:"unknown",warning:null},FIXED_CONTENT_NOW),/lease lost/);
});

test("Source bounded completion can continue its exact checkpoint without re-fetching committed pages",async()=>{
  const repo=new InMemorySourceContentRepository(),service=new SourceContentService(repo,fixtureConnector([{rows:[syntheticRedditPost(),syntheticRedditPost({id:"abc124",created_utc:publishedSeconds-10})]}]),()=>FIXED_CONTENT_NOW);
  const source=await service.createSource(sourceInput),first=await service.enqueue(source.id,{...window,pageSize:2,maxPages:1});await service.workOnce();
  const completed=await service.getJob(first.id);assert.equal(completed.status,"succeeded");assert.ok(completed.checkpoint);assert.equal(completed.coverage,"partial");
  const continued=await service.continueJob(first.id);assert.notEqual(continued.id,first.id);assert.deepEqual(continued.checkpoint,completed.checkpoint);assert.equal(continued.pagesCommitted,0);assert.equal(continued.from,completed.from);assert.equal(continued.to,completed.to);
});

test("Graceful source worker cancellation leaves a resumable job and does not advance its checkpoint",async()=>{
  const repo=new InMemorySourceContentRepository(),controller=new AbortController();
  const provider=new ArcticShiftContentConnector(async()=>{throw new DOMException("Stopped","AbortError")});
  const service=new SourceContentService(repo,provider,()=>FIXED_CONTENT_NOW),source=await service.createSource(sourceInput),job=await service.enqueue(source.id,window);
  controller.abort();await service.workOnce(controller.signal);const paused=await service.getJob(job.id);
  assert.equal(paused.status,"retrying");assert.equal(paused.pagesCommitted,0);assert.equal(paused.checkpoint,null);assert.equal((await repo.listContent({})).items.length,0);
});
