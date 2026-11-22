import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { Static } from "@sinclair/typebox";
import type { Actor, Filter, ProjectInput } from "../../../packages/contracts/src/source-content";
import { transaction, fail } from "../../storage/db";
import { compileContentFilter, matchingNodes } from "../content/index";

type ProjectWrite = Static<typeof ProjectInput>;
export interface Project {
  id: string;
  name: string;
  description: string | null;
  dataset_mode: "source_filter" | "batch";
  owner_user_id: string | null;
  filter: Filter;
  revision: number;
  thread_aware: boolean;
  include_push_in_trends: boolean;
  source_ids: string[];
  can_edit: boolean;
  is_shared: boolean;
  enabled_batch_count: number;
  total_batch_count: number;
}

export async function listProjects(pool: Pool | PoolClient, actor: Actor, id?: string) {
  const isViewer = actor.role === "viewer";
  return (await pool.query<Project>(`
    SELECT p.id, p.name, p.description, p.dataset_mode, p.owner_user_id, p.filter,
      p.revision, p.thread_aware, p.include_push_in_trends, p.created_at, p.updated_at,
      s.source_ids,
      (NOT $3::boolean OR p.owner_user_id = $4::uuid) AS can_edit,
      (p.owner_user_id IS NULL OR COALESCE(owner_u.role, 'admin') IN ('owner', 'admin')) AS is_shared,
      COALESCE(b.enabled_batch_count, 0)::int AS enabled_batch_count,
      COALESCE(b.total_batch_count, 0)::int AS total_batch_count
    FROM monitor_project p
    LEFT JOIN app_user owner_u ON owner_u.id = p.owner_user_id
    CROSS JOIN LATERAL (
      SELECT ARRAY(SELECT collection_source_id FROM monitor_project_source WHERE project_id=p.id ORDER BY collection_source_id) AS source_ids
    ) s
    LEFT JOIN LATERAL (
      SELECT COUNT(*) FILTER (WHERE status = 'enabled') AS enabled_batch_count,
             COUNT(*) FILTER (WHERE status <> 'removed') AS total_batch_count
      FROM monitor_project_batch
      WHERE project_id = p.id
    ) b ON true
    WHERE ($1::uuid[] IS NULL OR s.source_ids <@ $1)
      AND ($2::uuid IS NULL OR p.id=$2)
      AND (
        NOT $3::boolean
        OR p.owner_user_id = $4::uuid
        OR p.owner_user_id IS NULL
        OR COALESCE(owner_u.role, 'admin') IN ('owner', 'admin')
      )
    ORDER BY p.updated_at DESC`, [actor.allowedSourceIds, id ?? null, isViewer, actor.userId ?? null])).rows;
}

export async function projectSources(pool: Pool | PoolClient, actor: Actor, id: string) {
  const [project] = await listProjects(pool, actor, id);
  if (!project) fail(404, "Project not found");
  return project;
}

export async function assertProjectWritable(pool: Pool | PoolClient, actor: Actor, id: string) {
  const project = await projectSources(pool, actor, id);
  if (!project.can_edit) fail(403, "You do not have permission to modify this project");
  return project;
}

export async function writeProject(pool: Pool, actor: Actor, input: ProjectWrite, update?: { id: string; revision: number }) {
  const sources = [...new Set(input.sourceIds ?? [])];
  if (actor.allowedSourceIds !== null && !sources.every((id) => actor.allowedSourceIds!.includes(id)))
    fail(404, "Source not found");
  const filter = input.filter ?? {};
  compileContentFilter(actor, filter);
  return transaction(pool, async (client) => {
    const id = update?.id ?? randomUUID();
    if (update) {
      await client.query("SELECT id FROM monitor_project WHERE id=$1 FOR UPDATE", [id]);
      const existing = await assertProjectWritable(client, actor, id);
      const mode = input.datasetMode ?? existing.dataset_mode;
      if (mode === "source_filter" && sources.length < 1) {
        fail(422, "Select at least one collection source");
      }
      const result = await client.query(`
        UPDATE monitor_project
        SET name=$2,
            description=COALESCE($3, description),
            dataset_mode=$4,
            filter=$5,
            thread_aware=COALESCE($6,thread_aware),
            include_push_in_trends=COALESCE($7,include_push_in_trends),
            revision=revision+1,
            updated_at=NOW()
        WHERE id=$1 AND revision=$8`,
        [
          id,
          input.name,
          input.description === undefined ? null : input.description,
          mode,
          filter,
          input.threadAware ?? null,
          input.includePushInTrends ?? null,
          update.revision,
        ],
      );
      if (!result.rowCount) fail(409, "Project changed; reload before saving");
      await client.query("DELETE FROM monitor_project_source WHERE project_id=$1", [id]);
    } else {
      const mode = input.datasetMode ?? (sources.length > 0 ? "source_filter" : "batch");
      if (mode === "source_filter" && sources.length < 1) {
        fail(422, "Select at least one collection source");
      }
      if (actor.role === "viewer") {
        if (!actor.userId) fail(403, "Authenticated browser session required");
        const { rows: [planRow] } = await client.query<{ plan_tier: string; max_projects: number }>(
          `SELECT u.plan_tier, COALESCE(p.max_projects, 3)::int AS max_projects
           FROM app_user u
           LEFT JOIN plan_collection_policy p ON p.plan_tier = u.plan_tier
           WHERE u.id = $1 AND u.status = 'active'
           FOR UPDATE OF u`,
          [actor.userId],
        );
        if (!planRow) fail(401, "Account no longer active");
        const { rows: [owned] } = await client.query<{ count: string }>(
          "SELECT COUNT(*) AS count FROM monitor_project WHERE owner_user_id=$1",
          [actor.userId],
        );
        if (Number(owned.count) >= planRow.max_projects) {
          fail(403, `Project limit reached for ${planRow.plan_tier} tier (${planRow.max_projects})`);
        }
      }
      await client.query(`
        INSERT INTO monitor_project(id,name,description,dataset_mode,filter,thread_aware,include_push_in_trends,owner_user_id)
        VALUES($1,$2,$3,$4,$5,COALESCE($6,TRUE),COALESCE($7,FALSE),$8)`,
        [
          id,
          input.name,
          input.description ?? null,
          mode,
          filter,
          input.threadAware ?? null,
          input.includePushInTrends ?? null,
          actor.userId ?? null,
        ],
      );
    }
    if (sources.length > 0) {
      await client.query(
        "INSERT INTO monitor_project_source(project_id,collection_source_id) SELECT $1,UNNEST($2::uuid[])",
        [id, sources],
      );
    }
    return projectSources(client, actor, id);
  });
}

export async function deleteProject(pool: Pool, actor: Actor, id: string, revision: number) {
  return transaction(pool, async (client) => {
    await client.query("SELECT id FROM monitor_project WHERE id=$1 FOR UPDATE", [id]);
    await assertProjectWritable(client, actor, id);
    const result = await client.query("DELETE FROM monitor_project WHERE id=$1 AND revision=$2", [id, revision]);
    if (!result.rowCount) fail(409, "Project changed; reload before deleting");
    return { deleted: true };
  });
}

export async function projectOverview(pool: Pool, actor: Actor, id: string) {
  const project = await projectSources(pool, actor, id);
  const batchProjectId = project.dataset_mode === "batch" ? project.id : undefined;
  const pullOnly = batchProjectId ? false : !project.include_push_in_trends;
  const compiled = compileContentFilter(
    actor,
    {},
    batchProjectId ? undefined : project.source_ids,
    project.filter,
    pullOnly,
    batchProjectId,
  );
  const anchorCount = project.thread_aware ? "COUNT(DISTINCT c.anchor_id)" : "COUNT(*)";
  const [row] = (await pool.query<{
    facets: {
      day_group: number; platform_group: number; kind_group: number;
      day: string | null; platform: string | null; kind: string | null;
      count: number; matchedContentCount: number;
    }[];
    dayPlatformFacets: { day: string; platform: string; count: number; matchedContentCount: number }[];
    providers: string[];
  }>(`
    WITH matched AS (${matchingNodes(compiled, project.thread_aware)}), facets AS (
      SELECT GROUPING(date_trunc('day',c.created_at_source,'UTC')) AS day_group,
        GROUPING(c.platform) AS platform_group,GROUPING(c.kind) AS kind_group,
        date_trunc('day',c.created_at_source,'UTC') AS day,c.platform,c.kind,
        ${anchorCount} AS count,COUNT(*) AS "matchedContentCount"
      FROM matched c
      GROUP BY GROUPING SETS ((),(date_trunc('day',c.created_at_source,'UTC')),(c.platform),(c.kind),
        (date_trunc('day',c.created_at_source,'UTC'),c.platform))
    )
    SELECT (SELECT jsonb_agg(facets ORDER BY day_group DESC,day,platform,kind)
        FROM facets WHERE day_group=1 OR platform_group=1) AS facets,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'day',day,'platform',platform,'count',count,'matchedContentCount',"matchedContentCount"
      ) ORDER BY day,platform),'[]'::jsonb)
        FROM facets WHERE day_group=0 AND platform_group=0 AND day IS NOT NULL) AS "dayPlatformFacets",
      ARRAY(SELECT DISTINCT o.provider FROM matched c JOIN content_observation o ON o.content_id=c.id
        WHERE EXISTS (SELECT 1 FROM content_discovery d JOIN collection_source cs ON cs.id=d.collection_source_id
          WHERE ${compiled.discovery} AND d.collection_source_id=o.collection_source_id)
        ORDER BY o.provider) AS providers`, compiled.values)).rows;
  const totals = row.facets[0];
  return {
    project,
    contentCount: totals.count,
    matchedContentCount: totals.matchedContentCount,
    facets: row.facets,
    dayPlatformFacets: row.dayPlatformFacets,
    providers: row.providers,
    resolvedFilter: project.filter,
    coverage: "stored_sample",
    threadAware: project.thread_aware,
  };
}
