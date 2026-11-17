import { Type } from "@sinclair/typebox";
import type { Pool } from "pg";
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import {
  Content,
  ListQuery,
  ParamsId,
} from "../../../packages/contracts/src/source-content";
import { contentSelect, compileContentFilter, decodeCursor, filterSignature } from "./search";
import { contentFromRow } from "./sql";
import { exportRoutes } from "./export";
export { csvCell } from "./export";
import { fail } from "../../storage/db";

export async function contentRoutes(
  app: FastifyInstance,
  pool: Pool,
  shutdown: AbortSignal,
) {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();
  api.get(
    "/v1/content",
    {
      schema: {
        querystring: ListQuery,
        response: {
          200: Type.Object({
            items: Type.Array(Content),
            nextCursor: Type.Union([Type.String(), Type.Null()]),
            totalMatching: Type.Null(),
            resolvedFilter: Type.Any(),
            coverage: Type.Literal("stored_sample"),
          }),
        },
      },
    },
    async (request) => {
      const { limit = 50, cursor, ...filter } = request.query;
      const compiled = compileContentFilter(request.actor!, filter),
        signature = filterSignature(request.actor!, filter);
      let seek = "";
      if (cursor) {
        const after = decodeCursor(cursor, signature);
        compiled.values.push(after.id);
        const id = `$${compiled.values.length}`;
        if (after.time === null)
          seek = ` AND c.created_at_source IS NULL AND c.id<${id}::uuid`;
        else {
          compiled.values.push(after.time);
          const time = `$${compiled.values.length}`;
          seek = ` AND ((c.created_at_source,c.id)<(${time}::timestamptz,${id}::uuid) OR c.created_at_source IS NULL)`;
        }
      }
      compiled.values.push(limit + 1);
      const rows = (
        await pool.query(
          `${contentSelect(compiled.discovery)} WHERE ${compiled.text}${seek} ORDER BY c.created_at_source DESC NULLS LAST,c.id DESC LIMIT $${compiled.values.length}`,
          compiled.values,
        )
      ).rows;
      const page = rows.slice(0, limit),
        last = page.at(-1);
      return {
        items: page.map(contentFromRow),
        nextCursor:
          rows.length > limit && last
            ? Buffer.from(
                JSON.stringify({
                  signature,
                  id: last.id,
                  time: last.cursor_time,
                }),
              ).toString("base64url")
            : null,
        totalMatching: null,
        resolvedFilter: filter,
        coverage: "stored_sample" as const,
      };
    },
  );
  api.get(
    "/v1/content/:id",
    { schema: { params: ParamsId } },
    async (request) => {
      const compiled = compileContentFilter(request.actor!, {});
      compiled.values.push(request.params.id);
      const row = (
        await pool.query(
          `${contentSelect(compiled.discovery)} WHERE ${compiled.text} AND c.id=$${compiled.values.length}`,
          compiled.values,
        )
      ).rows[0];
      if (!row) fail(404, "Content not found");
      return { content: contentFromRow(row) };
    },
  );
  await exportRoutes(app, pool, shutdown);
}
