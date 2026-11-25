import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { Static } from "@sinclair/typebox";
import type { Actor } from "../../../packages/contracts/src/access";
import type { Filter } from "../../../packages/contracts/src/content";
import type { ProjectForkInput, ProjectInput, ProjectPublishInput } from "../../../packages/contracts/src/projects";
import { fail } from "../../shared/errors";
import { transaction } from "../../storage/db";
import {
  allSourcesExist,
  batchMembership,
  contentVisibility,
  createSnapshotBatch,
  loadAuthorizedBatches,
  loadEffectivePolicyForUser,
} from "../collection/index";
import { compileContentFilter, listScopedContentIds, summarizeScopedContent } from "../content/index";

type ProjectWrite = Static<typeof ProjectInput>;
export interface ProjectDataSummary {
  platforms: string[];
  source_labels: string[];
  item_count: number;
  shared_batch_count: number;
  private_batch_count: number;
  latest_batch_at: string | null;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  dataset_mode: "source_filter" | "batch";
  visibility: "private" | "shared";
  owner_user_id: string | null;
  forked_from_project_id: string | null;
  linked_monitor_id: string | null;
  filter: Filter;
  revision: number;
  thread_aware: boolean;
  include_push_in_trends: boolean;
  source_ids: string[];
  can_edit: boolean;
  is_shared: boolean;
  enabled_batch_count: number;
  total_batch_count: number;
  data_summary?: ProjectDataSummary;
}

export async function listProjects(pool: Pool | PoolClient, actor: Actor, id?: string) {
  const isViewer = actor.role === "viewer";
  const restrictBatches = isViewer || actor.allowedSourceIds !== null;
  const { rows } = await pool.query<Project & { batch_ids: string[]; enabled_batch_ids: string[] }>(`
    SELECT p.id, p.name, p.description, p.dataset_mode, p.visibility, p.owner_user_id,
      p.forked_from_project_id, p.linked_monitor_id, p.filter,
      p.revision, p.thread_aware, p.include_push_in_trends, p.created_at, p.updated_at,
      s.source_ids,
      (NOT $3::boolean OR p.owner_user_id = $4::uuid) AS can_edit,
      (p.visibility = 'shared') AS is_shared,
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
             ARRAY_AGG(batch_id) FILTER (WHERE status <> 'removed') AS batch_ids,
             ARRAY_AGG(batch_id) FILTER (WHERE status = 'enabled') AS enabled_batch_ids
      FROM monitor_project_batch
      WHERE project_id = p.id
    ) b ON true
    WHERE ($1::uuid[] IS NULL OR s.source_ids <@ $1)
      AND ($2::uuid IS NULL OR p.id=$2)
      AND ($5::boolean OR p.dataset_mode <> 'batch')
      AND (
        NOT $3::boolean
        OR p.owner_user_id = $4::uuid
        OR p.visibility = 'shared'
      )
    ORDER BY p.updated_at DESC`, [
    actor.allowedSourceIds, id ?? null, isViewer, actor.userId ?? null,
    actor.clientKind === "browser",
  ]);
  const authorizedBatches = await loadAuthorizedBatches(pool, actor, [...new Set(rows.flatMap(row => row.batch_ids))]);
  const authorizedById = new Map(authorizedBatches.map(batch => [batch.batchId, batch]));
  const boundSourceIds = [...new Set(rows.filter(r => r.dataset_mode === "source_filter").flatMap(r => r.source_ids))];
  const sourceMetaById = new Map<string, { label: string; platform: string }>();
  if (boundSourceIds.length > 0) {
    const { rows: sourceRows } = await pool.query<{ id: string; label: string; platform: string }>(
      `SELECT cs.id, cs.label, p.code AS platform
       FROM collection_source cs
       JOIN source p ON p.id = cs.platform_id
       WHERE cs.id = ANY($1::uuid[])`,
      [boundSourceIds],
    );
    for (const row of sourceRows) sourceMetaById.set(row.id, { label: row.label, platform: row.platform });
  }
  return rows.map(({ batch_ids, enabled_batch_ids, ...project }) => {
    const activeBatches = enabled_batch_ids
      .map(bid => authorizedById.get(bid))
      .filter((b): b is NonNullable<typeof b> => Boolean(b));
    const data_summary: ProjectDataSummary = project.dataset_mode === "batch"
      ? {
          platforms: [...new Set(activeBatches.map(b => b.platform))],
          source_labels: [...new Set(activeBatches.map(b => b.sourceLabel))].slice(0, 8),
          item_count: activeBatches.reduce((sum, b) => sum + b.itemCount, 0),
          shared_batch_count: activeBatches.filter(b => b.visibility === "shared").length,
          private_batch_count: activeBatches.filter(b => b.visibility === "private").length,
          latest_batch_at: activeBatches.reduce<string | null>(
            (latest, b) => (!latest || b.createdAt > latest ? b.createdAt : latest),
            null,
          ),
        }
      : {
          platforms: [...new Set(project.source_ids.map(sid => sourceMetaById.get(sid)?.platform).filter((v): v is string => Boolean(v)))],
          source_labels: [...new Set(project.source_ids.map(sid => sourceMetaById.get(sid)?.label).filter((v): v is string => Boolean(v)))].slice(0, 8),
          item_count: 0,
          shared_batch_count: 0,
          private_batch_count: 0,
          latest_batch_at: null,
        };
    if (!restrictBatches) return { ...project, data_summary };
    return {
      ...project,
      data_summary,
      enabled_batch_count: enabled_batch_ids.filter(bid => authorizedById.has(bid)).length,
      total_batch_count: batch_ids.filter(bid => authorizedById.has(bid)).length,
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

async function assertViewerProjectQuota(client: PoolClient, actor: Actor) {
  if (actor.role !== "viewer") return;
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

function resolveNewProjectParams(actor: Actor, input: ProjectWrite, sources: string[]) {
  const mode = input.datasetMode ?? (sources.length > 0 ? "source_filter" : "batch");
  if (mode === "source_filter" && sources.length < 1) {
    fail(422, "Select at least one collection source");
  }
  if (actor.role === "viewer" && input.visibility === "shared") {
    fail(403, "Only administrators can publish shared projects");
  }
  const visibility =
    (actor.role === "admin" || actor.role === "owner") && input.visibility === "shared"
      ? "shared"
      : "private";
  return { mode, visibility };
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
      const { mode, visibility } = resolveNewProjectParams(actor, input, sources);
      await assertViewerProjectQuota(client, actor);
      await client.query(`
        INSERT INTO monitor_project(id,name,description,dataset_mode,visibility,filter,thread_aware,include_push_in_trends,owner_user_id)
        VALUES($1,$2,$3,$4,$5,$6,COALESCE($7,TRUE),COALESCE($8,FALSE),$9)`,
        [
          id,
          input.name,
          input.description ?? null,
          mode,
          visibility,
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

export async function publishProject(
  pool: Pool,
  actor: Actor,
  id: string,
  input: Static<typeof ProjectPublishInput>,
) {
  if (actor.clientKind !== "browser" || actor.role === "viewer") {
    fail(403, "Administrator browser session required");
  }
  return transaction(pool, async (client) => {
    await client.query("SELECT id FROM monitor_project WHERE id=$1 FOR UPDATE", [id]);
    const existing = await assertProjectWritable(client, actor, id);
    if (existing.revision !== input.revision) fail(409, "Project changed; reload before publishing");
    if (input.visibility === "shared" && existing.dataset_mode === "batch") {
      const { rows } = await client.query<{ batch_id: string }>(
        "SELECT batch_id FROM monitor_project_batch WHERE project_id=$1 AND status<>'removed'",
        [id],
      );
      if (rows.length > 0) {
        const batches = await loadAuthorizedBatches(client, actor, rows.map((r) => r.batch_id));
        if (batches.some((b) => b.visibility !== "shared")) {
          fail(409, "Remove or mark private batches as shared before publishing this project");
        }
      }
    }
    await client.query(
      "UPDATE monitor_project SET visibility=$2, revision=revision+1, updated_at=NOW() WHERE id=$1",
      [id, input.visibility],
    );
    return projectSources(client, actor, id);
  });
}

async function copyBatchesForFork(
  client: PoolClient,
  actor: Actor,
  sourceProject: Project,
  targetProjectId: string,
) {
  if (sourceProject.dataset_mode === "batch") {
    const { rows } = await client.query<{ batch_id: string }>(
      "SELECT batch_id FROM monitor_project_batch WHERE project_id=$1 AND status='enabled' ORDER BY added_at, batch_id",
      [sourceProject.id],
    );
    if (!rows.length) return;
    const authorized = await loadAuthorizedBatches(client, actor, rows.map((r) => r.batch_id));
    if (!authorized.length) return;
    await client.query(
      `INSERT INTO monitor_project_batch(project_id, batch_id, status, added_by_user_id, added_at, updated_at)
       SELECT $1, UNNEST($2::uuid[]), 'enabled', $3, NOW(), NOW()
       ON CONFLICT (project_id, batch_id) DO NOTHING`,
      [targetProjectId, authorized.map((b) => b.batchId), actor.userId ?? null],
    );
    return;
  }
  const items = await listScopedContentIds(
    client,
    actor,
    { sourceIds: sourceProject.source_ids, filter: sourceProject.filter },
    contentVisibility(actor),
    20000,
  );
  if (!items.length) return;
  const bySource = new Map<string, string[]>();
  for (const row of items) {
    const bucket = bySource.get(row.sourceId) ?? [];
    bucket.push(row.id);
    bySource.set(row.sourceId, bucket);
  }
  const batchIds: string[] = [];
  for (const [sourceId, contentIds] of bySource) {
    const batch = await createSnapshotBatch(client, {
      sourceId,
      label: `${sourceProject.name} fork snapshot`,
      userId: actor.userId ?? null,
      visibility: "private",
      contentIds,
    });
    batchIds.push(batch.batchId);
  }
  await client.query(
    `INSERT INTO monitor_project_batch(project_id, batch_id, status, added_by_user_id, added_at, updated_at)
     SELECT $1, UNNEST($2::uuid[]), 'enabled', $3, NOW(), NOW()
     ON CONFLICT (project_id, batch_id) DO NOTHING`,
    [targetProjectId, batchIds, actor.userId ?? null],
  );
}

export async function forkProject(
  pool: Pool,
  actor: Actor,
  sourceProjectId: string,
  input: Static<typeof ProjectForkInput>,
) {
  if (actor.clientKind !== "browser") fail(403, "Browser session required");
  return transaction(pool, async (client) => {
    const sourceProj = await projectSources(client, actor, sourceProjectId);
    await assertViewerProjectQuota(client, actor);
    const id = randomUUID();
    const forkName = (input.name?.trim() || `${sourceProj.name} (Copy)`).slice(0, 100);
    const forkDesc = input.description !== undefined ? input.description : sourceProj.description;
    await client.query(
      `INSERT INTO monitor_project(id,name,description,dataset_mode,visibility,forked_from_project_id,filter,thread_aware,include_push_in_trends,owner_user_id)
       VALUES($1,$2,$3,'batch','private',$4,$5,$6,$7,$8)`,
      [
        id, forkName, forkDesc, sourceProj.id, sourceProj.filter,
        sourceProj.thread_aware, sourceProj.include_push_in_trends, actor.userId ?? null,
      ],
    );
    await copyBatchesForFork(client, actor, sourceProj, id);
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
  const summary = await summarizeScopedContent(
    pool,
    actor,
    await scopeForProject(pool, actor, project),
    contentVisibility(actor),
  );
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
