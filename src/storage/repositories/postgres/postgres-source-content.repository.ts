import { randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";
import type { CollectionSource, ContentQuery, ContentStatsResponse, CreateCollectionSourceRequest, PublicContent, SourceCollectionJob, UpdateCollectionSourceRequest, SourceJobQuery, SourceProviderBudget, SourceProviderUsage, SourceWorkerHeartbeat, SourceOps } from "../../../../packages/contracts/src/source-content";
import { SourceConfigurationConflictError,type ClaimedSourceJob,type SourceContentRepository,type SourceJobInput } from "../../../domain/repositories/source-content-repository";
import type { CollectedPage } from "../../../connectors/shared/content-provider.interface";
import type { PostgresClient } from "../../postgres/postgres-client";
import { decodeContentCursor, encodeContentCursor } from "../../source-content-query";
import { defaultProviderBudget, nextUsageDay, scheduledWindow, recheckWindow } from "../../source-lifecycle";
type Row = QueryResultRow;
const iso = (value: Date | string | null): string | null => value === null ? null : new Date(value).toISOString();
function source(row: Row): CollectionSource { return { id: row.id, platform: row.platform, provider: row.provider, label: row.label, target: row.target, contentKind: row.content_kind, createdAt: iso(row.created_at)!, lastSuccessAt: iso(row.last_success_at), latestPublishedAt: iso(row.latest_published_at), coverage: row.coverage,state:row.state,group:row.source_group,updatedAt:iso(row.updated_at)!,schedule:row.schedule,refresh:row.refresh,nextDueAt:iso(row.next_due_at),incrementalTo:iso(row.incremental_to),nextRecheckAt:iso(row.next_recheck_at),revision:row.revision }; }
function job(row: Row): SourceCollectionJob { return { id: row.id, sourceId: row.collection_source_id, status: row.status, from: iso(row.from_at)!, to: iso(row.to_at)!, pageSize: row.page_size, maxPages: row.max_pages, pagesCommitted: row.pages_committed, recordsProcessed: row.records_processed, checkpoint: row.checkpoint, coverage: row.coverage, exhausted: row.exhausted, attempts: row.attempts, error: row.error, nextRunAt: iso(row.next_run_at)!, createdAt: iso(row.created_at)!, finishedAt: iso(row.finished_at),purpose:row.purpose,parentJobId:row.parent_job_id,refreshIds:row.refresh_ids,recordsInserted:row.records_inserted,recordsUpdated:row.records_updated,requestCount:row.request_count,requestDurationMs:row.request_duration_ms }; }
const sourceSelect = "SELECT cs.*, s.code AS platform FROM collection_source cs JOIN source s ON s.id=cs.platform_id";

export class PostgresSourceContentRepository implements SourceContentRepository {
  constructor(private readonly db: PostgresClient) {}
  async listSources() { return (await this.db.query(`${sourceSelect} ORDER BY cs.created_at, cs.id`)).rows.map(source); }
  async getSource(id: string) { const result = await this.db.query(`${sourceSelect} WHERE cs.id=$1`, [id]); return result.rows[0] ? source(result.rows[0]) : null; }
  async createSource(input: CreateCollectionSourceRequest & { id: string; label: string; createdAt: string }) {
    const result = await this.db.query(`INSERT INTO collection_source(id,platform_id,provider,label,target,content_kind,created_at,updated_at,next_recheck_at)
      SELECT $1,s.id,$3,$4,$5::jsonb,$6,$7,$7,$7::timestamptz+interval '6 hours' FROM source s WHERE s.code=$2
      ON CONFLICT(platform_id,provider,content_kind,target) DO UPDATE SET label=EXCLUDED.label,updated_at=EXCLUDED.updated_at,revision=collection_source.revision+1 RETURNING id`, [input.id, input.platform, input.provider, input.label, JSON.stringify(input.target), input.contentKind, input.createdAt]);
    if (!result.rows[0]) throw new Error("Platform is not registered in the database");
    return (await this.getSource(result.rows[0].id))!;
  }
  async updateSource(id:string,changes:UpdateCollectionSourceRequest,now:string) {const result=await this.db.query(`UPDATE collection_source SET label=COALESCE($2,label),source_group=CASE WHEN $3 THEN $4 ELSE source_group END,schedule=schedule||$5::jsonb,refresh=refresh||$6::jsonb,updated_at=$7,revision=revision+1,next_due_at=CASE WHEN $8 THEN CASE WHEN COALESCE(($5::jsonb->>'enabled')::boolean,(schedule->>'enabled')::boolean) THEN $7::timestamptz ELSE NULL END ELSE next_due_at END,next_recheck_at=CASE WHEN $8 AND COALESCE(($5::jsonb->>'enabled')::boolean,(schedule->>'enabled')::boolean) AND (COALESCE(($5::jsonb->>'initialLookbackHours')::integer,(schedule->>'initialLookbackHours')::integer)>COALESCE(($5::jsonb->>'maxCatchupHours')::integer,(schedule->>'maxCatchupHours')::integer) OR $5::jsonb ? 'recheckLookbackHours' OR $5::jsonb ? 'recheckCadenceSeconds') THEN $7::timestamptz ELSE next_recheck_at END WHERE id=$1 AND ($9::integer IS NULL OR revision=$9) RETURNING id`,[id,changes.label??null,Object.hasOwn(changes,"group"),changes.group??null,JSON.stringify(changes.schedule??{}),JSON.stringify(changes.refresh??{}),now,changes.schedule!==undefined,changes.expectedRevision??null]);return result.rows[0]?this.getSource(id):null;}
  async setSourceState(id:string,state:CollectionSource["state"],now:string,expectedRevision?:number) {const updated=await this.db.withTransaction(async client=>{const result=await client.query(`UPDATE collection_source SET state=$2,updated_at=$3,revision=revision+1,next_due_at=CASE WHEN $2='active' AND (schedule->>'enabled')::boolean THEN $3::timestamptz ELSE NULL END WHERE id=$1 AND ($4::integer IS NULL OR revision=$4) RETURNING id`,[id,state,now,expectedRevision??null]);if(!result.rows[0])return false;if(state!=="active")await client.query(`UPDATE source_collection_job SET status='cancelled',finished_at=$2,error='Cancelled by source lifecycle',lease_token=NULL,lease_until=NULL WHERE collection_source_id=$1 AND status IN ('queued','running','retrying')`,[id,now]);return true;});return updated?this.getSource(id):null;}
  async enqueue(input: SourceJobInput) {
    if(!input.purpose||input.purpose==="manual"){const active=await this.db.query(`SELECT * FROM source_collection_job WHERE collection_source_id=$1 AND status IN ('queued','running','retrying') ORDER BY CASE WHEN purpose='manual' THEN 0 ELSE 1 END,created_at,id LIMIT 1`,[input.sourceId]);if(active.rows[0])return job(active.rows[0]);}
    const result = await this.db.query(`INSERT INTO source_collection_job(id,collection_source_id,status,from_at,to_at,page_size,max_pages,next_run_at,created_at,purpose,parent_job_id,refresh_ids)
      SELECT $1,$2,'queued',$3,$4,$5,$6,$7,$7,$8,$9,$10::jsonb FROM collection_source WHERE id=$2 AND state='active'
      ON CONFLICT(collection_source_id,purpose) WHERE status IN ('queued','running','retrying') DO UPDATE SET collection_source_id=EXCLUDED.collection_source_id RETURNING *`, [input.id, input.sourceId, input.from, input.to, input.pageSize, input.maxPages, input.now,input.purpose??"manual",input.parentJobId??null,JSON.stringify(input.refreshIds??[])]);
    if(!result.rows[0])throw new Error("Source must be active to enqueue");
    return job(result.rows[0]);
  }
  async getJob(id: string) { const result = await this.db.query("SELECT * FROM source_collection_job WHERE id=$1", [id]); return result.rows[0] ? job(result.rows[0]) : null; }
  async listJobs(query:SourceJobQuery) {return (await this.db.query(`SELECT * FROM source_collection_job WHERE ($1::uuid IS NULL OR collection_source_id=$1) AND ($2::text IS NULL OR status=$2) ORDER BY created_at DESC,id DESC LIMIT $3`,[query.sourceId??null,query.status??null,query.limit??50])).rows.map(job);}
  async cancelJob(id:string,now:string) {const result=await this.db.query(`UPDATE source_collection_job SET status='cancelled',finished_at=$2,error='Cancelled by user',lease_token=NULL,lease_until=NULL WHERE id=$1 AND status IN ('queued','running','retrying') RETURNING *`,[id,now]);return result.rows[0]?job(result.rows[0]):null;}
  async retryJob(id: string, now: string) {
    try {
      const result = await this.db.query(`UPDATE source_collection_job SET status='queued',attempts=0,error=NULL,next_run_at=$2,finished_at=NULL,lease_token=NULL,lease_until=NULL
        WHERE id=$1 AND status='failed' AND NOT EXISTS(SELECT 1 FROM source_collection_job active WHERE active.collection_source_id=source_collection_job.collection_source_id AND active.purpose=source_collection_job.purpose AND active.status IN ('queued','running','retrying')) RETURNING *`, [id, now]);
      return result.rows[0] ? job(result.rows[0]) : null;
    } catch (error) { if ((error as { code?: string }).code === "23505") return null; throw error; }
  }
  async claim(now: string): Promise<ClaimedSourceJob | null> {
    const leaseToken = randomUUID();
    return this.db.withTransaction(async client=>{
    const state=(await client.query("SELECT claims FROM source_dispatch_state WHERE id=1 FOR UPDATE")).rows[0],backgroundTurn=(Number(state.claims)+1)%4===0;
    const result = await client.query(`WITH runnable AS (
      SELECT j.id FROM source_collection_job j JOIN collection_source cs ON cs.id=j.collection_source_id WHERE cs.state='active' AND ((j.status IN ('queued','retrying') AND j.next_run_at <= $1) OR (j.status='running' AND j.lease_until <= $1)) AND NOT EXISTS(SELECT 1 FROM source_collection_job running WHERE running.collection_source_id=j.collection_source_id AND running.status='running' AND running.id<>j.id)
      ORDER BY CASE WHEN j.status='running' THEN -1 WHEN ($3 AND j.purpose IN ('manual','refresh')) OR (NOT $3 AND j.purpose IN ('scheduled','recheck')) THEN 0 ELSE 1 END,j.next_run_at,j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1)
      UPDATE source_collection_job j SET status='running',lease_token=$2,lease_until=$1::timestamptz + interval '2 minutes',attempts=attempts+1
      FROM runnable WHERE j.id=runnable.id RETURNING j.*`, [now, leaseToken,backgroundTurn]);
    if(result.rows[0])await client.query("UPDATE source_dispatch_state SET claims=claims+1 WHERE id=1");
    return result.rows[0] ? { job: job(result.rows[0]), leaseToken } : null;
    });
  }
  async continueJob(id: string, newId: string, now: string) {
    const result = await this.db.query(`INSERT INTO source_collection_job(id,collection_source_id,status,from_at,to_at,page_size,max_pages,checkpoint,next_run_at,created_at,purpose,parent_job_id,refresh_ids)
      SELECT $2,j.collection_source_id,'queued',j.from_at,j.to_at,j.page_size,j.max_pages,j.checkpoint,$3,$3,j.purpose,j.id,j.refresh_ids FROM source_collection_job j JOIN collection_source cs ON cs.id=j.collection_source_id WHERE j.id=$1 AND j.status='succeeded' AND j.checkpoint IS NOT NULL AND j.checkpoint<>'null'::jsonb AND cs.state='active'
      ON CONFLICT(collection_source_id,purpose) WHERE status IN ('queued','running','retrying') DO NOTHING RETURNING *`, [id,newId,now]);
    if(result.rows[0])return job(result.rows[0]);const active=await this.db.query(`SELECT * FROM source_collection_job WHERE parent_job_id=$1 AND status IN ('queued','running','retrying') LIMIT 1`,[id]);return active.rows[0]?job(active.rows[0]):null;
  }
  async commitPage(claim: ClaimedSourceJob, page: CollectedPage, now: string) {
    await this.db.withTransaction(async client => {
      const locked = await client.query(`SELECT j.*,s.platform_id,s.provider,s.content_kind,p.code AS platform FROM source_collection_job j JOIN collection_source s ON s.id=j.collection_source_id JOIN source p ON p.id=s.platform_id WHERE j.id=$1 AND j.status='running' AND j.lease_token=$2 FOR UPDATE OF j`, [claim.job.id, claim.leaseToken]);
      const current = locked.rows[0]; if (!current) throw new Error("Collection lease lost");
      let added=0,updated=0;
      for (const item of new Map(page.items.map(item=>[`${item.kind}:${item.externalId}`,item])).values()) {
        if (item.platform !== current.platform || item.kind!==current.content_kind || item.platformDetails.platform !== item.platform || item.observation.sourceId !== current.collection_source_id || item.observation.provider!==current.provider) throw new Error("Page/source identity mismatch");
        const inserted = await client.query(`INSERT INTO content(id,source_id,target_id,external_id,kind,title,body_text,url,permalink,created_at_source,first_seen_at,last_seen_at,total_eligible,content_author,content_media,content_references,platform_details,language,availability,content_observed_at)
          VALUES($1,$2,NULL,$3,$4,$5,$6,$7,$7,$8,$9,$9,FALSE,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14,$15,$16)
          ON CONFLICT(source_id,kind,external_id) DO UPDATE SET
            title=CASE WHEN content.content_observed_at IS NULL OR EXCLUDED.content_observed_at>=content.content_observed_at THEN EXCLUDED.title ELSE content.title END,
            body_text=CASE WHEN content.content_observed_at IS NULL OR EXCLUDED.content_observed_at>=content.content_observed_at THEN EXCLUDED.body_text ELSE content.body_text END,
            content_author=CASE WHEN content.content_observed_at IS NULL OR EXCLUDED.content_observed_at>=content.content_observed_at THEN EXCLUDED.content_author ELSE content.content_author END,
            availability=CASE WHEN content.content_observed_at IS NULL OR EXCLUDED.content_observed_at>=content.content_observed_at THEN EXCLUDED.availability ELSE content.availability END,
            content_observed_at=GREATEST(content.content_observed_at,EXCLUDED.content_observed_at),
            platform_details=CASE WHEN content.content_observed_at IS NULL OR EXCLUDED.content_observed_at>=content.content_observed_at THEN EXCLUDED.platform_details ELSE content.platform_details END,
            permalink=CASE WHEN content.content_observed_at IS NULL OR EXCLUDED.content_observed_at>=content.content_observed_at THEN COALESCE(EXCLUDED.permalink,content.permalink) ELSE content.permalink END,
            url=CASE WHEN content.content_observed_at IS NULL OR EXCLUDED.content_observed_at>=content.content_observed_at THEN COALESCE(EXCLUDED.url,content.url) ELSE content.url END,
            content_references=CASE WHEN content.content_observed_at IS NULL OR EXCLUDED.content_observed_at>=content.content_observed_at THEN EXCLUDED.content_references ELSE content.content_references END,
            content_media=CASE WHEN content.content_observed_at IS NULL OR EXCLUDED.content_observed_at>=content.content_observed_at THEN EXCLUDED.content_media ELSE content.content_media END,
            language=COALESCE(content.language,EXCLUDED.language),created_at_source=COALESCE(content.created_at_source,EXCLUDED.created_at_source),
            last_seen_at=GREATEST(content.last_seen_at,EXCLUDED.last_seen_at)
          RETURNING id,(xmax=0) AS inserted`, [item.id,current.platform_id,item.externalId,item.kind,item.title,item.text,item.url,item.publishedAt,item.fetchedAt,JSON.stringify(item.author),JSON.stringify(item.media),JSON.stringify(item.references),JSON.stringify(item.platformDetails),item.language,item.availability,item.observation.sourceObservedAt??item.fetchedAt]);
        inserted.rows[0].inserted?added++:updated++;
        const contentId = inserted.rows[0].id, obs = item.observation;
        await client.query(`INSERT INTO content_discovery(content_id,collection_source_id,first_fetched_at,last_fetched_at) VALUES($1,$2,$3,$3)
          ON CONFLICT(content_id,collection_source_id) DO UPDATE SET last_fetched_at=GREATEST(content_discovery.last_fetched_at,EXCLUDED.last_fetched_at)`, [contentId,current.collection_source_id,item.fetchedAt]);
        await client.query(`INSERT INTO content_observation(content_id,collection_source_id,provider,source_observed_at,fetched_at,time_basis,maturity,metrics,evidence_key)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) ON CONFLICT(content_id,collection_source_id,evidence_key) DO UPDATE SET fetched_at=GREATEST(content_observation.fetched_at,EXCLUDED.fetched_at)`, [contentId,current.collection_source_id,obs.provider,obs.sourceObservedAt,obs.fetchedAt,obs.timeBasis,obs.maturity,JSON.stringify(obs.metrics),obs.evidenceKey]);
      }
      if(current.purpose==='refresh')await client.query(`UPDATE content_discovery d SET refresh_attempts=refresh_attempts+1,last_refresh_at=$3 FROM content c WHERE c.id=d.content_id AND d.collection_source_id=$1 AND c.external_id=ANY($2::text[])`,[current.collection_source_id,current.refresh_ids,now]);
      const done = page.exhausted || page.nextCheckpoint === null || current.pages_committed + 1 >= current.max_pages;
      const coverage = !page.exhausted || page.coverage === "partial" ? "partial" : "unknown";
      await client.query(`UPDATE source_collection_job SET checkpoint=$3::jsonb,pages_committed=pages_committed+1,records_processed=records_processed+$4,status=$5,coverage=$6,exhausted=$7,error=$8,finished_at=$9,next_run_at=$10,attempts=0,lease_token=NULL,lease_until=NULL,records_inserted=records_inserted+$11,records_updated=records_updated+$12 WHERE id=$1 AND lease_token=$2`, [claim.job.id,claim.leaseToken,JSON.stringify(page.nextCheckpoint),page.items.length,done ? "succeeded" : "queued",coverage,page.exhausted,page.warning,done ? now : null,new Date(Date.parse(now)+5_000).toISOString(),added,updated]);
      const latest = page.items.map(item => item.publishedAt).filter((value): value is string => value !== null).sort().at(-1) ?? null;
      await client.query(`UPDATE collection_source SET last_success_at=$2,latest_published_at=GREATEST(latest_published_at,$3::timestamptz),coverage=$4,incremental_to=CASE WHEN $5 THEN GREATEST(incremental_to,$6::timestamptz) ELSE incremental_to END WHERE id=$1`, [current.collection_source_id,now,latest,coverage,done&&page.exhausted&&current.purpose==='scheduled',current.to_at]);
    });
  }
  async failJob(claim: ClaimedSourceJob, error: string, retryAt: string | null, now: string,resetAttempts=false) {
    await this.db.query(`UPDATE source_collection_job SET status=$3,error=$4,next_run_at=$5,finished_at=$6,lease_token=NULL,lease_until=NULL,attempts=CASE WHEN $7 THEN 0 ELSE attempts END WHERE id=$1 AND lease_token=$2`, [claim.job.id,claim.leaseToken,retryAt ? "retrying" : "failed",error,retryAt ?? now,retryAt ? null : now,resetAttempts]);
  }
  async recordRequestAttempt(claim:ClaimedSourceJob,durationMs:number) {await this.db.query(`UPDATE source_collection_job SET request_count=request_count+1,request_duration_ms=request_duration_ms+$3 WHERE id=$1 AND lease_token=$2 AND status='running'`,[claim.job.id,claim.leaseToken,durationMs]);}
  async scheduleDue(now:string,refreshProviders:readonly string[],limit:number,enabledProviders?:readonly string[]) {
    return this.db.withTransaction(async client=>{
      const eligibleRefresh=`SELECT c.external_id FROM content_discovery d JOIN content c ON c.id=d.content_id JOIN LATERAL(SELECT maturity FROM content_observation o WHERE o.content_id=c.id AND o.collection_source_id=d.collection_source_id ORDER BY o.source_observed_at DESC NULLS LAST,o.fetched_at DESC,o.id DESC LIMIT 1) latest ON TRUE WHERE d.collection_source_id=cs.id AND latest.maturity='initial' AND c.created_at_source<=$1::timestamptz-make_interval(hours=>(cs.refresh->>'afterHours')::integer) AND d.refresh_attempts<(cs.refresh->>'maxAttempts')::integer AND (d.last_refresh_at IS NULL OR d.last_refresh_at<=$1::timestamptz-make_interval(hours=>(cs.refresh->>'minIntervalHours')::integer))`;
      const inactive=(purpose:string)=>`NOT EXISTS(SELECT 1 FROM source_collection_job j WHERE j.collection_source_id=cs.id AND j.purpose='${purpose}' AND j.status IN ('queued','running','retrying'))`;
      const dueScheduled=`(cs.schedule->>'enabled')::boolean AND (cs.next_due_at IS NULL OR cs.next_due_at<=$1) AND ${inactive('scheduled')}`;
      const dueRecheck=`(cs.schedule->>'enabled')::boolean AND COALESCE((cs.schedule->>'recheckLookbackHours')::integer,12)>0 AND (cs.next_recheck_at IS NULL OR cs.next_recheck_at<=$1) AND ${inactive('recheck')}`;
      const dueRefresh=`(cs.refresh->>'enabled')::boolean AND cs.provider=ANY($2::text[]) AND ${inactive('refresh')} AND EXISTS(${eligibleRefresh})`;
      const candidates=await client.query(`${sourceSelect} WHERE cs.state='active' AND ($4::text[] IS NULL OR (s.code||':'||cs.provider)=ANY($4::text[])) AND ((${dueScheduled}) OR (${dueRecheck}) OR (${dueRefresh})) ORDER BY LEAST(COALESCE(cs.next_due_at,$1),COALESCE(cs.next_recheck_at,$1)),cs.id FOR UPDATE OF cs SKIP LOCKED LIMIT $3`,[now,refreshProviders,limit,enabledProviders??null]);
      let count=0;
      for(const row of candidates.rows) {
        const current=source(row);
        const active=await client.query("SELECT purpose FROM source_collection_job WHERE collection_source_id=$1 AND status IN ('queued','running','retrying')",[current.id]);
        for(const purpose of ['scheduled','recheck'] as const){
        if(count>=limit)break;
        const due=purpose==='scheduled'?current.nextDueAt:current.nextRecheckAt;
        if(current.schedule.enabled&&(purpose!=="recheck"||(current.schedule.recheckLookbackHours??12)>0)&&(!due||due<=now)&&!active.rows.some(item=>item.purpose===purpose)) {
          const prior=await client.query(`SELECT j.* FROM source_collection_job j WHERE j.collection_source_id=$1 AND j.purpose=$2 AND (j.status='failed' OR (j.status='succeeded' AND j.checkpoint IS NOT NULL AND j.checkpoint<>'null'::jsonb)) AND NOT EXISTS(SELECT 1 FROM source_collection_job child WHERE child.parent_job_id=j.id) ORDER BY j.created_at DESC LIMIT 1`,[current.id,purpose]);
          const previous=prior.rows[0],window=previous?{from:iso(previous.from_at)!,to:iso(previous.to_at)!}:purpose==='scheduled'?scheduledWindow(current,now):recheckWindow(current,now);
          if(window.from>=window.to)continue;
          await client.query(`INSERT INTO source_collection_job(id,collection_source_id,status,from_at,to_at,page_size,max_pages,checkpoint,next_run_at,created_at,purpose,parent_job_id) VALUES($1,$2,'queued',$3,$4,$5,$6,$7::jsonb,$8,$8,$10,$9) ON CONFLICT(collection_source_id,purpose) WHERE status IN ('queued','running','retrying') DO NOTHING`,[randomUUID(),current.id,window.from,window.to,current.schedule.pageSize,current.schedule.maxPages,JSON.stringify(previous?.checkpoint??null),now,previous?.id??null,purpose]);
          const column=purpose==='scheduled'?'next_due_at':'next_recheck_at',cadence=purpose==='scheduled'?current.schedule.cadenceSeconds:current.schedule.recheckCadenceSeconds??21600;
          await client.query(`UPDATE collection_source SET ${column}=$2 WHERE id=$1`,[current.id,new Date(Date.parse(now)+cadence*1000).toISOString()]);count++;
        }
        }
        if(count<limit&&current.refresh.enabled&&refreshProviders.includes(current.provider)&&!active.rows.some(item=>item.purpose==='refresh')) {
          const ids=await client.query(`SELECT c.external_id FROM content_discovery d JOIN content c ON c.id=d.content_id JOIN LATERAL(SELECT maturity FROM content_observation o WHERE o.content_id=c.id AND o.collection_source_id=d.collection_source_id ORDER BY o.source_observed_at DESC NULLS LAST,o.fetched_at DESC,o.id DESC LIMIT 1) latest ON TRUE WHERE d.collection_source_id=$1 AND latest.maturity='initial' AND c.created_at_source<=$2::timestamptz-make_interval(hours=>$3::integer) AND d.refresh_attempts<$4 AND (d.last_refresh_at IS NULL OR d.last_refresh_at<=$2::timestamptz-make_interval(hours=>$5::integer)) ORDER BY d.last_refresh_at NULLS FIRST,c.id LIMIT $6`,[current.id,now,current.refresh.afterHours,current.refresh.maxAttempts,current.refresh.minIntervalHours,current.refresh.batchSize]);
          if(!ids.rows.length)continue;
          const externalIds=ids.rows.map(item=>item.external_id);
          await client.query(`INSERT INTO source_collection_job(id,collection_source_id,status,from_at,to_at,page_size,max_pages,next_run_at,created_at,purpose,refresh_ids) VALUES($1,$2,'queued',$3,$4,$5,1,$4,$4,'refresh',$6::jsonb) ON CONFLICT(collection_source_id,purpose) WHERE status IN ('queued','running','retrying') DO NOTHING`,[randomUUID(),current.id,new Date(Date.parse(now)-current.refresh.afterHours*3600000).toISOString(),now,externalIds.length,JSON.stringify(externalIds)]);count++;
        }
      }return count;
    });
  }
  async setProviderBudget(budget:SourceProviderBudget,now=new Date().toISOString(),expectedRevision?:number) {
    return this.db.withTransaction(async client=>{
      const values=[budget.provider,budget.enabled,budget.dailyRequests,budget.monthlyRequests,budget.dailyResources,budget.monthlyResources,budget.minimumIntervalMs??null];
      const row=expectedRevision!==undefined&&expectedRevision>0
        ?await client.query(`UPDATE source_provider_budget SET enabled=$2,daily_requests=$3,monthly_requests=$4,daily_resources=$5,monthly_resources=$6,minimum_interval_ms=COALESCE($7,minimum_interval_ms),revision=revision+1 WHERE provider=$1 AND revision=$8 RETURNING minimum_interval_ms,revision`,[...values,expectedRevision])
        :await client.query(`INSERT INTO source_provider_budget(provider,enabled,daily_requests,monthly_requests,daily_resources,monthly_resources,minimum_interval_ms) VALUES($1,$2,$3,$4,$5,$6,COALESCE($7,0)) ON CONFLICT(provider) ${expectedRevision===0?"DO NOTHING":"DO UPDATE SET enabled=EXCLUDED.enabled,daily_requests=EXCLUDED.daily_requests,monthly_requests=EXCLUDED.monthly_requests,daily_resources=EXCLUDED.daily_resources,monthly_resources=EXCLUDED.monthly_resources,minimum_interval_ms=COALESCE($7,source_provider_budget.minimum_interval_ms),revision=source_provider_budget.revision+1"} RETURNING minimum_interval_ms,revision`,values);
      if(!row.rows[0])throw new SourceConfigurationConflictError();
      if(budget.enabled)await client.query(`UPDATE source_collection_job j SET next_run_at=$2,attempts=0 FROM collection_source cs WHERE cs.id=j.collection_source_id AND cs.provider=$1 AND j.status='retrying' AND (j.error LIKE 'Provider budget%' OR j.error LIKE 'Provider request spacing%')`,[budget.provider,now]);
      return {...budget,minimumIntervalMs:row.rows[0].minimum_interval_ms,revision:row.rows[0].revision};
    });
  }
  async providerUsage(now:string):Promise<SourceProviderUsage[]> {
    const rows=await this.db.query(`SELECT provider FROM collection_source UNION SELECT provider FROM source_provider_budget`),budgets=await this.db.query("SELECT * FROM source_provider_budget"),usage=await this.db.query(`SELECT provider,to_char(day,'YYYY-MM-DD') AS day,requests,resources_reserved FROM source_provider_usage WHERE day>=date_trunc('month',$1::timestamptz AT TIME ZONE 'UTC')::date AND day<=$1::date`,[now]);
    return rows.rows.map(row=>{const stored=budgets.rows.find(item=>item.provider===row.provider),budget=stored?{provider:stored.provider,enabled:stored.enabled,dailyRequests:stored.daily_requests,monthlyRequests:stored.monthly_requests,dailyResources:stored.daily_resources,monthlyResources:stored.monthly_resources,minimumIntervalMs:stored.minimum_interval_ms,revision:stored.revision}:defaultProviderBudget(row.provider),values=usage.rows.filter(item=>item.provider===row.provider),daily=values.find(item=>item.day===now.slice(0,10));return {provider:row.provider,day:now.slice(0,10),month:now.slice(0,7),dailyRequests:daily?.requests??0,dailyResources:daily?.resources_reserved??0,monthlyRequests:values.reduce((sum,item)=>sum+item.requests,0),monthlyResources:values.reduce((sum,item)=>sum+item.resources_reserved,0),budget,lastReservationAt:stored?iso(stored.last_request_at):null};});
  }
  async reserveUsage(provider:string,resources:number,now:string) {
    return this.db.withTransaction(async client=>{
      const fallback=defaultProviderBudget(provider);
      await client.query(`INSERT INTO source_provider_budget(provider,enabled,daily_requests,monthly_requests,daily_resources,monthly_resources) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,[provider,fallback.enabled,fallback.dailyRequests,fallback.monthlyRequests,fallback.dailyResources,fallback.monthlyResources]);
      const b=(await client.query("SELECT * FROM source_provider_budget WHERE provider=$1 FOR UPDATE",[provider])).rows[0];
      const nextRequest=b.last_request_at?new Date(Date.parse(iso(b.last_request_at)!)+b.minimum_interval_ms).toISOString():now;
      if(b.enabled&&nextRequest>now)return {allowed:false,retryAt:nextRequest,reason:"interval" as const};
      const usage=(await client.query(`SELECT COALESCE(SUM(requests) FILTER(WHERE day=$2::date),0)::integer AS daily_requests,COALESCE(SUM(resources_reserved) FILTER(WHERE day=$2::date),0)::integer AS daily_resources,COALESCE(SUM(requests),0)::integer AS monthly_requests,COALESCE(SUM(resources_reserved),0)::integer AS monthly_resources FROM source_provider_usage WHERE provider=$1 AND day>=date_trunc('month',$2::timestamptz AT TIME ZONE 'UTC')::date AND day<=$2::date`,[provider,now])).rows[0];
      const monthlyBlocked=usage.monthly_requests+1>b.monthly_requests||usage.monthly_resources+resources>b.monthly_resources;
      const allowed=b.enabled&&!monthlyBlocked&&usage.daily_requests+1<=b.daily_requests&&usage.daily_resources+resources<=b.daily_resources;
      if(allowed){await client.query(`INSERT INTO source_provider_usage(provider,day,requests,resources_reserved) VALUES($1,$2::date,1,$3) ON CONFLICT(provider,day) DO UPDATE SET requests=source_provider_usage.requests+1,resources_reserved=source_provider_usage.resources_reserved+$3`,[provider,now,resources]);await client.query("UPDATE source_provider_budget SET last_request_at=$2 WHERE provider=$1",[provider,now]);}
      const retryAt=monthlyBlocked?new Date(Date.UTC(Number(now.slice(0,4)),Number(now.slice(5,7)),1)).toISOString():nextUsageDay(now);
      return {allowed,retryAt,reason:allowed?undefined:"budget" as const};
    });
  }
  async heartbeat(value:SourceWorkerHeartbeat) {await this.db.query(`INSERT INTO source_worker_heartbeat(id,started_at,last_heartbeat_at,state,last_job_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET last_heartbeat_at=EXCLUDED.last_heartbeat_at,state=EXCLUDED.state,last_job_id=EXCLUDED.last_job_id`,[value.id,value.startedAt,value.lastHeartbeatAt,value.state,value.lastJobId]);}
  async sourceOps(now:string):Promise<SourceOps> {
    const workers=await this.db.query("SELECT * FROM source_worker_heartbeat ORDER BY last_heartbeat_at DESC LIMIT 20"),counts=await this.db.query("SELECT status,COUNT(*)::integer AS count FROM source_collection_job GROUP BY status"),pending=await this.db.query("SELECT MIN(created_at) AS oldest FROM source_collection_job WHERE status IN ('queued','running','retrying')"),active=await this.db.query("SELECT collection_source_id,COUNT(*)::integer AS count FROM source_collection_job WHERE status IN ('queued','running','retrying') GROUP BY collection_source_id"),sources=await this.listSources(),age=(at:string|null)=>at?Math.max(0,(Date.parse(now)-Date.parse(at))/3600000):null;
    const failures=await this.db.query(`SELECT id,collection_source_id,error,finished_at FROM source_collection_job WHERE status='failed' ORDER BY COALESCE(finished_at,created_at) DESC,id DESC LIMIT 20`),requests=(await this.db.query(`SELECT COALESCE(SUM(request_count),0)::float8 AS count,COALESCE(SUM(request_duration_ms),0)::float8 AS duration FROM source_collection_job`)).rows[0];
    return {checkedAt:now,workers:workers.rows.map(row=>({id:row.id,startedAt:iso(row.started_at)!,lastHeartbeatAt:iso(row.last_heartbeat_at)!,state:row.state,lastJobId:row.last_job_id,stale:row.state!=="stopped"&&Date.parse(now)-Date.parse(iso(row.last_heartbeat_at)!)>90000})),queue:counts.rows.map(row=>({status:row.status,count:row.count})),oldestQueuedAt:iso(pending.rows[0].oldest),sources:sources.map(item=>({sourceId:item.id,state:item.state,lastSuccessAgeHours:age(item.lastSuccessAt),latestPublishedAgeHours:age(item.latestPublishedAt),coverage:item.coverage,nextDueAt:item.nextDueAt,activeJobs:active.rows.find(row=>row.collection_source_id===item.id)?.count??0})),providers:await this.providerUsage(now),recentFailures:failures.rows.map(row=>({jobId:row.id,sourceId:row.collection_source_id,error:row.error??"Collection failed",finishedAt:iso(row.finished_at)})),requests:{registeredCount:requests.count,totalDurationMs:requests.duration,scope:"retained_jobs"}};
  }
  private filters(query: ContentQuery) {
    const params: unknown[] = [], terms = ["c.platform_details IS NOT NULL"];
    const bind = (value: unknown) => { params.push(value); return `$${params.length}`; };
    if (query.platform) terms.push(`p.code=${bind(query.platform)}`);
    if (query.kind) terms.push(`c.kind=${bind(query.kind)}`);
    if (query.query) terms.push(`strpos(lower(COALESCE(c.title,'') || ' ' || COALESCE(c.body_text,'')),lower(${bind(query.query)}))>0`);
    if (query.from) terms.push(`c.created_at_source>=${bind(query.from)}::timestamptz`);
    if (query.to) terms.push(`c.created_at_source<${bind(query.to)}::timestamptz`);
    const sourceTerms = ["d.content_id=c.id"];
    if (query.sourceId) sourceTerms.push(`d.collection_source_id=${bind(query.sourceId)}`);
    if (query.provider) sourceTerms.push(`cs.provider=${bind(query.provider)}`);
    const observationScope = sourceTerms.slice(1).map(term => term.replaceAll("d.collection_source_id", "o.collection_source_id").replaceAll("cs.provider", "o.provider"));
    terms.push(`EXISTS(SELECT 1 FROM content_discovery d JOIN collection_source cs ON cs.id=d.collection_source_id WHERE ${sourceTerms.join(" AND ")})`);
    return { params, terms, observationScope, bind };
  }
  async listContent(query: ContentQuery) {
    const { params, terms, observationScope, bind } = this.filters(query), cursor = decodeContentCursor(query);
    if (cursor) terms.push(`(COALESCE(c.created_at_source,c.first_seen_at),c.id)<(${bind(cursor.timestamp)}::timestamptz,${bind(cursor.id)}::uuid)`);
    const limit = query.limit ?? 25;
    const result = await this.db.query(`SELECT c.*,p.code AS platform,COALESCE(c.created_at_source,c.first_seen_at) AS sort_time,
      COALESCE((SELECT jsonb_agg(latest.payload) FROM (SELECT DISTINCT ON(o.collection_source_id)
        jsonb_build_object('provider',o.provider,'sourceId',o.collection_source_id,'sourceObservedAt',o.source_observed_at,'fetchedAt',o.fetched_at,'timeBasis',o.time_basis,'maturity',o.maturity,'metrics',o.metrics,'evidenceKey',o.evidence_key) AS payload
        FROM content_observation o WHERE o.content_id=c.id ${observationScope.length ? `AND ${observationScope.join(" AND ")}` : ""}
        ORDER BY o.collection_source_id,o.source_observed_at DESC NULLS LAST,o.fetched_at DESC,o.id DESC) latest),'[]'::jsonb) AS observations
      FROM content c JOIN source p ON p.id=c.source_id WHERE ${terms.join(" AND ")}
      ORDER BY sort_time DESC,c.id DESC LIMIT ${bind(limit+1)}`, params);
    const rows = result.rows.slice(0,limit), last = rows.at(-1);
    const items: PublicContent[] = rows.map(row => ({ id:row.id,platform:row.platform,kind:row.kind,externalId:row.external_id,title:row.title,text:row.body_text,url:row.permalink || row.url,language:row.language,author:row.content_author,publishedAt:iso(row.created_at_source),firstFetchedAt:iso(row.first_seen_at)!,lastFetchedAt:iso(row.last_seen_at)!,availability:row.availability,references:row.content_references,media:row.content_media,platformDetails:row.platform_details,observations:row.observations.map((obs: PublicContent["observations"][number]) => ({ ...obs, sourceObservedAt: iso(obs.sourceObservedAt), fetchedAt: iso(obs.fetchedAt)! })) }));
    return { items, nextCursor: result.rows.length>limit && last ? encodeContentCursor(query,iso(last.sort_time)!,last.id) : null };
  }
  async contentStats(query: ContentQuery): Promise<Omit<ContentStatsResponse,"ok"|"requestId">> {
    const { params, terms } = this.filters(query);
    const result = await this.db.query(`SELECT c.kind,to_char(c.created_at_source AT TIME ZONE 'UTC','YYYY-MM-DD') AS day,COUNT(*)::int AS count FROM content c JOIN source p ON p.id=c.source_id WHERE ${terms.join(" AND ")} GROUP BY c.kind,day ORDER BY day`,params);
    const byKind = new Map<PublicContent["kind"],number>(), daily = new Map<string,number>(); let total=0, unknownPublishedAtCount=0;
    for (const row of result.rows) { total+=row.count; byKind.set(row.kind,(byKind.get(row.kind)??0)+row.count); if (row.day===null) unknownPublishedAtCount+=row.count; else { const day=String(row.day); daily.set(day,(daily.get(day)??0)+row.count); } }
    return { total,byKind:[...byKind].map(([kind,count])=>({kind,count})),daily:[...daily].map(([day,count])=>({day,count})),scope:"collected_content",unknownPublishedAtCount };
  }
}
