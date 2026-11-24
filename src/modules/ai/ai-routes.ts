import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import {
  AiCandidatePatchBody,
  AiEventStatus,
  AiEventType,
  AiEventsQuery,
  AiModelsQuery,
  AiPublishCandidateBody,
  AiUpdatesQuery,
  AiVendorSourceBinding,
} from "../../../packages/contracts/src/ai-catalog";
import { ParamsId } from "../../../packages/contracts/src/common";
import { transaction } from "../../storage/db";
import { isWebArticlePullSource } from "../content/index";
import { fail } from "../../shared/errors";
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
  createAdminAiEvent,
  deleteAdminAiEvent,
  listAdminAiEvents,
  listAiQueue,
  patchAiCandidate,
  publishAiCandidate,
  unpublishAiEvent,
} from "./ai-admin-sql";
import type { AiCredentialVault } from "./ai-credentials";
import {
  archiveLowValueCandidates,
  getAiOpsSummary,
  rollbackAiEvent,
  runOfficialEventDiscovery,
} from "./ai-discovery";
import { syncRegistrySourceByCode } from "./ai-sync";


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

const AdminEventsQuery = Type.Object({
  vendor: Type.Optional(Type.String({ maxLength: 64 })),
  eventType: Type.Optional(AiEventType),
  eventStatus: Type.Optional(AiEventStatus),
  visibility: Type.Optional(Type.Union([
    Type.Literal("all"),
    Type.Literal("published"),
    Type.Literal("unpublished"),
    Type.Literal("corrected"),
  ])),
  q: Type.Optional(Type.String({ maxLength: 120 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 5000 })),
}, { additionalProperties: false });

const EventCreateBody = Type.Object({
  vendorId: Type.String({ format: "uuid" }),
  modelId: Type.Optional(Type.Union([Type.String({ format: "uuid" }), Type.Null()])),
  eventType: AiEventType,
  eventStatus: Type.Optional(AiEventStatus),
  publicationStatus: Type.Optional(Type.Union([Type.Literal("published"), Type.Literal("unpublished")])),
  title: Type.String({ minLength: 1, maxLength: 240 }),
  eventDate: Type.String({ format: "date" }),
  datePrecision: Type.Optional(Type.Union([Type.Literal("day"), Type.Literal("month")])),
  officialAnnouncedOn: Type.Optional(Type.Union([Type.String({ format: "date" }), Type.Null()])),
  availableFrom: Type.Optional(Type.Union([Type.String({ format: "date" }), Type.Null()])),
  effectiveOn: Type.Optional(Type.Union([Type.String({ format: "date" }), Type.Null()])),
  summaryZh: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),
  summaryEn: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),
  keyChanges: Type.Optional(Type.Array(Type.String({ maxLength: 240 }), { maxItems: 12 })),
  sourceTier: Type.Optional(Type.Union([
    Type.Literal("official"),
    Type.Literal("historical_verified"),
    Type.Literal("manual_verified"),
  ])),
  primaryReferenceUrl: Type.Optional(Type.Union([Type.String({ minLength: 8, maxLength: 2000 }), Type.Null()])),
  primaryReferenceTitle: Type.Optional(Type.Union([Type.String({ maxLength: 240 }), Type.Null()])),
}, { additionalProperties: false });

const EventPatchBody = Type.Object({
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 240 })),
  eventType: Type.Optional(AiEventType),
  eventStatus: Type.Optional(AiEventStatus),
  eventDate: Type.Optional(Type.String({ format: "date" })),
  datePrecision: Type.Optional(Type.Union([Type.Literal("day"), Type.Literal("month")])),
  officialAnnouncedOn: Type.Optional(Type.Union([Type.String({ format: "date" }), Type.Null()])),
  availableFrom: Type.Optional(Type.Union([Type.String({ format: "date" }), Type.Null()])),
  effectiveOn: Type.Optional(Type.Union([Type.String({ format: "date" }), Type.Null()])),
  summaryZh: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),
  summaryEn: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),
  keyChanges: Type.Optional(Type.Array(Type.String({ maxLength: 240 }), { maxItems: 12 })),
  visibility: Type.Optional(Type.Union([Type.Literal("published"), Type.Literal("unpublished"), Type.Literal("corrected")])),
}, { additionalProperties: false });

const SourcePatchBody = Type.Object({
  enabled: Type.Optional(Type.Boolean()),
  cadenceSeconds: Type.Optional(Type.Integer({ minimum: 60, maximum: 604800 })),
  clearCircuit: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

const AiCredentialProviderParam = Type.Object({
  provider: Type.Union([
    Type.Literal("artificial_analysis"),
    Type.Literal("ai_llm"),
    Type.Literal("openrouter"),
  ]),
}, { additionalProperties: false });

const AiCredentialConfigBody = Type.Object({
  apiUrl: Type.Optional(Type.String({ maxLength: 500 })),
  model: Type.Optional(Type.String({ maxLength: 120 })),
  publicRedistribution: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

const AiCredentialPutBody = Type.Object({
  apiKey: Type.Optional(Type.String({ maxLength: 512 })),
  config: Type.Optional(AiCredentialConfigBody),
}, { additionalProperties: false });

const AiCredentialTestBody = Type.Object({
  apiKey: Type.Optional(Type.String({ maxLength: 512 })),
  apiUrl: Type.Optional(Type.String({ maxLength: 500 })),
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

export async function aiRoutes(
  app: FastifyInstance,
  pool: Pool,
  readWorkerHealth?: import("./ai-discovery").ReadWorkerHealth,
  aiVault?: AiCredentialVault,
) {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  // ── 8 explicit public read routes ──────────────────────────────────────────
  typed.get("/v1/ai/vendors", { config: { auth: { access: "public_read" } } }, async () => {
    const items = await listAiVendors(pool);
    return { items };
  });

  typed.get("/v1/ai/models", { config: { auth: { access: "public_read" } }, schema: { querystring: AiModelsQuery } }, async (req) => {
    const items = await listAiModels(pool, req.query);
    return { items };
  });

  typed.get("/v1/ai/models/:id", { config: { auth: { access: "public_read" } }, schema: { params: ParamsModelRef } }, async (req) => {
    return getAiModelDetail(pool, req.params.id);
  });

  typed.get("/v1/ai/events", { config: { auth: { access: "public_read" } }, schema: { querystring: AiEventsQuery } }, async (req) => {
    const items = await listAiEvents(pool, req.query);
    return { items };
  });

  typed.get("/v1/ai/events/:id", { config: { auth: { access: "public_read" } }, schema: { params: ParamsId } }, async (req) => {
    return getAiEventDetail(pool, req.params.id);
  });

  typed.get("/v1/ai/updates", { config: { auth: { access: "public_read" } }, schema: { querystring: AiUpdatesQuery } }, async (req) => {
    const items = await listAiOfficialUpdates(pool, req.query);
    return { items };
  });

  typed.get("/v1/ai/rankings", { config: { auth: { access: "public_read" } }, schema: { querystring: RankingsQuery } }, async (req) => {
    const items = await listAiRankings(pool, req.query.category, false);
    const internalCnt = Number(
      (await pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ai_benchmark_snapshot WHERE public_redistribution_allowed = FALSE`)).rows[0]?.count ?? "0",
    );
    await aiVault?.ensureLoaded();
    const aaStatus = aiVault?.resolve("artificial_analysis");
    const publicAllowed = aaStatus ? Boolean(aaStatus.config.publicRedistribution) : process.env.ARTIFICIAL_ANALYSIS_PUBLIC_REDISTRIBUTION === "true";
    const keyConfigured = aaStatus ? aaStatus.configured : Boolean(process.env.ARTIFICIAL_ANALYSIS_API_KEY?.trim());
    return {
      items,
      configured: keyConfigured || items.length > 0 || internalCnt > 0,
      publicRedistributionAllowed: publicAllowed || items.length > 0,
      internalSnapshotCount: internalCnt,
    };
  });

  typed.get("/v1/ai/rankings/:id", { config: { auth: { access: "public_read" } }, schema: { params: ParamsId } }, async (req) => {
    return getAiRankingDetail(pool, req.params.id, false);
  });

  // ── Admin-only AI review queue & catalog management ────────────────────────
  typed.get("/v1/admin/ai/queue", { config: { auth: { access: "admin" } }, schema: { querystring: QueueQuery } }, async (req) => {
    const items = await listAiQueue(pool, req.query);
    return { items };
  });

  typed.patch("/v1/admin/ai/candidates/:id", {config: { auth: { access: "admin_mfa" } }, schema: { params: ParamsId, body: AiCandidatePatchBody } },
    async (req) => {
      return patchAiCandidate(pool, req.params.id, req.body);
    },
  );

  typed.post("/v1/admin/ai/candidates/:id/publish", {config: { auth: { access: "admin_mfa" } }, schema: { params: ParamsId, body: AiPublishCandidateBody } },
    async (req) => {
      return publishAiCandidate(pool, req.params.id, req.actor!.userId, req.body);
    },
  );

  typed.post("/v1/admin/ai/candidates/:id/reject", {config: { auth: { access: "admin_mfa" } }, schema: { params: ParamsId, body: RejectBody } },
    async (req) => {
      return patchAiCandidate(pool, req.params.id, {
        expectedRevision: req.body.expectedRevision,
        status: req.body.status ?? "rejected",
        reviewerNote: req.body.reviewerNote ?? null,
      });
    },
  );

  typed.post("/v1/admin/ai/candidates/bulk-dismiss", {config: { auth: { access: "admin_mfa" } }, schema: { body: BulkDismissBody } },
    async (req) => {
      const res = await pool.query(
        `UPDATE ai_event_candidate
         SET status = 'deferred', reviewer_note = COALESCE($2, reviewer_note),
             reviewed_by = $3, reviewed_at = NOW(), revision = revision + 1, updated_at = NOW()
         WHERE id = ANY($1::uuid[]) AND status IN ('pending', 'needs_info')
         RETURNING id`,
        [req.body.ids, req.body.reviewerNote ?? null, req.actor!.userId],
      );
      return { dismissed: res.rowCount ?? 0 };
    },
  );

  typed.get("/v1/admin/ai/events", { config: { auth: { access: "admin" } }, schema: { querystring: AdminEventsQuery } }, async (req) => {
    return listAdminAiEvents(pool, req.query);
  });

  typed.post("/v1/admin/ai/events", { config: { auth: { access: "admin_mfa" } }, schema: { body: EventCreateBody } }, async (req) => {
    return createAdminAiEvent(pool, req.body);
  });

  typed.post("/v1/admin/ai/events/:id/unpublish", {config: { auth: { access: "admin_mfa" } }, schema: { params: ParamsId, body: UnpublishBody } },
    async (req) => {
      return unpublishAiEvent(pool, req.params.id);
    },
  );

  typed.patch("/v1/admin/ai/events/:id", {config: { auth: { access: "admin_mfa" } }, schema: { params: ParamsId, body: EventPatchBody } },
    async (req) => {
      const b = req.body;
      const res = await pool.query(
        `UPDATE ai_release_event
         SET title = COALESCE($2, title),
             event_type = COALESCE($3, event_type),
             event_status = COALESCE($4, event_status),
             event_date = COALESCE($5::date, event_date),
             date_precision = COALESCE($6, date_precision),
             official_announced_on = CASE WHEN $7::boolean THEN $8::date ELSE official_announced_on END,
             available_from = CASE WHEN $9::boolean THEN $10::date ELSE available_from END,
             effective_on = CASE WHEN $11::boolean THEN $12::date ELSE effective_on END,
             summary_zh = CASE WHEN $13::boolean THEN $14 ELSE summary_zh END,
             summary_en = CASE WHEN $15::boolean THEN $16 ELSE summary_en END,
             key_changes = CASE WHEN $17::boolean THEN $18::jsonb ELSE key_changes END,
             publication_status = COALESCE($19, publication_status),
             revision = revision + 1,
             updated_at = NOW()
         WHERE id = $1::uuid
         RETURNING id, title, event_type AS "eventType", event_status AS "eventStatus", event_date::text AS "eventDate",
                   date_precision AS "datePrecision", publication_status AS visibility, revision`,
        [
          req.params.id,
          b.title ?? null,
          b.eventType ?? null,
          b.eventStatus ?? null,
          b.eventDate ?? null,
          b.datePrecision ?? null,
          b.officialAnnouncedOn !== undefined,
          b.officialAnnouncedOn ?? null,
          b.availableFrom !== undefined,
          b.availableFrom ?? null,
          b.effectiveOn !== undefined,
          b.effectiveOn ?? null,
          b.summaryZh !== undefined,
          b.summaryZh ?? null,
          b.summaryEn !== undefined,
          b.summaryEn ?? null,
          b.keyChanges !== undefined,
          JSON.stringify(b.keyChanges ?? []),
          b.visibility ?? null,
        ],
      );
      if (!res.rows[0]) fail(404, "AI release event not found");
      return res.rows[0];
    },
  );

  typed.delete("/v1/admin/ai/events/:id", { config: { auth: { access: "admin_mfa" } }, schema: { params: ParamsId } }, async (req) => {
    return deleteAdminAiEvent(pool, req.params.id);
  });

  typed.post("/v1/admin/ai/models", {config: { auth: { access: "admin_mfa" } }, schema: { body: CreateModelBody } }, async (req) => {
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

  typed.post("/v1/admin/ai/aliases", {config: { auth: { access: "admin_mfa" } }, schema: { body: CreateAliasBody } }, async (req) => {
    const res = await pool.query(
      `INSERT INTO ai_model_alias (model_id, source_namespace, alias, review_status)
       VALUES ($1,$2,$3,'verified')
       ON CONFLICT (source_namespace, alias) DO UPDATE SET model_id = EXCLUDED.model_id, review_status = 'verified'
       RETURNING id, model_id AS "modelId", source_namespace AS "sourceNamespace", alias`,
      [req.body.modelId, req.body.sourceNamespace, req.body.alias.trim()],
    );
    return res.rows[0];
  });

  typed.get("/v1/admin/ai/sources", { config: { auth: { access: "admin" } } }, async () => {
    const res = await pool.query(
      `SELECT id, code, kind, endpoint_url AS "endpointUrl", enabled,
              sync_interval_seconds AS "cadenceSeconds", last_success_at AS "lastSuccessAt",
              consecutive_failures AS "consecutiveFailures", circuit_open_until AS "circuitOpenUntil",
              last_error AS "lastError"
       FROM ai_registry_source ORDER BY code ASC`,
    );
    return { items: res.rows };
  });

  typed.get("/v1/admin/ai/vendor-sources", { config: { auth: { access: "admin" } } }, async () => {
    const { rows } = await pool.query(
      'SELECT source_id AS "sourceId", vendor_id AS "vendorId", source_role AS "sourceRole", is_official AS "isOfficial" ' +
      'FROM ai_vendor_source ORDER BY source_id, vendor_id',
    );
    return { items: rows };
  });

  typed.put("/v1/admin/ai/vendor-sources", {
    config: { auth: { access: "admin_mfa" } },
    schema: { body: AiVendorSourceBinding },
  }, async (req) => {
    const { sourceId, vendorId, sourceRole, isOfficial } = req.body;
    return transaction(pool, async (client) => {
      if (!(await isWebArticlePullSource(client, sourceId))) fail(422, "An existing Web article pull source is required");
      const vendor = await client.query("SELECT id FROM ai_vendor WHERE id=$1 FOR KEY SHARE", [vendorId]);
      if (!vendor.rowCount) fail(404, "AI vendor not found");
      const other = await client.query("SELECT 1 FROM ai_vendor_source WHERE source_id=$1 AND vendor_id<>$2", [sourceId, vendorId]);
      if (other.rowCount) fail(409, "Remove the current vendor binding before choosing a different vendor");
      await client.query(
        "INSERT INTO ai_vendor_source(source_id,vendor_id,source_role,is_official) VALUES($1,$2,$3,$4) " +
        "ON CONFLICT(source_id,vendor_id) DO UPDATE SET source_role=EXCLUDED.source_role,is_official=EXCLUDED.is_official",
        [sourceId, vendorId, sourceRole, isOfficial],
      );
      return req.body;
    });
  });

  typed.delete("/v1/admin/ai/vendor-sources/:sourceId/:vendorId", {
    config: { auth: { access: "admin_mfa" } },
    schema: { params: Type.Pick(AiVendorSourceBinding, ["sourceId", "vendorId"]) },
  }, async (req) => {
    const { sourceId, vendorId } = req.params;
    await pool.query("DELETE FROM ai_vendor_source WHERE source_id=$1 AND vendor_id=$2", [sourceId, vendorId]);
    return { removed: true };
  });

  typed.patch("/v1/admin/ai/sources/:code", {
    config: { auth: { access: "admin_mfa" } },
    schema: { params: ParamsSourceCode, body: SourcePatchBody },
  }, async (req) => {
    const b = req.body;
    if (b.enabled === undefined && b.cadenceSeconds === undefined && !b.clearCircuit) {
      fail(422, "At least one source change (enabled, cadenceSeconds, or clearCircuit) is required");
    }
    const res = await pool.query(
      `UPDATE ai_registry_source
       SET enabled = COALESCE($2, enabled),
           sync_interval_seconds = COALESCE($3, sync_interval_seconds),
           consecutive_failures = CASE WHEN $4 THEN 0 ELSE consecutive_failures END,
           backoff_seconds = CASE WHEN $4 THEN 0 ELSE backoff_seconds END,
           circuit_open_until = CASE WHEN $4 THEN NULL ELSE circuit_open_until END,
           last_error = CASE WHEN $4 THEN NULL ELSE last_error END,
           next_run_at = CASE
             WHEN ($4 OR $2 IS TRUE) AND COALESCE($2, enabled) THEN NOW()
             ELSE next_run_at
           END,
           updated_at = NOW()
       WHERE code = $1
       RETURNING id, code, kind, endpoint_url AS "endpointUrl", enabled,
                 sync_interval_seconds AS "cadenceSeconds", last_success_at AS "lastSuccessAt",
                 consecutive_failures AS "consecutiveFailures", circuit_open_until AS "circuitOpenUntil",
                 last_error AS "lastError"`,
      [req.params.code, b.enabled ?? null, b.cadenceSeconds ?? null, Boolean(b.clearCircuit)],
    );
    if (!res.rows[0]) fail(404, "AI registry source not found");
    if (b.clearCircuit) {
      await pool.query("UPDATE ai_ops_alert SET resolved_at = NOW() WHERE source_code = $1 AND resolved_at IS NULL", [req.params.code]);
    }
    return res.rows[0];
  });

  typed.post("/v1/admin/ai/sources/:code/sync", {config: { auth: { access: "admin_mfa" } }, schema: { params: ParamsSourceCode, body: SyncBody } },
    async (req) => {
      return syncRegistrySourceByCode(pool, req.params.code, {
        dryRun: req.body?.dryRun,
        triggerKind: "manual",
        aiVault,
      });
    },
  );

  typed.get("/v1/admin/ai/credentials", { config: { auth: { access: "admin" } } }, async () => {
    if (!aiVault) return { items: [] };
    return { items: await aiVault.listStatuses() };
  });

  typed.put("/v1/admin/ai/credentials/:provider", {
    config: { auth: { access: "admin_mfa" } },
    schema: { params: AiCredentialProviderParam, body: AiCredentialPutBody },
  }, async (req) => {
    if (!aiVault) fail(503, "AI credential vault is unavailable");
    return aiVault.save(req.params.provider, req.actor!, req.body);
  });

  typed.delete("/v1/admin/ai/credentials/:provider", {
    config: { auth: { access: "admin_mfa" } },
    schema: { params: AiCredentialProviderParam },
  }, async (req) => {
    if (!aiVault) fail(503, "AI credential vault is unavailable");
    return aiVault.remove(req.params.provider, req.actor!);
  });

  typed.post("/v1/admin/ai/credentials/:provider/test", {
    config: { auth: { access: "admin_mfa" } },
    schema: { params: AiCredentialProviderParam, body: AiCredentialTestBody },
  }, async (req) => {
    if (!aiVault) fail(503, "AI credential vault is unavailable");
    return aiVault.testConnection(req.params.provider, req.body);
  });

  typed.get("/v1/admin/ai/sync-runs", { config: { auth: { access: "admin" } } }, async () => {
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

  // ── Automation ops: summary, audit, rollback, internal rankings, vendor rollout ──
  typed.get("/v1/admin/ai/ops/summary", { config: { auth: { access: "admin" } } }, async (req) => {
    const q = req.query as { days?: string };
    const days = q?.days ? Number(q.days) || 7 : 7;
    return getAiOpsSummary(pool, days, readWorkerHealth, aiVault);
  });

  typed.get("/v1/admin/ai/ops/audit", { config: { auth: { access: "admin" } } }, async () => {
    const res = await pool.query(
      `SELECT a.id, a.mode, a.vendor_id AS "vendorId", v.name AS "vendorName",
              a.event_id AS "eventId", a.candidate_id AS "candidateId",
              a.confidence::float AS confidence, a.rule_name AS "ruleName",
              a.reason, a.evidence_snapshot AS "evidenceSnapshot", a.created_at AS "createdAt"
       FROM ai_auto_publish_audit a
       LEFT JOIN ai_vendor v ON v.id = a.vendor_id
       ORDER BY a.created_at DESC LIMIT 60`,
    );
    return { items: res.rows };
  });

  typed.get("/v1/admin/ai/rankings", { config: { auth: { access: "admin" } }, schema: { querystring: RankingsQuery } }, async (req) => {
    const items = await listAiRankings(pool, req.query.category, true);
    return { items };
  });

  typed.post("/v1/admin/ai/events/:id/rollback", {config: { auth: { access: "admin_mfa" } }, schema: { params: ParamsId, body: UnpublishBody } },
    async (req) => {
      return rollbackAiEvent(pool, req.params.id, req.body?.reason?.trim() || "Manual admin rollback", "manual_rollback");
    },
  );

  typed.post(
    "/v1/admin/ai/discovery/run",
    {
      config: { auth: { access: "admin_mfa" } }, schema: {
        body: Type.Object({
          shadowMode: Type.Optional(Type.Boolean()),
          lookbackHours: Type.Optional(Type.Integer({ minimum: 1, maximum: 8760 })),
          archiveLowValue: Type.Optional(Type.Boolean()),
        }, { additionalProperties: false }),
      },
    },
    async (req) => {
      const discovery = await runOfficialEventDiscovery(pool, {
        shadowMode: req.body?.shadowMode,
        lookbackHours: req.body?.lookbackHours,
        aiVault,
      });
      const archived = req.body?.archiveLowValue ? await archiveLowValueCandidates(pool, 24) : { archived: 0 };
      return { ...discovery, ...archived };
    },
  );

  typed.patch(
    "/v1/admin/ai/vendors/:id/autopublish",
    {
      config: { auth: { access: "admin_mfa" } }, schema: {
        params: ParamsId,
        body: Type.Object({ enabled: Type.Boolean() }, { additionalProperties: false }),
      },
    },
    async (req) => {
      const res = await pool.query(
        `UPDATE ai_vendor SET auto_publish_enabled = $2, updated_at = NOW()
         WHERE id = $1::uuid RETURNING id, slug, name, auto_publish_enabled AS "autoPublishEnabled"`,
        [req.params.id, req.body.enabled],
      );
      if (!res.rows[0]) fail(404, "AI vendor not found");
      return res.rows[0];
    },
  );

  typed.post("/v1/admin/ai/alerts/:id/resolve", {config: { auth: { access: "admin_mfa" } }, schema: { params: ParamsId } }, async (req) => {
    const res = await pool.query(
      `UPDATE ai_ops_alert SET resolved_at = NOW() WHERE id = $1::uuid RETURNING id, resolved_at AS "resolvedAt"`,
      [req.params.id],
    );
    if (!res.rows[0]) fail(404, "Alert not found");
    return res.rows[0];
  });

  typed.get("/v1/admin/ai/history/status", { config: { auth: { access: "admin" } } }, async () => {
    const [imports, backfills] = await Promise.all([
      pool.query(`SELECT id, dataset_version AS "datasetVersion", dataset_sha256 AS "datasetSha256", trigger_kind AS "triggerKind", status, inserted_models AS "insertedModels", inserted_events AS "insertedEvents", matched_events AS "matchedEvents", skipped_events AS "skippedEvents", conflicts, started_at AS "startedAt", finished_at AS "finishedAt" FROM ai_history_import_run ORDER BY started_at DESC LIMIT 10`),
      pool.query(`SELECT id, source_code AS "sourceCode", vendor_slug AS "vendorSlug", status, scanned_count AS "scannedCount", published_count AS "publishedCount", candidates_count AS "candidatesCount", skipped_count AS "skippedCount", error_message AS "errorMessage", started_at AS "startedAt", finished_at AS "finishedAt" FROM ai_history_backfill_run ORDER BY started_at DESC LIMIT 10`),
    ]);
    return { imports: imports.rows, backfills: backfills.rows };
  });
}
