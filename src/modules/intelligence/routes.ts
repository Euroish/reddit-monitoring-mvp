import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Pool } from "pg";
import { IdempotencyHeaders, ParamsId } from "../../../packages/contracts/src/common";
import {
  AuthorListQuery, AuthorProfileParams, AuthorProfileQuery, CommunityDeepDiveQuery, CommunityListQuery, CommunityParams,
  MonitorCollectBody, MonitorCreateBody, MonitorKind, MonitorOverviewQuery, MonitorPatchBody, MonitorPostsQuery,
} from "../../../packages/contracts/src/intelligence";
import {
  CreateResearchTaskInput,
  L2ComparisonInput,
  ResearchTaskEvidenceQuery,
  ResearchTaskParams,
} from "../../../packages/contracts/src/research";
import type { ContentProvider } from "../../connectors/shared/content-provider.interface";
import {
  getCommunityDeepDive, getMonitorOverview, getTrackedAuthorProfile,
  listMonitoredCommunities, listMonitorPosts, listTrackedAuthors,
} from "./analytics";
import {
  getIntelligenceOpsSummary,
  reconcileAdminMonitor,
} from "./admin-ops";
import { runL2ResearchComparison } from "./research-l2";
import {
  cancelResearchTask,
  createResearchTask,
  deleteResearchTask,
  getResearchTask,
  getResearchTaskEvidence,
  listResearchTasks,
  retryResearchTask,
} from "./research-tasks";
import {
  createMonitor, deleteMonitor, estimateMonitorRun, listLegacyMonitorSources, listMonitors,
  loadMonitor, reconcileLegacyMonitorSource, triggerMonitorCollect, updateMonitor, type AssertWritableProjectFn,
} from "./sql";

export async function intelligenceRoutes(
  app: FastifyInstance,
  pool: Pool,
  providers: ContentProvider[],
  assertWritableProject?: AssertWritableProjectFn,
) {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();
  const readAuth = { auth: { access: "authenticated" as const, machineScope: "read" as const } };
  const writeAuth = { auth: { access: "viewer_write" as const, machineScope: "projects:write" as const } };
  const collectAuth = { auth: { access: "viewer_write" as const, machineScope: "collect" as const } };

  api.get("/v1/intelligence/monitors",
    { config: readAuth, schema: { querystring: Type.Object({ kind: Type.Optional(MonitorKind) }, { additionalProperties: false }) } },
    async (request) => ({ monitors: await listMonitors(pool, request.actor!, request.query.kind) }));
  api.post("/v1/intelligence/monitors",
    { config: { auth: { access: "viewer_write", browserOnly: true } }, schema: { body: MonitorCreateBody } },
    async (request) => ({ monitor: await createMonitor(pool, request.actor!, providers, request.body, assertWritableProject) }));
  api.get("/v1/intelligence/monitors/:id",
    { config: readAuth, schema: { params: ParamsId } },
    async (request) => loadMonitor(pool, request.actor!, request.params.id));
  api.patch("/v1/intelligence/monitors/:id",
    { config: writeAuth, schema: { params: ParamsId, body: MonitorPatchBody } },
    async (request) => ({ monitor: await updateMonitor(pool, request.actor!, providers, request.params.id, request.body, assertWritableProject) }));
  api.delete("/v1/intelligence/monitors/:id",
    { config: writeAuth, schema: { params: ParamsId, body: Type.Object({ revision: Type.Integer({ minimum: 1 }) }, { additionalProperties: false }) } },
    (request) => deleteMonitor(pool, request.actor!, request.params.id, request.body.revision));
  api.post("/v1/intelligence/monitors/:id/estimate",
    { config: writeAuth, schema: { params: ParamsId, body: MonitorCollectBody } },
    (request) => estimateMonitorRun(pool, request.actor!, request.params.id, request.body));
  api.post("/v1/intelligence/monitors/:id/collect",
    { config: collectAuth, schema: { params: ParamsId, headers: IdempotencyHeaders, body: MonitorCollectBody } },
    (request) => triggerMonitorCollect(pool, request.actor!, providers, request.params.id, request.headers["idempotency-key"], request.body));
  api.get("/v1/intelligence/monitors/:id/overview",
    { config: readAuth, schema: { params: ParamsId, querystring: MonitorOverviewQuery } },
    (request) => getMonitorOverview(pool, request.actor!, request.params.id, request.query));
  api.get("/v1/intelligence/monitors/:id/posts",
    { config: readAuth, schema: { params: ParamsId, querystring: MonitorPostsQuery } },
    (request) => listMonitorPosts(pool, request.actor!, request.params.id, request.query));
  api.get("/v1/intelligence/authors",
    { config: readAuth, schema: { querystring: AuthorListQuery } },
    (request) => listTrackedAuthors(pool, request.actor!, request.query));
  api.get("/v1/intelligence/authors/:platform/:handle",
    { config: readAuth, schema: { params: AuthorProfileParams, querystring: AuthorProfileQuery } },
    (request) => getTrackedAuthorProfile(pool, request.actor!, request.params.platform, request.params.handle, request.query));
  api.get("/v1/intelligence/communities",
    { config: readAuth, schema: { querystring: CommunityListQuery } },
    (request) => listMonitoredCommunities(pool, request.actor!, request.query));
  api.get("/v1/intelligence/communities/:subreddit",
    { config: readAuth, schema: { params: CommunityParams, querystring: CommunityDeepDiveQuery } },
    (request) => getCommunityDeepDive(pool, request.actor!, request.params.subreddit, request.query));
  api.get("/v1/intelligence/admin/legacy-sources",
    { config: { auth: { access: "admin", browserOnly: true } } },
    (request) => listLegacyMonitorSources(pool, request.actor!));
  api.post("/v1/intelligence/admin/legacy-sources/:id/reconcile",
    {
      config: { auth: { access: "admin_mfa", browserOnly: true } },
      schema: {
        params: ParamsId,
        body: Type.Object({
          action: Type.Union([Type.Literal("pause_schedule"), Type.Literal("claim_monitor_managed")]),
          revision: Type.Integer({ minimum: 1 }),
        }, { additionalProperties: false }),
      },
    },
    (request) => reconcileLegacyMonitorSource(pool, request.actor!, request.params.id, request.body));
  api.get("/v1/intelligence/admin/ops-summary",
    { config: { auth: { access: "admin", browserOnly: true } } },
    () => getIntelligenceOpsSummary(pool));
  api.post("/v1/intelligence/admin/monitors/:id/reconcile",
    {
      config: { auth: { access: "admin_mfa", browserOnly: true } },
      schema: {
        params: ParamsId,
        body: Type.Object({
          action: Type.Union([Type.Literal("pause"), Type.Literal("resume"), Type.Literal("refresh_rollups")]),
          revision: Type.Integer({ minimum: 1 }),
        }, { additionalProperties: false }),
      },
    },
    (request) => reconcileAdminMonitor(pool, request.actor!, request.params.id, request.body));

  // Phase 2: L2 Comparison / Text Intelligence & L3 On-Demand Async Research Tasks
  const browserAuth = { auth: { access: "authenticated" as const, browserOnly: true as const } };

  api.post("/v1/projects/:id/research/l2",
    { handlerTimeout: 25_000, config: browserAuth, schema: { params: ParamsId, body: L2ComparisonInput } },
    (request) => runL2ResearchComparison(pool, request.actor!, request.params.id, request.body));

  api.get("/v1/projects/:id/research/tasks",
    { config: readAuth, schema: { params: ParamsId } },
    (request) => listResearchTasks(pool, request.actor!, request.params.id));

  api.post("/v1/projects/:id/research/tasks",
    { config: browserAuth, schema: { params: ParamsId, body: CreateResearchTaskInput } },
    async (request, reply) => {
      const task = await createResearchTask(pool, request.actor!, request.params.id, request.body);
      return reply.code(202).send({ task });
    });

  api.get("/v1/projects/:id/research/tasks/:taskId",
    { config: readAuth, schema: { params: ResearchTaskParams } },
    async (request) => ({ task: await getResearchTask(pool, request.actor!, request.params.id, request.params.taskId) }));

  api.post("/v1/projects/:id/research/tasks/:taskId/cancel",
    { config: browserAuth, schema: { params: ResearchTaskParams } },
    async (request) => ({ task: await cancelResearchTask(pool, request.actor!, request.params.id, request.params.taskId) }));

  api.post("/v1/projects/:id/research/tasks/:taskId/retry",
    { config: browserAuth, schema: { params: ResearchTaskParams } },
    async (request) => ({ task: await retryResearchTask(pool, request.actor!, request.params.id, request.params.taskId) }));

  api.delete("/v1/projects/:id/research/tasks/:taskId",
    { config: browserAuth, schema: { params: ResearchTaskParams } },
    (request) => deleteResearchTask(pool, request.actor!, request.params.id, request.params.taskId));

  api.get("/v1/projects/:id/research/tasks/:taskId/evidence",
    { config: readAuth, schema: { params: ResearchTaskParams, querystring: ResearchTaskEvidenceQuery } },
    (request) => getResearchTaskEvidence(pool, request.actor!, request.params.id, request.params.taskId, request.query));
}
