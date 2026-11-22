import { Type, type Static } from "@sinclair/typebox";
import type { Pool } from "pg";
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Actor } from "../../../packages/contracts/src/access";
import { ParamsId, strictMerge } from "../../../packages/contracts/src/common";
import {
  Content,
  ContentFacets,
  ContentFacetsQuery,
  ListQuery,
  ResearchFilter,
} from "../../../packages/contracts/src/content";
import { StoryFeed, StoryQuery } from "../../../packages/contracts/src/content-stories";
import { fail } from "../../shared/errors";
import { exportRoutes } from "./export";
import { contentFacets } from "./facets";
import {
  compileContentFilter,
  contentColumns,
  contentSelect,
  contentSourceTables,
  contentTables,
  decodeCursor,
  filterSignature,
  matchedAnchors,
  pageObservations,
  type ContentScopeResolver,
} from "./search";
import { contentFromRow } from "./sql";
import { readStoryWindow, selectStoryFeed } from "./stories";
import { readThread } from "./thread";

export { csvCell } from "./export";

const MAX_STORY_WINDOW_CACHE = 32;

const ListResponse = {
  200: Type.Object({
    items: Type.Array(Content),
    nextCursor: Type.Union([Type.String(), Type.Null()]),
    totalMatching: Type.Null(),
    resolvedFilter: Type.Any(),
    coverage: Type.Literal("stored_sample"),
  }),
};

async function listContent(
  pool: Pool,
  actor: Actor,
  query: Static<typeof ListQuery>,
  pathProjectId?: string,
  feed = false,
  resolveProjectScope?: ContentScopeResolver,
) {
  const { limit = 50, cursor, projectId: queryProjectId, ...filter } = query;
  const projectId = pathProjectId ?? queryProjectId;
  const project = projectId
    ? await (resolveProjectScope ?? (() => fail(500, "Project scope resolver is unavailable")))(pool, actor, projectId)
    : undefined;
  const compiled = compileContentFilter(actor, filter, project?.source_ids, project?.filter, feed);
  const match = matchedAnchors(compiled, filter.threadAware ?? project?.thread_aware ?? false);
  const signature =
    filterSignature(actor, filter, project && { id: project.id, revision: project.revision }) + (feed ? ":feed" : "");
  let seek = feed ? " AND c.created_at_source IS NOT NULL" : "";
  if (cursor) {
    const after = decodeCursor(cursor, signature);
    compiled.values.push(after.id);
    const id = `$${compiled.values.length}`;
    if (after.time === null) {
      seek += ` AND c.created_at_source IS NULL AND c.id<${id}::uuid`;
    } else {
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
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(contentFromRow),
    nextCursor:
      rows.length > limit && last
        ? Buffer.from(JSON.stringify({ signature, id: last.id, time: last.cursor_time })).toString("base64url")
        : null,
    totalMatching: null,
    resolvedFilter: { ...filter, projectId },
    coverage: "stored_sample" as const,
  };
}

function storyCacheKey(query: Static<typeof StoryQuery>) {
  return [
    query.view ?? "latest",
    query.sourceGroup ?? "",
    query.platform ?? "",
    query.tier ?? "",
    query.language ?? "",
    query.includeTrends ? "1" : "0",
    query.date ?? "",
  ].join("|");
}

export async function contentRoutes(
  app: FastifyInstance,
  pool: Pool,
  shutdown: AbortSignal,
  resolveProjectScope?: ContentScopeResolver,
) {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();
  const storyWindows = new Map<string, { slot: number; result: ReturnType<typeof readStoryWindow> }>();
  let activeStoryReads = 0;

  const loadStoryWindow = async (...args: Parameters<typeof readStoryWindow>) => {
    if (activeStoryReads >= 3) fail(503, "Story ranking is busy; retry shortly");
    activeStoryReads++;
    try {
      return await readStoryWindow(...args);
    } finally {
      activeStoryReads--;
    }
  };

  const publicReadAuth = { auth: { access: "public_read" as const, machineScope: "read" as const } };
  const projectReadAuth = { auth: { access: "authenticated" as const, machineScope: "read" as const } };

  api.get(
    "/v1/content",
    { config: publicReadAuth, schema: { querystring: ListQuery, response: ListResponse } },
    (request) => listContent(pool, request.actor!, request.query, undefined, false, resolveProjectScope),
  );
  api.get(
    "/v1/content/facets",
    { config: publicReadAuth, schema: { querystring: ContentFacetsQuery, response: { 200: ContentFacets } } },
    (request) => contentFacets(pool, request.actor!, request.query, resolveProjectScope),
  );
  api.get(
    "/v1/content/stories",
    { config: publicReadAuth, schema: { querystring: StoryQuery, response: { 200: StoryFeed } } },
    async (request) => {
      const actor = request.actor!;
      const { view = "latest", limit = 30, offset = 0, sourceId, diverse } = request.query;
      const mix = diverse !== false && !sourceId;
      if (actor.allowedSourceIds !== null || sourceId) {
        return selectStoryFeed(await loadStoryWindow(pool, actor, request.query), view, limit, offset, mix);
      }
      const now = Date.now();
      const slot = Math.floor(now / 30_000);
      const cacheKey = storyCacheKey(request.query);
      let saved = storyWindows.get(cacheKey);
      if (saved) {
        storyWindows.delete(cacheKey);
        storyWindows.set(cacheKey, saved);
      }
      if (saved?.slot !== slot) {
        const result = loadStoryWindow(pool, actor, request.query, now).catch((error) => {
          if (storyWindows.get(cacheKey)?.result === result) storyWindows.delete(cacheKey);
          throw error;
        });
        saved = { slot, result };
        storyWindows.set(cacheKey, saved);
        if (storyWindows.size > MAX_STORY_WINDOW_CACHE) {
          const oldestKey = storyWindows.keys().next().value;
          if (oldestKey !== undefined) storyWindows.delete(oldestKey);
        }
      }
      return selectStoryFeed(await saved.result, view, limit, offset, mix);
    },
  );
  api.get(
    "/v1/content/feed",
    {
      config: publicReadAuth,
      schema: { querystring: Type.Omit(ListQuery, ["projectId", "threadAware"]), response: ListResponse },
    },
    (request) => listContent(pool, request.actor!, request.query, undefined, true, resolveProjectScope),
  );
  api.get(
    "/v1/projects/:id/content",
    {
      config: projectReadAuth,
      schema: { params: ParamsId, querystring: Type.Omit(ListQuery, ["projectId"]), response: ListResponse },
    },
    (request) => listContent(pool, request.actor!, request.query, request.params.id, false, resolveProjectScope),
  );
  api.get(
    "/v1/content/:id",
    { config: publicReadAuth, schema: { params: ParamsId } },
    async (request) => {
      const compiled = compileContentFilter(request.actor!, {});
      compiled.values.push(request.params.id);
      const row = (
        await pool.query(
          `${contentSelect(compiled.discovery, "", compiled.needsSearchDocument)} WHERE ${compiled.text} AND c.id=$${compiled.values.length}`,
          compiled.values,
        )
      ).rows[0];
      if (!row) fail(404, "Content not found");
      return { content: contentFromRow(row) };
    },
  );
  api.get(
    "/v1/content/:id/thread",
    {
      config: publicReadAuth,
      schema: {
        params: ParamsId,
        querystring: strictMerge([
          ResearchFilter,
          Type.Object({
            view: Type.Optional(Type.Union([Type.Literal("top"), Type.Literal("matches"), Type.Literal("op")])),
          }),
        ]),
      },
    },
    (request) => {
      const { projectId, view = "top", ...filter } = request.query;
      return readThread(pool, request.actor!, request.params.id, projectId, filter, view, resolveProjectScope);
    },
  );
  await exportRoutes(app, pool, shutdown, resolveProjectScope);
}
