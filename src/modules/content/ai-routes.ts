import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import {
  AiCandidatePatchBody,
  AiEventsQuery,
  AiModelsQuery,
  AiPublishCandidateBody,
  AiUpdatesQuery,
} from "../../../packages/contracts/src/ai-catalog";
import { ParamsId, type Actor } from "../../../packages/contracts/src/source-content";
import { fail } from "../../storage/db";
import {
  getAiEventDetail,
  getAiModelDetail,
  getAiRankingDetail,
  listAiEvents,
  listAiModels,
  listAiOfficialUpdates,
  listAiRankings,
  listAiVendors,
} from "./ai-sql";
import {
  listAiQueue,
  patchAiCandidate,
  publishAiCandidate,
  unpublishAiEvent,
} from "./ai-admin-sql";
import { syncRegistrySourceByCode } from "./ai-sync";

function requireAiAdmin(actor: Actor | null): Actor {
  if (!actor) fail(401, "Authentication required");
  if (actor.clientKind !== "browser") fail(403, "Browser administrator session required");
  if (actor.role !== "owner" && actor.role !== "admin") fail(403, "Administrator access required");
  return actor;
}

const ParamsModelRef = Type.Object({ id: Type.String({ minLength: 1, maxLength: 160 }) }, { additionalProperties: false });
const ParamsSourceCode = Type.Object({ code: Type.String({ minLength: 1, maxLength: 64 }) }, { additionalProperties: false });
const RankingsQuery = Type.Object({
  category: Type.Optional(Type.Union([
    Type.Literal("general"),
    Type.Literal("coding"),
    Type.Literal("reasoning"),
    Type.Literal("speed_price"),
  ])),
}, { additionalProperties: false });

const QueueQuery = Type.Object({
  status: Type.Optional(Type.String({ maxLength: 40 })),
  vendor: Type.Optional(Type.String({ maxLength: 64 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 2000 })),
}, { additionalProperties: false });

const RejectBody = Type.Object({
  expectedRevision: Type.Integer({ minimum: 1 }),
  status: Type.Optional(Type.Union([Type.Literal("rejected"), Type.Literal("deferred")])),
  reviewerNote: Type.Optional(Type.String({ maxLength: 1000 })),
}, { additionalProperties: false });

const BulkDismissBody = Type.Object({
  ids: Type.Array(Type.String({ format: "uuid" }), { minItems: 1, maxItems: 100 }),
  reviewerNote: Type.Optional(Type.String({ maxLength: 1000 })),
}, { additionalProperties: false });

const UnpublishBody = Type.Object({
  reason: Type.Optional(Type.String({ maxLength: 500 })),
}, { additionalProperties: false });

const EventPatchBody = Type.Object({
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 240 })),
  eventStatus: Type.Optional(Type.Union([
    Type.Literal("released"),
    Type.Literal("announced_future"),
    Type.Literal("deprecated"),
    Type.Literal("retired"),
  ])),
  summaryZh: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),
  summaryEn: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),
  visibility: Type.Optional(Type.Union([Type.Literal("published"), Type.Literal("unpublished"), Type.Literal("corrected")])),
}, { additionalProperties: false });

const CreateModelBody = Type.Object({
  vendorId: Type.String({ format: "uuid" }),
  canonicalSlug: Type.String({ minLength: 1, maxLength: 160 }),
  displayName: Type.String({ minLength: 1, maxLength: 160 }),
  family: Type.Optional(Type.String({ maxLength: 120 })),
  versionTag: Type.Optional(Type.String({ maxLength: 64 })),
  isOpenWeights: Type.Optional(Type.Boolean()),
  licenseName: Type.Optional(Type.String({ maxLength: 120 })),
  officialUrl: Type.Optional(Type.String({ maxLength: 2000 })),
  summaryZh: Type.Optional(Type.String({ maxLength: 2000 })),
  summaryEn: Type.Optional(Type.String({ maxLength: 2000 })),
}, { additionalProperties: false });

const CreateAliasBody = Type.Object({
  modelId: Type.String({ format: "uuid" }),
  sourceNamespace: Type.Union([
    Type.Literal("official"),
    Type.Literal("openrouter"),
    Type.Literal("litellm"),
    Type.Literal("hf"),
    Type.Literal("epoch"),
    Type.Literal("manual"),
  ]),
  alias: Type.String({ minLength: 1, maxLength: 256 }),
}, { additionalProperties: false });

const SyncBody = Type.Object({
  dryRun: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

export async function aiRoutes(app: FastifyInstance, pool: Pool) {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  // ── 8 explicit public read routes ──────────────────────────────────────────
  typed.get("/v1/ai/vendors", async () => {
    const items = await listAiVendors(pool);
    return { items };
  });

  typed.get("/v1/ai/models", { schema: { querystring: AiModelsQuery } }, async (req) => {
    const items = await listAiModels(pool, req.query);
    return { items };
  });

  typed.get("/v1/ai/models/:id", { schema: { params: ParamsModelRef } }, async (req) => {
    return getAiModelDetail(pool, req.params.id);
  });

  typed.get("/v1/ai/events", { schema: { querystring: AiEventsQuery } }, async (req) => {
    const items = await listAiEvents(pool, req.query);
    return { items };
  });

  typed.get("/v1/ai/events/:id", { schema: { params: ParamsId } }, async (req) => {
    return getAiEventDetail(pool, req.params.id);
  });

  typed.get("/v1/ai/updates", { schema: { querystring: AiUpdatesQuery } }, async (req) => {
    const items = await listAiOfficialUpdates(pool, req.query);
    return { items };
  });

  typed.get("/v1/ai/rankings", { schema: { querystring: RankingsQuery } }, async (req) => {
    const items = await listAiRankings(pool, req.query.category);
    return {
      items,
      configured: Boolean(process.env.ARTIFICIAL_ANALYSIS_API_KEY?.trim()) || items.length > 0,
    };
  });

  typed.get("/v1/ai/rankings/:id", { schema: { params: ParamsId } }, async (req) => {
    return getAiRankingDetail(pool, req.params.id);
  });

  // ── Admin-only AI review queue & catalog management ────────────────────────
  typed.get("/v1/admin/ai/queue", { schema: { querystring: QueueQuery } }, async (req) => {
    requireAiAdmin(req.actor);
    const items = await listAiQueue(pool, req.query);
    return { items };
  });

  typed.patch(
    "/v1/admin/ai/candidates/:id",
    { schema: { params: ParamsId, body: AiCandidatePatchBody } },
    async (req) => {
      requireAiAdmin(req.actor);
      return patchAiCandidate(pool, req.params.id, req.body);
    },
  );

  typed.post(
    "/v1/admin/ai/candidates/:id/publish",
    { schema: { params: ParamsId, body: AiPublishCandidateBody } },
    async (req) => {
      const actor = requireAiAdmin(req.actor);
      return publishAiCandidate(pool, req.params.id, actor.userId, req.body);
    },
  );

  typed.post(
    "/v1/admin/ai/candidates/:id/reject",
    { schema: { params: ParamsId, body: RejectBody } },
    async (req) => {
      requireAiAdmin(req.actor);
      return patchAiCandidate(pool, req.params.id, {
        expectedRevision: req.body.expectedRevision,
        status: req.body.status ?? "rejected",
        reviewerNote: req.body.reviewerNote ?? null,
      });
    },
  );

  typed.post(
    "/v1/admin/ai/candidates/bulk-dismiss",
    { schema: { body: BulkDismissBody } },
    async (req) => {
      const actor = requireAiAdmin(req.actor);
      const res = await pool.query(
        `UPDATE ai_event_candidate
         SET status = 'deferred', reviewer_note = COALESCE($2, reviewer_note),
             reviewed_by = $3, reviewed_at = NOW(), revision = revision + 1, updated_at = NOW()
         WHERE id = ANY($1::uuid[]) AND status IN ('pending', 'needs_info')
         RETURNING id`,
        [req.body.ids, req.body.reviewerNote ?? null, actor.userId],
      );
      return { dismissed: res.rowCount ?? 0 };
    },
  );

  typed.post(
    "/v1/admin/ai/events/:id/unpublish",
    { schema: { params: ParamsId, body: UnpublishBody } },
    async (req) => {
      requireAiAdmin(req.actor);
      return unpublishAiEvent(pool, req.params.id);
    },
  );

  typed.patch(
    "/v1/admin/ai/events/:id",
    { schema: { params: ParamsId, body: EventPatchBody } },
    async (req) => {
      requireAiAdmin(req.actor);
      const b = req.body;
      const res = await pool.query(
        `UPDATE ai_release_event
         SET title = COALESCE($2, title),
             event_status = COALESCE($3, event_status),
             summary_zh = CASE WHEN $4::boolean THEN $5 ELSE summary_zh END,
             summary_en = CASE WHEN $6::boolean THEN $7 ELSE summary_en END,
             publication_status = COALESCE($8, publication_status),
             updated_at = NOW()
         WHERE id = $1::uuid
         RETURNING id, title, event_status AS "eventStatus", publication_status AS visibility`,
        [
          req.params.id,
          b.title ?? null,
          b.eventStatus ?? null,
          b.summaryZh !== undefined,
          b.summaryZh ?? null,
          b.summaryEn !== undefined,
          b.summaryEn ?? null,
          b.visibility ?? null,
        ],
      );
      if (!res.rows[0]) fail(404, "AI release event not found");
      return res.rows[0];
    },
  );

  typed.post("/v1/admin/ai/models", { schema: { body: CreateModelBody } }, async (req) => {
    requireAiAdmin(req.actor);
    const b = req.body;
    const res = await pool.query(
      `INSERT INTO ai_model (
         vendor_id, slug, official_name, family, official_api_id,
         open_weights, license_name, summary_zh, summary_en
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, slug AS "canonicalSlug", official_name AS "displayName"`,
      [
        b.vendorId,
        b.canonicalSlug.trim().toLowerCase(),
        b.displayName.trim(),
        b.family ?? null,
        b.versionTag ?? null,
        Boolean(b.isOpenWeights),
        b.licenseName ?? null,
        b.summaryZh ?? null,
        b.summaryEn ?? null,
      ],
    );
    return res.rows[0];
  });

  typed.post("/v1/admin/ai/aliases", { schema: { body: CreateAliasBody } }, async (req) => {
    requireAiAdmin(req.actor);
    const res = await pool.query(
      `INSERT INTO ai_model_alias (model_id, source_namespace, alias, review_status)
       VALUES ($1,$2,$3,'verified')
       ON CONFLICT (source_namespace, alias) DO UPDATE SET model_id = EXCLUDED.model_id, review_status = 'verified'
       RETURNING id, model_id AS "modelId", source_namespace AS "sourceNamespace", alias`,
      [req.body.modelId, req.body.sourceNamespace, req.body.alias.trim()],
    );
    return res.rows[0];
  });

  typed.get("/v1/admin/ai/sources", async (req) => {
    requireAiAdmin(req.actor);
    const res = await pool.query(
      `SELECT id, code, kind, endpoint_url AS "endpointUrl", enabled,
              sync_interval_seconds AS "cadenceSeconds", last_success_at AS "lastSuccessAt",
              consecutive_failures AS "consecutiveFailures", circuit_open_until AS "circuitOpenUntil",
              last_error AS "lastError"
       FROM ai_registry_source ORDER BY code ASC`,
    );
    return { items: res.rows };
  });

  typed.post(
    "/v1/admin/ai/sources/:code/sync",
    { schema: { params: ParamsSourceCode, body: SyncBody } },
    async (req) => {
      requireAiAdmin(req.actor);
      return syncRegistrySourceByCode(pool, req.params.code, {
        dryRun: req.body?.dryRun,
        triggerKind: "manual",
      });
    },
  );

  typed.get("/v1/admin/ai/sync-runs", async (req) => {
    requireAiAdmin(req.actor);
    const res = await pool.query(
      `SELECT r.id, r.source_code AS "sourceCode", r.trigger_kind AS "triggerKind", r.status,
              r.fetched_count AS "itemsSeen", r.changed_count AS "itemsChanged",
              r.candidates_created AS "candidatesCreated", r.started_at AS "startedAt",
              r.finished_at AS "finishedAt", r.error_message AS "errorMessage"
       FROM ai_sync_run r
       ORDER BY r.started_at DESC LIMIT 40`,
    );
    return { items: res.rows };
  });
}
