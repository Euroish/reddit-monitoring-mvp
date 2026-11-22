import { Type } from "@sinclair/typebox";
import { Readable } from "node:stream";
import QueryStream from "pg-query-stream";
import type { Pool, PoolClient } from "pg";
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import {
  ResearchFilter,
  strictMerge,
} from "../../../packages/contracts/src/source-content";
import { compileContentFilter, contentSelect, filterSignature, matchedAnchors } from "./search";
import { contentFromRow } from "./sql";
import { projectSources } from "../projects/index";
import { fail } from "../../storage/db";

export function csvCell(value: unknown) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[\s]*[=+\-@]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export async function exportRoutes(
  app: FastifyInstance,
  pool: Pool,
  shutdown: AbortSignal,
) {
  // One admission slot is shared by every user of this application process.
  let exporting = false;
  const api = app.withTypeProvider<TypeBoxTypeProvider>();
  api.get(
    "/v1/content/export",
    {
      schema: {
        querystring: strictMerge([
          ResearchFilter,
          Type.Object({
            format: Type.Optional(
              Type.Union([Type.Literal("json"), Type.Literal("csv")]),
            ),
            maxRows: Type.Optional(
              Type.Integer({ minimum: 1, maximum: 50000 }),
            ),
          }),
        ]),
      },
    },
    async (request, reply) => {
      if (exporting) {
        reply.header("Retry-After", "5");
        fail(429, "Another export is in progress; try again shortly");
      }
      const { format = "json", maxRows = 10000, projectId, ...filter } = request.query;
      exporting = true;
      let client: PoolClient;
      try {
        client = await pool.connect();
      } catch (error) {
        exporting = false;
        throw error;
      }
      let released = false;
      let committed = false;
      let stream: QueryStream | undefined;
      let signature: string;
      const release = (destroy = false) => {
        if (released) return;
        released = true;
        exporting = false;
        client.release(destroy);
      };
      const abort = () => {
        if (reply.raw.writableFinished) return;
        stream?.destroy();
        release(true);
        reply.raw.destroy();
      };
      reply.raw.once("close", abort);
      shutdown.addEventListener("abort", abort, { once: true });
      const deadline = setTimeout(abort, 30000);
      deadline.unref();
      const cleanup = () => {
        clearTimeout(deadline);
        reply.raw.off("close", abort);
        shutdown.removeEventListener("abort", abort);
      };
      try {
        if (shutdown.aborted || reply.raw.destroyed)
          throw Error("Export aborted");
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        await client.query(
          "SET LOCAL idle_in_transaction_session_timeout='35s'",
        );
        const project = projectId ? await projectSources(client, request.actor!, projectId) : undefined;
        const compiled = compileContentFilter(request.actor!, filter, project?.source_ids, project?.filter);
        const match = matchedAnchors(compiled, filter.threadAware ?? project?.thread_aware ?? false);
        signature = filterSignature(request.actor!, filter, project && { id: project.id, revision: project.revision });
        compiled.values.push(maxRows + 1);
        stream = client.query(
          new QueryStream(
            `${match.cte} ${contentSelect(match.columns ? compiled.visible : compiled.discovery, match.columns)} ${match.joins} WHERE ${match.where}
          ORDER BY c.created_at_source DESC NULLS LAST,c.id DESC LIMIT $${compiled.values.length}`,
            compiled.values,
            { batchSize: 100 },
          ),
        );
      } catch (error) {
        cleanup();
        if (!released) {
          await client.query("ROLLBACK").catch(() => {});
          release();
        }
        throw error;
      }
      const rows = stream;
      async function* output() {
        let count = 0;
        let truncated = false;
        let last: { id: string; time: string | null } | undefined;
        try {
          yield format === "csv"
            ? "id,platform,kind,externalId,publishedAt,title,text\r\n"
            : '{"items":[';
          for await (const row of rows) {
            if (count === maxRows) {
              truncated = true;
              continue;
            }
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
              : `${count ? "," : ""}${JSON.stringify(content)}`;
            count++;
            last = { id: row.id, time: row.cursor_time };
          }
          await client.query("COMMIT");
          committed = true;
          release();
          if (format === "json") {
            const nextCursor =
              truncated && last
                ? Buffer.from(
                    JSON.stringify({
                      ...last,
                      signature,
                    }),
                  ).toString("base64url")
                : null;
            yield `],"result":${JSON.stringify({ exportedCount: count, truncated, nextCursor, complete: true })}}`;
          }
        } catch (error) {
          abort();
          throw error;
        } finally {
          cleanup();
          rows.destroy();
          if (!released) {
            if (!committed) await client.query("ROLLBACK").catch(() => {});
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
