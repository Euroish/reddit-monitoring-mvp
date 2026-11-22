import type { Pool } from "pg";
import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import {
  Hydrate,
  Id,
  IdempotencyHeaders,
  ParamsId,
  ProjectBatchAttachInput,
  ProjectBatchStatusInput,
  ProjectInput,
  strictMerge,
} from "../../../packages/contracts/src/source-content";
import { deleteProject, listProjects, projectOverview, projectSources, writeProject } from "./sql";
import { attachBatchToProject, listProjectBatches, updateProjectBatchStatus } from "./batches";

import type { ContentProvider } from "../../connectors/shared/content-provider.interface";
import { enqueueHydration } from "../collection/index";
import { fail } from "../../storage/db";

const Revision = Type.Object({ revision: Type.Integer({ minimum: 1 }) }, { additionalProperties: false });

export async function projectRoutes(app: FastifyInstance, pool: Pool, providers: ContentProvider[]) {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();
  api.get("/v1/projects", async (request) => ({ projects: await listProjects(pool, request.actor!) }));
  api.post("/v1/projects", { schema: { body: ProjectInput } }, (request) =>
    writeProject(pool, request.actor!, request.body),
  );
  api.get("/v1/projects/:id", { schema: { params: ParamsId } }, (request) =>
    projectSources(pool, request.actor!, request.params.id),
  );
  api.patch("/v1/projects/:id", { schema: { params: ParamsId, body: strictMerge([ProjectInput, Revision]) } }, (request) =>
    writeProject(pool, request.actor!, request.body, { id: request.params.id, revision: request.body.revision }),
  );
  api.delete("/v1/projects/:id", { schema: { params: ParamsId, querystring: Revision } }, (request) =>
    deleteProject(pool, request.actor!, request.params.id, request.query.revision),
  );
  api.post("/v1/projects/:id/hydrate", {
    schema: { params: ParamsId, body: Hydrate, headers: IdempotencyHeaders },
  }, (request) => {
    if (!providers.some(({ capability }) => capability.provider === "kaix" && capability.enabled))
      fail(422, "kaix networking is disabled or credentials are missing");
    return enqueueHydration(pool, request.actor!, request.params.id, request.headers["idempotency-key"], request.body);
  });
  api.get("/v1/projects/:id/overview", { schema: { params: ParamsId } }, (request) =>
    projectOverview(pool, request.actor!, request.params.id),
  );
  api.get("/v1/projects/:id/batches", { schema: { params: ParamsId } }, async (request) => ({
    batches: await listProjectBatches(pool, request.actor!, request.params.id),
  }));
  api.post(
    "/v1/projects/:id/batches",
    { schema: { params: ParamsId, body: ProjectBatchAttachInput } },
    (request) => attachBatchToProject(pool, request.actor!, request.params.id, request.body.batchId),
  );
  api.patch(
    "/v1/projects/:id/batches/:batchId",
    {
      schema: {
        params: Type.Object({ id: Id, batchId: Id }),
        body: ProjectBatchStatusInput,
      },
    },
    (request) =>
      updateProjectBatchStatus(pool, request.actor!, request.params.id, request.params.batchId, request.body.status),
  );
}
