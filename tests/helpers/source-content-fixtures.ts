import { randomUUID } from "node:crypto";
import type { CollectionSource } from "../../packages/contracts/src/source-content";
import { ArcticShiftContentConnector } from "../../src/connectors/reddit/arctic-shift-content.connector";
import { defaultSourceRefresh, defaultSourceSchedule } from "../../src/storage/source-lifecycle";

export const FIXED_CONTENT_NOW = "2026-10-12T10:00:00.000Z";
export const publishedSeconds = Date.parse("2026-10-10T08:00:00Z") / 1000;
export function syntheticRedditPost(overrides: Record<string, unknown> = {}) {
  return { id:"abc123",created_utc:publishedSeconds,retrieved_on:publishedSeconds+20,subreddit:"testcommunity",title:"Synthetic 人工智能 research",selftext:"Fixture body, not real source data",author:"fixture_author",author_fullname:"t2_author0",permalink:"/r/testcommunity/comments/abc123/fixture/",score:7,num_comments:0,upvote_ratio:0.75,_meta:{ retrieved_2nd_on:publishedSeconds+36*3600 },...overrides };
}
export function syntheticSource(overrides: Partial<CollectionSource> = {}): CollectionSource {
  return { id:randomUUID(),platform:"reddit",provider:"arctic_shift",label:"Offline fixture",target:{type:"community",community:"testcommunity"},contentKind:"post",createdAt:FIXED_CONTENT_NOW,lastSuccessAt:null,latestPublishedAt:null,coverage:"unknown",state:"active",group:null,updatedAt:FIXED_CONTENT_NOW,schedule:defaultSourceSchedule(),refresh:defaultSourceRefresh(),nextDueAt:null,incrementalTo:null,...overrides };
}
export function fixtureConnector(responses: { rows?: unknown[]; status?: number; error?: string; headers?: Record<string,string> }[], requests: URL[] = []) {
  let calls=0;
  const fetcher: typeof fetch = async input => {
    requests.push(new URL(String(input)));
    const response=responses[Math.min(calls++,responses.length-1)];
    return new Response(JSON.stringify(response.error ? { error:response.error,data:[] } : { data:response.rows ?? [] }),{ status:response.status ?? 200,headers:response.headers });
  };
  return new ArcticShiftContentConnector(fetcher,1000,()=>FIXED_CONTENT_NOW);
}
