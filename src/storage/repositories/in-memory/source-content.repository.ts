import { randomUUID } from "node:crypto";
import type { CollectionSource, ContentQuery, CreateCollectionSourceRequest, PublicContent, SourceCollectionJob, UpdateCollectionSourceRequest, SourceJobQuery, SourceProviderBudget, SourceProviderUsage, SourceWorkerHeartbeat, SourceOps } from "../../../../packages/contracts/src/source-content";
import type { CollectedPage } from "../../../connectors/shared/content-provider.interface";
import { SourceConfigurationConflictError,type ClaimedSourceJob,type SourceContentRepository,type SourceJobInput } from "../../../domain/repositories/source-content-repository";
import { decodeContentCursor, encodeContentCursor } from "../../source-content-query";
import { activeJob, backgroundJob, defaultProviderBudget, defaultSourceRefresh, defaultSourceSchedule, nextUsageDay, scheduledWindow, recheckWindow } from "../../source-lifecycle";
import { publicSearchDocument, matchesPublicSearch, hasPublicSearch, searchCoverage, type PublicSearchDocument } from "../../../domain/public-content-search";
import { SourceContentError } from "../../../domain/source-content-error";

/** Offline/test adapter; live runtimes always use PostgreSQL. */
export class InMemorySourceContentRepository implements SourceContentRepository {
  private sources = new Map<string, CollectionSource>();
  private jobs = new Map<string, SourceCollectionJob>();
  private leases = new Map<string, { token: string; until: string }>();
  private contents = new Map<string, PublicContent>();
  private contentVersions = new Map<string,string|null>();
  private budgets = new Map<string,SourceProviderBudget>();
  private usage = new Map<string,{requests:number;resources:number}>();
  private workers = new Map<string,SourceWorkerHeartbeat>();
  private refreshes = new Map<string,{attempts:number;at:string}>();
  private refreshRoundStarts = new Map<string,string>();
  private pageRequestAttempts = new Map<string,number>();
  private claims=0;
  private lastReservations=new Map<string,string>();
  private searchDocuments=new Map<string,PublicSearchDocument>();
  /** Synchronous isolated read view for offline research snapshots. */
  snapshotForResearch(){const copy=new InMemorySourceContentRepository();copy.sources=structuredClone(this.sources);copy.contents=structuredClone(this.contents);copy.contentVersions=structuredClone(this.contentVersions);copy.searchDocuments=structuredClone(this.searchDocuments);return copy;}
  async listSources(ids?: readonly string[]) {
    const selected = ids ? new Set(ids) : null;
    const sources = [...this.sources.values()];
    return structuredClone(selected ? sources.filter(source => selected.has(source.id)) : sources);
  }
  async getSource(id: string) { return structuredClone(this.sources.get(id) ?? null); }
  async createSource(input: CreateCollectionSourceRequest & { id: string; label: string; createdAt: string }) {
    const existing = [...this.sources.values()].find(item => item.platform===input.platform && item.provider===input.provider && item.contentKind===input.contentKind && JSON.stringify(item.target)===JSON.stringify(input.target));
    if (existing) { existing.label=input.label;existing.updatedAt=input.createdAt;existing.revision=(existing.revision??1)+1; return structuredClone(existing); }
    const value: CollectionSource = { ...input, lastSuccessAt:null,latestPublishedAt:null,coverage:"unknown",state:"active",group:null,updatedAt:input.createdAt,schedule:defaultSourceSchedule(),refresh:defaultSourceRefresh(),nextDueAt:null,incrementalTo:null,nextRecheckAt:new Date(Date.parse(input.createdAt)+21600000).toISOString(),revision:1,automaticCollectionBlocked:false };
    this.sources.set(value.id,value); return structuredClone(value);
  }
  async updateSource(id: string, changes: UpdateCollectionSourceRequest, now: string) { const value=this.sources.get(id); if(!value||changes.expectedRevision!==undefined&&changes.expectedRevision!==(value.revision??1))return null;const {expectedRevision:_expected,...patch}=changes; Object.assign(value,{...patch,schedule:{...value.schedule,...changes.schedule},refresh:{...value.refresh,...changes.refresh},updatedAt:now,revision:(value.revision??1)+1}); if(changes.schedule){value.nextDueAt=value.schedule.enabled ? now : null;if(value.schedule.enabled&&(value.schedule.initialLookbackHours>value.schedule.maxCatchupHours||Object.hasOwn(changes.schedule,"recheckLookbackHours")||Object.hasOwn(changes.schedule,"recheckCadenceSeconds")))value.nextRecheckAt=now;} return structuredClone(value); }
  async setSourceState(id: string,state:CollectionSource["state"],now:string,expectedRevision?:number) { const value=this.sources.get(id);if(!value||expectedRevision!==undefined&&expectedRevision!==(value.revision??1))return null;value.state=state;value.updatedAt=now;value.revision=(value.revision??1)+1;value.nextDueAt=state==="active"&&value.schedule.enabled?now:null;if(state!=="active")for(const job of this.jobs.values())if(job.sourceId===id&&activeJob(job))await this.cancelJob(job.id,now);return structuredClone(value); }
  async enqueue(input: SourceJobInput) {
    const origin=this.sources.get(input.sourceId);if(!origin||origin.state!=="active"||origin.automaticCollectionBlocked)throw new SourceContentError("Source must be active and unblocked to enqueue; Retry its failed job", "conflict");
    const purpose=input.purpose??"manual",values=[...this.jobs.values()].filter(item => item.sourceId===input.sourceId && activeJob(item)),existing=values.find(item=>item.purpose===purpose)??(purpose==="manual"?values[0]:undefined);
    if (existing) return structuredClone(existing);
    const value: SourceCollectionJob = { id:input.id,sourceId:input.sourceId,from:input.from,to:input.to,pageSize:input.pageSize,maxPages:input.maxPages,status:"queued",pagesCommitted:0,recordsProcessed:0,recordsInserted:0,recordsUpdated:0,requestCount:0,requestDurationMs:0,failureKind:null,purpose:input.purpose??"manual",parentJobId:input.parentJobId??null,refreshIds:input.refreshIds??[],checkpoint:null,coverage:"unknown",exhausted:false,attempts:0,error:null,nextRunAt:input.now,createdAt:input.now,finishedAt:null };
    this.jobs.set(value.id,value); return structuredClone(value);
  }
  async getJob(id: string) { return structuredClone(this.jobs.get(id) ?? null); }
  async listJobs(query:SourceJobQuery) { return structuredClone([...this.jobs.values()].filter(item=>(!query.sourceId||item.sourceId===query.sourceId)&&(!query.status||item.status===query.status)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id)).slice(0,query.limit??50)); }
  async cancelJob(id:string,now:string) { const value=this.jobs.get(id);if(!value||!activeJob(value))return null;Object.assign(value,{status:"cancelled",finishedAt:now,error:"Cancelled by source lifecycle or user"});this.leases.delete(id);return structuredClone(value); }
  async retryJob(id: string, now: string) {
    const current = this.jobs.get(id);
    const origin=current&&this.sources.get(current.sourceId);
    if (!current || !origin || origin.state!=="active" || current.status!=="failed" || [...this.jobs.values()].some(item => item.sourceId===current.sourceId && item.purpose===current.purpose&&activeJob(item))) return null;
    Object.assign(current,{ status:"queued",attempts:0,error:null,failureKind:null,nextRunAt:now,finishedAt:null });this.refreshRoundStarts.delete(id);this.pageRequestAttempts.delete(id);origin.automaticCollectionBlocked=false; return structuredClone(current);
  }
  async claim(now: string): Promise<ClaimedSourceJob | null> {
    const backgroundTurn=(this.claims+1)%4===0,priority=(item:SourceCollectionJob)=>item.status==="running"?-1:backgroundJob(item)===backgroundTurn?0:1;
    const current = [...this.jobs.values()].filter(item=>this.sources.get(item.sourceId)?.state==="active"&&!this.sources.get(item.sourceId)?.automaticCollectionBlocked&&![...this.jobs.values()].some(other=>other.sourceId===item.sourceId&&other.id!==item.id&&other.status==="running")).sort((a,b)=>priority(a)-priority(b)||a.nextRunAt.localeCompare(b.nextRunAt)||a.id.localeCompare(b.id)).find(item => ["queued","retrying"].includes(item.status) && item.nextRunAt<=now || item.status==="running" && (this.leases.get(item.id)?.until ?? "")<=now);
    if (!current) return null;
    this.claims++;current.status="running"; current.attempts++;
    const token=randomUUID(); this.leases.set(current.id,{ token,until:new Date(Date.parse(now)+120000).toISOString() });
    return { job:structuredClone(current),leaseToken:token,pageRequestAttempts:this.pageRequestAttempts.get(current.id)??0 };
  }
  async continueJob(id: string, newId: string, now: string) {
    const previous=this.jobs.get(id); if (!previous || previous.status!=="succeeded" || previous.checkpoint===null || this.sources.get(previous.sourceId)?.state!=="active" || this.sources.get(previous.sourceId)?.automaticCollectionBlocked) return null;
    const active=[...this.jobs.values()].find(item=>item.sourceId===previous.sourceId && item.purpose===previous.purpose&&activeJob(item)); if (active) return active.parentJobId===previous.id ? structuredClone(active) : null;
    const next:SourceCollectionJob={...structuredClone(previous),id:newId,parentJobId:previous.id,status:"queued",pagesCommitted:0,recordsProcessed:0,recordsInserted:0,recordsUpdated:0,requestCount:0,requestDurationMs:0,attempts:0,error:null,nextRunAt:now,createdAt:now,finishedAt:null};
    this.jobs.set(newId,next); return structuredClone(next);
  }
  async beginRequestAttempt(claim:ClaimedSourceJob,now:string) {
    const current=this.jobs.get(claim.job.id),origin=current&&this.sources.get(current.sourceId);
    if(!current||!origin||origin.state!=="active"||origin.automaticCollectionBlocked||current.status!=="running"||this.leases.get(current.id)?.token!==claim.leaseToken)return null;
    if((this.pageRequestAttempts.get(current.id)??0)>=3){Object.assign(current,{status:"failed",failureKind:"transient",error:"Page request attempt limit reached after interruption; Retry or the next eligible automatic round can resume the checkpoint",nextRunAt:now,finishedAt:now});this.leases.delete(current.id);return null;}
    if(current.purpose==="refresh"&&!this.refreshRoundStarts.has(current.id)){
      for(const item of this.contents.values())if(current.refreshIds.includes(item.externalId)&&item.observations.some(obs=>obs.sourceId===origin.id)){
        const key=`${origin.id}:${item.id}`,previous=this.refreshes.get(key);this.refreshes.set(key,{attempts:(previous?.attempts??0)+1,at:now});
      }
      this.refreshRoundStarts.set(current.id,now);
    }
    const attempts=(this.pageRequestAttempts.get(current.id)??0)+1;this.pageRequestAttempts.set(current.id,attempts);return attempts;
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
      const observed=item.observation.sourceObservedAt,version=this.contentVersions.get(item.id);
      const replace=!existing||Boolean(observed&&(!version||observed>=version))||!observed&&!version&&item.fetchedAt>=existing.lastFetchedAt;
      const replaceObservation=!previous||Boolean(item.observation.sourceObservedAt&&(!previous.sourceObservedAt||item.observation.sourceObservedAt>=previous.sourceObservedAt))||!previous.sourceObservedAt&&!item.observation.sourceObservedAt&&item.fetchedAt>=previous.fetchedAt;
      const observations=existing?.observations.filter(obs=>obs.sourceId!==origin.id) ?? [];
      observations.push(replaceObservation ? item.observation : previous!);
      const { fetchedAt, observation: _observation, ...fields } = item;
      const lastFetchedAt=existing&&existing.lastFetchedAt>fetchedAt?existing.lastFetchedAt:fetchedAt;
      const content: PublicContent = existing && !replace ? { ...existing,language:existing.language ?? fields.language,publishedAt:existing.publishedAt ?? fields.publishedAt,lastFetchedAt,observations } : { ...fields,language:existing?.language??fields.language,publishedAt:existing?.publishedAt??fields.publishedAt,firstFetchedAt:existing?.firstFetchedAt ?? fetchedAt,lastFetchedAt,observations };
      this.contents.set(item.id,structuredClone(content));
      this.searchDocuments.set(item.id,publicSearchDocument(content.title,content.text,now));
      if(replace)this.contentVersions.set(item.id,observed);
    }
    current.recordsInserted+=inserted;current.recordsUpdated+=updated;
    current.pagesCommitted++; current.recordsProcessed+=page.items.length; current.checkpoint=page.nextCheckpoint; current.exhausted=page.exhausted;
    current.coverage=page.exhausted && page.coverage!=="partial" ? "unknown" : "partial"; current.error=page.warning; current.attempts=0;
    current.failureKind=null;this.pageRequestAttempts.delete(current.id);
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
      if(count>=limit||source.state!=="active"||source.automaticCollectionBlocked||enabledProviders&&!enabledProviders.includes(`${source.platform}:${source.provider}`))continue;
      for(const purpose of ["scheduled","recheck"] as const){const due=purpose==="scheduled"?source.nextDueAt:source.nextRecheckAt;
      if(count<limit&&source.schedule.enabled&&(purpose!=="recheck"||(source.schedule.recheckLookbackHours??12)>0)&&(!due||due<=now)&&![...this.jobs.values()].some(item=>item.sourceId===source.id&&item.purpose===purpose&&activeJob(item))) {
        const previous=[...this.jobs.values()].filter(item=>item.sourceId===source.id&&item.purpose===purpose&&(item.status==="failed"&&item.failureKind==="transient"||item.status==="succeeded"&&item.checkpoint!==null)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).find(item=>!this.jobsHasChild(item.id));
        const window=previous?{from:previous.from,to:previous.to}:purpose==="scheduled"?scheduledWindow(source,now):recheckWindow(source,now);if(window.from>=window.to)continue;
        const queued=await this.enqueue({id:randomUUID(),sourceId:source.id,now,...window,pageSize:source.schedule.pageSize,maxPages:source.schedule.maxPages,purpose,parentJobId:previous?.id??null});if(previous)this.jobs.get(queued.id)!.checkpoint=structuredClone(previous.checkpoint);
        const next=new Date(Date.parse(now)+(purpose==="scheduled"?source.schedule.cadenceSeconds:source.schedule.recheckCadenceSeconds??21600)*1000).toISOString();purpose==="scheduled"?source.nextDueAt=next:source.nextRecheckAt=next;count++;
      }}
      if(count<limit&&source.refresh.enabled&&refreshProviders.includes(source.provider)&&![...this.jobs.values()].some(item=>item.sourceId===source.id&&item.purpose==="refresh"&&activeJob(item))) {
        const ids=[...this.contents.values()].filter(item=>{const obs=item.observations.find(value=>value.sourceId===source.id),previous=this.refreshes.get(`${source.id}:${item.id}`);return obs?.maturity==="initial"&&item.publishedAt&&Date.parse(item.publishedAt)<=Date.parse(now)-source.refresh.afterHours*3600000&&(previous?.attempts??0)<source.refresh.maxAttempts&&(!previous||Date.parse(previous.at)<=Date.parse(now)-source.refresh.minIntervalHours*3600000);}).slice(0,source.refresh.batchSize).map(item=>item.externalId);
        if(ids.length) {await this.enqueue({id:randomUUID(),sourceId:source.id,now,from:new Date(Date.parse(now)-source.refresh.afterHours*3600000).toISOString(),to:now,pageSize:ids.length,maxPages:1,purpose:"refresh",refreshIds:ids});count++;}
      }
    } return count;
  }
  private jobsHasChild(id:string) {return [...this.jobs.values()].some(item=>item.parentJobId===id);}
  async setProviderBudget(budget:SourceProviderBudget,now=new Date().toISOString(),expectedRevision?:number) {const previous=this.budgets.get(budget.provider);if(expectedRevision!==undefined&&expectedRevision!==(previous?.revision??0))throw new SourceConfigurationConflictError();const value={...budget,minimumIntervalMs:budget.minimumIntervalMs??previous?.minimumIntervalMs??0,revision:previous?(previous.revision??1)+1:1};this.budgets.set(budget.provider,structuredClone(value));if(budget.enabled)for(const item of this.jobs.values())if(item.status==="retrying"&&(item.error?.startsWith("Provider budget")||item.error?.startsWith("Provider request spacing"))&&this.sources.get(item.sourceId)?.provider===budget.provider){item.nextRunAt=now;item.attempts=0;}return structuredClone(value);}
  private usageFor(provider:string,now:string):SourceProviderUsage {const budget=this.budgets.get(provider)??defaultProviderBudget(provider),day=now.slice(0,10),month=now.slice(0,7),daily=this.usage.get(`${provider}:${day}`)??{requests:0,resources:0},monthly=[...this.usage.entries()].filter(([key])=>key.startsWith(`${provider}:${month}`)).reduce((sum,[,value])=>({requests:sum.requests+value.requests,resources:sum.resources+value.resources}),{requests:0,resources:0});return {provider,day,month,dailyRequests:daily.requests,monthlyRequests:monthly.requests,dailyResources:daily.resources,monthlyResources:monthly.resources,budget,lastReservationAt:this.lastReservations.get(provider)??null};}
  async providerUsage(now:string):Promise<SourceProviderUsage[]> {return [...new Set([...this.sources.values()].map(item=>item.provider).concat([...this.budgets.keys()]))].map(provider=>this.usageFor(provider,now));}
  async reserveUsage(provider:string,resources:number,now:string) {if(!this.budgets.has(provider))this.budgets.set(provider,{...defaultProviderBudget(provider),revision:1});const value=this.usageFor(provider,now),b=value.budget,nextRequest=new Date(Date.parse(this.lastReservations.get(provider)??now)+(b.minimumIntervalMs??0)).toISOString();if(b.enabled&&this.lastReservations.has(provider)&&nextRequest>now)return {allowed:false,retryAt:nextRequest,reason:"interval" as const};const allowed=b.enabled&&value.dailyRequests+1<=b.dailyRequests&&value.monthlyRequests+1<=b.monthlyRequests&&value.dailyResources+resources<=b.dailyResources&&value.monthlyResources+resources<=b.monthlyResources;if(allowed){this.usage.set(`${provider}:${now.slice(0,10)}`,{requests:value.dailyRequests+1,resources:value.dailyResources+resources});this.lastReservations.set(provider,now);}const monthBlocked=value.monthlyRequests+1>b.monthlyRequests||value.monthlyResources+resources>b.monthlyResources;const nextMonth=new Date(Date.UTC(Number(now.slice(0,4)),Number(now.slice(5,7)),1)).toISOString();return {allowed,retryAt:monthBlocked?nextMonth:nextUsageDay(now),reason:allowed?undefined:"budget" as const};}
  async heartbeat(value:SourceWorkerHeartbeat) {this.workers.set(value.id,structuredClone(value));}
  async sourceOps(now:string):Promise<SourceOps> {const jobs=[...this.jobs.values()],age=(at:string|null)=>at?Math.max(0,(Date.parse(now)-Date.parse(at))/3600000):null;return {checkedAt:now,workers:[...this.workers.values()].map(value=>({...value,stale:value.state!=="stopped"&&Date.parse(now)-Date.parse(value.lastHeartbeatAt)>90000})),queue:[...new Set(jobs.map(item=>item.status))].map(status=>({status,count:jobs.filter(item=>item.status===status).length})),oldestQueuedAt:jobs.filter(activeJob).map(item=>item.createdAt).sort()[0]??null,sources:[...this.sources.values()].map(item=>({sourceId:item.id,state:item.state,lastSuccessAgeHours:age(item.lastSuccessAt),latestPublishedAgeHours:age(item.latestPublishedAt),coverage:item.coverage,nextDueAt:item.nextDueAt,activeJobs:jobs.filter(job=>job.sourceId===item.id&&activeJob(job)).length,oldestPendingAt:jobs.filter(job=>job.sourceId===item.id&&["queued","retrying"].includes(job.status)).map(job=>job.createdAt).sort()[0]??null})),providers:await this.providerUsage(now),recentFailures:jobs.filter(item=>item.status==="failed").sort((a,b)=>(b.finishedAt??b.createdAt).localeCompare(a.finishedAt??a.createdAt)||b.id.localeCompare(a.id)).slice(0,20).map(item=>({jobId:item.id,sourceId:item.sourceId,error:item.error??"Collection failed",finishedAt:item.finishedAt})),requests:{registeredCount:jobs.reduce((sum,item)=>sum+(item.requestCount??0),0),totalDurationMs:jobs.reduce((sum,item)=>sum+(item.requestDurationMs??0),0),scope:"retained_jobs"}};}
  async failJob(claim: ClaimedSourceJob, error: string, retryAt: string | null, now: string,resetAttempts=false,failureKind:SourceCollectionJob["failureKind"]=retryAt?"transient":"permanent") {
    const current=this.jobs.get(claim.job.id); if (!current || this.leases.get(current.id)?.token!==claim.leaseToken) return;
    Object.assign(current,{status:retryAt ? "retrying" : "failed",error,failureKind,nextRunAt:retryAt ?? now,finishedAt:retryAt ? null : now,attempts:resetAttempts?0:current.attempts});if(failureKind==="permanent")this.sources.get(current.sourceId)!.automaticCollectionBlocked=true;this.leases.delete(current.id);
  }
  async recordRequestAttempt(claim:ClaimedSourceJob,durationMs:number) {const current=this.jobs.get(claim.job.id);if(!current||current.status!=="running"||this.leases.get(current.id)?.token!==claim.leaseToken)return;current.requestCount=(current.requestCount??0)+1;current.requestDurationMs=(current.requestDurationMs??0)+durationMs;}
  private filtered(query: ContentQuery,includeSearch=true) {
    return [...this.contents.values()].filter(item => (!query.platform || item.platform===query.platform) && (!query.kind || item.kind===query.kind)
      && (!includeSearch||!hasPublicSearch(query)||Boolean(this.searchDocuments.get(item.id)&&matchesPublicSearch(this.searchDocuments.get(item.id)!,query)))
      && (!query.from || Boolean(item.publishedAt && item.publishedAt>=query.from)) && (!query.to || Boolean(item.publishedAt && item.publishedAt<query.to))
      && (!query.author||[item.author?.handle,item.author?.externalId].some(value=>value?.toLowerCase()===query.author!.toLowerCase()))&&(!query.language||item.language?.toLowerCase()===query.language.toLowerCase())
      && item.observations.some(obs=>this.matchesObservation(obs,query))&&(!query.metricKey||item.platform===query.metricKey.split(".")[0]&&item.observations.filter(obs=>this.matchesObservation(obs,query)).some(obs=>{const value=obs.metrics[query.metricKey!];return typeof value==="number"&&(query.minMetric===undefined||value>=query.minMetric)&&(query.maxMetric===undefined||value<=query.maxMetric);}))) ;
  }
  private matchesObservation(obs:PublicContent["observations"][number],query:ContentQuery){return (!query.sourceId||obs.sourceId===query.sourceId)&&(!query.provider||obs.provider===query.provider)&&(!query.sourceGroup||this.sources.get(obs.sourceId)?.group===query.sourceGroup);}
  async listContent(query: ContentQuery) {
    const coverage=this.coverageFor(query);if(hasPublicSearch(query)&&coverage.unindexed)throw new SourceContentError("Public search coverage is incomplete; run the explicit bounded public-index backfill before searching", "unavailable");
    const cursor=decodeContentCursor(query), limit=query.limit ?? 25;
    const direction=query.sort==="published_asc"?1:-1;
    const rows=this.filtered(query).sort((a,b)=>direction*((a.publishedAt ?? a.firstFetchedAt).localeCompare(b.publishedAt ?? b.firstFetchedAt)||a.id.localeCompare(b.id)))
      .filter(item=>!cursor||direction*((item.publishedAt??item.firstFetchedAt).localeCompare(cursor.timestamp)||item.id.localeCompare(cursor.id))>0);
    const selected=rows.slice(0,limit), last=selected.at(-1);
    const items=selected.map(item=>({...item,observations:item.observations.filter(obs=>this.matchesObservation(obs,query))}));
    return { items:structuredClone(items),nextCursor:rows.length>limit && last ? encodeContentCursor(query,last.publishedAt ?? last.firstFetchedAt,last.id) : null,searchCoverage:coverage };
  }
  async getContent(id:string){return structuredClone(this.contents.get(id)??null);}
  async findContentsByIdentity(platform: PublicContent["platform"], identities: readonly Pick<PublicContent, "kind" | "externalId">[]) {
    if (identities.length === 0) return [];
    const wanted = new Map<PublicContent["kind"], Set<string>>();
    for (const { kind, externalId } of identities) {
      if (!wanted.has(kind)) wanted.set(kind, new Set());
      wanted.get(kind)!.add(externalId);
    }
    const found: PublicContent[] = [];
    for (const content of this.contents.values()) {
      if (content.platform === platform && wanted.get(content.kind)?.delete(content.externalId)) found.push(content);
    }
    return structuredClone(found);
  }
  async relatedChildren(content:PublicContent,limit:number){return structuredClone([...this.contents.values()].filter(item=>item.id!==content.id&&item.platform===content.platform&&item.references.some(reference=>["reply_to","thread_root"].includes(reference.relation)&&reference.kind===content.kind&&reference.externalId===content.externalId)).sort((a,b)=>(b.publishedAt??b.firstFetchedAt).localeCompare(a.publishedAt??a.firstFetchedAt)||b.id.localeCompare(a.id)).slice(0,limit));}
  async contentStats(query: ContentQuery) {
    const coverage=this.coverageFor(query);if(hasPublicSearch(query)&&coverage.unindexed)throw new SourceContentError("Public search coverage is incomplete; run the explicit bounded public-index backfill before searching", "unavailable");
    const rows=this.filtered(query), kinds=new Map<PublicContent["kind"],number>(), days=new Map<string,number>(); let unknownPublishedAtCount=0;
    for (const item of rows) { kinds.set(item.kind,(kinds.get(item.kind)??0)+1); if (item.publishedAt) { const day=item.publishedAt.slice(0,10); days.set(day,(days.get(day)??0)+1); } else unknownPublishedAtCount++; }
    return { total:rows.length,byKind:[...kinds].map(([kind,count])=>({kind,count})),daily:[...days].sort().map(([day,count])=>({day,count})),scope:"collected_content" as const,unknownPublishedAtCount,searchCoverage:coverage };
  }
  private coverageFor(query:ContentQuery){const rows=this.filtered(query,false);return searchCoverage(rows.length,rows.map(item=>this.searchDocuments.get(item.id)).filter((item):item is PublicSearchDocument=>Boolean(item)));}
  async searchCoverage(contentIds:readonly string[]){const rows=[...new Set(contentIds)].filter(id=>this.contents.has(id));return searchCoverage(rows.length,rows.map(id=>this.searchDocuments.get(id)).filter((item):item is PublicSearchDocument=>Boolean(item)));}
  private researchScope(query:ContentQuery){
    const coverage=this.coverageFor(query);if(hasPublicSearch(query)&&coverage.unindexed)throw new SourceContentError("Public search coverage is incomplete; run the explicit bounded public-index backfill before searching", "unavailable");
    const rows=this.filtered(query),sourceIds=new Set(rows.flatMap(item=>item.observations.filter(obs=>this.matchesObservation(obs,query)).map(obs=>obs.sourceId)));
    return {rows,sources:[...this.sources.values()].filter(source=>sourceIds.has(source.id))};
  }
  async researchPayloadPreflight(query:ContentQuery){
    // This is synchronous on the research snapshot clone before the first await.
    const {rows,sources}=this.researchScope(query);
    const contentBytes=rows.reduce((sum,item)=>sum+Buffer.byteLength(JSON.stringify({...item,observations:item.observations.filter(obs=>this.matchesObservation(obs,query))}),"utf8")+2,2);
    const sourceBytes=sources.reduce((sum,item)=>sum+Buffer.byteLength(JSON.stringify(item),"utf8")+2,2);
    return {total:rows.length,contentBytes,sourceCount:sources.length,sourceBytes};
  }
  async listSourcesForResearch(query:ContentQuery){return structuredClone(this.researchScope(query).sources);}
}
