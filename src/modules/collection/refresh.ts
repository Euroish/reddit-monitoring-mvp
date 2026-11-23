import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { IdempotencyHeaders, ParamsId } from "../../../packages/contracts/src/common";
import { Refresh } from "../../../packages/contracts/src/collection";
import type { ContentProvider } from "../../connectors/shared/content-provider.interface";
import { notifyChannel } from "../../platform/pg-notify";
import { fail } from "../../shared/errors";
import { transaction } from "../../storage/db";
import { findRefreshablePostsForSource } from "../content/index";
import { admitViewerCollection } from "./policy";
import { lockSource } from "./sql";

export async function refreshRoutes(app: FastifyInstance, pool: Pool, providers: ContentProvider[]) {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();
  api.post(
    "/v1/sources/:id/refresh",
    {
      config: { auth: { access: "viewer_write", machineScope: "collect" } },
      schema: { params: ParamsId, body: Refresh, headers: IdempotencyHeaders },
    },
    async (request) => {
      const result = await transaction(pool, async (client) => {
        const source = await lockSource(client, request.actor!, request.params.id);
        const key = `refresh:${request.headers["idempotency-key"]}`;
        const contentIds = [...request.body.contentIds].sort();
        const existing = (
          await client.query(
            "SELECT id,request_json,requested_by_user_id,requested_by_client_kind FROM source_collection_job WHERE collection_source_id=$1 AND operation='hydrate' AND request_key=$2",
            [source.id, key],
          )
        ).rows[0];
        if (existing) {
          if (existing.requested_by_client_kind !== request.actor!.clientKind ||
              existing.requested_by_user_id !== (request.actor!.userId ?? null) ||
              JSON.stringify(existing.request_json.contentIds) !== JSON.stringify(contentIds)) {
            fail(409, "Idempotency key already used with different IDs");
          }
          return { jobId: existing.id, created: false };
        }
        if (source.delivery_mode !== "pull" || source.automatic_collection_blocked) {
          fail(409, "Source is not ready for refresh");
        }
        const provider = providers.find(
          ({ capability, refreshIds }) =>
            capability.enabled &&
            refreshIds &&
            capability.platform === source.platform &&
            [source.primary_provider, source.fallback_provider].includes(capability.provider),
        );
        if (!provider) fail(422, "No enabled provider supports batch ID refresh for this source");
        const externalIds = await findRefreshablePostsForSource(client, source.id, contentIds);
        if (externalIds.length !== contentIds.length) {
          fail(404, "Some content IDs were not found in this source");
        }
        await admitViewerCollection(client, request.actor!, {
          provider: provider.capability.provider,
          sourceId: source.id,
          limit: externalIds.length,
          resources: externalIds.length,
        });
        const jobId = randomUUID();
        await client.query(
          `INSERT INTO source_collection_job(id,collection_source_id,status,purpose,operation,provider,from_at,to_at,
            page_size,max_pages,next_run_at,created_at,request_key,request_json,
            requested_by_user_id,requested_by_client_kind)
          VALUES($1,$2,'queued','refresh','hydrate',$3,NOW()-interval '1 second',NOW(),$4,1,NOW(),NOW(),$5,$6,$7,$8)`,
          [
            jobId, source.id, provider.capability.provider, externalIds.length,
            key, { contentIds, externalIds }, request.actor!.userId, request.actor!.clientKind,
          ],
        );
        return { jobId, created: true };
      });
      if (result.created) await notifyChannel(pool, "collection_jobs_ready");
      return { jobId: result.jobId };
    },
  );
}
