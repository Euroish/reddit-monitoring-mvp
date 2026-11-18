import { Type } from "@sinclair/typebox";
import type { Pool } from "pg";
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import {
  ResearchFilter,
  ParamsId,
} from "../../../packages/contracts/src/source-content";
import {
  listAnnotations,
  listSavedQueries,
  saveQuery,
  updateAnnotation,
} from "./sql";
import { fail } from "../../storage/db";

export async function workspaceRoutes(app: FastifyInstance, pool: Pool) {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();
  api.addHook("preHandler", async (request) => {
    if (
      request.url.startsWith("/v1/workspace") &&
      request.actor!.clientKind === "machine"
    )
      fail(403, "Personal workspace requires a browser session");
  });
  api.get("/v1/workspace/queries", async (request) => ({
    queries: await listSavedQueries(pool, request.actor!),
  }));
  api.post(
    "/v1/workspace/queries",
    {
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
    async (request) =>
      saveQuery(pool, request.actor!, request.body.name, request.body.filter),
  );
  api.delete(
    "/v1/workspace/queries/:id",
    { schema: { params: ParamsId } },
    async (request) => {
      await pool.query(
        "DELETE FROM content_saved_query WHERE id=$1 AND user_id=$2",
        [request.params.id, request.actor!.userId],
      );
      return { deleted: true };
    },
  );
  api.get("/v1/workspace/annotations", async (request) => ({
    annotations: await listAnnotations(pool, request.actor!),
  }));
  api.get(
    "/v1/workspace/annotations/:id",
    { schema: { params: ParamsId } },
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
      ),
  );
}
