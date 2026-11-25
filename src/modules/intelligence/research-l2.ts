import { createHash } from "node:crypto";
import { Worker } from "node:worker_threads";
import { join } from "node:path";
import type { Pool, PoolClient } from "pg";
import type { Actor } from "../../../packages/contracts/src/access";
import type { L2ComparisonRequest, L2ComparisonResponse } from "../../../packages/contracts/src/research";
import { AppError, fail } from "../../shared/errors";
import { transaction } from "../../storage/db";
import { loadResearchAggregationScope, resolveResearchContext, type ResolvedResearchContext } from "../projects/index";
import { analyzeL2, type L2AnalysisJob, type L2Inputs } from "./research-l2-analysis";

const L2_TEXT_SAMPLE_LIMIT = 5000;
const L2_CACHE_TTL_MS = 180_000;
const l2MemCache = new Map<string, { expiresAt: number; value: L2ComparisonResponse }>();

function cacheKeyForL2(
  actor: Actor,
  projectId: string,
  dataVersion: string,
  input: Record<string, unknown>,
): { cacheKey: string; actorScopeHash: string; scopeHash: string } {
  const actorScopeHash = createHash("sha256")
    .update(JSON.stringify([actor.role, actor.userId ?? "", actor.allowedSourceIds ?? null]))
    .digest("hex")
    .slice(0, 24);
  const scopeHash = createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 32);
  const cacheKey = `l2:${projectId}:${dataVersion}:${actorScopeHash}:${scopeHash}`;
  return { cacheKey, actorScopeHash, scopeHash };
}

async function loadL2Inputs(
  client: PoolClient,
  actor: Actor,
  ctx: ResolvedResearchContext,
  request: L2ComparisonRequest,
): Promise<L2Inputs> {
  await client.query("SET LOCAL statement_timeout = '8000'");
  const { cteSql, values } = await loadResearchAggregationScope(client, actor, ctx);
  const tsExpr = ctx.scope.timeBasis === "collected" ? "dc.first_seen_at" : "dc.created_at_source";
  const compareMode = request.compareMode ?? "target";
  const byBatch = compareMode === "batch" && ctx.useBatchMappings && ctx.effectiveBatchMappings.length > 0;
  // Switch comparison object CTE between collection target (keywords/communities/accounts) and batches
  const objCte =
    byBatch
      ? `object_memberships AS MATERIALIZED (
           SELECT DISTINCT dc.id AS content_id, cbi.batch_id::text AS obj_key, cb.label AS obj_label, 'batch'::text AS obj_type
           FROM dedup_content dc
           JOIN collection_batch_item cbi ON cbi.content_id = dc.id
             AND cbi.batch_id = ANY($7::uuid[])
           JOIN collection_batch cb ON cb.id = cbi.batch_id
         )`
      : `object_memberships AS MATERIALIZED (
           SELECT DISTINCT content_id, target_key AS obj_key, target_label AS obj_label, target_type AS obj_type
           FROM scoped_memberships
         )`;

  const { rows: [inputs] } = await client.query<L2Inputs>(
    `${cteSql}, ${objCte},
     deg AS (
       SELECT content_id, COUNT(DISTINCT obj_key)::int AS cnt FROM object_memberships GROUP BY content_id
     ),
     sampled_content AS MATERIALIZED (
       SELECT * FROM dedup_content
       ORDER BY engagement_score DESC, COALESCE(created_at_source, first_seen_at) DESC
       LIMIT ${L2_TEXT_SAMPLE_LIMIT}
     ),
     doc_objs AS (
       SELECT om.content_id, ARRAY_AGG(DISTINCT om.obj_key) AS obj_keys
       FROM object_memberships om JOIN sampled_content sc ON sc.id = om.content_id
       GROUP BY om.content_id
     ),
     total AS (
       SELECT
         COUNT(*)::int AS total_count,
         COUNT(*) FILTER (WHERE ${tsExpr} IS NULL)::int AS undated_count
       FROM dedup_content dc
     ),
     object_stats AS (
       SELECT
         om.obj_key,
         MIN(om.obj_label) AS obj_label,
         MIN(om.obj_type) AS obj_type,
         COUNT(DISTINCT dc.id)::int AS content_count,
         COUNT(DISTINCT dc.id) FILTER (WHERE dc.kind = 'post')::int AS posts_count,
         COUNT(DISTINCT dc.id) FILTER (WHERE dc.kind = 'comment')::int AS comments_count,
         COUNT(DISTINCT dc.id) FILTER (WHERE d.cnt = 1)::int AS exclusive_count,
         COALESCE(AVG(dc.engagement_score), 0)::float8 AS avg_eng,
         COALESCE(SUM(dc.metric_comments) FILTER (WHERE dc.kind <> 'comment'), 0)::text AS reported_comments_sum
       FROM object_memberships om
       JOIN dedup_content dc ON dc.id = om.content_id
       JOIN deg d ON d.content_id = dc.id
       GROUP BY om.obj_key
       ORDER BY content_count DESC, obj_label ASC
       LIMIT 24
     ),
     object_trends AS (
       SELECT
         date_trunc('day', ${tsExpr} AT TIME ZONE 'UTC') AS bucket_utc,
         om.obj_key,
         MIN(om.obj_label) AS obj_label,
         COUNT(DISTINCT dc.id)::int AS cnt
       FROM object_memberships om
       JOIN dedup_content dc ON dc.id = om.content_id
       WHERE ${tsExpr} IS NOT NULL
       GROUP BY 1, om.obj_key
       ORDER BY 1 ASC, cnt DESC
     ),
     object_platforms AS (
       SELECT om.obj_key, MIN(om.obj_label) AS obj_label, dc.platform, COUNT(DISTINCT dc.id)::int AS cnt
       FROM object_memberships om
       JOIN dedup_content dc ON dc.id = om.content_id
       GROUP BY om.obj_key, dc.platform
       ORDER BY om.obj_key ASC, cnt DESC
     ),
     object_communities AS (
       SELECT om.obj_key, MIN(om.obj_label) AS obj_label, dc.community_name, MIN(dc.platform) AS platform, COUNT(DISTINCT dc.id)::int AS cnt
       FROM object_memberships om
       JOIN dedup_content dc ON dc.id = om.content_id
       WHERE dc.community_name IS NOT NULL
       GROUP BY om.obj_key, dc.community_name
       ORDER BY cnt DESC
       LIMIT 160
     ),
     object_overlap AS (
       SELECT a.obj_key AS row_key, b.obj_key AS col_key, COUNT(DISTINCT a.content_id)::int AS inter_cnt
       FROM object_memberships a
       JOIN object_memberships b ON a.content_id = b.content_id
       GROUP BY a.obj_key, b.obj_key
     ),
     text_docs AS (
       SELECT
         dc.id, c.title, c.body_text, c.clean_excerpt,
         ${tsExpr} AS ts_utc,
         dc.engagement_score,
         COALESCE(do2.obj_keys, ARRAY[]::text[]) AS obj_keys
       FROM sampled_content dc
       JOIN content c ON c.id = dc.id
       LEFT JOIN doc_objs do2 ON do2.content_id = dc.id
       ORDER BY dc.engagement_score DESC, COALESCE(dc.created_at_source, dc.first_seen_at) DESC
     )
     SELECT
       ARRAY(SELECT row_to_json(total) FROM total) AS total,
       ARRAY(SELECT row_to_json(object_stats) FROM object_stats) AS object_stats,
       ARRAY(SELECT row_to_json(object_trends) FROM object_trends) AS object_trends,
       ARRAY(SELECT row_to_json(object_platforms) FROM object_platforms) AS object_platforms,
       ARRAY(SELECT row_to_json(object_communities) FROM object_communities) AS object_communities,
       ARRAY(SELECT row_to_json(object_overlap) FROM object_overlap) AS overlaps,
       COALESCE((SELECT json_agg(text_docs) FROM text_docs), '[]'::json)::text AS text_docs`,
    byBatch ? [...values, ctx.scope.selectedBatchIds] : values,
  );
  return inputs;
}

// Bound cold computations before fetching text; identical requests share the same promise.
const inFlight = new Map<string, Promise<L2ComparisonResponse>>();
const MAX_COLD_COMPARISONS = 1;
let activeColdComparisons = 0;

async function runAnalysisWorker(job: L2AnalysisJob): Promise<L2ComparisonResponse> {
  const worker = __filename.endsWith(".ts")
    ? new Worker("require('tsx/cjs'); require(require('node:worker_threads').workerData.entry)", {
      eval: true, workerData: { ...job, entry: join(__dirname, "research-l2-analysis.ts") },
    })
    : new Worker(join(__dirname, "research-l2-analysis.js"), { workerData: job });
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<L2ComparisonResponse>((resolve, reject) => {
      deadline = setTimeout(() => reject(new AppError(503, "Research analysis timed out")), 12_000);
      worker.once("message", resolve);
      worker.once("error", reject);
      worker.once("exit", (code) => reject(new Error(`Research analysis worker exited before responding (${code})`)));
    });
  } finally {
    clearTimeout(deadline);
    await worker.terminate();
  }
}

export async function runL2ResearchComparison(
  pool: Pool,
  actor: Actor,
  projectId: string,
  input: L2ComparisonRequest,
): Promise<L2ComparisonResponse> {
  const ctx = await resolveResearchContext(pool, actor, projectId, input);
  const lang = input.lang ?? "zh";
  const cacheSig = {
    scope: ctx.scope,
    compareMode: input.compareMode ?? "target",
    topN: input.topN ?? 20,
    windowSplitAt: input.windowSplitAt ?? null,
    anomalySensitivity: input.anomalySensitivity ?? "medium",
    lang,
  };
  const { cacheKey, actorScopeHash, scopeHash } = cacheKeyForL2(actor, projectId, ctx.dataVersion, cacheSig);

  // 1. Check bounded memory cache first
  const memHit = l2MemCache.get(cacheKey);
  if (memHit && memHit.expiresAt > Date.now()) {
    return { ...memHit.value, cacheStatus: "hit" };
  }

  if (ctx.scope.emptySelection) {
    return analyzeL2({ ctx, request: input, inputs: {
      total: [], object_stats: [], object_trends: [], object_platforms: [],
      object_communities: [], overlaps: [], text_docs: "[]",
    } });
  }
  const pending = inFlight.get(cacheKey);
  if (pending) return pending;
  const calculation = calculate().finally(() => inFlight.delete(cacheKey));
  inFlight.set(cacheKey, calculation);
  return calculation;

  async function calculate(): Promise<L2ComparisonResponse> {
    // 2. Check durable PG16 intel_research_cache (tolerate missing table if running against unmigrated mock)
    try {
      const { rows } = await pool.query<{ payload_json: L2ComparisonResponse }>(
        `SELECT payload_json FROM intel_research_cache
         WHERE cache_key = $1 AND expires_at > NOW()`,
        [cacheKey],
      );
      if (rows[0]?.payload_json) {
        const hitPayload: L2ComparisonResponse = { ...rows[0].payload_json, cacheStatus: "hit" };
        l2MemCache.set(cacheKey, { expiresAt: Date.now() + L2_CACHE_TTL_MS, value: hitPayload });
        return hitPayload;
      }
    } catch {
      // Non-fatal if cache table is absent in isolated unit test mocks
    }

    // Allow durable-cache hits even while a cold computation is running.
    if (activeColdComparisons >= MAX_COLD_COMPARISONS) fail(503, "Research analysis is busy");
    activeColdComparisons++;
    try {
      // 3. Compute in read-only TX
      const jobCtx = { project: { id: ctx.project.id, name: ctx.project.name }, scope: ctx.scope, dataVersion: ctx.dataVersion };
      const inputs = await transaction(pool, async (client) => {
        await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
        return loadL2Inputs(client, actor, ctx, input);
      });
      const computed = await runAnalysisWorker({ ctx: jobCtx, request: input, inputs });

      if (l2MemCache.size >= 32) {
        const oldest = l2MemCache.keys().next().value;
        if (oldest !== undefined) l2MemCache.delete(oldest);
      }
      l2MemCache.set(cacheKey, { expiresAt: Date.now() + L2_CACHE_TTL_MS, value: computed });

      // Best-effort durable cache persistence
      try {
        await pool.query(
          `INSERT INTO intel_research_cache(
             cache_key, project_id, layer, actor_scope_hash, data_version, scope_hash, lang, payload_json, expires_at
           ) VALUES ($1, $2, 'l2', $3, $4, $5, $6, $7::jsonb, NOW() + INTERVAL '15 minutes')
           ON CONFLICT (cache_key) DO UPDATE SET payload_json = EXCLUDED.payload_json, expires_at = EXCLUDED.expires_at`,
          [cacheKey, projectId, actorScopeHash, ctx.dataVersion, scopeHash, lang, JSON.stringify(computed)],
        );
      } catch {
        // Non-fatal in isolated mock tests
      }

      return computed;
    } finally {
      activeColdComparisons--;
    }
  }
}

export function clearL2ResearchCacheForTests(): void {
  l2MemCache.clear();
}
