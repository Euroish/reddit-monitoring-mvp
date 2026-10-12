import { randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";
import type { CollectionSource, ContentQuery, ContentStatsResponse, CreateCollectionSourceRequest, PublicContent, SourceCollectionJob, StartSourceCollectionRequest } from "../../../../packages/contracts/src/source-content";
import type { ClaimedSourceJob, SourceContentRepository } from "../../../domain/repositories/source-content-repository";
import type { CollectedPage } from "../../../connectors/shared/content-provider.interface";
import type { PostgresClient } from "../../postgres/postgres-client";
import { decodeContentCursor, encodeContentCursor } from "../../source-content-query";
type Row = QueryResultRow;
const iso = (value: Date | string | null): string | null => value === null ? null : new Date(value).toISOString();
function source(row: Row): CollectionSource { return { id: row.id, platform: row.platform, provider: row.provider, label: row.label, target: row.target, contentKind: row.content_kind, createdAt: iso(row.created_at)!, lastSuccessAt: iso(row.last_success_at), latestPublishedAt: iso(row.latest_published_at), coverage: row.coverage }; }
function job(row: Row): SourceCollectionJob { return { id: row.id, sourceId: row.collection_source_id, status: row.status, from: iso(row.from_at)!, to: iso(row.to_at)!, pageSize: row.page_size, maxPages: row.max_pages, pagesCommitted: row.pages_committed, recordsProcessed: row.records_processed, checkpoint: row.checkpoint, coverage: row.coverage, exhausted: row.exhausted, attempts: row.attempts, error: row.error, nextRunAt: iso(row.next_run_at)!, createdAt: iso(row.created_at)!, finishedAt: iso(row.finished_at) }; }
const sourceSelect = "SELECT cs.*, s.code AS platform FROM collection_source cs JOIN source s ON s.id=cs.platform_id";

export class PostgresSourceContentRepository implements SourceContentRepository {
  constructor(private readonly db: PostgresClient) {}
  async listSources() { return (await this.db.query(`${sourceSelect} ORDER BY cs.created_at, cs.id`)).rows.map(source); }
  async getSource(id: string) { const result = await this.db.query(`${sourceSelect} WHERE cs.id=$1`, [id]); return result.rows[0] ? source(result.rows[0]) : null; }
  async createSource(input: CreateCollectionSourceRequest & { id: string; label: string; createdAt: string }) {
    const result = await this.db.query(`INSERT INTO collection_source(id,platform_id,provider,label,target,content_kind,created_at)
      SELECT $1,s.id,$3,$4,$5::jsonb,$6,$7 FROM source s WHERE s.code=$2
      ON CONFLICT(platform_id,provider,content_kind,target) DO UPDATE SET label=EXCLUDED.label RETURNING id`, [input.id, input.platform, input.provider, input.label, JSON.stringify(input.target), input.contentKind, input.createdAt]);
    if (!result.rows[0]) throw new Error("Platform is not registered in the database");
    return (await this.getSource(result.rows[0].id))!;
  }
  async enqueue(input: Required<StartSourceCollectionRequest> & { id: string; sourceId: string; now: string }) {
    const result = await this.db.query(`INSERT INTO source_collection_job(id,collection_source_id,status,from_at,to_at,page_size,max_pages,next_run_at,created_at)
      VALUES($1,$2,'queued',$3,$4,$5,$6,$7,$7)
      ON CONFLICT(collection_source_id) WHERE status IN ('queued','running','retrying') DO UPDATE SET collection_source_id=EXCLUDED.collection_source_id RETURNING *`, [input.id, input.sourceId, input.from, input.to, input.pageSize, input.maxPages, input.now]);
    return job(result.rows[0]);
  }
  async getJob(id: string) { const result = await this.db.query("SELECT * FROM source_collection_job WHERE id=$1", [id]); return result.rows[0] ? job(result.rows[0]) : null; }
  async retryJob(id: string, now: string) {
    try {
      const result = await this.db.query(`UPDATE source_collection_job SET status='queued',attempts=0,error=NULL,next_run_at=$2,finished_at=NULL,lease_token=NULL,lease_until=NULL
        WHERE id=$1 AND status='failed' AND NOT EXISTS(SELECT 1 FROM source_collection_job active WHERE active.collection_source_id=source_collection_job.collection_source_id AND active.status IN ('queued','running','retrying')) RETURNING *`, [id, now]);
      return result.rows[0] ? job(result.rows[0]) : null;
    } catch (error) { if ((error as { code?: string }).code === "23505") return null; throw error; }
  }
  async claim(now: string): Promise<ClaimedSourceJob | null> {
    const leaseToken = randomUUID();
    const result = await this.db.query(`WITH runnable AS (
      SELECT id FROM source_collection_job WHERE (status IN ('queued','retrying') AND next_run_at <= $1) OR (status='running' AND lease_until <= $1)
      ORDER BY next_run_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
      UPDATE source_collection_job j SET status='running',lease_token=$2,lease_until=$1::timestamptz + interval '2 minutes',attempts=attempts+1
      FROM runnable WHERE j.id=runnable.id RETURNING j.*`, [now, leaseToken]);
    return result.rows[0] ? { job: job(result.rows[0]), leaseToken } : null;
  }
  async continueJob(id: string, newId: string, now: string) {
    const result = await this.db.query(`INSERT INTO source_collection_job(id,collection_source_id,status,from_at,to_at,page_size,max_pages,checkpoint,next_run_at,created_at)
      SELECT $2,collection_source_id,'queued',from_at,to_at,page_size,max_pages,checkpoint,$3,$3 FROM source_collection_job WHERE id=$1 AND status='succeeded' AND checkpoint IS NOT NULL AND checkpoint<>'null'::jsonb
      ON CONFLICT(collection_source_id) WHERE status IN ('queued','running','retrying') DO UPDATE SET collection_source_id=EXCLUDED.collection_source_id RETURNING *`, [id,newId,now]);
    return result.rows[0] ? job(result.rows[0]) : null;
  }
  async commitPage(claim: ClaimedSourceJob, page: CollectedPage, now: string) {
    await this.db.withTransaction(async client => {
      const locked = await client.query(`SELECT j.*,s.platform_id,p.code AS platform FROM source_collection_job j JOIN collection_source s ON s.id=j.collection_source_id JOIN source p ON p.id=s.platform_id WHERE j.id=$1 AND j.status='running' AND j.lease_token=$2 FOR UPDATE OF j`, [claim.job.id, claim.leaseToken]);
      const current = locked.rows[0]; if (!current) throw new Error("Collection lease lost");
      for (const item of page.items) {
        if (item.platform !== current.platform || item.platformDetails.platform !== item.platform || item.observation.sourceId !== current.collection_source_id) throw new Error("Page/source identity mismatch");
        const inserted = await client.query(`INSERT INTO content(id,source_id,target_id,external_id,kind,title,body_text,url,permalink,created_at_source,first_seen_at,last_seen_at,total_eligible,content_author,content_media,content_references,platform_details,language,availability,content_observed_at)
          VALUES($1,$2,NULL,$3,$4,$5,$6,$7,$7,$8,$9,$9,FALSE,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14,$15,$16)
          ON CONFLICT(source_id,kind,external_id) DO UPDATE SET
            title=CASE WHEN content.content_observed_at IS NULL OR EXCLUDED.content_observed_at>=content.content_observed_at THEN EXCLUDED.title ELSE content.title END,
            body_text=CASE WHEN content.content_observed_at IS NULL OR EXCLUDED.content_observed_at>=content.content_observed_at THEN EXCLUDED.body_text ELSE content.body_text END,
            content_author=CASE WHEN content.content_observed_at IS NULL OR EXCLUDED.content_observed_at>=content.content_observed_at THEN EXCLUDED.content_author ELSE content.content_author END,
            availability=CASE WHEN content.content_observed_at IS NULL OR EXCLUDED.content_observed_at>=content.content_observed_at THEN EXCLUDED.availability ELSE content.availability END,
            content_observed_at=GREATEST(content.content_observed_at,EXCLUDED.content_observed_at),
            platform_details=CASE WHEN content.content_observed_at IS NULL OR EXCLUDED.content_observed_at>=content.content_observed_at THEN EXCLUDED.platform_details ELSE content.platform_details END,
            permalink=COALESCE(EXCLUDED.permalink,content.permalink),url=COALESCE(EXCLUDED.url,content.url),
            content_references=EXCLUDED.content_references,content_media=EXCLUDED.content_media,
            last_seen_at=GREATEST(content.last_seen_at,EXCLUDED.last_seen_at)
          RETURNING id`, [item.id,current.platform_id,item.externalId,item.kind,item.title,item.text,item.url,item.publishedAt,item.fetchedAt,JSON.stringify(item.author),JSON.stringify(item.media),JSON.stringify(item.references),JSON.stringify(item.platformDetails),item.language,item.availability,item.observation.sourceObservedAt]);
        const contentId = inserted.rows[0].id, obs = item.observation;
        await client.query(`INSERT INTO content_discovery(content_id,collection_source_id,first_fetched_at,last_fetched_at) VALUES($1,$2,$3,$3)
          ON CONFLICT(content_id,collection_source_id) DO UPDATE SET last_fetched_at=GREATEST(content_discovery.last_fetched_at,EXCLUDED.last_fetched_at)`, [contentId,current.collection_source_id,item.fetchedAt]);
        await client.query(`INSERT INTO content_observation(content_id,collection_source_id,provider,source_observed_at,fetched_at,time_basis,maturity,metrics,evidence_key)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) ON CONFLICT(content_id,collection_source_id,evidence_key) DO UPDATE SET fetched_at=GREATEST(content_observation.fetched_at,EXCLUDED.fetched_at)`, [contentId,current.collection_source_id,obs.provider,obs.sourceObservedAt,obs.fetchedAt,obs.timeBasis,obs.maturity,JSON.stringify(obs.metrics),obs.evidenceKey]);
      }
      const done = page.exhausted || page.nextCheckpoint === null || current.pages_committed + 1 >= current.max_pages;
      const coverage = !page.exhausted || page.coverage === "partial" ? "partial" : "unknown";
      await client.query(`UPDATE source_collection_job SET checkpoint=$3::jsonb,pages_committed=pages_committed+1,records_processed=records_processed+$4,status=$5,coverage=$6,exhausted=$7,error=$8,finished_at=$9,next_run_at=$10,attempts=0,lease_token=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2`, [claim.job.id,claim.leaseToken,JSON.stringify(page.nextCheckpoint),page.items.length,done ? "succeeded" : "queued",coverage,page.exhausted,page.warning,done ? now : null,new Date(Date.parse(now)+5_000).toISOString()]);
      const latest = page.items.map(item => item.publishedAt).filter((value): value is string => value !== null).sort().at(-1) ?? null;
      await client.query(`UPDATE collection_source SET last_success_at=$2,latest_published_at=GREATEST(latest_published_at,$3::timestamptz),coverage=$4 WHERE id=$1`, [current.collection_source_id,now,latest,coverage]);
    });
  }
  async failJob(claim: ClaimedSourceJob, error: string, retryAt: string | null, now: string) {
    await this.db.query(`UPDATE source_collection_job SET status=$3,error=$4,next_run_at=$5,finished_at=$6,lease_token=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2`, [claim.job.id,claim.leaseToken,retryAt ? "retrying" : "failed",error,retryAt ?? now,retryAt ? null : now]);
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
