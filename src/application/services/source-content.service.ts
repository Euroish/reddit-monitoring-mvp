import { randomUUID } from "node:crypto";
import type { CollectionSource, ContentPlatform, ContentQuery, CreateCollectionSourceRequest, PublicContentKind, SourceCollectionJob, StartSourceCollectionRequest, UpdateCollectionSourceRequest, SourceJobQuery, SourceProviderBudgetRequest, SourceWorkerHeartbeat } from "../../../packages/contracts/src/source-content";
import { ContentProviderError, type ContentProvider } from "../../connectors/shared/content-provider.interface";
import { SourceConfigurationConflictError,type SourceContentRepository } from "../../domain/repositories/source-content-repository";
import { normalizePublicSearchText } from "../../domain/public-content-search";
import { SourceContentError } from "../../domain/source-content-error";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function requireSourceId(value: string): string { if (!uuid.test(value)) throw new SourceContentError("Invalid source/job identifier"); return value; }
function date(value: unknown, fallback: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new SourceContentError("Invalid date; use an ISO timestamp");
  return new Date(value).toISOString();
}
function integer(value: unknown, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > max) throw new SourceContentError(`Expected integer from 1 to ${max}`);
  return value;
}
function revision(value:unknown,allowZero=false):number|undefined {if(value===undefined)return undefined;if(typeof value!=="number"||!Number.isSafeInteger(value)||value<(allowZero?0:1)||value>2147483646)throw new SourceContentError("Invalid expectedRevision");return value;}
const kinds: PublicContentKind[] = ["post", "comment", "article", "image", "video"];
const platforms: ContentPlatform[] = ["reddit", "x", "instagram", "web"];

export class SourceContentService {
  private readonly providers: readonly ContentProvider[];
  lastWorkedJobId:string|null=null;
  constructor(readonly repository: SourceContentRepository, providers: ContentProvider | readonly ContentProvider[], private readonly now = () => new Date().toISOString()) {
    this.providers = Array.isArray(providers) ? providers : [providers as ContentProvider];
    if (new Set(this.providers.map(item => `${item.capability.platform}:${item.capability.provider}`)).size !== this.providers.length) throw new Error("Duplicate platform/provider registration");
  }
  capabilities() { return this.providers.map(provider => provider.capability); }
  private providerFor(platform: string, provider: string) { return this.providers.find(item => item.capability.platform===platform && item.capability.provider===provider && item.capability.enabled); }

  async createSource(input: CreateCollectionSourceRequest): Promise<CollectionSource> {
    if (!input || typeof input !== "object") throw new SourceContentError("Invalid source configuration");
    const provider = this.providerFor(input.platform,input.provider);
    if (!provider) throw new SourceContentError("This platform/provider is not enabled");
    if (!provider.capability.contentKinds.includes(input.contentKind)) throw new SourceContentError("Content kind is not supported by this provider");
    let normalizedTarget: CollectionSource["target"];
    try { normalizedTarget = provider.normalizeTarget(input.target,input.contentKind); }
    catch (error) { if (error instanceof ContentProviderError) throw new SourceContentError(error.message); throw error; }
    if (input.label !== undefined && (typeof input.label !== "string" || input.label.trim().length > 100)) throw new SourceContentError("Label must be at most 100 characters");
    const name = Object.values(normalizedTarget).filter(value => typeof value === "string").slice(1,2).join("");
    const scopedQuery = "query" in normalizedTarget && normalizedTarget.type !== "search" ? normalizedTarget.query : undefined;
    const label = input.label?.trim() || `${name} · ${input.contentKind}${scopedQuery ? ` · ${scopedQuery}` : ""}`.slice(0,100);
    return this.repository.createSource({ id: randomUUID(), platform: input.platform, provider: input.provider, contentKind: input.contentKind, label, target: normalizedTarget, createdAt: this.now() });
  }
  async updateSource(id:string,input:UpdateCollectionSourceRequest) {
    const current=await this.repository.getSource(requireSourceId(id));if(!current)throw new SourceContentError("Source not found", "not_found");
    if(!input||typeof input!=="object"||Array.isArray(input))throw new SourceContentError("Invalid source update");
    if(Object.keys(input).some(key=>!["label","group","schedule","refresh","expectedRevision"].includes(key)))throw new SourceContentError("Only label, group, schedule and refresh can be edited; create a new source for a different identity");
    revision(input.expectedRevision);
    if(input.label!==undefined&&(typeof input.label!=="string"||!input.label.trim()||input.label.trim().length>100))throw new SourceContentError("Label must contain 1–100 characters");
    if(input.group!==undefined&&input.group!==null&&(typeof input.group!=="string"||input.group.trim().length>100))throw new SourceContentError("Group must be at most 100 characters");
    const checks=[{key:"schedule" as const,settings:input.schedule,limits:{cadenceSeconds:[60,86400],overlapSeconds:[0,86400],initialLookbackHours:[1,8760],maxCatchupHours:[1,168],pageSize:[1,100],maxPages:[1,20],recheckLookbackHours:[0,168],recheckCadenceSeconds:[60,86400]}},{key:"refresh" as const,settings:input.refresh,limits:{afterHours:[1,8760],minIntervalHours:[1,720],maxAttempts:[1,20],batchSize:[1,100]}}];
    for(const {settings,limits} of checks) {
      if(settings===undefined)continue;if(!settings||typeof settings!=="object"||Array.isArray(settings))throw new SourceContentError("Invalid schedule/refresh settings");
      for(const [key,value] of Object.entries(settings)){if(key==="enabled"){if(typeof value!=="boolean")throw new SourceContentError("enabled must be boolean");continue;}const range=limits[key as keyof typeof limits] as number[]|undefined;if(!range||typeof value!=="number"||!Number.isInteger(value)||value<range[0]!||value>range[1]!)throw new SourceContentError(`Invalid ${key} setting`);}
    }
    if(input.refresh?.enabled){const provider=this.providerFor(current.platform,current.provider);if(!provider?.refreshIds)throw new SourceContentError("Provider does not support refresh by IDs");if(provider.capability.observationModel!=="archive")throw new SourceContentError("Automatic maturity refresh supports archive observations only; snapshot ID refresh is an adapter capability, not an automatic schedule");}
    if(input.schedule?.enabled&&!this.providerFor(current.platform,current.provider))throw new SourceContentError("Provider is not enabled for scheduling");
    const changes:UpdateCollectionSourceRequest={...input};if(input.label!==undefined)changes.label=input.label.trim();if(input.group!==undefined)changes.group=input.group===null?null:input.group.trim()||null;
    const result=await this.repository.updateSource(id,changes,this.now());if(!result)throw new SourceContentError("Source configuration changed; reload it before retrying", "conflict");return result;
  }
  async setSourceState(id:string,state:CollectionSource["state"],expectedRevision?:number) {revision(expectedRevision);const result=await this.repository.setSourceState(requireSourceId(id),state,this.now(),expectedRevision);if(!result){if(expectedRevision!==undefined&&await this.repository.getSource(id))throw new SourceContentError("Source configuration changed; reload it before retrying", "conflict");throw new SourceContentError("Source not found", "not_found");}return result;}

  async enqueue(sourceId: string, input: StartSourceCollectionRequest = {}): Promise<SourceCollectionJob> {
    requireSourceId(sourceId);
    if (!input || typeof input !== "object") throw new SourceContentError("Invalid collection request");
    const source = await this.repository.getSource(sourceId);
    if (!source) throw new SourceContentError("Source not found", "not_found");
    if(source.state!=="active")throw new SourceContentError("Paused or archived sources cannot collect; resume the source first", "conflict");
    if(source.automaticCollectionBlocked)throw new SourceContentError("Collection is blocked by a permanent failure; correct its cause and Retry the failed job", "conflict");
    if (!this.providerFor(source.platform,source.provider)) throw new SourceContentError("This platform/provider is not enabled for collection");
    const now = this.now(), to = date(input.to, now), from = date(input.from, new Date(Date.parse(to) - 86400000).toISOString());
    if (Date.parse(from) >= Date.parse(to) || Date.parse(to) > Date.parse(now) + 60_000) throw new SourceContentError("Collection window must be ordered and must not be in the future");
    const pageSize = integer(input.pageSize,25,100), maxPages = integer(input.maxPages,5,20);
    const queued = await this.repository.enqueue({ id: randomUUID(), sourceId, now, from, to, pageSize, maxPages });
    if (queued.purpose !== "manual" || queued.from !== from || queued.to !== to || queued.pageSize !== pageSize || queued.maxPages !== maxPages) throw new SourceContentError("Source is already collecting a different window or page budget; wait for that job to finish", "conflict");
    return queued;
  }
  normalizeQuery(input: ContentQuery): ContentQuery {
    if(!input||typeof input!=="object"||Array.isArray(input))throw new SourceContentError("Invalid content query");
    if (input.platform && !platforms.includes(input.platform)) throw new SourceContentError("Invalid platform filter");
    if (input.kind && !kinds.includes(input.kind)) throw new SourceContentError("Invalid kind filter");
    if (input.sourceId) requireSourceId(input.sourceId);
    if (input.provider && !/^[a-z0-9_]{1,60}$/.test(input.provider)) throw new SourceContentError("Invalid provider filter");
    if (input.query !== undefined && (typeof input.query !== "string" || input.query.length > 200||/[\u0000-\u0008\u000e-\u001f\u007f]/.test(input.query))) throw new SourceContentError("Search text must be at most 200 characters without non-whitespace control characters");
    for(const key of ["author","language","sourceGroup"] as const)if(input[key]!==undefined&&(typeof input[key]!=="string"||input[key]!.length>(key==="language"?40:100)||/[\u0000-\u001f]/.test(input[key]!)))throw new SourceContentError(`Invalid ${key} filter`);
    if(input.sort!==undefined&&!["published_desc","published_asc"].includes(input.sort))throw new SourceContentError("Invalid content sort");
    if(input.searchMode!==undefined&&!["literal","terms","phrase"].includes(input.searchMode))throw new SourceContentError("Invalid searchMode");
    if(input.searchScope!==undefined&&!["title","text","title_text"].includes(input.searchScope))throw new SourceContentError("Invalid searchScope");
    if(input.exclusions!==undefined&&(!Array.isArray(input.exclusions)||input.exclusions.length>10||input.exclusions.some(value=>typeof value!=="string"||value.length>200||/[\u0000-\u0008\u000e-\u001f\u007f]/.test(value)||!normalizePublicSearchText(value))))throw new SourceContentError("exclusions accepts at most 10 nonempty literal phrases of at most 200 characters");
    if(input.metricKey!==undefined&&(!/^(reddit|x|instagram|web)\.[a-z0-9_]{1,50}$/.test(input.metricKey)||input.platform&&input.metricKey.split(".")[0]!==input.platform))throw new SourceContentError("Metric key must be namespaced to the selected platform");
    for(const key of ["minMetric","maxMetric"] as const)if(input[key]!==undefined&&(typeof input[key]!=="number"||!Number.isFinite(input[key])))throw new SourceContentError("Metric bounds must be finite numbers");
    if((input.minMetric!==undefined||input.maxMetric!==undefined)&&!input.metricKey||input.minMetric!==undefined&&input.maxMetric!==undefined&&input.minMetric>input.maxMetric)throw new SourceContentError("Invalid metric range");
    const query = { ...input, query: input.query?normalizePublicSearchText(input.query)||undefined:undefined,searchMode:input.searchMode??"literal" as const,searchScope:input.searchScope??"title_text" as const,exclusions:[...new Set((input.exclusions??[]).map(normalizePublicSearchText))],author:input.author?.trim()||undefined,language:input.language?.trim()||undefined,sourceGroup:input.sourceGroup?.trim()||undefined,sort:input.sort??"published_desc" as const, limit: integer(input.limit, 25, 100), from: input.from === undefined ? undefined : date(input.from, ""), to: input.to === undefined ? undefined : date(input.to, "") };
    if (query.from && query.to && query.from >= query.to) throw new SourceContentError("Invalid query window");
    return query;
  }
  async contentDetail(id:string){const content=await this.repository.getContent(requireSourceId(id));if(!content)throw new SourceContentError("Content not found", "not_found");const relatedLimit=20,references=await Promise.all(content.references.slice(0,relatedLimit).map(async reference=>({reference,content:await this.repository.findContentByIdentity(content.platform,reference.kind,reference.externalId)}))),children=await this.repository.relatedChildren(content,relatedLimit+1),ids=new Set(content.observations.map(item=>item.sourceId)),sources=(await this.repository.listSources()).filter(item=>ids.has(item.id));return {content,sources,references,children:children.slice(0,relatedLimit),relatedLimit,relatedTruncated:content.references.length>relatedLimit||children.length>relatedLimit,scope:"stored_content" as const};}
  async getJob(id: string) { const job = await this.repository.getJob(requireSourceId(id)); if (!job) throw new SourceContentError("Job not found", "not_found"); return job; }
  async retryJob(id: string) { const previous=await this.getJob(id);await this.requireActiveSource(previous.sourceId);const job = await this.repository.retryJob(id, this.now()); if (!job) throw new SourceContentError("Only failed jobs with no active job for the same source and purpose can be retried", "conflict"); return job; }
  async continueJob(id: string) { const previous=await this.getJob(id);await this.requireActiveSource(previous.sourceId);const source=await this.repository.getSource(previous.sourceId);if(source?.automaticCollectionBlocked)throw new SourceContentError("Collection is blocked by a permanent failure; correct its cause and Retry the failed job", "conflict");const job = await this.repository.continueJob(id, randomUUID(), this.now()); if (!job) throw new SourceContentError("Only bounded completed jobs with a saved checkpoint and no conflicting active job can continue", "conflict"); return job; }
  private async requireActiveSource(id:string) {const source=await this.repository.getSource(id);if(!source||source.state!=="active")throw new SourceContentError("Source must be active", "conflict");if(!this.providerFor(source.platform,source.provider))throw new SourceContentError("Provider is not enabled", "conflict");}
  async listJobs(query:SourceJobQuery) {if(query.sourceId)requireSourceId(query.sourceId);if(query.status&&!["queued","running","retrying","succeeded","failed","cancelled"].includes(query.status))throw new SourceContentError("Invalid job status");return this.repository.listJobs({...query,limit:integer(query.limit,50,100)});}
  async cancelJob(id:string) {const result=await this.repository.cancelJob(requireSourceId(id),this.now());if(!result)throw new SourceContentError("Only active jobs can be cancelled", "conflict");return result;}
  async setProviderBudget(provider:string,input:SourceProviderBudgetRequest) {
    if(!/^[a-z0-9_]{1,60}$/.test(provider)||!this.providers.some(item=>item.capability.provider===provider))throw new SourceContentError("Unknown provider");
    if(!input||typeof input!=="object"||typeof input.enabled!=="boolean"||Object.keys(input).some(key=>!["enabled","dailyRequests","monthlyRequests","dailyResources","monthlyResources","minimumIntervalMs","expectedRevision"].includes(key)))throw new SourceContentError("Invalid provider budget");
    revision(input.expectedRevision,true);
    for(const key of ["dailyRequests","monthlyRequests","dailyResources","monthlyResources"] as const)if(typeof input[key]!=="number"||!Number.isInteger(input[key])||input[key]<0||input[key]>100000000)throw new SourceContentError(`Invalid ${key} budget`);
    if(input.minimumIntervalMs!==undefined&&(!Number.isInteger(input.minimumIntervalMs)||input.minimumIntervalMs<0||input.minimumIntervalMs>3600000))throw new SourceContentError("minimumIntervalMs must be 0–3600000");
    const {expectedRevision,...budget}=input;try{return await this.repository.setProviderBudget({...budget,provider},this.now(),expectedRevision);}catch(error){if(error instanceof SourceConfigurationConflictError)throw new SourceContentError(error.message, "conflict");throw error;}
  }
  async ops() {return this.repository.sourceOps(this.now());}
  async heartbeat(value:Omit<SourceWorkerHeartbeat,"lastHeartbeatAt">) {return this.repository.heartbeat({...value,lastHeartbeatAt:this.now()});}

  /** One bounded page per tick. A lease prevents concurrent workers committing the same job. */
  async workOnce(signal?: AbortSignal): Promise<boolean> {
    if(!signal?.aborted)await this.repository.scheduleDue(this.now(),this.providers.filter(provider=>provider.capability.enabled&&provider.refreshIds).map(provider=>provider.capability.provider),20,this.providers.filter(provider=>provider.capability.enabled).map(provider=>`${provider.capability.platform}:${provider.capability.provider}`));
    const claimed = await this.repository.claim(this.now());
    if (!claimed) return false;
    this.lastWorkedJobId=claimed.job.id;
    if(signal?.aborted){await this.repository.failJob(claimed,"Worker stopped before requesting a page",this.now(),this.now(),true);return true;}
    let pageRequestAttempts=0;
    try {
      if((claimed.pageRequestAttempts??0)>=3){await this.repository.beginRequestAttempt(claimed,this.now());return true;}
      const source = await this.repository.getSource(claimed.job.sourceId);
      if (!source) throw new ContentProviderError("Source no longer exists", false);
      const provider = this.providerFor(source.platform,source.provider);
      if (!provider) throw new ContentProviderError("Source provider is not enabled", false);
      const reservedResources=claimed.job.purpose==="refresh"?claimed.job.refreshIds.length:Math.max(claimed.job.pageSize,provider.capability.requestResourceUpperBound??0);
      const budget=await this.repository.reserveUsage(source.provider,reservedResources,this.now());
    if(!budget.allowed){await this.repository.failJob(claimed,budget.reason==="interval"?"Provider request spacing; no upstream request was sent":"Provider budget disabled or exhausted; no upstream request was sent",budget.retryAt,this.now(),true);return true;}
      if(signal?.aborted){await this.repository.failJob(claimed,"Worker stopped before requesting a reserved page",this.now(),this.now(),true);return true;}
      const begun=await this.repository.beginRequestAttempt(claimed,this.now());if(begun===null)return true;pageRequestAttempts=begun;
      const started=performance.now();let page;
      try{page=claimed.job.purpose==="refresh" ? await (provider.refreshIds?.({source,externalIds:claimed.job.refreshIds,signal})??Promise.reject(new ContentProviderError("Provider does not support refresh by IDs",false))) : await provider.collectPage({ source, from: claimed.job.from, to: claimed.job.to, limit: claimed.job.pageSize, checkpoint: claimed.job.checkpoint, signal });}
      finally{await this.repository.recordRequestAttempt(claimed,Math.max(0,performance.now()-started));}
      if (!page.exhausted && page.nextCheckpoint === null) throw new ContentProviderError(page.warning ?? "Provider pagination stopped without exhausting the window; checkpoint retained", true);
      await this.repository.commitPage(claimed, page, this.now());
    } catch (error) {
      const databaseTransient = error instanceof Error && "code" in error && ["40P01", "40001", "08000", "08003", "08006", "57P01", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT"].includes(String(error.code));
      const transient = databaseTransient || error instanceof ContentProviderError && error.retryable;
      const retryable = signal?.aborted || transient && pageRequestAttempts < 3;
      const wait = error instanceof ContentProviderError ? error.retryAfterSeconds : 30;
      const retryAt = retryable ? new Date(Date.parse(this.now()) + (signal?.aborted ? 0 : Math.max(5, wait) * 1000)).toISOString() : null;
      const failureKind = signal?.aborted || transient ? "transient" : "permanent";
      await this.repository.failJob(claimed, error instanceof Error ? error.message.slice(0, 400) : "Collection failed", retryAt, this.now(),signal?.aborted,failureKind);
    }
    return true;
  }
}
