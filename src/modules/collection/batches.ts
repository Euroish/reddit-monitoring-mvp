import { randomUUID } from "node:crypto";
import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Pool, PoolClient } from "pg";
import { BatchVisibilityInput, Id, ParamsId } from "../../../packages/contracts/src/source-content";
import { fail, transaction } from "../../storage/db";

const BatchesQuery = Type.Object(
  {
    sourceId: Type.Optional(Id),
    jobId: Type.Optional(Id),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  { additionalProperties: false },
);

export type BatchCommittedHook = (
  client: PoolClient,
  info: { batchId: string; projectId: string; userId: string | null },
) => Promise<void>;

export async function recordCommittedBatch(
  client: PoolClient,
  input: {
    jobId: string;
    sourceId: string;
    sourceLabel: string;
    userId: string | null;
    contentIds: readonly string[];
    visibility?: "private" | "shared";
  },
): Promise<{ batchId: string; itemCount: number; visibility: "private" | "shared" }> {
  const uniqueIds = [...new Set(input.contentIds)];
  let visibility: "private" | "shared" = input.visibility ?? "shared";
  if (!input.visibility && input.userId) {
    const userRow = (
      await client.query<{ role: string }>("SELECT role FROM app_user WHERE id=$1", [input.userId])
    ).rows[0];
    if (userRow?.role === "viewer") visibility = "private";
  }
  const label = `${input.sourceLabel} · ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`;
  const { rows: [batch] } = await client.query<{ id: string; visibility: "private" | "shared" }>(
    `INSERT INTO collection_batch(id, job_id, collection_source_id, created_by_user_id, label, item_count, visibility)
     VALUES($1, $2, $3, $4, $5, 0, $6)
     ON CONFLICT (job_id) DO UPDATE SET label = collection_batch.label
     RETURNING id, visibility`,
    [randomUUID(), input.jobId, input.sourceId, input.userId, label, visibility],
  );
  if (uniqueIds.length > 0) {
    await client.query(
      `INSERT INTO collection_batch_item(batch_id, content_id)
       SELECT $1, UNNEST($2::uuid[])
       ON CONFLICT (batch_id, content_id) DO NOTHING`,
      [batch.id, uniqueIds],
    );
  }
  const { rows: [updated] } = await client.query<{ item_count: number }>(
    `UPDATE collection_batch
     SET item_count = (SELECT COUNT(*)::int FROM collection_batch_item WHERE batch_id = $1)
     WHERE id = $1
     RETURNING item_count`,
    [batch.id],
  );
  return { batchId: batch.id, itemCount: updated.item_count, visibility: batch.visibility };
}

export async function batchRoutes(app: FastifyInstance, pool: Pool) {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();
  api.get("/v1/batches", { schema: { querystring: BatchesQuery } }, async (request) => {
    const actor = request.actor!;
    const isViewer = actor.role === "viewer";
    const limit = request.query.limit ?? 50;
    const { rows } = await pool.query<{
      id: string;
      jobId: string | null;
      sourceId: string;
      sourceLabel: string;
      platform: string;
      provider: string;
      deliveryMode: string;
      usageDomain: string;
      label: string;
      itemCount: number;
      visibility: "private" | "shared";
      createdAt: string;
      createdByUserId: string | null;
    }>(
      `SELECT cb.id,
              cb.job_id AS "jobId",
              cb.collection_source_id AS "sourceId",
              cs.label AS "sourceLabel",
              p.code AS platform,
              COALESCE(j.provider, cs.primary_provider) AS provider,
              cs.delivery_mode AS "deliveryMode",
              cs.usage_domain AS "usageDomain",
              cb.label,
              cb.item_count AS "itemCount",
              cb.visibility,
              cb.created_at AS "createdAt",
              cb.created_by_user_id AS "createdByUserId"
       FROM collection_batch cb
       JOIN collection_source cs ON cs.id = cb.collection_source_id
       JOIN source p ON p.id = cs.platform_id
       LEFT JOIN source_collection_job j ON j.id = cb.job_id
       WHERE ($1::uuid[] IS NULL OR cb.collection_source_id = ANY($1::uuid[]))
         AND ($2::uuid IS NULL OR cb.collection_source_id = $2)
         AND ($3::uuid IS NULL OR cb.job_id = $3)
         AND (NOT $4::boolean OR cb.visibility = 'shared' OR cb.created_by_user_id = $5::uuid)
       ORDER BY cb.created_at DESC, cb.id DESC
       LIMIT $6`,
      [
        actor.allowedSourceIds,
        request.query.sourceId ?? null,
        request.query.jobId ?? null,
        isViewer,
        actor.userId ?? null,
        limit,
      ],
    );
    return { batches: rows };
  });

  api.patch(
    "/v1/batches/:id/visibility",
    { schema: { params: ParamsId, body: BatchVisibilityInput } },
    async (request) => {
      const actor = request.actor!;
      if (actor.clientKind !== "browser" || actor.role === "viewer") {
        fail(403, "Administrator browser session required");
      }
      return transaction(pool, async (client) => {
        const res = await client.query<{ id: string; visibility: "private" | "shared" }>(
          "UPDATE collection_batch SET visibility=$2 WHERE id=$1 RETURNING id, visibility",
          [request.params.id, request.body.visibility],
        );
        if (!res.rowCount) fail(404, "Batch not found");
        return { updated: true, batch: res.rows[0] };
      });
    },
  );
}
