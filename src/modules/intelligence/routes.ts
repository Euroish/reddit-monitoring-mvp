import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Pool } from "pg";
import { IdempotencyHeaders, ParamsId } from "../../../packages/contracts/src/common";
import {
  AuthorListQuery, AuthorProfileParams, AuthorProfileQuery, CommunityDeepDiveQuery, CommunityListQuery, CommunityParams,
  MonitorCollectBody, MonitorCreateBody, MonitorKind, MonitorOverviewQuery, MonitorPatchBody, MonitorPostsQuery,
} from "../../../packages/contracts/src/intelligence";
import type { ContentProvider } from "../../connectors/shared/content-provider.interface";
import {
  getCommunityDeepDive, getMonitorOverview, getTrackedAuthorProfile,
  listMonitoredCommunities, listMonitorPosts, listTrackedAuthors,
} from "./analytics";
import {
  createMonitor, deleteMonitor, estimateMonitorRun, listLegacyMonitorSources, listMonitors,
  loadMonitor, reconcileLegacyMonitorSource, triggerMonitorCollect, updateMonitor,
} from "./sql";

export async function intelligenceRoutes(app: FastifyInstance, pool: Pool, providers: ContentProvider[]) {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();
  const readAuth = { auth: { access: "authenticated" as const, machineScope: "read" as const } };
  const writeAuth = { auth: { access: "viewer_write" as const, machineScope: "projects:write" as const } };
  const collectAuth = { auth: { access: "viewer_write" as const, machineScope: "collect" as const } };

  api.get("/v1/intelligence/monitors",
    { config: readAuth, schema: { querystring: Type.Object({ kind: Type.Optional(MonitorKind) }, { additionalProperties: false }) } },
    async (request) => ({ monitors: await listMonitors(pool, request.actor!, request.query.kind) }));
  api.post("/v1/intelligence/monitors",
    { config: { auth: { access: "admin", browserOnly: true } }, schema: { body: MonitorCreateBody } },
    async (request) => ({ monitor: await createMonitor(pool, request.actor!, providers, request.body) }));
  api.get("/v1/intelligence/monitors/:id",
    { config: readAuth, schema: { params: ParamsId } },
    async (request) => loadMonitor(pool, request.actor!, request.params.id));
  api.patch("/v1/intelligence/monitors/:id",
    { config: writeAuth, schema: { params: ParamsId, body: MonitorPatchBody } },
    async (request) => ({ monitor: await updateMonitor(pool, request.actor!, providers, request.params.id, request.body) }));
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
}
