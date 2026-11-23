import type { Pool, PoolClient } from "pg";
import type { Actor } from "../../../packages/contracts/src/source-content";
import { fail } from "../../shared/errors";
import { transaction } from "../../storage/db";
import { getUserRoleStatus, loadAuthorizedBatches } from "../collection/index";
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
  const { rows } = await pool.query<Pick<ProjectBatchItem, "batchId" | "status" | "addedAt">>(
    `SELECT batch_id AS "batchId", status, added_at AS "addedAt" FROM monitor_project_batch
       WHERE project_id=$1 AND status<>'removed' ORDER BY added_at DESC, batch_id DESC`, [projectId],
  );
  const authorized = new Map((await loadAuthorizedBatches(pool, actor, rows.map(row => row.batchId)))
    .map(batch => [batch.batchId, batch]));
  return rows.flatMap(row => {
    const batch = authorized.get(row.batchId);
    return batch ? [{ ...batch, ...row }] : [];
  });
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
    const [batch] = await loadAuthorizedBatches(client, actor, [batchId]);
    if (!batch) fail(404, "Batch not found");
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
    if (!(await loadAuthorizedBatches(client, actor, [batchId])).length) fail(404, "Batch not found");
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
    const user = await getUserRoleStatus(client, input.userId);
    if (!user || user.status !== "active") return;
    if (user?.role === "viewer" && project.owner_user_id !== input.userId) return;
  }
  // Later pages and retries must not override a user's disable/remove decision.
  const attached = await client.query(
    `INSERT INTO monitor_project_batch(project_id, batch_id, status, added_by_user_id, added_at, updated_at)
     VALUES($1, $2, 'enabled', $3, NOW(), NOW())
     ON CONFLICT (project_id, batch_id) DO NOTHING
     RETURNING batch_id`,
    [input.projectId, input.batchId, input.userId],
  );
  if (attached.rowCount) await client.query(
    "UPDATE monitor_project SET revision=revision+1, updated_at=NOW() WHERE id=$1",
    [input.projectId],
  );
}
