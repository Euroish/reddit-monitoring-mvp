import { randomUUID } from "node:crypto";
import type { CollectionSource, ContentPlatform, ContentQuery, CreateCollectionSourceRequest, PublicContentKind, SourceCollectionJob, StartSourceCollectionRequest, UpdateCollectionSourceRequest, SourceJobQuery, SourceProviderBudget, SourceWorkerHeartbeat } from "../../../packages/contracts/src/source-content";
import { ContentProviderError, type ContentProvider } from "../../connectors/shared/content-provider.interface";
import type { SourceContentRepository } from "../../domain/repositories/source-content-repository";

export class SourceContentError extends Error {
  constructor(message: string, public readonly status: 400 | 404 | 409 = 400) { super(message); }
}
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
    const current=await this.repository.getSource(requireSourceId(id));if(!current)throw new SourceContentError("Source not found",404);
    if(!input||typeof input!=="object"||Array.isArray(input))throw new SourceContentError("Invalid source update");
    if(Object.keys(input).some(key=>!["label","group","schedule","refresh"].includes(key)))throw new SourceContentError("Only label, group, schedule and refresh can be edited; create a new source for a different identity");
    if(input.label!==undefined&&(typeof input.label!=="string"||!input.label.trim()||input.label.trim().length>100))throw new SourceContentError("Label must contain 1–100 characters");
    if(input.group!==undefined&&input.group!==null&&(typeof input.group!=="string"||input.group.trim().length>100))throw new SourceContentError("Group must be at most 100 characters");
    const checks=[{key:"schedule" as const,settings:input.schedule,limits:{cadenceSeconds:[60,86400],overlapSeconds:[0,86400],initialLookbackHours:[1,8760],maxCatchupHours:[1,168],pageSize:[1,100],maxPages:[1,20]}},{key:"refresh" as const,settings:input.refresh,limits:{afterHours:[1,8760],minIntervalHours:[1,720],maxAttempts:[1,20],batchSize:[1,100]}}];
    for(const {settings,limits} of checks) {
      if(settings===undefined)continue;if(!settings||typeof settings!=="object"||Array.isArray(settings))throw new SourceContentError("Invalid schedule/refresh settings");
      for(const [key,value] of Object.entries(settings)){if(key==="enabled"){if(typeof value!=="boolean")throw new SourceContentError("enabled must be boolean");continue;}const range=limits[key as keyof typeof limits] as number[]|undefined;if(!range||typeof value!=="number"||!Number.isInteger(value)||value<range[0]!||value>range[1]!)throw new SourceContentError(`Invalid ${key} setting`);}
    }
    if(input.refresh?.enabled){const provider=this.providerFor(current.platform,current.provider);if(!provider?.refreshIds)throw new SourceContentError("Provider does not support refresh by IDs");if(provider.capability.observationModel!=="archive")throw new SourceContentError("Automatic maturity refresh supports archive observations only; snapshot ID refresh is an adapter capability, not an automatic schedule");}
    if(input.schedule?.enabled&&!this.providerFor(current.platform,current.provider))throw new SourceContentError("Provider is not enabled for scheduling");
    const changes:UpdateCollectionSourceRequest={...input};if(input.label!==undefined)changes.label=input.label.trim();if(input.group!==undefined)changes.group=input.group===null?null:input.group.trim()||null;
    return (await this.repository.updateSource(id,changes,this.now()))!;
  }
  async setSourceState(id:string,state:CollectionSource["state"]) {const result=await this.repository.setSourceState(requireSourceId(id),state,this.now());if(!result)throw new SourceContentError("Source not found",404);return result;}

  async enqueue(sourceId: string, input: StartSourceCollectionRequest = {}): Promise<SourceCollectionJob> {
    requireSourceId(sourceId);
    if (!input || typeof input !== "object") throw new SourceContentError("Invalid collection request");
    const source = await this.repository.getSource(sourceId);
    if (!source) throw new SourceContentError("Source not found", 404);
    if(source.state!=="active")throw new SourceContentError("Paused or archived sources cannot collect; resume the source first",409);
    if (!this.providerFor(source.platform,source.provider)) throw new SourceContentError("This platform/provider is not enabled for collection");
    const now = this.now(), to = date(input.to, now), from = date(input.from, new Date(Date.parse(to) - 86400000).toISOString());
    if (Date.parse(from) >= Date.parse(to) || Date.parse(to) > Date.parse(now) + 60_000) throw new SourceContentError("Collection window must be ordered and must not be in the future");
    const pageSize = integer(input.pageSize,25,100), maxPages = integer(input.maxPages,5,20);
    const queued = await this.repository.enqueue({ id: randomUUID(), sourceId, now, from, to, pageSize, maxPages });
    if (queued.from !== from || queued.to !== to || queued.pageSize !== pageSize || queued.maxPages !== maxPages) throw new SourceContentError("Source is already collecting a different window or page budget; wait for that job to finish",409);
    return queued;
  }
  normalizeQuery(input: ContentQuery): ContentQuery {
    if (input.platform && !platforms.includes(input.platform)) throw new SourceContentError("Invalid platform filter");
    if (input.kind && !kinds.includes(input.kind)) throw new SourceContentError("Invalid kind filter");
    if (input.sourceId) requireSourceId(input.sourceId);
    if (input.provider && !/^[a-z0-9_]{1,60}$/.test(input.provider)) throw new SourceContentError("Invalid provider filter");
    if (input.query !== undefined && (typeof input.query !== "string" || input.query.length > 200)) throw new SourceContentError("Search text must be at most 200 characters");
    const query = { ...input, query: input.query?.trim() || undefined, limit: integer(input.limit, 25, 100), from: input.from === undefined ? undefined : date(input.from, ""), to: input.to === undefined ? undefined : date(input.to, "") };
    if (query.from && query.to && query.from >= query.to) throw new SourceContentError("Invalid query window");
    return query;
  }
  async getJob(id: string) { const job = await this.repository.getJob(requireSourceId(id)); if (!job) throw new SourceContentError("Job not found", 404); return job; }
  async retryJob(id: string) { const previous=await this.getJob(id);await this.requireActiveSource(previous.sourceId);const job = await this.repository.retryJob(id, this.now()); if (!job) throw new SourceContentError("Only failed jobs with no active job on the same source can be retried", 409); return job; }
  async continueJob(id: string) { const previous=await this.getJob(id);await this.requireActiveSource(previous.sourceId);const job = await this.repository.continueJob(id, randomUUID(), this.now()); if (!job) throw new SourceContentError("Only bounded completed jobs with a saved checkpoint and no conflicting active job can continue", 409); return job; }
  private async requireActiveSource(id:string) {const source=await this.repository.getSource(id);if(!source||source.state!=="active")throw new SourceContentError("Source must be active",409);if(!this.providerFor(source.platform,source.provider))throw new SourceContentError("Provider is not enabled",409);}
  async listJobs(query:SourceJobQuery) {if(query.sourceId)requireSourceId(query.sourceId);if(query.status&&!["queued","running","retrying","succeeded","failed","cancelled"].includes(query.status))throw new SourceContentError("Invalid job status");return this.repository.listJobs({...query,limit:integer(query.limit,50,100)});}
  async cancelJob(id:string) {const result=await this.repository.cancelJob(requireSourceId(id),this.now());if(!result)throw new SourceContentError("Only active jobs can be cancelled",409);return result;}
  async setProviderBudget(provider:string,input:Omit<SourceProviderBudget,"provider">) {if(!/^[a-z0-9_]{1,60}$/.test(provider)||!this.providers.some(item=>item.capability.provider===provider))throw new SourceContentError("Unknown provider");if(!input||typeof input!=="object"||typeof input.enabled!=="boolean"||Object.keys(input).some(key=>!["enabled","dailyRequests","monthlyRequests","dailyResources","monthlyResources"].includes(key)))throw new SourceContentError("Invalid provider budget");for(const key of ["dailyRequests","monthlyRequests","dailyResources","monthlyResources"] as const)if(typeof input[key]!=="number"||!Number.isInteger(input[key])||input[key]<0||input[key]>100000000)throw new SourceContentError(`Invalid ${key} budget`);return this.repository.setProviderBudget({...input,provider},this.now());}
  async ops() {return this.repository.sourceOps(this.now());}
  async heartbeat(value:Omit<SourceWorkerHeartbeat,"lastHeartbeatAt">) {return this.repository.heartbeat({...value,lastHeartbeatAt:this.now()});}

  /** One bounded page per tick. A lease prevents concurrent workers committing the same job. */
  async workOnce(signal?: AbortSignal): Promise<boolean> {
    if(!signal?.aborted)await this.repository.scheduleDue(this.now(),this.providers.filter(provider=>provider.capability.enabled&&provider.refreshIds).map(provider=>provider.capability.provider),20,this.providers.filter(provider=>provider.capability.enabled).map(provider=>`${provider.capability.platform}:${provider.capability.provider}`));
    const claimed = await this.repository.claim(this.now());
    if (!claimed) return false;
    this.lastWorkedJobId=claimed.job.id;
    if(signal?.aborted){await this.repository.failJob(claimed,"Worker stopped before requesting a page",this.now(),this.now(),true);return true;}
    try {
      const source = await this.repository.getSource(claimed.job.sourceId);
      if (!source) throw new ContentProviderError("Source no longer exists", false);
      const provider = this.providerFor(source.platform,source.provider);
      if (!provider) throw new ContentProviderError("Source provider is not enabled", false);
      const reservedResources=claimed.job.purpose==="refresh"?claimed.job.refreshIds.length:Math.max(claimed.job.pageSize,provider.capability.requestResourceUpperBound??0);
      const budget=await this.repository.reserveUsage(source.provider,reservedResources,this.now());
      if(!budget.allowed){await this.repository.failJob(claimed,"Provider budget disabled or exhausted; no upstream request was sent",budget.retryAt,this.now(),true);return true;}
      if(signal?.aborted){await this.repository.failJob(claimed,"Worker stopped before requesting a reserved page",this.now(),this.now(),true);return true;}
      const started=performance.now();let page;
      try{page=claimed.job.purpose==="refresh" ? await (provider.refreshIds?.({source,externalIds:claimed.job.refreshIds,signal})??Promise.reject(new ContentProviderError("Provider does not support refresh by IDs",false))) : await provider.collectPage({ source, from: claimed.job.from, to: claimed.job.to, limit: claimed.job.pageSize, checkpoint: claimed.job.checkpoint, signal });}
      finally{await this.repository.recordRequestAttempt(claimed,Math.max(0,performance.now()-started));}
      await this.repository.commitPage(claimed, page, this.now());
    } catch (error) {
      const retryable = signal?.aborted || error instanceof ContentProviderError && error.retryable && claimed.job.attempts < 3;
      const wait = error instanceof ContentProviderError ? error.retryAfterSeconds : 30;
      const retryAt = retryable ? new Date(Date.parse(this.now()) + (signal?.aborted ? 0 : Math.max(5, wait) * 1000)).toISOString() : null;
      await this.repository.failJob(claimed, error instanceof Error ? error.message.slice(0, 400) : "Collection failed", retryAt, this.now(),signal?.aborted);
    }
    return true;
  }
}
