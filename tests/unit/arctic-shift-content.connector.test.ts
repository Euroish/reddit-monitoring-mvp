import assert from "node:assert/strict";
import test from "node:test";
import { ArcticShiftContentConnector } from "../../src/connectors/reddit/arctic-shift-content.connector";
import { ContentProviderError } from "../../src/connectors/shared/content-provider.interface";
import { fixtureConnector,FIXED_CONTENT_NOW,publishedSeconds,syntheticRedditPost,syntheticSource } from "../helpers/source-content-fixtures";
const request = (source=syntheticSource(),limit=25) => ({source,from:"2026-10-09T00:00:00Z",to:FIXED_CONTENT_NOW,limit,checkpoint:null});

test("Arctic Shift keeps initial/refresh/fetch times and preserves signed score, zero and missing metrics",async()=>{
  const provider=fixtureConnector([{rows:[syntheticRedditPost({score:-3,num_comments:0,upvote_ratio:undefined})]}]);
  const page=await provider.collectPage(request()), item=page.items[0];
  assert.equal(item.observation.sourceObservedAt,new Date((publishedSeconds+36*3600)*1000).toISOString());
  assert.equal(item.observation.timeBasis,"archive_refresh"); assert.equal(item.observation.maturity,"refreshed");
  assert.equal(item.fetchedAt,FIXED_CONTENT_NOW); assert.notEqual(item.publishedAt,item.observation.sourceObservedAt);
  assert.deepEqual(item.observation.metrics,{"reddit.score":-3,"reddit.num_comments":0,"reddit.upvote_ratio":null});
  assert.equal(page.coverage,"unknown"); assert.equal(page.exhausted,true);
});
test("Arctic Shift initial placeholders remain marked initial and do not fabricate missing author",async()=>{
  const page=await fixtureConnector([{rows:[syntheticRedditPost({_meta:undefined,score:1,num_comments:0,author:"[deleted]",selftext:"[deleted]"})]}]).collectPage(request());
  assert.equal(page.items[0].observation.maturity,"initial"); assert.equal(page.items[0].author,null); assert.equal(page.items[0].text,null); assert.equal(page.items[0].availability,"deleted");
});
test("Arctic Shift comments preserve parent/root identity and have no invented post title or comment count",async()=>{
  const source=syntheticSource({contentKind:"comment",target:{type:"post",postId:"abc123"}});
  const page=await fixtureConnector([{rows:[{id:"def456",created_utc:publishedSeconds,retrieved_on:publishedSeconds+20,subreddit:"testcommunity",body:"中文评论",link_id:"t3_abc123",parent_id:"t1_cafe00",score:0}]}]).collectPage(request(source));
  assert.equal(page.items[0].externalId,"t1_def456"); assert.equal(page.items[0].title,null);
  assert.deepEqual(page.items[0].references,[{kind:"comment",externalId:"t1_cafe00",relation:"reply_to"},{kind:"post",externalId:"t3_abc123",relation:"thread_root"}]);
  assert.deepEqual(page.items[0].observation.metrics,{"reddit.score":0});
});
test("Arctic Shift encodes scoped queries and requests _meta through full response",async()=>{
  const urls:URL[]=[]; const source=syntheticSource({target:{type:"community",community:"testcommunity",query:"人工智能 & AI"}});
  await fixtureConnector([{rows:[]}],urls).collectPage(request(source));
  assert.equal(urls[0].searchParams.get("query"),"人工智能 & AI"); assert.equal(urls[0].searchParams.has("fields"),false); assert.equal(urls[0].origin,"https://arctic-shift.photon-reddit.com");
});
test("Arctic Shift overlaps the last second, deduplicates boundary and detects saturation",async()=>{
  const source=syntheticSource(), one=syntheticRedditPost({id:"aaa111"}), two=syntheticRedditPost({id:"bbb222",created_utc:publishedSeconds-10}), three=syntheticRedditPost({id:"ccc333",created_utc:publishedSeconds-20});
  const provider=fixtureConnector([{rows:[one,two]},{rows:[two,three]}]);
  const first=await provider.collectPage(request(source,2)); const second=await provider.collectPage({...request(source,2),checkpoint:first.nextCheckpoint});
  assert.deepEqual(second.items.map(item=>item.externalId),["t3_ccc333"]); assert.equal(second.exhausted,true);
  const rows=Array.from({length:100},(_,index)=>syntheticRedditPost({id:`abc${index}`}));
  const saturated=fixtureConnector([{rows}]);
  const initial=await saturated.collectPage(request(source,100));
  await assert.rejects(saturated.collectPage({...request(source,100),checkpoint:initial.nextCheckpoint}),/saturated/);
});
test("Arctic Shift completes small pages without skipping timestamp ties",async()=>{
  const rows=[syntheticRedditPost({id:"aaa111"}),syntheticRedditPost({id:"bbb222"}),syntheticRedditPost({id:"ccc333",created_utc:publishedSeconds-10})];
  const limits:number[]=[];
  const provider=new ArcticShiftContentConnector(async input=>{
    const url=new URL(String(input)),limit=Number(url.searchParams.get("limit"));limits.push(limit);
    return new Response(JSON.stringify({data:rows.filter(row=>row.created_utc<Number(url.searchParams.get("before"))).slice(0,limit)}));
  },1000,()=>FIXED_CONTENT_NOW);
  const collected:string[]=[];let saved:Awaited<ReturnType<typeof provider.collectPage>>["nextCheckpoint"]=null;
  for(let page=0;page<4;page++){
    const result=await provider.collectPage({...request(syntheticSource(),1),checkpoint:saved});
    collected.push(...result.items.map(item=>item.externalId));saved=result.nextCheckpoint;
    if(result.exhausted)break;
  }
  assert.deepEqual(collected,["t3_aaa111","t3_bbb222","t3_ccc333"]);
  assert.equal(saved,null);assert.deepEqual(limits,[1,2,3,2]);
});
test("Arctic Shift limits retries to the worker and distinguishes timeout/429/403 from empty results",async()=>{
  for (const [status,message,retryable] of [[422,"Timeout. Maybe slow down a bit",true],[429,"Rate limited",true],[403,"Forbidden",false]] as const) {
    const urls:URL[]=[]; const provider=fixtureConnector([{status,error:message,headers:{"x-ratelimit-reset":"45"}}],urls);
    await assert.rejects(provider.collectPage(request()),error=>error instanceof ContentProviderError && error.retryable===retryable && error.retryAfterSeconds===45);
    assert.equal(urls.length,1);
  }
  const html = new ArcticShiftContentConnector(async()=>new Response("temporary limit",{status:429}));
  await assert.rejects(html.collectPage(request()),error=>error instanceof ContentProviderError && error.retryable);
});
test("Arctic Shift fails invalid pages instead of silently writing a partial page",async()=>{
  await assert.rejects(fixtureConnector([{rows:[syntheticRedditPost(),{id:"invalid"}]}]).collectPage(request()),/lacks valid identity/);
  await assert.rejects(fixtureConnector([{rows:[syntheticRedditPost({subreddit:"wrongcommunity"})]}]).collectPage(request()),/different community/);
  assert.throws(()=>fixtureConnector([{rows:[]}]).normalizeTarget({type:"feed",url:"http://localhost/private"},"post"),/not supported/);
});
