import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import path from "node:path";
import {createApiServer} from "../../apps/api/src/create-api-server";
import {RedditMockConnector} from "../../src/connectors/reddit/reddit-mock.connector";
import {PasswordHashingService} from "../../src/application/services/password-hashing.service";
import {createApiTestRepositories,startServer,stopServer} from "./api-server.helpers";

test("authentication rate limit cannot be evaded using an untrusted forwarded address",async()=>{
  const server=createApiServer({repositories:createApiTestRepositories(),createConnector:()=>new RedditMockConnector(),authRateLimit:{points:1,durationSeconds:60},logger:()=>{}});
  try{const base=await startServer(server);
    const send=(ip:string)=>fetch(`${base}/auth/login`,{method:"POST",headers:{"content-type":"application/json","x-forwarded-for":ip},body:JSON.stringify({email:"unknown@example.test",password:"fixture-password"})});
    assert.equal((await send("192.0.2.1")).status,401);
    const blocked=await send("192.0.2.2");assert.equal(blocked.status,429);assert.ok(Number(blocked.headers.get("retry-after"))>0);
  }finally{await stopServer(server);}
});

test("login and registration share a dedicated socket-IP limit independent of query limiting",async()=>{
  const server=createApiServer({repositories:createApiTestRepositories(),createConnector:()=>new RedditMockConnector(),rateLimit:{enabled:false},authRateLimit:{points:1,durationSeconds:60},logger:()=>{}});
  try{const base=await startServer(server);
    assert.equal((await fetch(`${base}/auth/login`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:"unknown@example.test",password:"fixture-password"})})).status,401);
    const blocked=await fetch(`${base}/auth/register`,{method:"POST",headers:{"content-type":"application/json","x-forwarded-for":"192.0.2.33"},body:JSON.stringify({email:"new@example.test",password:"fixture-password",inviteCode:"190123"})});
    assert.equal(blocked.status,429);assert.ok(Number(blocked.headers.get("retry-after"))>0);assert.equal((await blocked.json()).errorCode,"rate_limited");
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

test("managed local web origin permits session login through an API host while remote origins stay blocked",async()=>{
  const {managedEnvironment,validateManagedConfig}=await import("../../scripts/local-dev-config.mjs");
  const home=path.resolve("output","local-dev"),config=validateManagedConfig({pgBin:path.join(home,"pgsql","bin"),pgData:path.join(home,"postgres-data"),pgPort:25432,apiPort:28060,webPort:28061,databaseUrl:"postgresql://postgres@127.0.0.1:25432/info_workbench_dev",setupComplete:true},home);
  const env=managedEnvironment(config,{DATABASE_URL:config.databaseUrl,PORT:"28060",LOCAL_WEB_PORT:"28061",VITE_API_PROXY_TARGET:"http://127.0.0.1:28060",NODE_ENV:"development"},{API_CORS_ALLOW_ORIGINS:"https://untrusted.example"});
  const repositories=createApiTestRepositories(),passwords=new PasswordHashingService(),password="Synthetic-managed-password-12",now=new Date().toISOString();
  const user={id:randomUUID(),email:"managed-origin@example.test",role:"viewer" as const,status:"active" as const,createdAt:now,updatedAt:now};
  await repositories.appUserRepository.create(user,{userId:user.id,passwordHash:await passwords.hashPassword(password),passwordAlgo:passwords.passwordAlgo,updatedAt:now});
  const server=createApiServer({repositories,createConnector:()=>new RedditMockConnector(),cors:{allowedOrigins:(env.API_CORS_ALLOW_ORIGINS??"").split(",")},logger:()=>{}});
  try{const base=await startServer(server);
    const send=(origin:string)=>fetch(`${base}/auth/login`,{method:"POST",headers:{"content-type":"application/json",origin,"x-forwarded-host":"127.0.0.1:28061","x-forwarded-proto":"http"},body:JSON.stringify({email:user.email,password})});
    const allowed=await send("http://127.0.0.1:28061");assert.equal(allowed.status,200);assert.ok(allowed.headers.get("set-cookie"));
    const blocked=await send("https://untrusted.example");assert.equal(blocked.status,403);assert.equal((await blocked.json()).errorCode,"write_origin_not_allowed");
  }finally{await stopServer(server);}
});
