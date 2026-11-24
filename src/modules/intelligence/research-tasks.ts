import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { Actor } from "../../../packages/contracts/src/access";
import type {
  CreateResearchTaskRequest,
  L3ResearchTaskRecord,
  L3SentimentSummary,
  L3TopicSummary,
  NormalizedAnalysisScope,
  ResearchTaskStatusValue,
  ResearchTaskTypeValue,
} from "../../../packages/contracts/src/research";
import { fail } from "../../shared/errors";
import { transaction } from "../../storage/db";
import { contentVisibility } from "../collection/index";
import { buildScopedSql, resolveResearchContext } from "../projects/index";
import {
  runSentimentAnalysisTask,
  runTopicDiscoveryTask,
  SENTIMENT_ALGO_VERSION,
  TOPIC_ALGO_VERSION,
  type L3SourceDocument,
} from "./research-l3-algorithms";

const maxConcurrent = Math.max(1, Number(process.env.RESEARCH_MAX_CONCURRENT_TASKS ?? "2") || 2);
const activeControllers = new Map<string, AbortController>();
const pendingQueue: Array<{
  taskId: string;
  pool: Pool;
  actor: Actor;
  projectId: string;
}> = [];
let runningCount = 0;

interface TaskRow {
  id: string;
  project_id: string;
  created_by_user_id: string | null;
  task_type: ResearchTaskTypeValue;
  status: ResearchTaskStatusValue;
  scope_hash: string;
  scope_json: NormalizedAnalysisScope;
  config_json: Record<string, unknown>;
  data_version: string;
  algorithm_version: string;
  sample_limit: number;
  sample_count: number;
  progress_pct: number;
  progress_stage: string;
  summary_json: L3SentimentSummary | L3TopicSummary | null;
  error_message: string | null;
  retry_count: number;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
}

function rowToTaskRecord(row: TaskRow, currentDataVersion: string): L3ResearchTaskRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    taskType: row.task_type,
    status: row.status,
    dataVersion: row.data_version,
    isStale: row.data_version !== currentDataVersion,
    algorithmVersion: row.algorithm_version,
    sampleLimit: row.sample_limit,
    sampleCount: row.sample_count,
    progressPct: row.progress_pct,
    progressStage: row.progress_stage,
    scope: row.scope_json,
    config: row.config_json ?? {},
    summary: row.summary_json ?? null,
    errorMessage: row.error_message,
    retryCount: row.retry_count,
    createdAt: row.created_at.toISOString(),
    startedAt: row.started_at ? row.started_at.toISOString() : null,
    finishedAt: row.finished_at ? row.finished_at.toISOString() : null,
  };
}

function pumpQueue() {
  while (runningCount < maxConcurrent && pendingQueue.length > 0) {
    const next = pendingQueue.shift()!;
    runningCount++;
    void executeQueuedTask(next).finally(() => {
      runningCount = Math.max(0, runningCount - 1);
      setImmediate(pumpQueue);
    });
  }
}

async function executeQueuedTask(entry: {
  taskId: string;
  pool: Pool;
  actor: Actor;
  projectId: string;
}) {
  const { taskId, pool, actor, projectId } = entry;
  const controller = new AbortController();
  activeControllers.set(taskId, controller);

  try {
    // Claim queued row (if cancelled in queue, skip execution)
    const { rows: [claimed] } = await pool.query<TaskRow>(
      `UPDATE intel_research_task
       SET status = 'running',
           progress_pct = 10,
           progress_stage = 'loading_samples',
           started_at = COALESCE(started_at, NOW()),
           updated_at = NOW()
       WHERE id = $1 AND project_id = $2 AND status = 'queued'
       RETURNING *`,
      [taskId, projectId],
    );
    if (!claimed) return;

    const scopeInput = {
      ...(claimed.scope_json.selectedBatchIds.length
        ? { batchIds: claimed.scope_json.selectedBatchIds }
        : claimed.scope_json.selectedSourceIds.length
          ? { sourceIds: claimed.scope_json.selectedSourceIds }
          : {}),
      ...(claimed.scope_json.from ? { from: claimed.scope_json.from } : {}),
      ...(claimed.scope_json.to ? { to: claimed.scope_json.to } : {}),
      timeBasis: claimed.scope_json.timeBasis,
      ...(claimed.scope_json.platforms.length ? { platforms: claimed.scope_json.platforms } : {}),
      ...(claimed.scope_json.kinds.length ? { kinds: claimed.scope_json.kinds } : {}),
      ...(claimed.scope_json.communities.length ? { communities: claimed.scope_json.communities } : {}),
      ...(claimed.scope_json.languages.length ? { languages: claimed.scope_json.languages } : {}),
      ...(claimed.scope_json.signal ? { signal: claimed.scope_json.signal } : {}),
      threadAware: claimed.scope_json.threadAware,
      includeUndated: claimed.scope_json.includeUndated,
      lang: (claimed.config_json?.lang as "zh" | "en") ?? "zh",
    };

    const ctx = await resolveResearchContext(pool, actor, projectId, scopeInput);
    if (ctx.scope.emptySelection) {
      await pool.query(
        `UPDATE intel_research_task
         SET status = 'failed', error_message = 'Selected scope contains 0 targets or batches', finished_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [taskId],
      );
      return;
    }

    const { cteSql, values } = buildScopedSql(actor, ctx);
    const tsExpr = ctx.scope.timeBasis === "collected" ? "dc.first_seen_at" : "dc.created_at_source";

    const docsRes = await pool.query<{
      id: string;
      platform: "reddit" | "x" | "bluesky" | "web";
      title: string | null;
      body_text: string | null;
      clean_excerpt: string | null;
      ts_utc: Date | null;
      engagement_score: number;
      target_pairs: Array<{ key: string; label: string }>;
    }>(
      `${cteSql},
       doc_targets AS (
         SELECT
           content_id,
           JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT('key', target_key, 'label', target_label)) AS target_pairs
         FROM scoped_memberships
         GROUP BY content_id
       )
       SELECT
         dc.id, dc.platform, dc.title, dc.body_text, dc.clean_excerpt,
         ${tsExpr} AS ts_utc,
         dc.engagement_score,
         COALESCE(dt.target_pairs, '[]'::jsonb) AS target_pairs
       FROM dedup_content dc
       LEFT JOIN doc_targets dt ON dt.content_id = dc.id
       ORDER BY dc.engagement_score DESC, COALESCE(dc.created_at_source, dc.first_seen_at) DESC
       LIMIT $${values.length + 1}`,
      [...values, claimed.sample_limit],
    );

    if (controller.signal.aborted) {
      throw new Error("Task cancelled");
    }

    const docs: L3SourceDocument[] = docsRes.rows.map((r) => ({
      id: r.id,
      platform: r.platform,
      title: r.title,
      text: r.body_text || r.clean_excerpt || "",
      bucket: r.ts_utc ? r.ts_utc.toISOString().slice(0, 10) : null,
      targetKeys: Array.isArray(r.target_pairs) ? r.target_pairs : [],
      engagementScore: Number(r.engagement_score ?? 0),
    }));

    const lang = (claimed.config_json?.lang as "zh" | "en") ?? "zh";
    let lastReportedPct = 10;
    const onProgress = async (pct: number, stage: string) => {
      if (controller.signal.aborted) return;
      if (pct - lastReportedPct >= 15 || pct >= 90) {
        lastReportedPct = pct;
        await pool.query(
          `UPDATE intel_research_task
           SET progress_pct = $2, progress_stage = $3, updated_at = NOW()
           WHERE id = $1 AND status = 'running'`,
          [taskId, pct, stage],
        );
      }
    };

    const result =
      claimed.task_type === "sentiment"
        ? await runSentimentAnalysisTask(docs, { lang, signal: controller.signal, onProgress })
        : await runTopicDiscoveryTask(docs, {
            lang,
            numTopics: Number(claimed.config_json?.numTopics ?? 5) || 5,
            maxVocab: Number(claimed.config_json?.maxVocab ?? 400) || 400,
            signal: controller.signal,
            onProgress,
          });

    if (controller.signal.aborted) {
      throw new Error("Task cancelled");
    }

    // Persist items and summary atomically
    await transaction(pool, async (client) => {
      const { rows: [curRow] } = await client.query<{ status: string }>(
        `SELECT status FROM intel_research_task WHERE id = $1 FOR UPDATE`,
        [taskId],
      );
      if (!curRow || curRow.status === "cancelled") {
        return;
      }

      await client.query(`DELETE FROM intel_research_task_item WHERE task_id = $1`, [taskId]);

      if (result.items.length > 0) {
        const contentIds = result.items.map((it) => it.contentId);
        const sentLabels = result.items.map((it) => it.sentimentLabel ?? null);
        const sentScores = result.items.map((it) => it.sentimentScore ?? null);
        const topicIdx = result.items.map((it) => it.topicIndex ?? null);
        const topicScores = result.items.map((it) => it.topicScore ?? null);
        await client.query(
          `INSERT INTO intel_research_task_item(
             task_id, content_id, sentiment_label, sentiment_score, topic_index, topic_score
           )
           SELECT $1, cid, sl, ss, ti, ts
           FROM UNNEST($2::uuid[], $3::text[], $4::double precision[], $5::int[], $6::double precision[])
             AS t(cid, sl, ss, ti, ts)
           ON CONFLICT (task_id, content_id) DO UPDATE SET
             sentiment_label = EXCLUDED.sentiment_label,
             sentiment_score = EXCLUDED.sentiment_score,
             topic_index = EXCLUDED.topic_index,
             topic_score = EXCLUDED.topic_score`,
          [taskId, contentIds, sentLabels, sentScores, topicIdx, topicScores],
        );
      }

      await client.query(
        `UPDATE intel_research_task
         SET status = 'succeeded',
             progress_pct = 100,
             progress_stage = 'completed',
             sample_count = $2,
             summary_json = $3::jsonb,
             finished_at = NOW(),
             updated_at = NOW()
         WHERE id = $1 AND status = 'running'`,
        [taskId, docs.length, JSON.stringify(result.summary)],
      );
    });
  } catch (err) {
    const isCancel = controller.signal.aborted || (err instanceof Error && err.message === "Task cancelled");
    if (isCancel) {
      await pool.query(
        `UPDATE intel_research_task
         SET status = 'cancelled', progress_stage = 'cancelled', finished_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND status IN ('queued', 'running')`,
        [taskId],
      ).catch(() => undefined);
    } else {
      const msg = err instanceof Error ? err.message : "Unknown task execution failure";
      await pool.query(
        `UPDATE intel_research_task
         SET status = 'failed', progress_stage = 'failed', error_message = $2, finished_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND status IN ('queued', 'running')`,
        [taskId, msg.slice(0, 400)],
      ).catch(() => undefined);
    }
  } finally {
    activeControllers.delete(taskId);
  }
}

export async function listResearchTasks(
  pool: Pool,
  actor: Actor,
  projectId: string,
): Promise<{ dataVersion: string; tasks: L3ResearchTaskRecord[] }> {
  const ctx = await resolveResearchContext(pool, actor, projectId, {});
  const { rows } = await pool.query<TaskRow>(
    `SELECT * FROM intel_research_task
     WHERE project_id = $1
     ORDER BY created_at DESC
     LIMIT 30`,
    [projectId],
  );
  return {
    dataVersion: ctx.dataVersion,
    tasks: rows.map((r) => rowToTaskRecord(r, ctx.dataVersion)),
  };
}

export async function getResearchTask(
  pool: Pool,
  actor: Actor,
  projectId: string,
  taskId: string,
): Promise<L3ResearchTaskRecord> {
  const ctx = await resolveResearchContext(pool, actor, projectId, {});
  const { rows: [row] } = await pool.query<TaskRow>(
    `SELECT * FROM intel_research_task WHERE id = $1 AND project_id = $2`,
    [taskId, projectId],
  );
  if (!row) fail(404, "Research task not found");
  return rowToTaskRecord(row, ctx.dataVersion);
}

export async function createResearchTask(
  pool: Pool,
  actor: Actor,
  projectId: string,
  input: CreateResearchTaskRequest,
): Promise<L3ResearchTaskRecord> {
  const ctx = await resolveResearchContext(pool, actor, projectId, input.scope);
  if (ctx.scope.emptySelection) {
    fail(422, "请至少选择一个关键词或数据批次后再启动深入分析任务。");
  }

  // Guard per-project active task backlog (max 5 active queued/running)
  const { rows: [activeCnt] } = await pool.query<{ cnt: number }>(
    `SELECT COUNT(*)::int AS cnt FROM intel_research_task
     WHERE project_id = $1 AND status IN ('queued', 'running')`,
    [projectId],
  );
  if ((activeCnt?.cnt ?? 0) >= 5) {
    fail(429, "当前项目同时排队的深入分析任务较多，请等待部分完成后再发起新任务。");
  }

  const taskId = randomUUID();
  const sampleLimit = Math.max(20, Math.min(20000, input.config?.sampleLimit ?? 3000));
  const algorithmVersion = input.taskType === "sentiment" ? SENTIMENT_ALGO_VERSION : TOPIC_ALGO_VERSION;
  const configJson = {
    ...(input.config ?? {}),
    lang: input.scope.lang ?? "zh",
  };
  const scopeHash = createHash("sha256")
    .update(JSON.stringify([ctx.scope, input.taskType, configJson]))
    .digest("hex")
    .slice(0, 32);

  const { rows: [inserted] } = await pool.query<TaskRow>(
    `INSERT INTO intel_research_task(
       id, project_id, created_by_user_id, task_type, status, scope_hash, scope_json,
       config_json, data_version, algorithm_version, sample_limit, progress_pct, progress_stage
     ) VALUES ($1, $2, $3, $4, 'queued', $5, $6::jsonb, $7::jsonb, $8, $9, $10, 0, 'queued')
     RETURNING *`,
    [
      taskId,
      projectId,
      actor.userId ?? null,
      input.taskType,
      scopeHash,
      JSON.stringify(ctx.scope),
      JSON.stringify(configJson),
      ctx.dataVersion,
      algorithmVersion,
      sampleLimit,
    ],
  );

  pendingQueue.push({ taskId, pool, actor, projectId });
  setImmediate(pumpQueue);

  return rowToTaskRecord(inserted, ctx.dataVersion);
}

export async function cancelResearchTask(
  pool: Pool,
  actor: Actor,
  projectId: string,
  taskId: string,
): Promise<L3ResearchTaskRecord> {
  const ctx = await resolveResearchContext(pool, actor, projectId, {});
  const ctrl = activeControllers.get(taskId);
  if (ctrl) ctrl.abort();
  const qIdx = pendingQueue.findIndex((q) => q.taskId === taskId);
  if (qIdx >= 0) pendingQueue.splice(qIdx, 1);

  const { rows: [updated] } = await pool.query<TaskRow>(
    `UPDATE intel_research_task
     SET status = CASE WHEN status IN ('queued', 'running') THEN 'cancelled' ELSE status END,
         progress_stage = CASE WHEN status IN ('queued', 'running') THEN 'cancelled' ELSE progress_stage END,
         finished_at = CASE WHEN status IN ('queued', 'running') THEN NOW() ELSE finished_at END,
         updated_at = NOW()
     WHERE id = $1 AND project_id = $2
     RETURNING *`,
    [taskId, projectId],
  );
  if (!updated) fail(404, "Research task not found");
  return rowToTaskRecord(updated, ctx.dataVersion);
}

export async function retryResearchTask(
  pool: Pool,
  actor: Actor,
  projectId: string,
  taskId: string,
): Promise<L3ResearchTaskRecord> {
  const ctx = await resolveResearchContext(pool, actor, projectId, {});
  const { rows: [existing] } = await pool.query<TaskRow>(
    `SELECT * FROM intel_research_task WHERE id = $1 AND project_id = $2`,
    [taskId, projectId],
  );
  if (!existing) fail(404, "Research task not found");
  if (existing.status === "queued" || existing.status === "running") {
    return rowToTaskRecord(existing, ctx.dataVersion);
  }

  const { rows: [updated] } = await pool.query<TaskRow>(
    `UPDATE intel_research_task
     SET status = 'queued',
         progress_pct = 0,
         progress_stage = 'queued',
         error_message = NULL,
         summary_json = NULL,
         data_version = $3,
         retry_count = retry_count + 1,
         started_at = NULL,
         finished_at = NULL,
         updated_at = NOW()
     WHERE id = $1 AND project_id = $2
     RETURNING *`,
    [taskId, projectId, ctx.dataVersion],
  );

  pendingQueue.push({ taskId, pool, actor, projectId });
  setImmediate(pumpQueue);
  return rowToTaskRecord(updated, ctx.dataVersion);
}

export async function deleteResearchTask(
  pool: Pool,
  actor: Actor,
  projectId: string,
  taskId: string,
): Promise<{ deleted: true; taskId: string }> {
  await resolveResearchContext(pool, actor, projectId, {});
  const ctrl = activeControllers.get(taskId);
  if (ctrl) ctrl.abort();
  const qIdx = pendingQueue.findIndex((q) => q.taskId === taskId);
  if (qIdx >= 0) pendingQueue.splice(qIdx, 1);

  const { rowCount } = await pool.query(
    `DELETE FROM intel_research_task WHERE id = $1 AND project_id = $2`,
    [taskId, projectId],
  );
  if (!rowCount) fail(404, "Research task not found");
  return { deleted: true, taskId };
}

export async function getResearchTaskEvidence(
  pool: Pool,
  actor: Actor,
  projectId: string,
  taskId: string,
  query: {
    sentiment?: "positive" | "neutral" | "negative" | "unclassified";
    topicIndex?: number;
    limit?: number;
    offset?: number;
  },
) {
  const task = await getResearchTask(pool, actor, projectId, taskId);
  const limit = Math.max(1, Math.min(100, query.limit ?? 30));
  const offset = Math.max(0, query.offset ?? 0);

  const conds = ["ti.task_id = $1", "c.availability = 'available'"];
  const values: unknown[] = [taskId];
  if (query.sentiment) {
    values.push(query.sentiment);
    conds.push(`ti.sentiment_label = $${values.length}`);
  }
  if (query.topicIndex !== undefined) {
    values.push(query.topicIndex);
    conds.push(`ti.topic_index = $${values.length}`);
  }
  const visClause = contentVisibility(actor).contains(
    (v) => `$${values.push(v)}`,
    "c.id",
  );
  conds.push(visClause);
  const whereSql = conds.join(" AND ");

  const [rowsRes, countRes] = await Promise.all([
    pool.query<{
      content_id: string;
      platform: string;
      kind: string;
      external_id: string;
      title: string | null;
      clean_excerpt: string | null;
      url: string | null;
      author_handle: string | null;
      community_name: string | null;
      created_at_source: Date | null;
      metric_score: number | null;
      metric_likes: number | null;
      metric_comments: number | null;
      engagement_score: number;
      sentiment_label: string | null;
      sentiment_score: number | null;
      topic_index: number | null;
      topic_score: number | null;
    }>(
      `SELECT
         c.id AS content_id,
         s.code AS platform,
         c.kind,
         c.external_id,
         c.title,
         COALESCE(c.clean_excerpt, LEFT(c.body_text, 280)) AS clean_excerpt,
         COALESCE(c.permalink, c.url) AS url,
         c.author_handle,
         c.community_name,
         c.created_at_source,
         c.metric_score,
         c.metric_likes,
         c.metric_comments,
         c.engagement_score,
         ti.sentiment_label,
         ti.sentiment_score,
         ti.topic_index,
         ti.topic_score
       FROM intel_research_task_item ti
       JOIN content c ON c.id = ti.content_id
       JOIN source s ON s.id = c.source_id
       WHERE ${whereSql}
       ORDER BY c.engagement_score DESC, COALESCE(c.created_at_source, c.first_seen_at) DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset],
    ),
    pool.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total
       FROM intel_research_task_item ti
       JOIN content c ON c.id = ti.content_id
       WHERE ${whereSql}`,
      values,
    ),
  ]);

  return {
    task: {
      id: task.id,
      taskType: task.taskType,
      status: task.status,
      isStale: task.isStale,
      sampleCount: task.sampleCount,
    },
    total: countRes.rows[0]?.total ?? 0,
    limit,
    offset,
    items: rowsRes.rows.map((r) => ({
      id: r.content_id,
      platform: r.platform,
      kind: r.kind,
      externalId: r.external_id,
      title: r.title,
      text: r.clean_excerpt,
      url: r.url,
      authorHandle: r.author_handle,
      communityName: r.community_name,
      publishedAt: r.created_at_source ? r.created_at_source.toISOString() : null,
      metricScore: r.metric_score,
      metricLikes: r.metric_likes,
      metricComments: r.metric_comments,
      engagementScore: Number(r.engagement_score ?? 0),
      sentimentLabel: r.sentiment_label,
      sentimentScore: r.sentiment_score,
      topicIndex: r.topic_index,
      topicScore: r.topic_score,
    })),
  };
}
