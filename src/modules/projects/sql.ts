import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { Static } from "@sinclair/typebox";
import type { Actor } from "../../../packages/contracts/src/access";
import type { Filter } from "../../../packages/contracts/src/content";
import type { ProjectInput } from "../../../packages/contracts/src/projects";
import { fail } from "../../shared/errors";
import { transaction } from "../../storage/db";
import { allSourcesExist, batchMembership, listStaffOwnerIds, loadAuthorizedBatches, loadEffectivePolicyForUser } from "../collection/index";
import { compileContentFilter, summarizeScopedContent } from "../content/index";

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
  const staffIds = await listStaffOwnerIds(pool);
  const restrictBatches = isViewer || actor.allowedSourceIds !== null;
  const { rows } = await pool.query<Project & { batch_ids: string[]; enabled_batch_ids: string[] }>(`
    SELECT p.id, p.name, p.description, p.dataset_mode, p.owner_user_id, p.filter,
      p.revision, p.thread_aware, p.include_push_in_trends, p.created_at, p.updated_at,
      s.source_ids,
      (NOT $3::boolean OR p.owner_user_id = $4::uuid) AS can_edit,
      (p.owner_user_id IS NULL OR p.owner_user_id=ANY($5::uuid[])) AS is_shared,
      COALESCE(b.enabled_batch_count, 0)::int AS enabled_batch_count,
      COALESCE(b.total_batch_count, 0)::int AS total_batch_count,
      COALESCE(b.batch_ids, ARRAY[]::uuid[]) AS batch_ids,
      COALESCE(b.enabled_batch_ids, ARRAY[]::uuid[]) AS enabled_batch_ids
    FROM monitor_project p
    CROSS JOIN LATERAL (
      SELECT ARRAY(SELECT collection_source_id FROM monitor_project_source WHERE project_id=p.id ORDER BY collection_source_id) AS source_ids
    ) s
    LEFT JOIN LATERAL (
      SELECT COUNT(*) FILTER (WHERE status = 'enabled') AS enabled_batch_count,
             COUNT(*) FILTER (WHERE status <> 'removed') AS total_batch_count,
             ARRAY_AGG(batch_id) FILTER (WHERE $7::boolean AND status <> 'removed') AS batch_ids,
             ARRAY_AGG(batch_id) FILTER (WHERE $7::boolean AND status = 'enabled') AS enabled_batch_ids
      FROM monitor_project_batch
      WHERE project_id = p.id
    ) b ON true
    WHERE ($1::uuid[] IS NULL OR s.source_ids <@ $1)
      AND ($2::uuid IS NULL OR p.id=$2)
      AND ($6::boolean OR p.dataset_mode <> 'batch')
      AND (
        NOT $3::boolean
        OR p.owner_user_id = $4::uuid
        OR p.owner_user_id IS NULL
        OR p.owner_user_id=ANY($5::uuid[])
      )
    ORDER BY p.updated_at DESC`, [
    actor.allowedSourceIds, id ?? null, isViewer, actor.userId ?? null, staffIds,
    actor.clientKind === "browser", restrictBatches,
  ]);
  const visibleIds = new Set((await loadAuthorizedBatches(pool, actor, [...new Set(rows.flatMap(row => row.batch_ids))]))
    .map(batch => batch.batchId));
  return rows.map(({ batch_ids, enabled_batch_ids, ...project }) => {
    if (!restrictBatches) return project;
    return {
      ...project,
      enabled_batch_count: enabled_batch_ids.filter(id => visibleIds.has(id)).length,
      total_batch_count: batch_ids.filter(id => visibleIds.has(id)).length,
    };
  });
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
    if (!(await allSourcesExist(client, sources))) fail(404, "Source not found");
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
        const plan = await loadEffectivePolicyForUser(client, actor.userId, true);
        const { rows: [owned] } = await client.query<{ count: string }>(
          "SELECT COUNT(*) AS count FROM monitor_project WHERE owner_user_id=$1",
          [actor.userId],
        );
        if (Number(owned.count) >= plan.maxProjects) {
          fail(403, `Project limit reached for ${plan.planTier} tier (${plan.maxProjects})`);
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
  const summary = await summarizeScopedContent(pool, actor, await scopeForProject(pool, actor, project));
  return { project, ...summary };
}


export async function listProjectBatchIds(db: Pool | PoolClient, actor: Actor, id: string) {
  await projectSources(db, actor, id);
  const { rows } = await db.query<{ batch_id: string }>(
    "SELECT batch_id FROM monitor_project_batch WHERE project_id=$1 AND status<>'removed'", [id],
  );
  return rows.map(row => row.batch_id);
}

async function scopeForProject(db: Pool | PoolClient, actor: Actor, project: Project) {
  if (project.dataset_mode !== "batch") return project;
  const { rows } = await db.query<{ batch_id: string }>(
    "SELECT batch_id FROM monitor_project_batch WHERE project_id=$1 AND status='enabled'", [project.id],
  );
  return { ...project, batchMembership: batchMembership(rows.map(row => row.batch_id), actor) };
}

export async function resolveProjectScope(db: Pool | PoolClient, actor: Actor, id: string) {
  return scopeForProject(db, actor, await projectSources(db, actor, id));
}
