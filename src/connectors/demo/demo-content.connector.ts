import { createHash } from "node:crypto";
import type { ContentPlatform, JsonValue, PublicContentKind, SourceCapability, SourceTarget } from "../../../packages/contracts/src/source-content";
import { ContentProviderError, type CollectedContent, type ContentProvider, type CollectContentPageRequest } from "../shared/content-provider.interface";
import { stableUuidFromString } from "../../shared/ids/stable-id";

/** Synthetic, offline development data. Provider identity keeps it distinct from real sources. */
export class DemoContentProvider implements ContentProvider {
  readonly capability: SourceCapability;
  constructor(readonly platform: "reddit" | "x", private readonly now = () => new Date().toISOString()) {
    this.capability = {
      platform, provider: `demo_${platform}`, enabled: true, contentKinds: platform === "reddit" ? ["post","comment"] : ["post"],
      targetTypes: platform === "reddit" ? ["community","account","post"] : ["account","search"], keywordSearch: platform === "reddit" ? "scoped" : "global",
      observationModel: platform === "reddit" ? "archive" : "snapshot",
      metrics: [{key:platform === "reddit" ? "reddit.score" : "x.likes",label:platform === "reddit" ? "Score" : "Likes",unit:"count",cumulative:platform === "x",signed:platform === "reddit",contentKinds:platform === "reddit" ? ["post","comment"] : ["post"],direction:"higher"}],
      limitations:["Synthetic offline demo data; no external requests or real-platform coverage.","The demo provider must never be interpreted as Arctic Shift or a live X provider."],
    };
    Object.assign(this.capability, { refreshByIds: true });
  }
  normalizeTarget(target: SourceTarget, kind: PublicContentKind): SourceTarget {
    if (!target || !this.capability.contentKinds.includes(kind) || !this.capability.targetTypes.includes(target.type)) throw new ContentProviderError("Unsupported demo target/kind",false);
    if (target.type === "search") { if(typeof target.query!=="string" || !target.query.trim() || target.query.length>200)throw new ContentProviderError("Invalid demo search",false); return {type:"search",query:target.query.trim()}; }
    const key=target.type==="community" ? "community" : target.type==="account" ? "account" : "postId";
    const raw=(target as unknown as Record<string,unknown>)[key];
    if(typeof raw!=="string" || !/^[a-z0-9_-]{2,40}$/i.test(raw.trim().replace(/^[ru]\//,"")))throw new ContentProviderError("Invalid demo identifier",false);
    if(target.type==="post" && kind!=="comment")throw new ContentProviderError("Post targets collect comments",false);
    const query="query" in target ? target.query : undefined;
    if(query!==undefined && (typeof query!=="string" || query.length>200))throw new ContentProviderError("Invalid demo keyword",false);
    return {...target,[key]:raw.trim().replace(/^[ru]\//,"").toLowerCase(),...(query ? {query:query.trim()} : {})} as SourceTarget;
  }
  async collectPage(request: CollectContentPageRequest) {
    request.signal?.throwIfAborted();
    const start=Date.parse(request.from),end=Date.parse(request.to),step=1800000;
    const first=Math.ceil(start/step)*step, total=Math.min(2000,Math.max(0,Math.ceil((end-first)/step)));
    const offset=request.checkpoint && typeof request.checkpoint==="object" && !Array.isArray(request.checkpoint) ? Number(request.checkpoint.offset) : 0;
    if(!Number.isInteger(offset)||offset<0)throw new ContentProviderError("Invalid demo checkpoint",false);
    const items:CollectedContent[]=[];
    for(let i=offset;i<Math.min(total,offset+request.limit);i++)items.push(this.item(request,first+(total-1-i)*step));
    const next=offset+items.length;
    return {items,nextCheckpoint:next<total ? {offset:next} as JsonValue : null,exhausted:next>=total,coverage:"unknown" as const,warning:"Synthetic offline demonstration; not real source data."};
  }
  async refreshIds(request: { source: CollectContentPageRequest["source"]; externalIds: string[]; signal?: AbortSignal }) {
    request.signal?.throwIfAborted();
    const items=request.externalIds.map(id=>{
      const match=/demo_(\d+)_([a-f0-9]+)$/.exec(id.replace(/^t[13]_/ ,""));
      if(!match)throw new ContentProviderError("Invalid demo refresh identity",false);
      const time=Number(match[1]);
      const item=this.item({source:request.source,from:new Date(time).toISOString(),to:this.now(),limit:1,checkpoint:null},time);
      item.observation.maturity="refreshed";item.observation.timeBasis=this.platform==="reddit" ? "archive_refresh" : "provider_snapshot";
      item.observation.sourceObservedAt=this.now();item.observation.metrics[this.platform==="reddit" ? "reddit.score" : "x.likes"]=12;
      item.observation.evidenceKey=createHash("sha256").update(`${item.externalId}:refresh:${item.observation.sourceObservedAt}`).digest("hex");return item;
    });
    return {items,nextCheckpoint:null,exhausted:true,coverage:"unknown" as const,warning:"Synthetic offline refresh."};
  }
  private item(request:CollectContentPageRequest,time:number):CollectedContent {
    const target=request.source.target, signature=createHash("sha256").update(JSON.stringify(target)).digest("hex").slice(0,10);
    const rawId=`demo_${time}_${signature}`,externalId=this.platform==="reddit" ? `${request.source.contentKind==="comment" ? "t1" : "t3"}_${rawId}` : rawId;
    const query="query" in target ? target.query ?? "" : "",publishedAt=new Date(time).toISOString(),fetchedAt=this.now();
    const author=target.type==="account" ? target.account : "demo_author";
    return {id:stableUuidFromString(`${this.platform}:content:${externalId}`),platform:this.platform as ContentPlatform,kind:request.source.contentKind,externalId,title:request.source.contentKind==="comment" ? null : `[DEMO] ${query || author} information sample`,text:`[合成演示 / SYNTHETIC] ${query} · ${publishedAt} · 本地功能验证数据，不代表真实平台内容。`,url:null,language:"zh-CN",author:{externalId:null,handle:author,displayName:author,url:null},publishedAt,fetchedAt,availability:"available",references:[],media:[],platformDetails:this.platform==="reddit" ? {platform:"reddit",community:target.type==="community" ? target.community : "demo",flair:"SYNTHETIC",nsfw:false} : {platform:"x",conversationId:rawId,isReply:false,isRepost:false,isQuote:false,sensitive:false},observation:{provider:this.capability.provider,sourceId:request.source.id,sourceObservedAt:publishedAt,fetchedAt,timeBasis:this.platform==="reddit" ? "archive_initial" : "provider_snapshot",maturity:this.platform==="reddit" ? "initial" : "unknown",metrics:{[this.platform==="reddit" ? "reddit.score" : "x.likes"]:time % 3600000===0 ? 0 : 3},evidenceKey:createHash("sha256").update(`${externalId}:initial`).digest("hex")}};
  }
}
