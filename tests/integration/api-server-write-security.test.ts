import assert from "node:assert/strict";
import test from "node:test";
import {createApiServer} from "../../apps/api/src/create-api-server";
import {RedditMockConnector} from "../../src/connectors/reddit/reddit-mock.connector";
import {createApiTestRepositories,startServer,stopServer} from "./api-server.helpers";

test("authentication rate limit cannot be evaded using an untrusted forwarded address",async()=>{
  const server=createApiServer({repositories:createApiTestRepositories(),createConnector:()=>new RedditMockConnector(),authRateLimit:{points:1,durationSeconds:60},logger:()=>{}});
  try{const base=await startServer(server);
    const send=(ip:string)=>fetch(`${base}/auth/login`,{method:"POST",headers:{"content-type":"application/json","x-forwarded-for":ip},body:JSON.stringify({email:"unknown@example.test",password:"fixture-password"})});
    assert.equal((await send("192.0.2.1")).status,401);
    const blocked=await send("192.0.2.2");assert.equal(blocked.status,429);assert.ok(Number(blocked.headers.get("retry-after"))>0);
  }finally{await stopServer(server);}
});

test("cross-origin writes are rejected even without configured CORS, while reads remain available",async()=>{
  const repositories=createApiTestRepositories();
  const server=createApiServer({repositories,createConnector:()=>new RedditMockConnector(),auth:{bearerToken:"synthetic-secret"},logger:()=>{}});
  try{const base=await startServer(server);
    const response=await fetch(`${base}/v1/targets/subreddit`,{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer synthetic-secret",origin:"https://untrusted.example"},body:JSON.stringify({subreddit:"fixture"})});
    assert.equal(response.status,403);assert.equal((await response.json()).errorCode,"write_origin_not_allowed");
    assert.equal((await repositories.monitorTargetRepository.findActiveSubreddits()).length,0);
    assert.equal((await fetch(`${base}/healthz`,{headers:{origin:"https://untrusted.example"}})).status,200);
  }finally{await stopServer(server);}
});

test("default CORS supports PATCH PUT DELETE and does not reflect arbitrary preflight headers",async()=>{
  const server=createApiServer({repositories:createApiTestRepositories(),createConnector:()=>new RedditMockConnector(),cors:{allowedOrigins:["https://app.example"]},logger:()=>{}});
  try{const base=await startServer(server);
    const result=await fetch(`${base}/v1/sources`,{method:"OPTIONS",headers:{origin:"https://app.example","access-control-request-method":"PATCH","access-control-request-headers":"x-unapproved-header"}});
    assert.equal(result.status,204);
    for(const method of ["PATCH","PUT","DELETE"])assert.ok(result.headers.get("access-control-allow-methods")?.includes(method));
    assert.ok(!result.headers.get("access-control-allow-headers")?.includes("x-unapproved-header"));
  }finally{await stopServer(server);}
});
