import { randomUUID } from "node:crypto";
import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Pool, PoolClient } from "pg";
import { Id } from "../../../packages/contracts/src/source-content";

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
  },
): Promise<{ batchId: string; itemCount: number }> {
  const uniqueIds = [...new Set(input.contentIds)];
  const label = `${input.sourceLabel} · ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`;
  const { rows: [batch] } = await client.query<{ id: string }>(
    `INSERT INTO collection_batch(id, job_id, collection_source_id, created_by_user_id, label, item_count)
     VALUES($1, $2, $3, $4, $5, 0)
     ON CONFLICT (job_id) DO UPDATE SET label = collection_batch.label
     RETURNING id`,
    [randomUUID(), input.jobId, input.sourceId, input.userId, label],
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
  return { batchId: batch.id, itemCount: updated.item_count };
}

export async function batchRoutes(app: FastifyInstance, pool: Pool) {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();
  api.get("/v1/batches", { schema: { querystring: BatchesQuery } }, async (request) => {
    const actor = request.actor!;
    const limit = request.query.limit ?? 50;
    const { rows } = await pool.query<{
      id: string;
      jobId: string | null;
      sourceId: string;
      sourceLabel: string;
      platform: string;
      provider: string;
      deliveryMode: string;
      label: string;
      itemCount: number;
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
              cb.label,
              cb.item_count AS "itemCount",
              cb.created_at AS "createdAt",
              cb.created_by_user_id AS "createdByUserId"
       FROM collection_batch cb
       JOIN collection_source cs ON cs.id = cb.collection_source_id
       JOIN source p ON p.id = cs.platform_id
       LEFT JOIN source_collection_job j ON j.id = cb.job_id
       WHERE ($1::uuid[] IS NULL OR cb.collection_source_id = ANY($1::uuid[]))
         AND ($2::uuid IS NULL OR cb.collection_source_id = $2)
         AND ($3::uuid IS NULL OR cb.job_id = $3)
       ORDER BY cb.created_at DESC, cb.id DESC
       LIMIT $4`,
      [actor.allowedSourceIds, request.query.sourceId ?? null, request.query.jobId ?? null, limit],
    );
    return { batches: rows };
  });
}
