import type { Pool } from "pg";
import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { IdempotencyHeaders, ParamsId, strictMerge } from "../../../packages/contracts/src/common";
import { Hydrate } from "../../../packages/contracts/src/collection";
import { ProjectInput } from "../../../packages/contracts/src/projects";
import type { ContentProvider } from "../../connectors/shared/content-provider.interface";
import { notifyChannel } from "../../platform/pg-notify";
import { fail } from "../../shared/errors";
import { transaction } from "../../storage/db";
import { enqueueHydrationForScope } from "../collection/index";
import { deleteProject, listProjects, projectOverview, projectSources, writeProject } from "./sql";

const Revision = Type.Object({ revision: Type.Integer({ minimum: 1 }) }, { additionalProperties: false });

export async function projectRoutes(app: FastifyInstance, pool: Pool, providers: ContentProvider[]) {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();
  const readAuth = { auth: { access: "authenticated" as const, machineScope: "read" as const } };
  const writeAuth = { auth: { access: "admin" as const, machineScope: "projects:write" as const } };

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
        const project = await projectSources(client, request.actor!, request.params.id);
        return enqueueHydrationForScope(
          client,
          request.actor!,
          { projectId: project.id, sourceIds: project.source_ids, filter: project.filter },
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
}
