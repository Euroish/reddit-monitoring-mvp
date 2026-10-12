import assert from "node:assert/strict";
import test from "node:test";
import { createApiServer } from "../../apps/api/src/create-api-server";
import { RedditMockConnector } from "../../src/connectors/reddit/reddit-mock.connector";
import { createSourceContentService } from "../../src/runtime/source-content-runtime";
import { createRedditConnectorFromEnv } from "../../src/runtime/reddit-phase1-runtime";
import { PostgresClient } from "../../src/storage/postgres/postgres-client";
import {createApiTestRepositories,postJson,startServer,stopServer} from "./api-server.helpers";

test("explicit legacy live requests cannot bypass the network-disabled environment, including async enqueue", async () => {
  const old = process.env.SOURCE_NETWORK_ENABLED;
  process.env.SOURCE_NETWORK_ENABLED="false";
  let calls=0;
  const repos=createApiTestRepositories();
  const server=createApiServer({repositories:repos,createConnector:()=>{calls++;return new RedditMockConnector();}});
  try {
    const base=await startServer(server);
    for(const async of [false,true]) {
      const result=await postJson<{errorCode:string}>(`${base}/v1/runs/reddit-phase1`,{mode:"live",async,subreddit:"fixture"});
      assert.equal(result.status,409);
      assert.equal(result.body.errorCode,"external_requests_disabled");
    }
    const result=await postJson<{errorCode:string}>(`${base}/v1/ops/collection/run-now`,{mode:"live",async:true,subreddit:"fixture"});
    assert.equal(result.status,409);
    assert.equal(calls,0);
    assert.equal((await repos.collectionJobRepository.findRunnableJobs(new Date().toISOString(),100)).length,0);
  } finally {await stopServer(server);if(old===undefined)delete process.env.SOURCE_NETWORK_ENABLED;else process.env.SOURCE_NETWORK_ENABLED=old;}
});

test("production API rejects synthetic mock writes before creating a target or queued job", async () => {
  const old=process.env.NODE_ENV;process.env.NODE_ENV="production";
  const repos=createApiTestRepositories();let calls=0;
  const server=createApiServer({repositories:repos,createConnector:()=>{calls++;return new RedditMockConnector();}});
  try {
    const base=await startServer(server);
    const result=await postJson<{errorCode:string}>(`${base}/v1/runs/reddit-phase1`,{mode:"mock",async:false,subreddit:"fixture"});
    assert.equal(result.status,409);assert.equal(result.body.errorCode,"synthetic_mode_forbidden");
    assert.equal(calls,0);assert.equal((await repos.monitorTargetRepository.findActiveSubreddits()).length,0);
  } finally {await stopServer(server);if(old===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=old;}
});

test("legacy CLI connector factory blocks live/probe without permission and mock in production", () => {
  assert.throws(()=>createRedditConnectorFromEnv({env:{SOURCE_NETWORK_ENABLED:"false"},mode:"live"}),/External requests disabled/);
  assert.throws(()=>createRedditConnectorFromEnv({env:{SOURCE_RUN_MODE:"demo",SOURCE_NETWORK_ENABLED:"true"},mode:"live"}),/External requests disabled/);
  assert.throws(()=>createRedditConnectorFromEnv({env:{NODE_ENV:"production"},mode:"mock"}),/Synthetic/);
  assert.ok(createRedditConnectorFromEnv({env:{SOURCE_NETWORK_ENABLED:"true",REDDIT_CB_ENABLED:"false"},mode:"live"}));
});

test("public demo runtime cannot write synthetic content in production", async()=>{
  const old=Object.fromEntries(["NODE_ENV","SOURCE_RUN_MODE"].map(key=>[key,process.env[key]]));
  const db=new PostgresClient({connectionString:"postgresql://postgres@127.0.0.1:1/source_validation_execution_policy",connectionTimeoutMs:100});
  try {process.env.NODE_ENV="production";process.env.SOURCE_RUN_MODE="demo";assert.throws(()=>createSourceContentService(db),/Synthetic/);}
  finally {for(const [key,value]of Object.entries(old))if(value===undefined)delete process.env[key];else process.env[key]=value;await db.close();}
});
