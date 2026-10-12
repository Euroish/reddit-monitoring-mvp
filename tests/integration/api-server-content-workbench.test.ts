import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApiServer } from "../../apps/api/src/create-api-server";
import { SourceContentService } from "../../src/application/services/source-content.service";
import { InMemorySourceContentRepository } from "../../src/storage/repositories/in-memory/source-content.repository";
import { RedditMockConnector } from "../../src/connectors/reddit/reddit-mock.connector";
import { PasswordHashingService } from "../../src/application/services/password-hashing.service";
import type { CollectedContent,ContentProvider } from "../../src/connectors/shared/content-provider.interface";
import type { ContentWorkbenchResponse,ContentExportResponse,ContentPlatform,PublicContentKind,PlatformDetails } from "../../packages/contracts/src/source-content";
import { createApiTestRepositories,startServer,stopServer } from "./api-server.helpers";
import { FIXED_CONTENT_NOW } from "../helpers/source-content-fixtures";

function provider(platform:ContentPlatform,name:string,kind:PublicContentKind):ContentProvider {
  return {capability:{platform,provider:name,enabled:true,contentKinds:[kind],targetTypes:["account"],keywordSearch:"global",metrics:[],observationModel:"snapshot",limitations:["Synthetic offline test"]},normalizeTarget:target=>target,collectPage:async()=>{assert.fail("Read APIs must never collect");}};
}
async function seededService() {
  const repo=new InMemorySourceContentRepository(),providers=[provider("reddit","fixture_reddit","post"),provider("reddit","fixture_reddit_alt","post"),provider("x","fixture_x","post"),provider("instagram","fixture_instagram","video"),provider("web","fixture_web","article")],service=new SourceContentService(repo,providers,()=>FIXED_CONTENT_NOW);
  const specs:{platform:ContentPlatform;provider:string;kind:PublicContentKind;details:PlatformDetails;externalId:string;publishedAt:string|null;title:string|null;text:string;metrics:Record<string,number|null>}[]=[
    {platform:"reddit",provider:"fixture_reddit",kind:"post",details:{platform:"reddit",community:"fixture",flair:null,nsfw:null},externalId:"t3_formula",publishedAt:FIXED_CONTENT_NOW,title:'=HYPERLINK("https://example.test","danger")',text:"中文 alpha",metrics:{"reddit.score":-2,"reddit.num_comments":0}},
    {platform:"reddit",provider:"fixture_reddit",kind:"post",details:{platform:"reddit",community:"fixture",flair:null,nsfw:null},externalId:"t3_quotes",publishedAt:FIXED_CONTENT_NOW,title:'A "quoted", title',text:"中文 alpha",metrics:{"reddit.score":null}},
    {platform:"x",provider:"fixture_x",kind:"post",details:{platform:"x",conversationId:"18446744073709551615",isReply:null,isRepost:false,isQuote:true,sensitive:null},externalId:"18446744073709551615",publishedAt:FIXED_CONTENT_NOW,title:null,text:" \t=SUM(1,2)\n中文 alpha",metrics:{"x.likes":0,"x.views":null}},
    {platform:"instagram",provider:"fixture_instagram",kind:"video",details:{platform:"instagram",mediaProduct:"reel",caption:null,carouselIds:["child"]},externalId:"video-fixture",publishedAt:"2026-10-11T01:00:00.000Z",title:null,text:"alpha",metrics:{"instagram.plays":null}},
    {platform:"web",provider:"fixture_web",kind:"article",details:{platform:"web",publisher:null,canonicalUrl:null,feedUrl:"https://example.test/feed"},externalId:"article-fixture",publishedAt:null,title:"Article",text:"alpha",metrics:{"web.rank":3}},
  ];
  const sources=new Map<string,string>();const rows:CollectedContent[]=[];
  for(const spec of specs) {
    if(!sources.has(spec.provider)){const origin=await service.createSource({platform:spec.platform,provider:spec.provider,contentKind:spec.kind,target:{type:"account",account:"fixture"}});sources.set(spec.provider,origin.id);}
    const sourceId=sources.get(spec.provider)!,row:CollectedContent={id:randomUUID(),platform:spec.platform,kind:spec.kind,externalId:spec.externalId,title:spec.title,text:spec.text,url:null,language:null,author:null,publishedAt:spec.publishedAt,fetchedAt:FIXED_CONTENT_NOW,availability:"available",references:[],media:[],platformDetails:spec.details,observation:{provider:spec.provider,sourceId,sourceObservedAt:null,fetchedAt:FIXED_CONTENT_NOW,timeBasis:"unknown",maturity:"unknown",metrics:spec.metrics,evidenceKey:spec.externalId}};
    await repo.enqueue({id:randomUUID(),sourceId,from:"2026-10-01T00:00:00.000Z",to:FIXED_CONTENT_NOW,pageSize:25,maxPages:1,now:FIXED_CONTENT_NOW});const claim=await repo.claim(FIXED_CONTENT_NOW);assert.ok(claim);await repo.commitPage(claim,{items:[row],nextCheckpoint:null,exhausted:true,coverage:"unknown",warning:null},FIXED_CONTENT_NOW);rows.push(row);
  }
  const alt=await service.createSource({platform:"reddit",provider:"fixture_reddit_alt",contentKind:"post",target:{type:"account",account:"fixture"}}),shared={...rows[0],observation:{...rows[0].observation,provider:alt.provider,sourceId:alt.id,evidenceKey:"shared"}};
  await repo.enqueue({id:randomUUID(),sourceId:alt.id,from:"2026-10-01T00:00:00.000Z",to:FIXED_CONTENT_NOW,pageSize:25,maxPages:1,now:FIXED_CONTENT_NOW});const claim=await repo.claim(FIXED_CONTENT_NOW);assert.ok(claim);await repo.commitPage(claim,{items:[shared],nextCheckpoint:null,exhausted:true,coverage:"unknown",warning:null},FIXED_CONTENT_NOW);
  return {service,sourceId:sources.get("fixture_reddit")!};
}
function parseCsv(csv:string) {
  const rows:string[][]=[],cells:string[]=[];let cell="",quoted=false;const input=csv.replace(/^\uFEFF/u,"");
  for(let index=0;index<input.length;index++){const c=input[index];if(c==='"'){if(quoted&&input[index+1]==='"'){cell+='"';index++;}else quoted=!quoted;}else if(!quoted&&c===','){cells.push(cell);cell="";}else if(!quoted&&c==='\n'){cells.push(cell.replace(/\r$/u,""));rows.push(cells.splice(0));cell="";}else cell+=c;}
  return rows;
}

test("content workbench keeps heterogeneous fields, exact same-scope denominators, and overlapping provider discovery counts",async()=>{
  const {service,sourceId}=await seededService(),server=createApiServer({repositories:createApiTestRepositories(),createConnector:()=>new RedditMockConnector(),sourceContent:service,auth:{bearerToken:"workbench-token"},logger:()=>{}}),base=await startServer(server),headers={authorization:"Bearer workbench-token"};
  try{
    assert.equal((await fetch(`${base}/v1/content/workbench`)).status,401);assert.equal((await fetch(`${base}/v1/content/export`)).status,401);
    const result=await (await fetch(`${base}/v1/content/workbench?query=alpha&limit=1`,{headers})).json() as ContentWorkbenchResponse;assert.equal(result.stats.total,5);assert.equal(result.stats.unknownPublishedAtCount,1);assert.equal(result.byPlatform.reduce((sum,row)=>sum+row.count,0),5);assert.equal(result.byProvider.reduce((sum,row)=>sum+row.count,0),6);assert.equal(result.providerCountsMayOverlap,true);assert.equal(result.metricComparison,"platform_units_only");
    const scoped=await (await fetch(`${base}/v1/content/workbench?sourceId=${sourceId}&query=alpha&limit=1`,{headers})).json() as ContentWorkbenchResponse;assert.equal(scoped.stats.total,2);assert.deepEqual(scoped.byProvider,[{provider:"fixture_reddit",count:2}]);
    const none=await (await fetch(`${base}/v1/content/workbench?query=${encodeURIComponent("不存在")}`,{headers})).json() as ContentWorkbenchResponse;assert.equal(none.stats.total,0);assert.deepEqual(none.byPlatform,[]);assert.deepEqual(none.byProvider,[]);
    const exported=await (await fetch(`${base}/v1/content/export?format=json&maxItems=20&query=alpha`,{headers})).json() as ContentExportResponse;assert.equal(exported.items.find(row=>row.platform==="x")!.externalId,"18446744073709551615");assert.equal(exported.items.find(row=>row.platform==="x")!.observations[0].metrics["x.likes"],0);assert.equal(exported.items.find(row=>row.platform==="instagram")!.observations[0].metrics["instagram.plays"],null);assert.equal(exported.items.find(row=>row.platform==="web")!.publishedAt,null);
  }finally{await stopServer(server);}
});

test("bounded export continues exact cursor scopes without duplicates, exposes metadata and protects CSV formulas and numeric IDs",async()=>{
  const {service}=await seededService(),server=createApiServer({repositories:createApiTestRepositories(),createConnector:()=>new RedditMockConnector(),sourceContent:service,auth:{bearerToken:"workbench-token"},logger:()=>{}}),base=await startServer(server),headers={authorization:"Bearer workbench-token"};
  try{
    const first=await (await fetch(`${base}/v1/content/export?query=alpha&maxItems=2`,{headers})).json() as ContentExportResponse;assert.equal(first.totalMatching,5);assert.equal(first.exportedCount,2);assert.equal(first.truncated,true);assert.ok(first.nextCursor);assert.equal(first.filters.limit,undefined);assert.equal(first.filters.cursor,undefined);
    const second=await (await fetch(`${base}/v1/content/export?query=alpha&maxItems=2&cursor=${first.nextCursor}`,{headers})).json() as ContentExportResponse;const third=await (await fetch(`${base}/v1/content/export?query=alpha&maxItems=2&cursor=${second.nextCursor}`,{headers})).json() as ContentExportResponse;assert.equal(third.exportedCount,1);assert.equal(third.truncated,false);assert.equal(new Set([...first.items,...second.items,...third.items].map(row=>row.id)).size,5);
    assert.equal((await fetch(`${base}/v1/content/export?query=changed&cursor=${first.nextCursor}`,{headers})).status,400);
    for(const suffix of ["maxItems=0","maxItems=2001","maxItems=NaN","format=xml"])assert.equal((await fetch(`${base}/v1/content/export?${suffix}`,{headers})).status,400);
    const response=await fetch(`${base}/v1/content/export?query=alpha&format=csv&maxItems=20`,{headers});assert.equal(response.status,200);assert.match(response.headers.get("content-type")!,/text\/csv/);assert.match(response.headers.get("content-disposition")!,/attachment/);assert.equal(response.headers.get("x-export-total-matching"),"5");assert.equal(response.headers.get("x-export-count"),"5");assert.equal(response.headers.get("x-export-truncated"),"false");
    const rows=parseCsv(await response.text()),metadata=JSON.parse(rows[0][1]);assert.equal(metadata.scope,"collected_content");assert.equal(metadata.totalMatching,5);assert.equal(rows.length,7);const columns=rows[1],idIndex=columns.indexOf("externalId"),titleIndex=columns.indexOf("title"),textIndex=columns.indexOf("text");assert.equal(rows.slice(2).find(row=>row[idIndex]==="'18446744073709551615")![textIndex],"' \t=SUM(1,2)\n中文 alpha");assert.ok(rows.slice(2).some(row=>row[titleIndex]==="'=HYPERLINK(\"https://example.test\",\"danger\")"));assert.ok(rows.slice(2).some(row=>row[titleIndex]==='A "quoted", title'));
  }finally{await stopServer(server);}
});

test("authenticated viewer can read the cross-platform workbench and export but cannot start collection",async()=>{
  const {service,sourceId}=await seededService(),repos=createApiTestRepositories(),password=new PasswordHashingService(),id=randomUUID();await repos.appUserRepository.create({id,email:"export-viewer@example.test",displayName:"Viewer",role:"viewer",status:"active",createdAt:FIXED_CONTENT_NOW,updatedAt:FIXED_CONTENT_NOW},{userId:id,passwordHash:await password.hashPassword("fixture-password"),passwordAlgo:password.passwordAlgo,updatedAt:FIXED_CONTENT_NOW});
  const server=createApiServer({repositories:repos,createConnector:()=>new RedditMockConnector(),sourceContent:service,auth:{bearerToken:"workbench-token"},now:()=>FIXED_CONTENT_NOW,logger:()=>{}}),base=await startServer(server);
  try{const login=await fetch(`${base}/auth/login`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:"export-viewer@example.test",password:"fixture-password"})}),cookie=login.headers.get("set-cookie")!.split(";")[0],headers={cookie};assert.equal((await fetch(`${base}/v1/content/workbench`,{headers})).status,200);assert.equal((await fetch(`${base}/v1/content/export?format=csv`,{headers})).status,200);assert.equal((await fetch(`${base}/v1/sources/${sourceId}/collect`,{method:"POST",headers:{...headers,"content-type":"application/json"},body:"{}"})).status,403);}finally{await stopServer(server);}
});
