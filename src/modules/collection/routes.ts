import { createHash, randomUUID } from "node:crypto";
import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Pool } from "pg";
import {
  Collect,
  IdempotencyHeaders,
  Ingest,
  ParamsId,
  SourceInput,
  Source,
} from "../../../packages/contracts/src/source-content";
import type { ContentProvider } from "../../connectors/shared/content-provider.interface";
import { commitContentBatch, prepareContentBatch } from "../content/sql";
import { fail, transaction } from "../../storage/db";
import {
  assertSource,
  lockSource,
  sourceFromRow,
  sourceSelect,
  audit,
} from "./sql";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export async function collectionRoutes(
  app: FastifyInstance,
  pool: Pool,
  providers: ContentProvider[],
) {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();
  api.get(
    "/v1/sources",
    {
      schema: {
        response: {
          200: Type.Object({
            sources: Type.Array(Source),
            capabilities: Type.Any(),
          }),
        },
      },
    },
    async (request) => ({
      sources: (
        await pool.query(
          `${sourceSelect} WHERE ($1::uuid[] IS NULL OR cs.id=ANY($1)) ORDER BY cs.created_at,cs.id`,
          [request.actor!.allowedSourceIds],
        )
      ).rows.map(sourceFromRow),
      capabilities: providers.map((provider) => provider.capability),
    }),
  );
  api.get("/v1/sources/budgets", async (request) => {
    if (
      request.actor!.clientKind !== "browser" ||
      request.actor!.role === "viewer"
    )
      fail(403, "Administrator browser session required");
    return {
      budgets: (
        await pool.query(
          "SELECT provider,enabled,daily_requests,monthly_requests,daily_resources,monthly_resources,minimum_interval_ms,revision FROM source_provider_budget WHERE provider=ANY($1::text[]) ORDER BY provider",
          [providers.map((provider) => provider.capability.provider)],
        )
      ).rows,
    };
  });
  api.put(
    "/v1/sources/budgets/:provider",
    {
      schema: {
        params: Type.Object({ provider: Type.String({ maxLength: 64 }) }),
        body: Type.Object(
          {
            enabled: Type.Boolean(),
            dailyRequests: Type.Integer({ minimum: 0, maximum: 1000000 }),
            monthlyRequests: Type.Integer({ minimum: 0, maximum: 10000000 }),
            dailyResources: Type.Integer({ minimum: 0, maximum: 100000000 }),
            monthlyResources: Type.Integer({ minimum: 0, maximum: 1000000000 }),
            minimumIntervalMs: Type.Integer({ minimum: 0, maximum: 3600000 }),
            revision: Type.Integer({ minimum: 1 }),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request) => {
      if (
        request.actor!.clientKind !== "browser" ||
        request.actor!.role === "viewer"
      )
        fail(403, "Administrator browser session required");
      if (
        !providers.some(
          (provider) =>
            provider.capability.provider === request.params.provider,
        )
      )
        fail(422, "Provider not registered");
      const input = request.body;
      const result = await pool.query(
        `UPDATE source_provider_budget SET enabled=$2,daily_requests=$3,monthly_requests=$4,daily_resources=$5,monthly_resources=$6,minimum_interval_ms=$7,revision=revision+1 WHERE provider=$1 AND revision=$8 RETURNING revision`,
        [
          request.params.provider,
          input.enabled,
          input.dailyRequests,
          input.monthlyRequests,
          input.dailyResources,
          input.monthlyResources,
          input.minimumIntervalMs,
          input.revision,
        ],
      );
      if (!result.rowCount) fail(409, "Budget changed; reload before saving");
      await audit(
        pool,
        request.actor!,
        "provider.budget",
        request.params.provider,
      );
      return result.rows[0];
    },
  );
  api.post(
    "/v1/sources",
    { schema: { body: SourceInput } },
    async (request) => {
      if (request.actor!.clientKind !== "browser")
        fail(403, "Create sources from a browser administrator session");
      const input = request.body;
      const provider = providers.find(
        (item) =>
          item.capability.provider === input.primaryProvider &&
          item.capability.platform === input.platform,
      );
      if (
        (input.deliveryMode === "push") !==
        (input.primaryProvider === "external_ingest")
      )
        fail(422, "Push sources require external_ingest");
      if (input.deliveryMode === "pull" && !provider)
        fail(422, "Unsupported provider for this platform");
      const target = provider
        ? provider.normalizeTarget(input.target, input.contentKind)
        : input.target;
      const row = (
        await pool.query(
          `INSERT INTO collection_source(id,platform_id,provider,primary_provider,label,target,content_kind,delivery_mode,created_at,updated_at)
      SELECT $1,id,$2,$2,$3,$4,$5,$6,NOW(),NOW() FROM source WHERE code=$7
      RETURNING id`,
          [
            randomUUID(),
            input.primaryProvider,
            input.label,
            target,
            input.contentKind,
            input.deliveryMode,
            input.platform,
          ],
        )
      ).rows[0];
      if (!row) fail(422, "Platform not registered");
      return {
        source: sourceFromRow(
          (await pool.query(`${sourceSelect} WHERE cs.id=$1`, [row.id]))
            .rows[0],
        ),
      };
    },
  );
  api.patch(
    "/v1/sources/:id",
    {
      schema: {
        params: ParamsId,
        body: Type.Object(
          {
            state: Type.Union([
              Type.Literal("active"),
              Type.Literal("paused"),
              Type.Literal("archived"),
            ]),
            revision: Type.Integer({ minimum: 1 }),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request) =>
      transaction(pool, async (client) => {
        assertSource(request.actor!, request.params.id);
        const source = (
          await client.query(
            "SELECT * FROM collection_source WHERE id=$1 FOR UPDATE",
            [request.params.id],
          )
        ).rows[0];
        if (!source) fail(404, "Source not found");
        if (source.revision !== request.body.revision)
          fail(409, "Source changed; reload before saving");
        if (["arctic_shift", "twitterapi_io"].includes(source.primary_provider))
          fail(409, "Retired provider cannot be reactivated");
        await client.query(
          "UPDATE collection_source SET state=$2,revision=revision+1,updated_at=NOW() WHERE id=$1",
          [source.id, request.body.state],
        );
        if (request.body.state !== "active")
          await client.query(
            "UPDATE source_collection_job SET status='cancelled',finished_at=NOW(),lease_token=NULL,lease_until=NULL WHERE collection_source_id=$1 AND status IN ('queued','running','retrying')",
            [source.id],
          );
        return { updated: true };
      }),
  );
  api.post(
    "/v1/sources/:id/ingest",
    {
      bodyLimit: 1024 * 1024,
      schema: {
        params: ParamsId,
        body: Ingest,
        headers: Type.Object({
          "idempotency-key": Type.String({
            minLength: 1,
            maxLength: 128,
            pattern: "^[\\x21-\\x7e]+$",
          }),
        }),
      },
    },
    async (request, reply) => {
      for (const item of request.body.items) {
        if (Buffer.byteLength(item.title ?? "") > 4096 || Buffer.byteLength(item.text ?? "") > 65536) fail(413, "Content title or text exceeds byte limit");
      }
      const batch = prepareContentBatch(request.body.items.map(item => ({ ...item, id: item.id ?? randomUUID() })));
      const hash = createHash("sha256")
        .update(canonical(request.body))
        .digest("hex");
      return transaction(pool, async (client) => {
        const source = await lockSource(
          client,
          request.actor!,
          request.params.id,
        );
        if (source.delivery_mode !== "push")
          fail(409, "Ingest requires a push source");
        const key = request.headers["idempotency-key"];
        const previous = (
          await client.query(
            "SELECT * FROM source_collection_job WHERE collection_source_id=$1 AND ingest_key=$2 FOR UPDATE",
            [source.id, key],
          )
        ).rows[0];
        if (previous) {
          if (previous.payload_hash !== hash)
            fail(409, "Idempotency key already used with different content");
          return previous.result_summary;
        }
        const jobId = randomUUID();
        await client.query(
          `INSERT INTO source_collection_job(id,collection_source_id,status,purpose,operation,provider,ingest_key,payload_hash,next_run_at,created_at)
        VALUES($1,$2,'succeeded','ingest','ingest','external_ingest',$3,$4,NOW(),NOW())`,
          [jobId, source.id, key, hash],
        );
        const counts = await commitContentBatch(
          client,
          {
            id: source.id,
            platformId: source.platform_id,
            platform: source.platform,
            provider: "external_ingest",
            contentKinds: ["post", "comment", "article", "image", "video"],
          },
          batch,
          new Date().toISOString(),
        );
        reply.code(201);
        const result = {
          jobId,
          ...counts,
          accepted: request.body.items.length,
        };
        await client.query(
          "UPDATE source_collection_job SET result_summary=$2,records_processed=$3,records_inserted=$4,records_updated=$5,finished_at=NOW() WHERE id=$1",
          [jobId, result, result.accepted, counts.added, counts.updated],
        );
        await audit(client, request.actor!, "content.ingest", source.id);
        return result;
      });
    },
  );
  api.post(
    "/v1/sources/:id/collect",
    { schema: { params: ParamsId, body: Collect, headers: IdempotencyHeaders } },
    async (request) =>
      transaction(pool, async (client) => {
        const source = await lockSource(
          client,
          request.actor!,
          request.params.id,
        );
        const key = request.headers["idempotency-key"];
        const previous = (await client.query(
          "SELECT id,request_json FROM source_collection_job WHERE collection_source_id=$1 AND request_key=$2 AND purpose='collect'",
          [source.id, key],
        )).rows[0];
        if (previous) {
          if (canonical(previous.request_json) !== canonical(request.body)) fail(409, "Idempotency key already used with different request");
          return { jobId: previous.id };
        }
        if (source.delivery_mode !== "pull")
          fail(409, "Push sources cannot be scheduled");
        if (Date.parse(request.body.from) >= Date.parse(request.body.to))
          fail(422, "Invalid collection window");
        const provider = providers.find(
          (item) =>
            item.capability.provider === source.primary_provider &&
            item.capability.platform === source.platform,
        );
        const maxComments = request.body.maxCommentsPerPost ?? 15;
        if (
          source.primary_provider === "kaix" &&
          source.target.type !== "post" &&
          request.body.limit *
            (request.body.includeComments ? maxComments + 1 : 1) >
            2000
        )
          fail(422, "Requested batch exceeds 2000 nodes");
        if (
          source.primary_provider === "bluesky_appview" &&
          (request.body.limit > 100 || request.body.includeComments)
        )
          fail(422, "Bluesky supports at most 100 authored posts per request");
        if (!provider?.capability.enabled)
          fail(
            422,
            "Provider networking is disabled or credentials are missing",
          );
        if (source.automatic_collection_blocked)
          fail(
            409,
            "Collection is blocked pending review of an unresolved operation",
          );
        const id = randomUUID();
        await client.query(
          `INSERT INTO source_collection_job(id,collection_source_id,status,purpose,operation,provider,from_at,to_at,page_size,max_pages,next_run_at,created_at,request_key,request_json)
      VALUES($1,$2,'queued','collect','radar',$3,$4,$5,$6,1,NOW(),NOW(),$7,$8)`,
          [
            id,
            source.id,
            source.primary_provider,
            request.body.from,
            request.body.to,
            request.body.limit,
            key,
            request.body,
          ],
        );
        return { jobId: id };
      }),
  );
  api.get(
    "/v1/sources/:id/jobs",
    { schema: { params: ParamsId } },
    async (request) => {
      assertSource(request.actor!, request.params.id);
      return {
        jobs: (
          await pool.query(
            "SELECT id,status,operation,provider,provider_state,records_processed,error,created_at FROM source_collection_job WHERE collection_source_id=$1 ORDER BY created_at DESC LIMIT 50",
            [request.params.id],
          )
        ).rows,
      };
    },
  );
}
