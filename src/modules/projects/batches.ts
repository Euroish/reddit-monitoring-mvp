import type { Pool, PoolClient } from "pg";
import type { Actor } from "../../../packages/contracts/src/source-content";
import { fail, transaction } from "../../storage/db";
import { assertProjectWritable, projectSources } from "./sql";

export interface ProjectBatchItem {
  batchId: string;
  jobId: string | null;
  sourceId: string;
  sourceLabel: string;
  platform: string;
  provider: string;
  deliveryMode: string;
  label: string;
  itemCount: number;
  visibility: "private" | "shared";
  status: "enabled" | "disabled" | "removed";
  addedAt: string;
  createdAt: string;
}

export async function listProjectBatches(
  pool: Pool | PoolClient,
  actor: Actor,
  projectId: string,
): Promise<ProjectBatchItem[]> {
  await projectSources(pool, actor, projectId);
  const { rows } = await pool.query<ProjectBatchItem>(
    `SELECT mpb.batch_id AS "batchId",
            cb.job_id AS "jobId",
            cb.collection_source_id AS "sourceId",
            cs.label AS "sourceLabel",
            p.code AS platform,
            COALESCE(j.provider, cs.primary_provider) AS provider,
            cs.delivery_mode AS "deliveryMode",
            cb.label,
            cb.item_count AS "itemCount",
            cb.visibility,
            mpb.status,
            mpb.added_at AS "addedAt",
            cb.created_at AS "createdAt"
     FROM monitor_project_batch mpb
     JOIN collection_batch cb ON cb.id = mpb.batch_id
     JOIN collection_source cs ON cs.id = cb.collection_source_id
     JOIN source p ON p.id = cs.platform_id
     LEFT JOIN source_collection_job j ON j.id = cb.job_id
     WHERE mpb.project_id = $1
       AND mpb.status <> 'removed'
       AND ($2::uuid[] IS NULL OR cb.collection_source_id = ANY($2::uuid[]))
     ORDER BY mpb.added_at DESC, mpb.batch_id DESC`,
    [projectId, actor.allowedSourceIds],
  );
  return rows;
}

export async function attachBatchToProject(
  pool: Pool,
  actor: Actor,
  projectId: string,
  batchId: string,
) {
  return transaction(pool, async (client) => {
    await client.query("SELECT id FROM monitor_project WHERE id=$1 FOR UPDATE", [projectId]);
    await assertProjectWritable(client, actor, projectId);
    const batch = (
      await client.query<{
        id: string;
        collection_source_id: string;
        visibility: "private" | "shared";
        created_by_user_id: string | null;
      }>(
        "SELECT id, collection_source_id, visibility, created_by_user_id FROM collection_batch WHERE id=$1",
        [batchId],
      )
    ).rows[0];
    if (!batch) fail(404, "Batch not found");
    if (actor.allowedSourceIds !== null && !actor.allowedSourceIds.includes(batch.collection_source_id)) {
      fail(404, "Batch not found");
    }
    if (actor.role === "viewer" && batch.visibility !== "shared" && batch.created_by_user_id !== actor.userId) {
      fail(404, "Batch not found");
    }
    await client.query(
      `INSERT INTO monitor_project_batch(project_id, batch_id, status, added_by_user_id, added_at, updated_at)
       VALUES($1, $2, 'enabled', $3, NOW(), NOW())
       ON CONFLICT (project_id, batch_id)
       DO UPDATE SET status='enabled', updated_at=NOW()`,
      [projectId, batchId, actor.userId ?? null],
    );
    await client.query(
      "UPDATE monitor_project SET revision=revision+1, updated_at=NOW() WHERE id=$1",
      [projectId],
    );
    const batches = await listProjectBatches(client, actor, projectId);
    return { attached: true, batch: batches.find((b) => b.batchId === batchId) ?? null };
  });
}

export async function updateProjectBatchStatus(
  pool: Pool,
  actor: Actor,
  projectId: string,
  batchId: string,
  status: "enabled" | "disabled" | "removed",
) {
  return transaction(pool, async (client) => {
    await client.query("SELECT id FROM monitor_project WHERE id=$1 FOR UPDATE", [projectId]);
    await assertProjectWritable(client, actor, projectId);
    const updated = await client.query(
      `UPDATE monitor_project_batch
       SET status=$3, updated_at=NOW()
       WHERE project_id=$1 AND batch_id=$2
       RETURNING batch_id`,
      [projectId, batchId, status],
    );
    if (!updated.rowCount) fail(404, "Project batch not found");
    await client.query(
      "UPDATE monitor_project SET revision=revision+1, updated_at=NOW() WHERE id=$1",
      [projectId],
    );
    return { updated: true, batchId, status };
  });
}

export async function attachBatchToProjectInTx(
  client: PoolClient,
  input: { projectId: string; batchId: string; userId: string | null },
) {
  const project = (
    await client.query<{ id: string; owner_user_id: string | null }>(
      "SELECT id, owner_user_id FROM monitor_project WHERE id=$1 FOR UPDATE",
      [input.projectId],
    )
  ).rows[0];
  if (!project) return;
  if (input.userId) {
    const user = (
      await client.query<{ role: string }>("SELECT role FROM app_user WHERE id=$1", [input.userId])
    ).rows[0];
    if (user?.role === "viewer" && project.owner_user_id !== input.userId) return;
  }
  await client.query(
    `INSERT INTO monitor_project_batch(project_id, batch_id, status, added_by_user_id, added_at, updated_at)
     VALUES($1, $2, 'enabled', $3, NOW(), NOW())
     ON CONFLICT (project_id, batch_id)
     DO UPDATE SET status='enabled', updated_at=NOW()`,
    [input.projectId, input.batchId, input.userId],
  );
  await client.query(
    "UPDATE monitor_project SET revision=revision+1, updated_at=NOW() WHERE id=$1",
    [input.projectId],
  );
}
