import assert from "node:assert/strict";
import test from "node:test";
import { SourceContentService } from "../../src/application/services/source-content.service";
import { InMemorySourceContentRepository } from "../../src/storage/repositories/in-memory/source-content.repository";
import { DemoContentProvider } from "../../src/connectors/demo/demo-content.connector";
import { contentExport,contentWorkbench } from "../../src/application/services/content-workbench.service";
import { FIXED_CONTENT_NOW } from "../helpers/source-content-fixtures";

test("content export walks multiple bounded pages and resumes without using its export cap as the denominator",async()=>{
  let now=FIXED_CONTENT_NOW;const repo=new InMemorySourceContentRepository(),service=new SourceContentService(repo,new DemoContentProvider("reddit",()=>now),()=>now),source=await service.createSource({platform:"reddit",provider:"demo_reddit",contentKind:"post",target:{type:"community",community:"export_fixture"}});
  await service.enqueue(source.id,{from:new Date(Date.parse(now)-120*3600000).toISOString(),to:now,pageSize:100,maxPages:3});
  for(let index=0;index<3;index++){await service.workOnce();now=new Date(Date.parse(now)+6000).toISOString();}
  const first=await contentExport(service,{sourceId:source.id},205);assert.equal(first.exportedCount,205);assert.equal(first.totalMatching,240);assert.equal(first.truncated,true);assert.ok(first.nextCursor);assert.equal(new Set(first.items.map(item=>item.id)).size,205);
  const rest=await contentExport(service,{sourceId:source.id,cursor:first.nextCursor!},205);assert.equal(rest.exportedCount,35);assert.equal(rest.totalMatching,240);assert.equal(rest.truncated,false);assert.equal(new Set([...first.items,...rest.items].map(item=>item.id)).size,240);
  const workbench=await contentWorkbench(service,{sourceId:source.id,limit:1});assert.equal(workbench.stats.total,240);assert.equal(workbench.byPlatform[0].count,240);
  await assert.rejects(contentExport(service,{sourceId:source.id,cursor:first.nextCursor!,query:"changed"}),/changed query/);
});
