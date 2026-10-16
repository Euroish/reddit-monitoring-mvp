import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PostgresClient } from "../../src/storage/postgres/postgres-client";
import { runMigrations } from "../../src/storage/schema/run-migrations";
import { PostgresSourceContentRepository } from "../../src/storage/repositories/postgres/postgres-source-content.repository";
import { SourceContentService } from "../../src/application/services/source-content.service";
import { DemoContentProvider } from "../../src/connectors/demo/demo-content.connector";
import type { ContentProvider } from "../../src/connectors/shared/content-provider.interface";
import { defaultProviderBudget } from "../../src/storage/source-lifecycle";
import { FIXED_CONTENT_NOW } from "../helpers/source-content-fixtures";

const connectionString=process.env.TEST_SOURCE_DATABASE_URL;
test("native X migration and synthetic providers share content identity while preserving independent observations",{skip:!connectionString},async()=>{
  const url=new URL(connectionString!);assert.ok(["127.0.0.1","localhost"].includes(url.hostname)&&/^\/source_validation_[a-z0-9_]+$/.test(url.pathname),"Use a dedicated loopback source_validation_* database");const db=new PostgresClient({connectionString,max:2});
  try{
    await runMigrations({db});assert.equal((await db.query("SELECT name FROM source WHERE code='x'")).rows[0].name,"X");
    const repo=new PostgresSourceContentRepository(db),demo=new DemoContentProvider("x",()=>FIXED_CONTENT_NOW),alternateName=`fixture_x_${randomUUID().replaceAll("-","").slice(0,8)}`;
    const alternate:ContentProvider={capability:{...demo.capability,provider:alternateName},normalizeTarget:demo.normalizeTarget.bind(demo),collectPage:async request=>{const page=await demo.collectPage(request);return {...page,items:page.items.map(item=>({...item,observation:{...item.observation,provider:alternateName,sourceObservedAt:null,metrics:{"x.likes":9},evidenceKey:"alternate-evidence"}}))};}};
    const service=new SourceContentService(repo,[demo,alternate],()=>FIXED_CONTENT_NOW),query=`sql_x_${randomUUID().slice(0,8)}`;
    await repo.setProviderBudget(defaultProviderBudget("demo_x"),FIXED_CONTENT_NOW);await service.setProviderBudget(alternateName,{enabled:true,dailyRequests:10,monthlyRequests:100,dailyResources:1000,monthlyResources:10000});
    const a=await service.createSource({platform:"x",provider:"demo_x",contentKind:"post",target:{type:"search",query}}),b=await service.createSource({platform:"x",provider:alternateName,contentKind:"post",target:{type:"search",query}}),window={from:new Date(Date.parse(FIXED_CONTENT_NOW)-3600000).toISOString(),to:FIXED_CONTENT_NOW,pageSize:25,maxPages:1};
    await service.enqueue(a.id,window);await service.workOnce();await service.enqueue(b.id,window);await service.workOnce();const content=(await repo.listContent({platform:"x",query})).items;assert.equal(content.length,2);assert.equal((await repo.contentStats({platform:"x",query})).total,2);
    for(const item of content){assert.equal(item.platformDetails.platform,"x");assert.equal(item.observations.length,2);assert.equal(item.observations.find(obs=>obs.provider===alternateName)!.metrics["x.likes"],9);assert.equal(item.observations.find(obs=>obs.provider===alternateName)!.sourceObservedAt,null);assert.equal(item.observations.find(obs=>obs.provider===alternateName)!.timeBasis,"provider_snapshot");assert.match(item.text!,/SYNTHETIC/);}
    assert.ok(content.some(item=>item.observations.find(obs=>obs.provider==="demo_x")!.metrics["x.likes"]===0));assert.equal((await repo.listContent({sourceId:a.id})).items[0].observations.length,1);assert.equal((await repo.listContent({sourceId:b.id})).items[0].observations.length,1);
  }finally{await db.close();}
});
