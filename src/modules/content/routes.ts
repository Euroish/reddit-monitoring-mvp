import { Type, type Static } from "@sinclair/typebox";
import type { Pool } from "pg";
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import {
  Content,
  ContentFacets,
  ContentFacetsQuery,
  type Actor,
  ListQuery,
  ParamsId,
  ResearchFilter,
  strictMerge,
} from "../../../packages/contracts/src/source-content";
import { contentColumns, contentSelect, contentSourceTables, contentTables, compileContentFilter, decodeCursor, filterSignature, matchedAnchors, pageObservations } from "./search";
import { contentFromRow } from "./sql";
import { exportRoutes } from "./export";
import { contentFacets } from "./facets";
import { readThread } from "./thread";
export { csvCell } from "./export";
import { projectSources } from "../projects/sql";
import { fail } from "../../storage/db";

const ListResponse = {
  200: Type.Object({
    items: Type.Array(Content),
    nextCursor: Type.Union([Type.String(), Type.Null()]),
    totalMatching: Type.Null(),
    resolvedFilter: Type.Any(),
    coverage: Type.Literal("stored_sample"),
  }),
};

async function listContent(pool: Pool, actor: Actor, query: Static<typeof ListQuery>, pathProjectId?: string, feed = false) {
  const { limit = 50, cursor, projectId: queryProjectId, ...filter } = query;
  const projectId = pathProjectId ?? queryProjectId;
  const project = projectId ? await projectSources(pool, actor, projectId) : undefined;
  const compiled = compileContentFilter(actor, filter, project?.source_ids, project?.filter, feed);
  const match = matchedAnchors(compiled, filter.threadAware ?? project?.thread_aware ?? false);
  const signature = filterSignature(actor, filter, project && { id: project.id, revision: project.revision }) + (feed ? ":feed" : "");
  let seek = feed ? " AND c.created_at_source IS NOT NULL" : "";
  if (cursor) {
    const after = decodeCursor(cursor, signature);
    compiled.values.push(after.id);
    const id = `$${compiled.values.length}`;
    if (after.time === null)
      seek += ` AND c.created_at_source IS NULL AND c.id<${id}::uuid`;
    else {
      compiled.values.push(after.time);
      const time = `$${compiled.values.length}`;
      seek += ` AND ((c.created_at_source,c.id)<(${time}::timestamptz,${id}::uuid) OR c.created_at_source IS NULL)`;
    }
  }
  compiled.values.push(limit + 1);
  const tables = compiled.needsSearchDocument ? contentTables : contentSourceTables;
  const rows = (
    await pool.query(
      `${match.cte ? `${match.cte},` : "WITH"} page AS MATERIALIZED (
        SELECT ${contentColumns}${match.columns} FROM ${tables} ${match.joins} WHERE ${match.where}${seek}
        ORDER BY c.created_at_source DESC NULLS LAST,c.id DESC LIMIT $${compiled.values.length}
      ) ${pageObservations(match.columns ? compiled.visible : compiled.discovery)}`,
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
    resolvedFilter: { ...filter, projectId },
    coverage: "stored_sample" as const,
  };
}

export async function contentRoutes(
  app: FastifyInstance,
  pool: Pool,
  shutdown: AbortSignal,
) {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();
  api.get("/v1/content", { schema: { querystring: ListQuery, response: ListResponse } },
    (request) => listContent(pool, request.actor!, request.query),
  );
  api.get("/v1/content/facets", { schema: { querystring: ContentFacetsQuery, response: { 200: ContentFacets } } },
    (request) => contentFacets(pool, request.actor!, request.query),
  );
  api.get("/v1/content/feed", { schema: {
    querystring: Type.Omit(ListQuery, ["projectId", "threadAware"]), response: ListResponse,
  } }, (request) => listContent(pool, request.actor!, request.query, undefined, true));
  api.get("/v1/projects/:id/content", { schema: {
    params: ParamsId, querystring: Type.Omit(ListQuery, ["projectId"]), response: ListResponse,
  } }, (request) => listContent(pool, request.actor!, request.query, request.params.id));
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
  api.get("/v1/content/:id/thread", {
    schema: {
      params: ParamsId,
      querystring: strictMerge([ResearchFilter, Type.Object({
        view: Type.Optional(Type.Union([Type.Literal("top"), Type.Literal("matches"), Type.Literal("op")])),
      })]),
    },
  }, (request) => {
    const { projectId, view = "top", ...filter } = request.query;
    return readThread(pool, request.actor!, request.params.id, projectId, filter, view);
  });
  await exportRoutes(app, pool, shutdown);
}
