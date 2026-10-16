import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { Client, type QueryResult, type QueryResultRow } from "pg";
import { PostgresClient } from "../src/storage/postgres/postgres-client";
import { runMigrations } from "../src/storage/schema/run-migrations";
import { PostgresSourceContentRepository } from "../src/storage/repositories/postgres/postgres-source-content.repository";
import { backfillPublicSearchIndex } from "../src/storage/backfill-public-search-index";
import type { ContentQuery } from "../packages/contracts/src/source-content";

class MeasuredDatabase extends PostgresClient {
  lastStatement: { text: string; params: unknown[] } | null = null;
  override query<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<QueryResult<T>> {
    this.lastStatement = { text, params }; return super.query<T>(text, params);
  }
}
let benchmarkPhase="initialization";
const markPhase=(phase:string)=>{benchmarkPhase=phase;console.error(JSON.stringify({event:"benchmark_phase",phase}));};
const option = (name: string) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const summary = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { samples: sorted.length, minMs: sorted[0], medianMs: sorted[Math.ceil(sorted.length * .5) - 1],
    p95Ms: sorted[Math.ceil(sorted.length * .95) - 1], maxMs: sorted.at(-1) };
};

async function main() {
  const raw = process.env.TEST_SOURCE_DATABASE_URL;
  if (!raw) throw new Error("TEST_SOURCE_DATABASE_URL is required; benchmark never uses the business database");
  const url = new URL(raw);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["localhost", "127.0.0.1"].includes(url.hostname) || url.search || url.hash || !/^\/source_validation_[a-z0-9_]+$/.test(url.pathname)) throw new Error("Benchmark needs dedicated loopback source_validation_* PostgreSQL without URL options");
  const rows = Number(option("--rows") ?? 20000), repeats = Number(option("--repeats") ?? 20);
  if (!Number.isInteger(rows) || rows < 1000 || rows > 100000 || !Number.isInteger(repeats) || repeats < 5 || repeats > 100) throw new Error("Bounded benchmark rows=1000–100000, repeats=5–100");
  const database = `source_validation_benchmark_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const report = path.resolve(option("--out") ?? `output/validation/${database}.json`);
  if (!report.startsWith(path.resolve("output") + path.sep)) throw new Error("Benchmark report must remain under output/");
  const adminUrl = new URL(url); adminUrl.pathname = "/postgres";
  const admin = new Client({ connectionString: adminUrl.href }); await admin.connect();
  try { await admin.query(`CREATE DATABASE "${database}"`); } finally { await admin.end(); }
  url.pathname = `/${database}`;
  const db = new MeasuredDatabase({ connectionString: url.href, max: 2 });
  let peakClientRssBytes = process.memoryUsage().rss;
  try {
    markPhase("migrations");
    await runMigrations({ db });
    const redditSource = randomUUID(), xSource = randomUUID(), now = "2026-10-13T01:00:00.000Z";
    const beforeWal = (await db.query("SELECT pg_current_wal_lsn()::text AS lsn")).rows[0].lsn;
    markPhase("synthetic_seed");
    await db.query(`INSERT INTO collection_source(id,platform_id,provider,label,target,content_kind,created_at,updated_at)
      SELECT $1::uuid,id,'demo_reddit','Synthetic benchmark Reddit','{"type":"community","community":"benchmark"}'::jsonb,'post',$3::timestamptz,$3::timestamptz FROM source WHERE code='reddit'
      UNION ALL SELECT $2::uuid,id,'demo_x','Synthetic benchmark X','{"type":"search","query":"benchmark"}'::jsonb,'post',$3::timestamptz,$3::timestamptz FROM source WHERE code='x'`, [redditSource, xSource, now]);
    await db.query(`INSERT INTO content(id,source_id,external_id,kind,title,body_text,url,created_at_source,first_seen_at,last_seen_at,platform_details,availability,language,content_author)
      SELECT md5('source-benchmark:'||n)::uuid,p.id,'synthetic-'||n,'post','Synthetic benchmark '||n,
        CASE WHEN n%7=0 THEN 'needle 中文 ' ELSE 'ordinary ' END||repeat('synthetic retained body ',45),
        'https://example.test/synthetic/'||n,$2::timestamptz-(n%720)*interval '1 hour',$2,$2,
        CASE WHEN p.code='reddit' THEN '{"platform":"reddit","community":"benchmark","flair":null,"nsfw":false}'::jsonb
          ELSE '{"platform":"x","conversationId":null,"isReply":false,"isRepost":false,"isQuote":false,"sensitive":false}'::jsonb END,
        'available',CASE WHEN n%3=0 THEN 'zh' ELSE 'en' END,jsonb_build_object('externalId','author-'||n%100,'handle','author-'||n%100,'displayName',NULL,'url',NULL)
      FROM generate_series(1,$1::integer) n JOIN source p ON p.code=CASE WHEN n%2=1 THEN 'reddit' ELSE 'x' END`, [rows, now]);
    await db.query(`INSERT INTO content_discovery(content_id,collection_source_id,first_fetched_at,last_fetched_at)
      SELECT c.id,cs.id,$3,$3 FROM content c JOIN collection_source cs ON cs.platform_id=c.source_id WHERE cs.id=ANY(ARRAY[$1,$2]::uuid[])`, [redditSource, xSource, now]);
    await db.query(`INSERT INTO content_observation(content_id,collection_source_id,provider,source_observed_at,fetched_at,time_basis,maturity,metrics,evidence_key)
      SELECT d.content_id,d.collection_source_id,cs.provider,$1::timestamptz-interval '1 hour',
        $1::timestamptz-interval '1 hour','provider_snapshot','unknown',jsonb_build_object(CASE WHEN cs.provider='demo_reddit' THEN 'reddit.score' ELSE 'x.likes' END,10),'older'
      FROM content_discovery d JOIN collection_source cs ON cs.id=d.collection_source_id
      UNION ALL SELECT d.content_id,d.collection_source_id,cs.provider,$1,$1,'provider_snapshot','unknown',
        jsonb_build_object(CASE WHEN cs.provider='demo_reddit' THEN 'reddit.score' ELSE 'x.likes' END,20),'latest'
      FROM content_discovery d JOIN collection_source cs ON cs.id=d.collection_source_id`, [now]);
    // Direct SQL fixture seeding deliberately bypasses page commits. Populate
    // the public projection explicitly before timing any keyword reads.
    markPhase("explicit_public_index_backfill");
    const indexStarted=performance.now();let indexScanned=0,indexWritten=0,indexBatches=0,indexCursor:string|undefined;
    for(;;){const batch=await backfillPublicSearchIndex(db,{limit:1000,after:indexCursor,now});indexScanned+=batch.scanned;indexWritten+=batch.written;indexBatches++;if(!batch.remaining)break;if(!batch.nextCursor||batch.requiresRescan)throw new Error("Synthetic public-index backfill did not finish its bounded ordered pass");indexCursor=batch.nextCursor;}
    const indexBackfillMs=performance.now()-indexStarted;
    const indexCoverage=(await db.query(`SELECT COUNT(*)::integer AS public_content,COUNT(d.content_id)::integer AS indexed,COUNT(d.content_id) FILTER(WHERE d.text_present)::integer AS text_present FROM content c LEFT JOIN public_content_search_document d ON d.content_id=c.id AND d.format_version=1 WHERE c.platform_details IS NOT NULL`)).rows[0];
    if(indexCoverage.public_content!==rows||indexCoverage.indexed!==rows||indexWritten!==rows)throw new Error("Synthetic public search projection coverage differs from the seeded content");
    peakClientRssBytes=Math.max(peakClientRssBytes,process.memoryUsage().rss);
    await db.query("ANALYZE content"); await db.query("ANALYZE content_discovery"); await db.query("ANALYZE content_observation");await db.query("ANALYZE public_content_search_document");
    const walBytes = Number((await db.query("SELECT pg_wal_lsn_diff(pg_current_wal_lsn(),$1::pg_lsn)::text AS bytes", [beforeWal])).rows[0].bytes);
    const repository = new PostgresSourceContentRepository(db);
    const cases: { name: string; query: ContentQuery; expectedTotal: number }[] = [
      { name: "all-platforms-page-and-total", query: { limit: 25 }, expectedTotal: rows },
      { name: "source-page-and-total", query: { sourceId: redditSource, limit: 25 }, expectedTotal: Math.ceil(rows / 2) },
      { name: "literal-text-page-and-total", query: { query: "needle 中文", limit: 25 }, expectedTotal: Math.floor(rows / 7) },
    ];
    const measurements = [];
    for (const item of cases) {
      markPhase(`measure_${item.name}`);
      await repository.listContent(item.query); await repository.contentStats(item.query);
      const listTimes: number[] = [], statsTimes: number[] = [];
      for (let i = 0; i < repeats; i++) {
        let started = performance.now(); const page = await repository.listContent(item.query); listTimes.push(performance.now() - started);
        if (page.items.length !== 25) throw new Error("Benchmark query returned an unexpected page");
        started = performance.now(); const stats = await repository.contentStats(item.query); statsTimes.push(performance.now() - started);
        if (stats.total !== item.expectedTotal) throw new Error("Benchmark denominator differs from synthetic fixture");
        peakClientRssBytes = Math.max(peakClientRssBytes, process.memoryUsage().rss);
      }
      await repository.listContent(item.query); const listStatement = db.lastStatement!;
      const listExplain = (await db.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${listStatement.text}`, listStatement.params)).rows[0]["QUERY PLAN"];
      await repository.contentStats(item.query); const statsStatement = db.lastStatement!;
      const statsExplain = (await db.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${statsStatement.text}`, statsStatement.params)).rows[0]["QUERY PLAN"];
      measurements.push({ name: item.name, expectedTotal: item.expectedTotal, list: summary(listTimes), stats: summary(statsTimes), listExplain, statsExplain });
    }
    markPhase("write_report");
    const databaseBytes = Number((await db.query("SELECT pg_database_size(current_database())::text AS bytes")).rows[0].bytes);
    const result = { version: 1, scope: "synthetic_repository_loopback_warm_cache", database, rows, observations: rows * 2, repeats, measurements,
      publicSearchIndex:{mode:"explicit_bounded_backfill_before_queries",formatVersion:1,batchLimit:1000,batches:indexBatches,scanned:indexScanned,written:indexWritten,durationMs:indexBackfillMs,coverage:{candidateCount:indexCoverage.public_content,indexed:indexCoverage.indexed,textPresent:indexCoverage.text_present,textMissing:indexCoverage.indexed-indexCoverage.text_present}},
      peakClientRssBytes, databaseAllocatedBytes: databaseBytes, clusterWalBytesDuringSeed: walBytes,
      limitations: ["Repository timings include client mapping; they are not full HTTP/UI latency", "Warm-cache synthetic content is not production load", "WAL delta is cluster-wide and may include concurrent tests", "Client RSS is this benchmark process, not API/worker/PostgreSQL combined memory"],
      realSourceRequests: 0, businessDatabaseModified: false };
    await mkdir(path.dirname(report), { recursive: true }); await writeFile(report, JSON.stringify(result, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ report: path.relative(process.cwd(), report), database, rows, observations: rows * 2,
      p95: measurements.map(item => ({ name: item.name, listMs: item.list.p95Ms, statsMs: item.stats.p95Ms })), realSourceRequests: 0 }));
  } finally { await db.close(); }
}
if (require.main === module) void main().catch(error => { console.error(JSON.stringify({event:"benchmark_failed",phase:benchmarkPhase,message:error instanceof Error?error.message:"Benchmark failed"})); process.exitCode = 1; });
