import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Pool } from "pg";
import { JobStatusQuery, ParamsId } from "../../../packages/contracts/src/source-content";
import { fail, transaction } from "../../storage/db";
import { admitViewerCollection } from "./policy";
import { assertSource, audit, lockSource } from "./sql";

const RecentJobsQuery = Type.Object(
  {
    status: Type.Optional(Type.String({ maxLength: 32 })),
    sourceId: Type.Optional(Type.String({ format: "uuid" })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 10000 })),
  },
  { additionalProperties: false },
);

export async function jobRoutes(app: FastifyInstance, pool: Pool) {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();
  api.get("/v1/source-jobs/recent", { schema: { querystring: RecentJobsQuery } }, async (request) => {
    const actor = request.actor!;
    const limit = request.query.limit ?? 30;
    const offset = request.query.offset ?? 0;
    const isAdmin = actor.role === "owner" || actor.role === "admin";
    const { rows } = await pool.query(
      `SELECT j.id, j.collection_source_id AS "sourceId", cs.label AS "sourceLabel",
         p.code AS platform, j.status, j.purpose, j.operation, j.provider,
         j.provider_state->>'phase' AS phase, j.page_size AS "pageSize",
         j.records_processed AS "recordsProcessed", j.records_inserted AS "recordsInserted",
         j.records_updated AS "recordsUpdated", j.request_count AS "requestCount",
         j.request_duration_ms AS "requestDurationMs", j.error,
         j.created_at AS "createdAt", j.finished_at AS "finishedAt",
         j.requested_by_user_id AS "requestedByUserId",
         j.requested_by_client_kind AS "requestedByClientKind",
         CASE WHEN $4 THEN u.email ELSE NULL END AS "requesterEmail"
       FROM source_collection_job j
       JOIN collection_source cs ON cs.id = j.collection_source_id
       JOIN source p ON p.id = cs.platform_id
       LEFT JOIN app_user u ON u.id = j.requested_by_user_id
       WHERE ($1::uuid[] IS NULL OR j.collection_source_id = ANY($1::uuid[]))
         AND ($2::text IS NULL OR j.status = $2)
         AND ($3::uuid IS NULL OR j.collection_source_id = $3)
         AND ($4 OR (j.requested_by_user_id = $5 AND j.requested_by_client_kind = 'browser'))
       ORDER BY j.created_at DESC, j.id DESC
       LIMIT $6 OFFSET $7`,
      [
        actor.allowedSourceIds,
        request.query.status ?? null,
        request.query.sourceId ?? null,
        isAdmin,
        actor.userId,
        limit,
        offset,
      ],
    );
    return { jobs: rows, scope: isAdmin ? "all" : "personal" };
  });
  api.get("/v1/source-jobs", { schema: { querystring: JobStatusQuery } }, async (request) => {
    const isViewer = request.actor!.role === "viewer";
    const { rows } = await pool.query(
      `SELECT id,status,provider,provider_state->>'phase' AS phase,error,next_run_at,
        request_count,records_processed,records_inserted,records_updated
       FROM source_collection_job
       WHERE id=ANY($1::uuid[])
         AND ($2::uuid[] IS NULL OR collection_source_id=ANY($2::uuid[]))
         AND ($3 OR (requested_by_user_id=$4 AND requested_by_client_kind='browser'))`,
      [request.query.ids.split(","), request.actor!.allowedSourceIds, !isViewer, request.actor!.userId],
    );
    return { jobs: rows };
  });
  api.get(
    "/v1/source-jobs/:id",
    { schema: { params: ParamsId } },
    async (request) => {
      const job = (
        await pool.query("SELECT * FROM source_collection_job WHERE id=$1", [
          request.params.id,
        ])
      ).rows[0];
      if (!job) fail(404, "Job not found");
      assertSource(request.actor!, job.collection_source_id);
      if (
        request.actor!.role === "viewer" &&
        (job.requested_by_user_id !== request.actor!.userId || job.requested_by_client_kind !== "browser")
      ) {
        fail(403, "You can only inspect your own collection jobs");
      }
      return { job };
    },
  );
  for (const action of ["cancel", "retry", "continue"] as const) {
    api.post(
      `/v1/source-jobs/:id/${action}`,
      {
        schema: {
          params: ParamsId,
          body: Type.Object(
            {
              acknowledgePotentialCharge: Type.Optional(Type.Boolean()),
            },
            { additionalProperties: false },
          ),
        },
      },
      async (request) =>
        transaction(pool, async (client) => {
          const found = (
            await client.query(
              "SELECT collection_source_id FROM source_collection_job WHERE id=$1",
              [request.params.id],
            )
          ).rows[0];
          if (!found) fail(404, "Job not found");
          const source = await lockSource(
            client,
            request.actor!,
            found.collection_source_id,
          );
          const job = (
            await client.query(
              "SELECT * FROM source_collection_job WHERE id=$1 FOR UPDATE",
              [request.params.id],
            )
          ).rows[0];
          if (
            request.actor!.role === "viewer" &&
            (job.requested_by_user_id !== request.actor!.userId || job.requested_by_client_kind !== "browser")
          ) {
            fail(403, "You can only manage your own collection jobs");
          }
          const phase = job.provider_state.phase;
          const unresolved = ["starting", "unknown"].includes(phase);
          if (action === "cancel") {
            if (unresolved)
              await client.query(
                "UPDATE collection_source SET automatic_collection_blocked=TRUE WHERE id=$1",
                [source.id],
              );
            await client.query(
              "UPDATE source_collection_job SET status='cancelled',lease_token=NULL,lease_until=NULL,finished_at=NOW() WHERE id=$1",
              [job.id],
            );
          } else {
            if (
              !["failed", "cancelled", "queued", "retrying"].includes(
                job.status,
              )
            )
              fail(409, "Job cannot be resumed in its current state");
            if (
              action === "continue" &&
              !["running", "reading"].includes(phase)
            )
              fail(409, "No persisted run to continue");
            if (unresolved && !request.body.acknowledgePotentialCharge)
              fail(409, "Confirm potential duplicate charge before retrying");
            const resume = ["running", "reading"].includes(phase);
            if (!resume && request.actor!.role === "viewer") {
              const pageSize = job.page_size ?? 20;
              const includeComments = Boolean(job.request_json?.includeComments);
              const maxCommentsPerPost = Number(
                job.request_json?.maxCommentsPerPost ?? (includeComments ? 15 : 0),
              );
              const isSingleHydrate =
                job.operation === "hydrate" && !Array.isArray(job.request_json?.externalIds);
              const resources = isSingleHydrate
                ? maxCommentsPerPost + 1
                : job.provider === "kaix" && includeComments
                  ? pageSize * (maxCommentsPerPost + 1)
                  : pageSize;
              await admitViewerCollection(client, request.actor!, {
                provider: job.provider,
                sourceId: source.id,
                limit: pageSize,
                resources,
                includeComments,
                maxCommentsPerPost,
              });
            }
            await client.query(
              `UPDATE source_collection_job SET status='queued',provider_state=$2,provider_run_id=$3,
          next_run_at=NOW(),lease_token=NULL,lease_until=NULL,finished_at=NULL,error=NULL,page_request_attempts=CASE WHEN $4 THEN page_request_attempts ELSE 0 END WHERE id=$1`,
              [
                job.id,
                resume ? job.provider_state : {},
                resume ? job.provider_run_id : null,
                resume,
              ],
            );
            await client.query(
              "UPDATE collection_source SET automatic_collection_blocked=FALSE WHERE id=$1",
              [source.id],
            );
          }
          await audit(client, request.actor!, `collection.${action}`, job.id);
          return { jobId: job.id };
        }),
    );
  }
  api.post(
    "/v1/sources/:id/unblock",
    {
      schema: {
        params: ParamsId,
        body: Type.Object(
          { acknowledgePotentialCharge: Type.Boolean() },
          { additionalProperties: false },
        ),
      },
    },
    async (request) =>
      transaction(pool, async (client) => {
        const source = await lockSource(
          client,
          request.actor!,
          request.params.id,
        );
        const unresolved = (
          await client.query(
            `SELECT 1 FROM source_collection_job WHERE collection_source_id=$1
      AND provider_state->>'phase' IN ('starting','unknown')`,
            [source.id],
          )
        ).rowCount;
        if (unresolved && !request.body.acknowledgePotentialCharge)
          fail(409, "Confirm potential charge before unblocking");
        await client.query(
          "UPDATE collection_source SET automatic_collection_blocked=FALSE WHERE id=$1",
          [source.id],
        );
        await audit(client, request.actor!, "collection.unblock", source.id);
        return { unblocked: true };
      }),
  );
}
