import { Type } from "@sinclair/typebox";
import type { Pool } from "pg";
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { ParamsId } from "../../../packages/contracts/src/common";
import { ResearchFilter } from "../../../packages/contracts/src/content";
import { compileContentFilter, type ContentVisibilityResolver } from "../content/index";
import { listAnnotations, listSavedQueries, saveQuery, updateAnnotation } from "./sql";

export async function workspaceRoutes(
  app: FastifyInstance,
  pool: Pool,
  resolveContentVisibility?: ContentVisibilityResolver,
) {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();
  const readAuth = { auth: { access: "authenticated" as const } };
  const writeAuth = { auth: { access: "viewer_write" as const } };

  api.get("/v1/workspace/queries", { config: readAuth }, async (request) => ({
    queries: await listSavedQueries(pool, request.actor!),
  }));

  api.post(
    "/v1/workspace/queries",
    {
      config: writeAuth,
      schema: {
        body: Type.Object(
          {
            name: Type.String({ minLength: 1, maxLength: 100 }),
            filter: ResearchFilter,
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request) => {
      const { name, filter } = request.body;
      compileContentFilter(request.actor!, filter);
      return saveQuery(pool, request.actor!, name, filter);
    },
  );

  api.delete(
    "/v1/workspace/queries/:id",
    { config: writeAuth, schema: { params: ParamsId } },
    async (request) => {
      await pool.query("DELETE FROM content_saved_query WHERE id=$1 AND user_id=$2", [
        request.params.id,
        request.actor!.userId,
      ]);
      return { deleted: true };
    },
  );

  api.get("/v1/workspace/annotations", { config: readAuth }, async (request) => ({
    annotations: await listAnnotations(pool, request.actor!, resolveContentVisibility),
  }));

  api.get(
    "/v1/workspace/annotations/:id",
    { config: readAuth, schema: { params: ParamsId } },
    async (request) => ({
      annotation:
        (
          await pool.query(
            "SELECT favorite,note,revision FROM content_annotation WHERE user_id=$1 AND content_id=$2",
            [request.actor!.userId, request.params.id],
          )
        ).rows[0] ?? null,
    }),
  );

  api.put(
    "/v1/workspace/annotations/:id",
    {
      config: writeAuth,
      schema: {
        params: ParamsId,
        body: Type.Object(
          {
            favorite: Type.Boolean(),
            note: Type.String({ maxLength: 2000 }),
            revision: Type.Integer({ minimum: 0 }),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request) =>
      updateAnnotation(
        pool,
        request.actor!,
        request.params.id,
        request.body.favorite,
        request.body.note,
        request.body.revision,
        resolveContentVisibility,
      ),
  );
}
