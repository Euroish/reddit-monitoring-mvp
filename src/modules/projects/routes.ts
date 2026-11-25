import type { Pool } from "pg";
import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Id, IdempotencyHeaders, ParamsId, strictMerge } from "../../../packages/contracts/src/common";
import { Hydrate } from "../../../packages/contracts/src/collection";
import {
  ProjectBatchAttachInput,
  ProjectBatchMoveInput,
  ProjectBatchStatusInput,
  ProjectForkInput,
  ProjectInput,
  ProjectPublishInput,
} from "../../../packages/contracts/src/projects";
import { AnalysisScopeInput } from "../../../packages/contracts/src/research";
import type { ContentProvider } from "../../connectors/shared/content-provider.interface";
import { notifyChannel } from "../../platform/pg-notify";
import { fail } from "../../shared/errors";
import { transaction } from "../../storage/db";
import { enqueueHydrationForScope, loadAuthorizedBatches } from "../collection/index";
import { runL1ResearchOverview } from "./research";
import { getProjectResearchScopeTree } from "./research-scope";
import {
  deleteProject,
  forkProject,
  listProjectBatchIds,
  listProjects,
  projectOverview,
  projectSources,
  publishProject,
  resolveProjectScope,
  writeProject,
} from "./sql";

import { attachBatchToProject, listProjectBatches, moveBatchBetweenProjects, updateProjectBatchStatus } from "./batches";

const Revision = Type.Object({ revision: Type.Integer({ minimum: 1 }) }, { additionalProperties: false });

export async function projectRoutes(app: FastifyInstance, pool: Pool, providers: ContentProvider[]) {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();
  const readAuth = { auth: { access: "authenticated" as const, machineScope: "read" as const } };
  const writeAuth = { auth: { access: "viewer_write" as const, machineScope: "projects:write" as const } };

  api.get(
    "/v1/projects",
    { config: readAuth },
    async (request) => ({ projects: await listProjects(pool, request.actor!) }),
  );
  api.post(
    "/v1/projects",
    { config: writeAuth, schema: { body: ProjectInput } },
    (request) => writeProject(pool, request.actor!, request.body),
  );
  api.get(
    "/v1/projects/:id",
    { config: readAuth, schema: { params: ParamsId } },
    (request) => projectSources(pool, request.actor!, request.params.id),
  );
  api.patch(
    "/v1/projects/:id",
    { config: writeAuth, schema: { params: ParamsId, body: strictMerge([ProjectInput, Revision]) } },
    (request) => writeProject(pool, request.actor!, request.body, { id: request.params.id, revision: request.body.revision }),
  );
  api.delete(
    "/v1/projects/:id",
    { config: writeAuth, schema: { params: ParamsId, querystring: Revision } },
    (request) => deleteProject(pool, request.actor!, request.params.id, request.query.revision),
  );
  api.post(
    "/v1/projects/:id/hydrate",
    {
      config: { auth: { access: "viewer_write", machineScope: "collect" } },
      schema: { params: ParamsId, body: Hydrate, headers: IdempotencyHeaders },
    },
    async (request) => {
      if (!providers.some(({ capability }) => capability.provider === "kaix" && capability.enabled)) {
        fail(422, "kaix networking is disabled or credentials are missing");
      }
      const outcome = await transaction(pool, async (client) => {
        await client.query("SELECT id FROM monitor_project WHERE id=$1 FOR UPDATE", [request.params.id]);
        const actor = request.actor!;
        const project = await resolveProjectScope(client, actor, request.params.id);
        const sourceIds = 'batchMembership' in project
          ? [...new Set((await loadAuthorizedBatches(client, actor, await listProjectBatchIds(client, actor, project.id))).map(batch => batch.sourceId))]
          : project.source_ids;
        return enqueueHydrationForScope(
          client,
          request.actor!,
          { projectId: project.id, sourceIds, filter: project.filter,
            batchMembership: "batchMembership" in project ? project.batchMembership : undefined },
          request.headers["idempotency-key"],
          request.body,
        );
      });
      if (outcome.created) await notifyChannel(pool, "collection_jobs_ready");
      return { jobIds: outcome.jobIds };
    },
  );
  api.get(
    "/v1/projects/:id/overview",
    { config: readAuth, schema: { params: ParamsId } },
    (request) => projectOverview(pool, request.actor!, request.params.id),
  );
  api.get("/v1/projects/:id/batches", { config: { auth: { access: "authenticated", browserOnly: true } }, schema: { params: ParamsId } }, async (request) => ({
    batches: await listProjectBatches(pool, request.actor!, request.params.id),
  }));
  api.post(
    "/v1/projects/:id/batches",
    { config: { auth: { access: "viewer_write", browserOnly: true } }, schema: { params: ParamsId, body: ProjectBatchAttachInput } },
    (request) => attachBatchToProject(pool, request.actor!, request.params.id, request.body.batchId),
  );
  api.patch(
    "/v1/projects/:id/batches/:batchId",
    {
      config: { auth: { access: "viewer_write", browserOnly: true } },
      schema: {
        params: Type.Object({ id: Id, batchId: Id }),
        body: ProjectBatchStatusInput,
      },
    },
    (request) =>
      updateProjectBatchStatus(pool, request.actor!, request.params.id, request.params.batchId, request.body.status),
  );
  api.post(
    "/v1/projects/:id/publish",
    { config: { auth: { access: "admin_mfa", browserOnly: true } }, schema: { params: ParamsId, body: ProjectPublishInput } },
    (request) => publishProject(pool, request.actor!, request.params.id, request.body),
  );
  api.post(
    "/v1/projects/:id/fork",
    { config: { auth: { access: "viewer_write", browserOnly: true } }, schema: { params: ParamsId, body: ProjectForkInput } },
    (request) => forkProject(pool, request.actor!, request.params.id, request.body),
  );
  api.post(
    "/v1/projects/:id/batches/:batchId/move",
    {
      config: { auth: { access: "viewer_write", browserOnly: true } },
      schema: { params: Type.Object({ id: Id, batchId: Id }), body: ProjectBatchMoveInput },
    },
    (request) =>
      moveBatchBetweenProjects(pool, request.actor!, request.params.id, request.params.batchId, request.body.targetProjectId),
  );
  api.get(
    "/v1/projects/:id/research/scope",
    { config: readAuth, schema: { params: ParamsId } },
    (request) => getProjectResearchScopeTree(pool, request.actor!, request.params.id),
  );
  api.post(
    "/v1/projects/:id/research/l1",
    {
      handlerTimeout: 25_000,
      config: { auth: { access: "authenticated", browserOnly: true } },
      schema: { params: ParamsId, body: AnalysisScopeInput },
    },
    (request) => runL1ResearchOverview(pool, request.actor!, request.params.id, request.body),
  );
}
