import assert from "node:assert/strict";
import test from "node:test";
import {createApiServer} from "../../apps/api/src/create-api-server";
import {SourceContentService} from "../../src/application/services/source-content.service";
import {InMemorySourceContentRepository} from "../../src/storage/repositories/in-memory/source-content.repository";
import {DemoContentProvider} from "../../src/connectors/demo/demo-content.connector";
import {RedditMockConnector} from "../../src/connectors/reddit/reddit-mock.connector";
import {createApiTestRepositories,startServer,stopServer} from "./api-server.helpers";

test("readiness includes the public-source queue and requires a live worker only when collection work exists",async()=>{
  let now="2026-10-12T10:00:00.000Z";
  const service=new SourceContentService(new InMemorySourceContentRepository(),[new DemoContentProvider("reddit")],()=>now);
  const server=createApiServer({repositories:createApiTestRepositories(),sourceContent:service,createConnector:()=>new RedditMockConnector(),now:()=>now,logger:()=>{}});
  try {
    const base=await startServer(server);
    let response=await fetch(`${base}/readyz`),body=await response.json();
    assert.equal(response.status,200);assert.equal(body.sourceCollection.status,"idle");
    const source=await service.createSource({platform:"reddit",provider:"demo_reddit",contentKind:"post",target:{type:"community",community:"fixture"}});
    await service.enqueue(source.id,{from:"2026-10-11",to:now});
    response=await fetch(`${base}/readyz`);body=await response.json();
    assert.equal(response.status,503);assert.equal(body.sourceCollection.activeJobs,1);assert.equal(body.sourceCollection.workerRequired,true);
    assert.ok(body.degradedReasons.includes("source_worker_unavailable"));
    await service.heartbeat({id:"fixture-worker",startedAt:now,state:"active",lastJobId:null});
    response=await fetch(`${base}/readyz`);body=await response.json();
    assert.equal(response.status,200);assert.equal(body.sourceCollection.liveWorkers,1);
    now="2026-10-12T10:02:00.000Z";
    response=await fetch(`${base}/readyz`);assert.equal(response.status,503);
    await service.setSourceState(source.id,"paused");
    response=await fetch(`${base}/readyz`);body=await response.json();
    assert.equal(response.status,200);assert.equal(body.sourceCollection.workerRequired,false);
  }finally{await stopServer(server);}
});
