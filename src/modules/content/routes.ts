import { Type } from "@sinclair/typebox";
import { Readable } from "node:stream";
import QueryStream from "pg-query-stream";
import type { Pool } from "pg";
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import {
  Content,
  ListQuery,
  ParamsId,
  type Actor,
  type Filter,
} from "../../../packages/contracts/src/source-content";
import { compileContentFilter, decodeCursor, filterSignature } from "./search";
import { contentFromRow } from "./sql";
import { fail } from "../../storage/db";

export function contentSelect(discovery: string) {
  return `SELECT c.*,p.code AS platform,to_char(c.created_at_source,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time,
    COALESCE((SELECT jsonb_agg(latest.payload) FROM (
      SELECT DISTINCT ON(o.collection_source_id,o.provider) jsonb_build_object('sourceId',o.collection_source_id,'provider',o.provider,'sourceObservedAt',o.source_observed_at,'fetchedAt',o.fetched_at,'timeBasis',o.time_basis,'maturity',o.maturity,'metrics',o.metrics,'evidenceKey',o.evidence_key) AS payload
      FROM content_observation o WHERE o.content_id=c.id AND EXISTS(SELECT 1 FROM content_discovery d JOIN collection_source cs ON cs.id=d.collection_source_id WHERE ${discovery} AND d.collection_source_id=o.collection_source_id)
      ORDER BY o.collection_source_id,o.provider,o.source_observed_at DESC NULLS LAST,o.fetched_at DESC,o.id DESC) latest),'[]'::jsonb) AS observations
    FROM content c JOIN source p ON p.id=c.source_id JOIN public_content_search_document doc ON doc.content_id=c.id`;
}
export function csvCell(value: unknown) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[\s]*[=+\-@]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
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
  api.get(
    "/v1/content/export",
    {
      schema: {
        querystring: Type.Composite([
          Type.Omit(ListQuery, ["cursor", "limit"]),
          Type.Object({
            format: Type.Optional(
              Type.Union([Type.Literal("json"), Type.Literal("csv")]),
            ),
          }),
        ]),
      },
    },
    async (request, reply) => {
      const { format = "json", ...filter } = request.query;
      const compiled = compileContentFilter(request.actor!, filter),
        client = await pool.connect();
      let released = false,
        stream: QueryStream | undefined;
      const release = (destroy = false) => {
        if (!released) {
          released = true;
          client.release(destroy);
        }
      };
      const abort = () => {
        if (!reply.raw.writableFinished) {
          stream?.destroy();
          release(true);
          reply.raw.destroy();
        }
      };
      reply.raw.once("close", abort);
      shutdown.addEventListener("abort", abort, { once: true });
      try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        await client.query(
          "SET LOCAL idle_in_transaction_session_timeout='35s'",
        );
        stream = client.query(
          new QueryStream(
            `${contentSelect(compiled.discovery)} WHERE ${compiled.text} ORDER BY c.created_at_source DESC NULLS LAST,c.id DESC`,
            compiled.values,
            { batchSize: 100 },
          ),
        );
      } catch (error) {
        reply.raw.off("close", abort);
        shutdown.removeEventListener("abort", abort);
        await client.query("ROLLBACK").catch(() => {});
        release();
        throw error;
      }
      const rows = stream;
      async function* output() {
        let first = true;
        const deadline = setTimeout(abort, 30000);
        try {
          yield format === "csv"
            ? "id,platform,kind,externalId,publishedAt,title,text\r\n"
            : "[";
          for await (const row of rows) {
            const content = contentFromRow(row);
            yield format === "csv"
              ? [
                  content.id,
                  content.platform,
                  content.kind,
                  content.externalId,
                  content.publishedAt,
                  content.title,
                  content.text,
                ]
                  .map(csvCell)
                  .join(",") + "\r\n"
              : `${first ? "" : ","}${JSON.stringify(content)}`;
            first = false;
          }
          await client.query("COMMIT");
          if (format === "json") yield "]";
        } finally {
          clearTimeout(deadline);
          reply.raw.off("close", abort);
          shutdown.removeEventListener("abort", abort);
          rows.destroy();
          if (!released) {
            await client.query("ROLLBACK").catch(() => {});
            release();
          }
        }
      }
      reply
        .header("X-Accel-Buffering", "no")
        .header(
          "Content-Disposition",
          `attachment; filename="content.${format}"`,
        );
      return reply
        .type(
          format === "csv"
            ? "text/csv; charset=utf-8"
            : "application/json; charset=utf-8",
        )
        .send(Readable.from(output()));
    },
  );
}
