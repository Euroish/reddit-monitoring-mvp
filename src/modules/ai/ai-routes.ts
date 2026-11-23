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
  listAiQueue,
  patchAiCandidate,
  publishAiCandidate,
  unpublishAiEvent,
} from "./ai-admin-sql";
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

export async function aiRoutes(app: FastifyInstance, pool: Pool, readWorkerHealth?: import("./ai-discovery").ReadWorkerHealth) {
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
    const publicAllowed = process.env.ARTIFICIAL_ANALYSIS_PUBLIC_REDISTRIBUTION === "true";
    return {
      items,
      configured: Boolean(process.env.ARTIFICIAL_ANALYSIS_API_KEY?.trim()) || items.length > 0 || internalCnt > 0,
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

  typed.post("/v1/admin/ai/sources/:code/sync", {config: { auth: { access: "admin_mfa" } }, schema: { params: ParamsSourceCode, body: SyncBody } },
    async (req) => {
      return syncRegistrySourceByCode(pool, req.params.code, {
        dryRun: req.body?.dryRun,
        triggerKind: "manual",
      });
    },
  );

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
    return getAiOpsSummary(pool, days, readWorkerHealth);
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
