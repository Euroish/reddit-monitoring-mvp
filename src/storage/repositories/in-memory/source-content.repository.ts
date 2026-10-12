import { randomUUID } from "node:crypto";
import type { CollectionSource, ContentQuery, CreateCollectionSourceRequest, PublicContent, SourceCollectionJob, StartSourceCollectionRequest } from "../../../../packages/contracts/src/source-content";
import type { CollectedPage } from "../../../connectors/shared/content-provider.interface";
import type { ClaimedSourceJob, SourceContentRepository } from "../../../domain/repositories/source-content-repository";
import { decodeContentCursor, encodeContentCursor } from "../../source-content-query";

/** Offline/test adapter; live runtimes always use PostgreSQL. */
export class InMemorySourceContentRepository implements SourceContentRepository {
  private sources = new Map<string, CollectionSource>();
  private jobs = new Map<string, SourceCollectionJob>();
  private leases = new Map<string, { token: string; until: string }>();
  private contents = new Map<string, PublicContent>();
  async listSources() { return structuredClone([...this.sources.values()]); }
  async getSource(id: string) { return structuredClone(this.sources.get(id) ?? null); }
  async createSource(input: CreateCollectionSourceRequest & { id: string; label: string; createdAt: string }) {
    const existing = [...this.sources.values()].find(item => item.platform===input.platform && item.provider===input.provider && item.contentKind===input.contentKind && JSON.stringify(item.target)===JSON.stringify(input.target));
    if (existing) { existing.label=input.label; return structuredClone(existing); }
    const value: CollectionSource = { ...input, lastSuccessAt:null,latestPublishedAt:null,coverage:"unknown" };
    this.sources.set(value.id,value); return structuredClone(value);
  }
  async enqueue(input: Required<StartSourceCollectionRequest> & { id: string; sourceId: string; now: string }) {
    const existing = [...this.jobs.values()].find(item => item.sourceId===input.sourceId && ["queued","running","retrying"].includes(item.status));
    if (existing) return structuredClone(existing);
    const value: SourceCollectionJob = { id:input.id,sourceId:input.sourceId,from:input.from,to:input.to,pageSize:input.pageSize,maxPages:input.maxPages,status:"queued",pagesCommitted:0,recordsProcessed:0,checkpoint:null,coverage:"unknown",exhausted:false,attempts:0,error:null,nextRunAt:input.now,createdAt:input.now,finishedAt:null };
    this.jobs.set(value.id,value); return structuredClone(value);
  }
  async getJob(id: string) { return structuredClone(this.jobs.get(id) ?? null); }
  async retryJob(id: string, now: string) {
    const current = this.jobs.get(id);
    if (!current || current.status!=="failed" || [...this.jobs.values()].some(item => item.sourceId===current.sourceId && ["queued","running","retrying"].includes(item.status))) return null;
    Object.assign(current,{ status:"queued",attempts:0,error:null,nextRunAt:now,finishedAt:null }); return structuredClone(current);
  }
  async claim(now: string): Promise<ClaimedSourceJob | null> {
    const current = [...this.jobs.values()].find(item => ["queued","retrying"].includes(item.status) && item.nextRunAt<=now || item.status==="running" && (this.leases.get(item.id)?.until ?? "")<=now);
    if (!current) return null;
    current.status="running"; current.attempts++;
    const token=randomUUID(); this.leases.set(current.id,{ token,until:new Date(Date.parse(now)+120000).toISOString() });
    return { job:structuredClone(current),leaseToken:token };
  }
  async continueJob(id: string, newId: string, now: string) {
    const previous=this.jobs.get(id); if (!previous || previous.status!=="succeeded" || previous.checkpoint===null) return null;
    const active=[...this.jobs.values()].find(item=>item.sourceId===previous.sourceId && ["queued","running","retrying"].includes(item.status)); if (active) return structuredClone(active);
    const next:SourceCollectionJob={...structuredClone(previous),id:newId,status:"queued",pagesCommitted:0,recordsProcessed:0,attempts:0,error:null,nextRunAt:now,createdAt:now,finishedAt:null};
    this.jobs.set(newId,next); return structuredClone(next);
  }
  async commitPage(claim: ClaimedSourceJob, page: CollectedPage, now: string) {
    const current=this.jobs.get(claim.job.id), origin=current && this.sources.get(current.sourceId);
    if (!current || !origin || this.leases.get(current.id)?.token!==claim.leaseToken || current.status!=="running") throw new Error("Collection lease lost");
    // Validate the whole page before mutating; the SQL adapter uses a real transaction.
    if (page.items.some(item => item.platform!==origin.platform || item.platformDetails.platform!==item.platform || item.observation.sourceId!==origin.id)) throw new Error("Page/source identity mismatch");
    for (const item of page.items) {
      const existing=this.contents.get(item.id), previous=existing?.observations.find(obs => obs.sourceId===origin.id);
      const replace=!previous?.sourceObservedAt || Boolean(item.observation.sourceObservedAt && item.observation.sourceObservedAt>=previous.sourceObservedAt);
      const observations=existing?.observations.filter(obs=>obs.sourceId!==origin.id) ?? [];
      observations.push(replace ? item.observation : previous!);
      const { fetchedAt, observation: _observation, ...fields } = item;
      const content: PublicContent = existing && !replace ? { ...existing,lastFetchedAt:fetchedAt,observations } : { ...fields,firstFetchedAt:existing?.firstFetchedAt ?? fetchedAt,lastFetchedAt:fetchedAt,observations };
      this.contents.set(item.id,structuredClone(content));
    }
    current.pagesCommitted++; current.recordsProcessed+=page.items.length; current.checkpoint=page.nextCheckpoint; current.exhausted=page.exhausted;
    current.coverage=page.exhausted && page.coverage!=="partial" ? "unknown" : "partial"; current.error=page.warning; current.attempts=0;
    const done=page.exhausted || page.nextCheckpoint===null || current.pagesCommitted>=current.maxPages;
    current.status=done ? "succeeded" : "queued"; current.finishedAt=done ? now : null; current.nextRunAt=new Date(Date.parse(now)+5000).toISOString();
    origin.lastSuccessAt=now; origin.coverage=current.coverage;
    const latest=page.items.map(item=>item.publishedAt).filter((value):value is string=>value!==null).sort().at(-1);
    if (latest && (!origin.latestPublishedAt || latest>origin.latestPublishedAt)) origin.latestPublishedAt=latest;
    this.leases.delete(current.id);
  }
  async failJob(claim: ClaimedSourceJob, error: string, retryAt: string | null, now: string) {
    const current=this.jobs.get(claim.job.id); if (!current || this.leases.get(current.id)?.token!==claim.leaseToken) return;
    Object.assign(current,{status:retryAt ? "retrying" : "failed",error,nextRunAt:retryAt ?? now,finishedAt:retryAt ? null : now}); this.leases.delete(current.id);
  }
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
