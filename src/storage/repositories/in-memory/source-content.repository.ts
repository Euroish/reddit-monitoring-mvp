import { randomUUID } from "node:crypto";
import type { CollectionSource, ContentQuery, CreateCollectionSourceRequest, PublicContent, SourceCollectionJob, UpdateCollectionSourceRequest, SourceJobQuery, SourceProviderBudget, SourceProviderUsage, SourceWorkerHeartbeat, SourceOps } from "../../../../packages/contracts/src/source-content";
import type { CollectedPage } from "../../../connectors/shared/content-provider.interface";
import type { ClaimedSourceJob, SourceContentRepository, SourceJobInput } from "../../../domain/repositories/source-content-repository";
import { decodeContentCursor, encodeContentCursor } from "../../source-content-query";
import { activeJob, defaultProviderBudget, defaultSourceRefresh, defaultSourceSchedule, nextUsageDay, scheduledWindow } from "../../source-lifecycle";

/** Offline/test adapter; live runtimes always use PostgreSQL. */
export class InMemorySourceContentRepository implements SourceContentRepository {
  private sources = new Map<string, CollectionSource>();
  private jobs = new Map<string, SourceCollectionJob>();
  private leases = new Map<string, { token: string; until: string }>();
  private contents = new Map<string, PublicContent>();
  private contentVersions = new Map<string,string>();
  private budgets = new Map<string,SourceProviderBudget>();
  private usage = new Map<string,{requests:number;resources:number}>();
  private workers = new Map<string,SourceWorkerHeartbeat>();
  private refreshes = new Map<string,{attempts:number;at:string}>();
  async listSources() { return structuredClone([...this.sources.values()]); }
  async getSource(id: string) { return structuredClone(this.sources.get(id) ?? null); }
  async createSource(input: CreateCollectionSourceRequest & { id: string; label: string; createdAt: string }) {
    const existing = [...this.sources.values()].find(item => item.platform===input.platform && item.provider===input.provider && item.contentKind===input.contentKind && JSON.stringify(item.target)===JSON.stringify(input.target));
    if (existing) { existing.label=input.label;existing.updatedAt=input.createdAt; return structuredClone(existing); }
    const value: CollectionSource = { ...input, lastSuccessAt:null,latestPublishedAt:null,coverage:"unknown",state:"active",group:null,updatedAt:input.createdAt,schedule:defaultSourceSchedule(),refresh:defaultSourceRefresh(),nextDueAt:null,incrementalTo:null };
    this.sources.set(value.id,value); return structuredClone(value);
  }
  async updateSource(id: string, changes: UpdateCollectionSourceRequest, now: string) { const value=this.sources.get(id); if(!value)return null; Object.assign(value,{...changes,schedule:{...value.schedule,...changes.schedule},refresh:{...value.refresh,...changes.refresh},updatedAt:now}); if(changes.schedule) value.nextDueAt=value.schedule.enabled ? now : null; return structuredClone(value); }
  async setSourceState(id: string,state:CollectionSource["state"],now:string) { const value=this.sources.get(id);if(!value)return null;value.state=state;value.updatedAt=now;value.nextDueAt=state==="active"&&value.schedule.enabled?now:null;if(state!=="active")for(const job of this.jobs.values())if(job.sourceId===id&&activeJob(job))await this.cancelJob(job.id,now);return structuredClone(value); }
  async enqueue(input: SourceJobInput) {
    const existing = [...this.jobs.values()].find(item => item.sourceId===input.sourceId && ["queued","running","retrying"].includes(item.status));
    if (existing) return structuredClone(existing);
    const value: SourceCollectionJob = { id:input.id,sourceId:input.sourceId,from:input.from,to:input.to,pageSize:input.pageSize,maxPages:input.maxPages,status:"queued",pagesCommitted:0,recordsProcessed:0,recordsInserted:0,recordsUpdated:0,requestCount:0,requestDurationMs:0,purpose:input.purpose??"manual",parentJobId:input.parentJobId??null,refreshIds:input.refreshIds??[],checkpoint:null,coverage:"unknown",exhausted:false,attempts:0,error:null,nextRunAt:input.now,createdAt:input.now,finishedAt:null };
    this.jobs.set(value.id,value); return structuredClone(value);
  }
  async getJob(id: string) { return structuredClone(this.jobs.get(id) ?? null); }
  async listJobs(query:SourceJobQuery) { return structuredClone([...this.jobs.values()].filter(item=>(!query.sourceId||item.sourceId===query.sourceId)&&(!query.status||item.status===query.status)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id)).slice(0,query.limit??50)); }
  async cancelJob(id:string,now:string) { const value=this.jobs.get(id);if(!value||!activeJob(value))return null;Object.assign(value,{status:"cancelled",finishedAt:now,error:"Cancelled by source lifecycle or user"});this.leases.delete(id);return structuredClone(value); }
  async retryJob(id: string, now: string) {
    const current = this.jobs.get(id);
    if (!current || current.status!=="failed" || [...this.jobs.values()].some(item => item.sourceId===current.sourceId && ["queued","running","retrying"].includes(item.status))) return null;
    Object.assign(current,{ status:"queued",attempts:0,error:null,nextRunAt:now,finishedAt:null }); return structuredClone(current);
  }
  async claim(now: string): Promise<ClaimedSourceJob | null> {
    const current = [...this.jobs.values()].filter(item=>this.sources.get(item.sourceId)?.state==="active").sort((a,b)=>a.nextRunAt.localeCompare(b.nextRunAt)||a.id.localeCompare(b.id)).find(item => ["queued","retrying"].includes(item.status) && item.nextRunAt<=now || item.status==="running" && (this.leases.get(item.id)?.until ?? "")<=now);
    if (!current) return null;
    current.status="running"; current.attempts++;
    const token=randomUUID(); this.leases.set(current.id,{ token,until:new Date(Date.parse(now)+120000).toISOString() });
    return { job:structuredClone(current),leaseToken:token };
  }
  async continueJob(id: string, newId: string, now: string) {
    const previous=this.jobs.get(id); if (!previous || previous.status!=="succeeded" || previous.checkpoint===null) return null;
    const active=[...this.jobs.values()].find(item=>item.sourceId===previous.sourceId && activeJob(item)); if (active) return active.parentJobId===previous.id ? structuredClone(active) : null;
    const next:SourceCollectionJob={...structuredClone(previous),id:newId,parentJobId:previous.id,status:"queued",pagesCommitted:0,recordsProcessed:0,recordsInserted:0,recordsUpdated:0,requestCount:0,requestDurationMs:0,attempts:0,error:null,nextRunAt:now,createdAt:now,finishedAt:null};
    this.jobs.set(newId,next); return structuredClone(next);
  }
  async commitPage(claim: ClaimedSourceJob, page: CollectedPage, now: string) {
    const current=this.jobs.get(claim.job.id), origin=current && this.sources.get(current.sourceId);
    if (!current || !origin || this.leases.get(current.id)?.token!==claim.leaseToken || current.status!=="running") throw new Error("Collection lease lost");
    // Validate the whole page before mutating; the SQL adapter uses a real transaction.
    if (page.items.some(item => item.platform!==origin.platform || item.kind!==origin.contentKind || item.platformDetails.platform!==item.platform || item.observation.sourceId!==origin.id || item.observation.provider!==origin.provider)) throw new Error("Page/source identity mismatch");
    let inserted=0,updated=0;
    for (const item of new Map(page.items.map(item=>[item.id,item])).values()) {
      const existing=this.contents.get(item.id), previous=existing?.observations.find(obs => obs.sourceId===origin.id);
      existing ? updated++ : inserted++;
      const observed=item.observation.sourceObservedAt??item.fetchedAt,version=this.contentVersions.get(item.id);
      const replace=!version||observed>=version;
      const replaceObservation=!previous||Boolean(item.observation.sourceObservedAt&&(!previous.sourceObservedAt||item.observation.sourceObservedAt>=previous.sourceObservedAt))||!previous.sourceObservedAt&&!item.observation.sourceObservedAt&&item.fetchedAt>=previous.fetchedAt;
      const observations=existing?.observations.filter(obs=>obs.sourceId!==origin.id) ?? [];
      observations.push(replaceObservation ? item.observation : previous!);
      const { fetchedAt, observation: _observation, ...fields } = item;
      const lastFetchedAt=existing&&existing.lastFetchedAt>fetchedAt?existing.lastFetchedAt:fetchedAt;
      const content: PublicContent = existing && !replace ? { ...existing,language:existing.language ?? fields.language,publishedAt:existing.publishedAt ?? fields.publishedAt,lastFetchedAt,observations } : { ...fields,language:existing?.language??fields.language,publishedAt:existing?.publishedAt??fields.publishedAt,firstFetchedAt:existing?.firstFetchedAt ?? fetchedAt,lastFetchedAt,observations };
      this.contents.set(item.id,structuredClone(content));
      if(replace)this.contentVersions.set(item.id,observed);
    }
    if(current.purpose==="refresh")for(const item of this.contents.values())if(current.refreshIds.includes(item.externalId)&&item.observations.some(obs=>obs.sourceId===origin.id)){const key=`${origin.id}:${item.id}`,old=this.refreshes.get(key);this.refreshes.set(key,{attempts:(old?.attempts??0)+1,at:now});}
    current.recordsInserted+=inserted;current.recordsUpdated+=updated;
    current.pagesCommitted++; current.recordsProcessed+=page.items.length; current.checkpoint=page.nextCheckpoint; current.exhausted=page.exhausted;
    current.coverage=page.exhausted && page.coverage!=="partial" ? "unknown" : "partial"; current.error=page.warning; current.attempts=0;
    const done=page.exhausted || page.nextCheckpoint===null || current.pagesCommitted>=current.maxPages;
    current.status=done ? "succeeded" : "queued"; current.finishedAt=done ? now : null; current.nextRunAt=new Date(Date.parse(now)+5000).toISOString();
    origin.lastSuccessAt=now; origin.coverage=current.coverage;
    if(done&&page.exhausted&&current.purpose==="scheduled")origin.incrementalTo=current.to;
    const latest=page.items.map(item=>item.publishedAt).filter((value):value is string=>value!==null).sort().at(-1);
    if (latest && (!origin.latestPublishedAt || latest>origin.latestPublishedAt)) origin.latestPublishedAt=latest;
    this.leases.delete(current.id);
  }
  async scheduleDue(now:string,refreshProviders:readonly string[],limit:number,enabledProviders?:readonly string[]) {
    let count=0;
    for(const source of [...this.sources.values()].sort((a,b)=>(a.nextDueAt??now).localeCompare(b.nextDueAt??now))) {
      if(count>=limit||source.state!=="active"||enabledProviders&&!enabledProviders.includes(`${source.platform}:${source.provider}`)||[...this.jobs.values()].some(item=>item.sourceId===source.id&&activeJob(item)))continue;
      if(source.schedule.enabled&&(!source.nextDueAt||source.nextDueAt<=now)) {
        const previous=[...this.jobs.values()].filter(item=>item.sourceId===source.id&&item.purpose==="scheduled"&&(item.status==="failed"||item.status==="succeeded"&&item.checkpoint!==null)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).find(item=>!this.jobsHasChild(item.id));
        if(previous) {if(previous.status==="succeeded")await this.continueJob(previous.id,randomUUID(),now);else {const retry=await this.enqueue({id:randomUUID(),sourceId:source.id,now,from:previous.from,to:previous.to,pageSize:source.schedule.pageSize,maxPages:source.schedule.maxPages,purpose:"scheduled",parentJobId:previous.id});this.jobs.get(retry.id)!.checkpoint=structuredClone(previous.checkpoint);}source.nextDueAt=new Date(Date.parse(now)+source.schedule.cadenceSeconds*1000).toISOString();count++;continue;}
        const window=scheduledWindow(source,now);if(window.from>=window.to)continue;
        await this.enqueue({id:randomUUID(),sourceId:source.id,now,...window,pageSize:source.schedule.pageSize,maxPages:source.schedule.maxPages,purpose:"scheduled"});source.nextDueAt=new Date(Date.parse(now)+source.schedule.cadenceSeconds*1000).toISOString();count++;continue;
      }
      if(source.refresh.enabled&&refreshProviders.includes(source.provider)) {
        const ids=[...this.contents.values()].filter(item=>{const obs=item.observations.find(value=>value.sourceId===source.id),previous=this.refreshes.get(`${source.id}:${item.id}`);return obs?.maturity==="initial"&&item.publishedAt&&Date.parse(item.publishedAt)<=Date.parse(now)-source.refresh.afterHours*3600000&&(previous?.attempts??0)<source.refresh.maxAttempts&&(!previous||Date.parse(previous.at)<=Date.parse(now)-source.refresh.minIntervalHours*3600000);}).slice(0,source.refresh.batchSize).map(item=>item.externalId);
        if(ids.length) {await this.enqueue({id:randomUUID(),sourceId:source.id,now,from:new Date(Date.parse(now)-source.refresh.afterHours*3600000).toISOString(),to:now,pageSize:ids.length,maxPages:1,purpose:"refresh",refreshIds:ids});count++;}
      }
    } return count;
  }
  private jobsHasChild(id:string) {return [...this.jobs.values()].some(item=>item.parentJobId===id);}
  async setProviderBudget(budget:SourceProviderBudget,now=new Date().toISOString()) {this.budgets.set(budget.provider,structuredClone(budget));if(budget.enabled)for(const item of this.jobs.values())if(item.status==="retrying"&&item.error?.startsWith("Provider budget")&&this.sources.get(item.sourceId)?.provider===budget.provider){item.nextRunAt=now;item.attempts=0;}return structuredClone(budget);}
  async providerUsage(now:string):Promise<SourceProviderUsage[]> { return [...new Set([...this.sources.values()].map(item=>item.provider).concat([...this.budgets.keys()]))].map(provider=>{const budget=this.budgets.get(provider)??defaultProviderBudget(provider),day=now.slice(0,10),month=now.slice(0,7),daily=this.usage.get(`${provider}:${day}`)??{requests:0,resources:0},monthly=[...this.usage.entries()].filter(([key])=>key.startsWith(`${provider}:${month}`)).reduce((sum,[,value])=>({requests:sum.requests+value.requests,resources:sum.resources+value.resources}),{requests:0,resources:0});return {provider,day,month,dailyRequests:daily.requests,monthlyRequests:monthly.requests,dailyResources:daily.resources,monthlyResources:monthly.resources,budget};}); }
  async reserveUsage(provider:string,resources:number,now:string) {if(!this.budgets.has(provider))this.budgets.set(provider,defaultProviderBudget(provider));const value=(await this.providerUsage(now)).find(item=>item.provider===provider)!,b=value.budget,allowed=b.enabled&&value.dailyRequests+1<=b.dailyRequests&&value.monthlyRequests+1<=b.monthlyRequests&&value.dailyResources+resources<=b.dailyResources&&value.monthlyResources+resources<=b.monthlyResources;if(allowed)this.usage.set(`${provider}:${now.slice(0,10)}`,{requests:value.dailyRequests+1,resources:value.dailyResources+resources});const monthBlocked=value.monthlyRequests+1>b.monthlyRequests||value.monthlyResources+resources>b.monthlyResources;const nextMonth=new Date(Date.UTC(Number(now.slice(0,4)),Number(now.slice(5,7)),1)).toISOString();return {allowed,retryAt:monthBlocked?nextMonth:nextUsageDay(now)};}
  async heartbeat(value:SourceWorkerHeartbeat) {this.workers.set(value.id,structuredClone(value));}
  async sourceOps(now:string):Promise<SourceOps> {const jobs=[...this.jobs.values()],age=(at:string|null)=>at?Math.max(0,(Date.parse(now)-Date.parse(at))/3600000):null;return {checkedAt:now,workers:[...this.workers.values()].map(value=>({...value,stale:value.state!=="stopped"&&Date.parse(now)-Date.parse(value.lastHeartbeatAt)>90000})),queue:[...new Set(jobs.map(item=>item.status))].map(status=>({status,count:jobs.filter(item=>item.status===status).length})),oldestQueuedAt:jobs.filter(activeJob).map(item=>item.createdAt).sort()[0]??null,sources:[...this.sources.values()].map(item=>({sourceId:item.id,state:item.state,lastSuccessAgeHours:age(item.lastSuccessAt),latestPublishedAgeHours:age(item.latestPublishedAt),coverage:item.coverage,nextDueAt:item.nextDueAt,activeJobs:jobs.filter(job=>job.sourceId===item.id&&activeJob(job)).length})),providers:await this.providerUsage(now)};}
  async failJob(claim: ClaimedSourceJob, error: string, retryAt: string | null, now: string,resetAttempts=false) {
    const current=this.jobs.get(claim.job.id); if (!current || this.leases.get(current.id)?.token!==claim.leaseToken) return;
    Object.assign(current,{status:retryAt ? "retrying" : "failed",error,nextRunAt:retryAt ?? now,finishedAt:retryAt ? null : now,attempts:resetAttempts?0:current.attempts}); this.leases.delete(current.id);
  }
  async recordRequestAttempt(claim:ClaimedSourceJob,durationMs:number) {const current=this.jobs.get(claim.job.id);if(!current||current.status!=="running"||this.leases.get(current.id)?.token!==claim.leaseToken)return;current.requestCount=(current.requestCount??0)+1;current.requestDurationMs=(current.requestDurationMs??0)+durationMs;}
  private filtered(query: ContentQuery) {
    return [...this.contents.values()].filter(item => (!query.platform || item.platform===query.platform) && (!query.kind || item.kind===query.kind)
      && (!query.query || `${item.title ?? ""} ${item.text ?? ""}`.toLowerCase().includes(query.query.toLowerCase()))
      && (!query.from || Boolean(item.publishedAt && item.publishedAt>=query.from)) && (!query.to || Boolean(item.publishedAt && item.publishedAt<query.to))
      && item.observations.some(obs=>(!query.sourceId || obs.sourceId===query.sourceId) && (!query.provider || obs.provider===query.provider)));
  }
  async listContent(query: ContentQuery) {
    const cursor=decodeContentCursor(query), limit=query.limit ?? 25;
    const rows=this.filtered(query).sort((a,b)=>(b.publishedAt ?? b.firstFetchedAt).localeCompare(a.publishedAt ?? a.firstFetchedAt) || b.id.localeCompare(a.id))
      .filter(item=>!cursor || (item.publishedAt ?? item.firstFetchedAt)<cursor.timestamp || (item.publishedAt ?? item.firstFetchedAt)===cursor.timestamp && item.id<cursor.id);
    const selected=rows.slice(0,limit), last=selected.at(-1);
    const items=selected.map(item=>({...item,observations:item.observations.filter(obs=>(!query.sourceId || obs.sourceId===query.sourceId) && (!query.provider || obs.provider===query.provider))}));
    return { items:structuredClone(items),nextCursor:rows.length>limit && last ? encodeContentCursor(query,last.publishedAt ?? last.firstFetchedAt,last.id) : null };
  }
  async contentStats(query: ContentQuery) {
    const rows=this.filtered(query), kinds=new Map<PublicContent["kind"],number>(), days=new Map<string,number>(); let unknownPublishedAtCount=0;
    for (const item of rows) { kinds.set(item.kind,(kinds.get(item.kind)??0)+1); if (item.publishedAt) { const day=item.publishedAt.slice(0,10); days.set(day,(days.get(day)??0)+1); } else unknownPublishedAtCount++; }
    return { total:rows.length,byKind:[...kinds].map(([kind,count])=>({kind,count})),daily:[...days].sort().map(([day,count])=>({day,count})),scope:"collected_content" as const,unknownPublishedAtCount };
  }
}
