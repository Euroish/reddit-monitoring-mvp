import { providerBudgetBounds } from "../../../packages/contracts/src/collection-budget";
import { createHash, randomUUID } from "node:crypto";
import { Type, type Static } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Pool, PoolClient } from "pg";
import type { Actor } from "../../../packages/contracts/src/access";
import { IdempotencyHeaders, ParamsId, SourceGroup, SourceLocale, SourceTier } from "../../../packages/contracts/src/common";
import {
  Collect,
  FallbackProvider,
  Ingest,
  PublicSourceDirectory,
  Source,
  SourceFetchPolicy,
  SourceInput,
  SourceListQuery,
  SourceOwner,
  SourceSchedule,
  SourceTags,
} from "../../../packages/contracts/src/collection";
import type { ContentProvider } from "../../connectors/shared/content-provider.interface";
import { notifyChannel } from "../../platform/pg-notify";
import { fail } from "../../shared/errors";
import { transaction } from "../../storage/db";
import { canonical, commitContentBatch, prepareContentBatch } from "../content/index";
import { collectionRequestRestriction, isCollectionBudgetDisabled, sourcePreviewRoute, validateFallback, validateSource } from "./config";
import { batchRoutes, recordCommittedBatch } from "./batches";
import { planRoutes, type RequireWritableProject } from "./plans";
import { sourceImportRoute } from "./import";
import { admitViewerCollection, viewerCollectionDemand } from "./policy";
import { assertSource, audit, insertSource, listPublicSources, listSources, lockSource } from "./sql";

const PatchSourceBody = Type.Object(
  {
    label: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
    sourceGroup: Type.Optional(SourceGroup),
    tags: Type.Optional(SourceTags),
    locale: Type.Optional(SourceLocale),
    fetchPolicy: Type.Optional(SourceFetchPolicy),
    fallbackProvider: Type.Optional(Type.Union([FallbackProvider, Type.Null()])),
    schedule: Type.Optional(SourceSchedule),
    tier: Type.Optional(SourceTier),
    ownerEntityId: Type.Optional(SourceOwner),
    state: Type.Optional(Type.Union([Type.Literal("active"), Type.Literal("paused"), Type.Literal("archived")])),
    revision: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

async function applySourcePatch(
  client: PoolClient,
  actor: Actor,
  sourceId: string,
  body: Static<typeof PatchSourceBody>,
  providers: ContentProvider[],
) {
  assertSource(actor, sourceId);
  const source = (await client.query("SELECT * FROM collection_source WHERE id=$1 FOR UPDATE", [sourceId])).rows[0];
  if (!source) fail(404, "Source not found");
  if (source.revision !== body.revision) fail(409, "Source changed; reload before saving");
  if (["arctic_shift", "twitterapi_io"].includes(source.primary_provider)) {
    fail(409, "Retired provider cannot be reactivated");
  }
  if (body.label !== undefined && !body.label.trim()) fail(422, "Source label cannot be blank");
  if ((body.schedule || body.tier || body.ownerEntityId !== undefined) && actor.clientKind !== "browser") {
    fail(403, "Configure scheduling and authority from a browser administrator session");
  }
  if (body.schedule?.enabled && source.delivery_mode !== "pull") {
    fail(422, "Automatic scheduling requires a pull source");
  }
  if (body.fallbackProvider) {
    validateFallback(providers, {
      primary: source.primary_provider,
      fallback: body.fallbackProvider,
      delivery: source.delivery_mode,
      target: source.target,
      kind: source.content_kind,
    });
  }
  const pick = <T>(val: T | undefined, prev: T) => (val === undefined ? prev : val);
  await client.query(
    `UPDATE collection_source SET label=$2,state=$3,fallback_provider=$4,revision=revision+1,updated_at=NOW(),
      schedule=COALESCE($5::jsonb,schedule),next_due_at=CASE WHEN $5::jsonb IS NULL THEN next_due_at
        WHEN $5::jsonb @> '{"enabled":true}' THEN now() END,
      tier=COALESCE($6,tier),owner_entity_id=$7,source_group=$8,tags=$9,locale=$10,fetch_policy=$11::jsonb
      WHERE id=$1`,
    [
      source.id, body.label ?? source.label, body.state ?? source.state,
      pick(body.fallbackProvider, source.fallback_provider), body.schedule ?? null, body.tier ?? null,
      pick(body.ownerEntityId, source.owner_entity_id), pick(body.sourceGroup, source.source_group),
      pick(body.tags, source.tags), pick(body.locale, source.locale), pick(body.fetchPolicy, source.fetch_policy),
    ],
  );
  if (body.state && body.state !== "active") {
    await client.query(
      "UPDATE source_collection_job SET status='cancelled',finished_at=NOW(),lease_token=NULL,lease_until=NULL WHERE collection_source_id=$1 AND status IN ('queued','retrying') AND provider_state='{}'",
      [source.id],
    );
  }
  if (body.schedule && !body.schedule.enabled) {
    await client.query(
      "UPDATE source_collection_job SET status='cancelled',finished_at=now() WHERE collection_source_id=$1 AND purpose='scheduled' AND status IN ('queued','retrying') AND provider_state='{}'",
      [source.id],
    );
  }
  return { updated: true };
}

function validateCollectWindowAndProvider(
  source: import("pg").QueryResultRow,
  body: Static<typeof Collect>,
  providers: ContentProvider[],
) {
  if (source.delivery_mode !== "pull") fail(409, "Push sources cannot be scheduled");
  if (Date.parse(body.from) >= Date.parse(body.to)) fail(422, "Invalid collection window");
  const providerName = body.useFallback ? source.fallback_provider : source.primary_provider;
  if (!providerName) fail(422, "No fallback provider configured for this source");
  const provider = providers.find(
    (item) => item.capability.provider === providerName && item.capability.platform === source.platform,
  );
  const restriction = collectionRequestRestriction(providerName, source.platform, source.target.type, body);
  if (restriction) fail(422, restriction);
  if (!provider?.capability.enabled) fail(422, "Provider networking is disabled or credentials are missing");
  if (source.automatic_collection_blocked) fail(409, "Collection is blocked pending review of an unresolved operation");
  return providerName as string;
}

export async function collectionRoutes(app: FastifyInstance, pool: Pool, providers: ContentProvider[], requireWritableProject?: RequireWritableProject) {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();
  sourcePreviewRoute(app, providers);
  await sourceImportRoute(app, pool, providers);
  await batchRoutes(app, pool);
  await planRoutes(app, pool, providers, requireWritableProject);
  api.get(
    "/v1/public/sources",
    {
      config: { auth: { access: "public_read", machineScope: "read" } },
      schema: { response: { 200: PublicSourceDirectory } },
    },
    async (request) => listPublicSources(pool, request.actor!),
  );
  api.get(
    "/v1/sources",
    {
      config: { auth: { access: "authenticated", machineScope: "read" } },
      schema: {
        querystring: SourceListQuery,
        response: { 200: Type.Object({ sources: Type.Array(Source), capabilities: Type.Any() }) },
      },
    },
    async (request) => ({
      sources: await listSources(pool, request.actor!, request.query),
      capabilities: providers.map((provider) => provider.capability),
    }),
  );
  api.get(
    "/v1/sources/budgets",
    { config: { auth: { access: "authenticated", machineScope: "read" } } },
    async (request) => {
      if (request.actor!.clientKind !== "browser" || request.actor!.role === "viewer") {
        fail(403, "Administrator browser session required");
      }
      return {
        budgets: (
          await pool.query(
            `WITH clock AS (
               SELECT (NOW() AT TIME ZONE 'UTC')::date AS today, date_trunc('month',NOW() AT TIME ZONE 'UTC')::date AS month_start
             )
             SELECT b.provider,b.enabled,b.daily_requests,b.monthly_requests,b.daily_resources,b.monthly_resources,b.minimum_interval_ms,b.revision,
               usage.requests_today,usage.requests_month,usage.resources_today,usage.resources_month
             FROM source_provider_budget b CROSS JOIN clock
             CROSS JOIN LATERAL (
               SELECT COALESCE(SUM(requests) FILTER (WHERE day=clock.today),0)::float8 AS requests_today,
                 COALESCE(SUM(requests),0)::float8 AS requests_month,
                 COALESCE(SUM(resources_reserved) FILTER (WHERE day=clock.today),0)::float8 AS resources_today,
                 COALESCE(SUM(resources_reserved),0)::float8 AS resources_month
               FROM source_provider_usage WHERE provider=b.provider AND day BETWEEN clock.month_start AND clock.today
             ) usage
             WHERE b.provider=ANY($1::text[]) ORDER BY b.provider`,
            [providers.map((provider) => provider.capability.provider)],
          )
        ).rows,
      };
    },
  );
  api.put(
    "/v1/sources/budgets/:provider",
    {
      config: { auth: { access: "admin", machineScope: "sources:write" } },
      schema: {
        params: Type.Object({ provider: Type.String({ maxLength: 64 }) }),
        body: Type.Object(
          {
            enabled: Type.Boolean(),
            dailyRequests: Type.Integer(providerBudgetBounds.dailyRequests),
            monthlyRequests: Type.Integer(providerBudgetBounds.monthlyRequests),
            dailyResources: Type.Integer(providerBudgetBounds.dailyResources),
            monthlyResources: Type.Integer(providerBudgetBounds.monthlyResources),
            minimumIntervalMs: Type.Integer(providerBudgetBounds.minimumIntervalMs),
            revision: Type.Integer({ minimum: 1 }),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request) => {
      if (request.actor!.clientKind !== "browser" || request.actor!.role === "viewer") {
        fail(403, "Administrator browser session required");
      }
      if (!providers.some((provider) => provider.capability.provider === request.params.provider)) {
        fail(422, "Provider not registered");
      }
      const input = request.body;
      const out = await transaction(pool, async (client) => {
        const result = await client.query(
          `UPDATE source_provider_budget
           SET enabled=$2,daily_requests=$3,monthly_requests=$4,daily_resources=$5,
               monthly_resources=$6,minimum_interval_ms=$7,revision=revision+1
           WHERE provider=$1 AND revision=$8 RETURNING revision`,
          [
            request.params.provider, input.enabled, input.dailyRequests, input.monthlyRequests,
            input.dailyResources, input.monthlyResources, input.minimumIntervalMs, input.revision,
          ],
        );
        if (!result.rowCount) fail(409, "Budget changed; reload before saving");
        await client.query(
          "UPDATE source_collection_job SET next_run_at=now() WHERE provider=$1 AND status='queued' AND error='Waiting for provider budget'",
          [request.params.provider],
        );
        await audit(client, request.actor!, "provider.budget", request.params.provider);
        return result.rows[0];
      });
      await notifyChannel(pool, "collection_jobs_ready");
      return out;
    },
  );
  api.post(
    "/v1/sources",
    { config: { auth: { access: "admin", machineScope: "sources:write" } }, schema: { body: SourceInput } },
    async (request) => {
      if (request.actor!.clientKind !== "browser") fail(403, "Create sources from a browser administrator session");
      const { target } = validateSource(providers, request.body);
      return { source: await insertSource(pool, request.body, target) };
    },
  );
  api.patch(
    "/v1/sources/:id",
    {
      config: { auth: { access: "admin", machineScope: "sources:write" } },
      schema: { params: ParamsId, body: PatchSourceBody },
    },
    (request) => transaction(pool, (client) => applySourcePatch(client, request.actor!, request.params.id, request.body, providers)),
  );
  api.post(
    "/v1/sources/:id/ingest",
    {
      config: { auth: { access: "admin", machineScope: "ingest" } },
      bodyLimit: 1024 * 1024,
      schema: { params: ParamsId, body: Ingest, headers: IdempotencyHeaders },
    },
    async (request, reply) => {
      for (const item of request.body.items) {
        if (Buffer.byteLength(item.title ?? "") > 4096 || Buffer.byteLength(item.text ?? "") > 65536) {
          fail(413, "Content title or text exceeds byte limit");
        }
      }
      const batch = prepareContentBatch(request.body.items.map((item) => ({ ...item, id: item.id ?? randomUUID() })));
      const hash = createHash("sha256").update(canonical(request.body)).digest("hex");
      return transaction(pool, async (client) => {
        const source = await lockSource(client, request.actor!, request.params.id);
        if (source.delivery_mode !== "push") fail(409, "Ingest requires a push source");
        const key = request.headers["idempotency-key"];
        const previous = (
          await client.query("SELECT * FROM source_collection_job WHERE collection_source_id=$1 AND ingest_key=$2 FOR UPDATE", [
            source.id, key,
          ])
        ).rows[0];
        if (previous) {
          if (previous.payload_hash !== hash) fail(409, "Idempotency key already used with different content");
          return previous.result_summary;
        }
        const jobId = randomUUID();
        await client.query(
          `INSERT INTO source_collection_job(id,collection_source_id,status,purpose,operation,provider,ingest_key,payload_hash,
            next_run_at,created_at,requested_by_user_id,requested_by_client_kind)
          VALUES($1,$2,'succeeded','ingest','ingest','external_ingest',$3,$4,NOW(),NOW(),$5,$6)`,
          [jobId, source.id, key, hash, request.actor!.userId, request.actor!.clientKind],
        );
        const counts = await commitContentBatch(
          client,
          { id: source.id, platformId: source.platform_id, platform: source.platform, provider: "external_ingest",
            contentKinds: ["post", "comment", "article", "image", "video"] },
          batch,
          new Date().toISOString(),
        );
        const committed = await recordCommittedBatch(client, {
          jobId,
          sourceId: source.id,
          sourceLabel: source.label,
          userId: request.actor!.userId ?? null,
          contentIds: counts.contentIds,
        });
        reply.code(201);
        const result = {
          jobId,
          batchId: committed.batchId,
          added: counts.added,
          updated: counts.updated,
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
    {
      config: { auth: { access: "viewer_write", machineScope: "collect" } },
      schema: { params: ParamsId, body: Collect, headers: IdempotencyHeaders },
    },
    async (request) => {
      const outcome = await transaction(pool, async (client) => {
        const source = await lockSource(
          client,
          request.actor!,
          request.params.id,
        );
        if (request.body.projectId) {
          if (request.actor!.clientKind !== "browser") fail(403, "Browser session required");
          if (!requireWritableProject) fail(500, "Project scope resolver is unavailable");
          await requireWritableProject(client, request.actor!, request.body.projectId);
        }
        const key = request.headers["idempotency-key"];
        const previous = (await client.query(
          "SELECT id,request_json,requested_by_user_id,requested_by_client_kind FROM source_collection_job WHERE collection_source_id=$1 AND request_key=$2 AND purpose='collect' AND operation='radar'",
          [source.id, key],
        )).rows[0];
        if (previous) {
          if (previous.requested_by_client_kind !== request.actor!.clientKind ||
              previous.requested_by_user_id !== (request.actor!.userId ?? null) ||
              canonical(previous.request_json) !== canonical(request.body))
            fail(409, "Idempotency key already used with different request");
          return { jobId: previous.id, created: false };
        }
        const providerName = validateCollectWindowAndProvider(source, request.body, providers);
        if (request.body.projectId && await isCollectionBudgetDisabled(client, providerName))
          fail(409, "System channel budget is disabled or zero");
        const pageSize =
          providerName === "twitterapis" ? Math.min(request.body.limit, 20) : request.body.limit;
        await admitViewerCollection(client, request.actor!, {
          sourceId: source.id,
          from: request.body.from,
          to: request.body.to,
          useFallback: request.body.useFallback,
          ...viewerCollectionDemand(providerName, source.target.type, pageSize, request.body),
        });
        const id = randomUUID();
        await client.query(
          `INSERT INTO source_collection_job(id,collection_source_id,status,purpose,operation,provider,from_at,to_at,
            page_size,max_pages,next_run_at,created_at,request_key,request_json,requested_by_user_id,requested_by_client_kind)
          VALUES($1,$2,'queued','collect','radar',$3,$4,$5,$6,1,NOW(),NOW(),$7,$8,$9,$10)`,
          [id, source.id, providerName, request.body.from, request.body.to, pageSize, key, request.body, request.actor!.userId, request.actor!.clientKind],
        );
        return { jobId: id, created: true };
      });
      if (outcome.created) await notifyChannel(pool, "collection_jobs_ready");
      return { jobId: outcome.jobId };
    },
  );
  api.get(
    "/v1/sources/:id/jobs",
    { config: { auth: { access: "authenticated", machineScope: "read" } }, schema: { params: ParamsId } },
    async (request) => {
      assertSource(request.actor!, request.params.id);
      const isViewer = request.actor!.role === "viewer";
      return {
        jobs: (
          await pool.query(
            `SELECT id,collection_source_id,status,purpose,operation,provider,provider_state,records_processed,
               records_inserted,records_updated,error,created_at,finished_at,requested_by_client_kind
             FROM source_collection_job
             WHERE collection_source_id=$1
               AND ($2 OR (requested_by_user_id=$3 AND requested_by_client_kind='browser'))
             ORDER BY created_at DESC LIMIT 50`,
            [request.params.id, !isViewer, request.actor!.userId],
          )
        ).rows,
      };
    },
  );
}
