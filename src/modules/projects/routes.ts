import type { Pool } from "pg";
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import {
  ParamsId,
  ProjectInput,
} from "../../../packages/contracts/src/source-content";
import { createProject, projectOverview, projectSources } from "./sql";

export async function projectRoutes(app: FastifyInstance, pool: Pool) {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();
  api.get("/v1/projects", async (request) => ({
    projects: (
      await pool.query(
        `SELECT p.* FROM monitor_project p WHERE NOT EXISTS(SELECT 1 FROM monitor_project_source ps WHERE ps.project_id=p.id AND $1::uuid[] IS NOT NULL AND NOT ps.collection_source_id=ANY($1)) ORDER BY p.updated_at DESC`,
        [request.actor!.allowedSourceIds],
      )
    ).rows,
  }));
  api.post("/v1/projects", { schema: { body: ProjectInput } }, (request) =>
    createProject(pool, request.actor!, request.body),
  );
  api.get(
    "/v1/projects/:id",
    { schema: { params: ParamsId } },
    async (request) =>
      (await projectSources(pool, request.actor!, request.params.id)).project,
  );
  api.get(
    "/v1/projects/:id/overview",
    { schema: { params: ParamsId } },
    (request) => projectOverview(pool, request.actor!, request.params.id),
  );
}
