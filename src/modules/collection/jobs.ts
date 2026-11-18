import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Pool } from "pg";
import { JobStatusQuery, ParamsId } from "../../../packages/contracts/src/source-content";
import { fail, transaction } from "../../storage/db";
import { assertSource, audit, lockSource } from "./sql";

export async function jobRoutes(app: FastifyInstance, pool: Pool) {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();
  api.get("/v1/source-jobs", { schema: { querystring: JobStatusQuery } }, async (request) => {
    const { rows } = await pool.query(
      `SELECT id,status,provider,provider_state->>'phase' AS phase,error,next_run_at,
        request_count,records_processed,records_inserted,records_updated
       FROM source_collection_job
       WHERE id=ANY($1::uuid[]) AND ($2::uuid[] IS NULL OR collection_source_id=ANY($2::uuid[]))`,
      [request.query.ids.split(","), request.actor!.allowedSourceIds],
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
