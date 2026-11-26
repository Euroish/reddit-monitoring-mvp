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
import {
  StoryFeed,
  StoryInsights,
  StoryInsightsQuery,
  StoryQuery,
} from "../../../packages/contracts/src/content-stories";
import { fail } from "../../shared/errors";
import { exportRoutes, type ExportAdmission } from "./export";
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
  type ContentVisibilityResolver,
} from "./search";
import { contentFromRow } from "./sql";
import { readStoryWindow, selectStoryFeed, type StoryDrilldownFilter } from "./stories";
import { computeStoryInsights, type ComputedStoryInsights } from "./story-insights";
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

const RECENT_ORDER_BY = "c.created_at_source DESC NULLS LAST,c.id DESC";
const ENGAGEMENT_COMMENTS_SQL = "COALESCE(c.metric_comments,0)";
const ENGAGEMENT_LIKES_SQL = "COALESCE(c.metric_likes,c.metric_score,0)";
const ENGAGEMENT_TOTAL_SQL = `(${ENGAGEMENT_COMMENTS_SQL}+${ENGAGEMENT_LIKES_SQL})`;
const ENGAGEMENT_ORDER_BY = `${ENGAGEMENT_TOTAL_SQL} DESC,${ENGAGEMENT_COMMENTS_SQL} DESC,${ENGAGEMENT_LIKES_SQL} DESC,${RECENT_ORDER_BY}`;

function buildContentSeekClause(
  cursor: string | undefined,
  signature: string,
  feed: boolean,
  sort: "recent" | "engagement",
  values: unknown[],
): string {
  const base = feed ? " AND c.created_at_source IS NOT NULL" : "";
  if (!cursor) return base;
  const after = decodeCursor(cursor, signature);
  values.push(after.id);
  const id = `$${values.length}`;
  let timeTie: string;
  if (after.time === null) {
    timeTie = `c.created_at_source IS NULL AND c.id<${id}::uuid`;
  } else {
    values.push(after.time);
    const time = `$${values.length}`;
    timeTie = `((c.created_at_source,c.id)<(${time}::timestamptz,${id}::uuid) OR c.created_at_source IS NULL)`;
  }
  if (sort !== "engagement") {
    return `${base} AND ${timeTie}`;
  }
  if (after.eng === undefined || after.com === undefined || after.lik === undefined) {
    fail(422, "Invalid cursor");
  }
  values.push(after.eng, after.com, after.lik);
  const eng = `$${values.length - 2}`;
  const com = `$${values.length - 1}`;
  const lik = `$${values.length}`;
  const tuple = `(${ENGAGEMENT_TOTAL_SQL},${ENGAGEMENT_COMMENTS_SQL},${ENGAGEMENT_LIKES_SQL})`;
  const bound = `(${eng}::int,${com}::int,${lik}::int)`;
  return `${base} AND (${tuple}<${bound} OR (${tuple}=${bound} AND ${timeTie}))`;
}

async function listContent(
  pool: Pool,
  actor: Actor,
  query: Static<typeof ListQuery>,
  pathProjectId?: string,
  feed = false,
  resolveProjectScope?: ContentScopeResolver,
  resolveContentVisibility?: ContentVisibilityResolver,
) {
  const { limit = 50, cursor, sort = "recent", projectId: queryProjectId, ...filter } = query;
  const projectId = pathProjectId ?? queryProjectId;
  const project = projectId
    ? await (resolveProjectScope ?? (() => fail(500, "Project scope resolver is unavailable")))(pool, actor, projectId)
    : undefined;
  const compiled = compileContentFilter(
    actor,
    filter,
    project?.batchMembership ? undefined : project?.source_ids,
    project?.filter,
    feed,
    project?.batchMembership ?? resolveContentVisibility?.(actor),
  );
  const match = matchedAnchors(compiled, filter.threadAware ?? project?.thread_aware ?? false);
  const signature =
    filterSignature(actor, filter, project && { id: project.id, revision: project.revision }) +
    (feed ? ":feed" : "") +
    (sort === "engagement" ? ":engagement" : "");
  const seek = buildContentSeekClause(cursor, signature, feed, sort, compiled.values);
  const orderBy = sort === "engagement" ? ENGAGEMENT_ORDER_BY : RECENT_ORDER_BY;
  compiled.values.push(limit + 1);
  const tables = compiled.needsSearchDocument ? contentTables : contentSourceTables;
  const rows = (
    await pool.query(
      `${match.cte ? `${match.cte},` : "WITH"} page AS MATERIALIZED (
        SELECT ${contentColumns}${match.columns} FROM ${tables} ${match.joins} WHERE ${match.where}${seek}
        ORDER BY ${orderBy} LIMIT $${compiled.values.length}
      ) ${pageObservations(match.columns ? compiled.visible : compiled.discovery, orderBy)}`,
      compiled.values,
    )
  ).rows;
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const lastCom = Number(last?.metric_comments ?? 0);
  const lastLik = Number(last?.metric_likes ?? last?.metric_score ?? 0);
  return {
    items: page.map(contentFromRow),
    nextCursor:
      rows.length > limit && last
        ? Buffer.from(
            JSON.stringify(
              sort === "engagement"
                ? { signature, id: last.id, time: last.cursor_time, eng: lastCom + lastLik, com: lastCom, lik: lastLik }
                : { signature, id: last.id, time: last.cursor_time },
            ),
          ).toString("base64url")
        : null,
    totalMatching: null,
    resolvedFilter: { ...filter, projectId, ...(sort === "engagement" ? { sort } : {}) },
    coverage: "stored_sample" as const,
  };
}

function storyCacheKey(query: Static<typeof StoryQuery>) {
  return [
    query.view ?? "latest",
    query.sourceGroup ?? "",
    query.platform ?? "",
    query.channelScope ?? "",
    query.tier ?? "",
    query.language ?? "",
    query.includeTrends ? "1" : "0",
    query.date ?? "",
  ].join("|");
}

function touchLru<T>(cache: Map<string, T>, key: string, value: T, maxSize: number) {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > maxSize) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
}

export async function contentRoutes(
  app: FastifyInstance,
  pool: Pool,
  shutdown: AbortSignal,
  assertExportAllowed: ExportAdmission,
  resolveProjectScope?: ContentScopeResolver,
  resolveContentVisibility?: ContentVisibilityResolver,
) {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();
  const storyWindows = new Map<string, { slot: number; result: ReturnType<typeof readStoryWindow> }>();
  const storyInsightsCache = new Map<string, { slot: number; result: Promise<ComputedStoryInsights> }>();
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

  const resolveStoryWindow = (actor: Actor, query: Static<typeof StoryQuery>, now = Date.now()) => {
    if (actor.allowedSourceIds !== null || query.sourceId) {
      return loadStoryWindow(pool, actor, query, undefined, resolveContentVisibility);
    }
    const slot = Math.floor(now / 30_000);
    const cacheKey = storyCacheKey(query);
    let saved = storyWindows.get(cacheKey);
    if (saved) touchLru(storyWindows, cacheKey, saved, MAX_STORY_WINDOW_CACHE);
    if (saved?.slot !== slot) {
      const result = loadStoryWindow(pool, actor, query, now, resolveContentVisibility).catch((error) => {
        if (storyWindows.get(cacheKey)?.result === result) storyWindows.delete(cacheKey);
        throw error;
      });
      saved = { slot, result };
      touchLru(storyWindows, cacheKey, saved, MAX_STORY_WINDOW_CACHE);
    }
    return saved.result;
  };

  const resolveComputedInsights = async (
    actor: Actor,
    query: Static<typeof StoryInsightsQuery>,
    now = Date.now(),
  ): Promise<ComputedStoryInsights> => {
    const lang = query.lang === "en" ? "en" : "zh";
    if (actor.allowedSourceIds !== null || query.sourceId) {
      const win = await resolveStoryWindow(actor, query, now);
      return computeStoryInsights(win, { view: query.view, sourceGroup: query.sourceGroup, lang }, now);
    }
    const slot = Math.floor(now / 30_000);
    const cacheKey = `${storyCacheKey(query)}|${lang}`;
    let saved = storyInsightsCache.get(cacheKey);
    if (saved) touchLru(storyInsightsCache, cacheKey, saved, MAX_STORY_WINDOW_CACHE);
    if (saved?.slot !== slot) {
      const result = resolveStoryWindow(actor, query, now)
        .then((win) => computeStoryInsights(win, { view: query.view, sourceGroup: query.sourceGroup, lang }, now))
        .catch((error) => {
          if (storyInsightsCache.get(cacheKey)?.result === result) storyInsightsCache.delete(cacheKey);
          throw error;
        });
      saved = { slot, result };
      touchLru(storyInsightsCache, cacheKey, saved, MAX_STORY_WINDOW_CACHE);
    }
    return saved.result;
  };

  const publicReadAuth = { auth: { access: "public_read" as const, machineScope: "read" as const } };
  const projectReadAuth = { auth: { access: "authenticated" as const, machineScope: "read" as const } };

  api.get(
    "/v1/content",
    { config: publicReadAuth, schema: { querystring: ListQuery, response: ListResponse } },
    (request) => listContent(pool, request.actor!, request.query, undefined, false, resolveProjectScope, resolveContentVisibility),
  );
  api.get(
    "/v1/content/facets",
    { config: publicReadAuth, schema: { querystring: ContentFacetsQuery, response: { 200: ContentFacets } } },
    (request) => contentFacets(pool, request.actor!, request.query, resolveProjectScope, resolveContentVisibility),
  );
  api.get(
    "/v1/content/stories/insights",
    { config: publicReadAuth, schema: { querystring: StoryInsightsQuery, response: { 200: StoryInsights } } },
    async (request) => (await resolveComputedInsights(request.actor!, request.query)).insights,
  );
  api.get(
    "/v1/content/stories",
    { config: publicReadAuth, schema: { querystring: StoryQuery, response: { 200: StoryFeed } } },
    async (request) => {
      const actor = request.actor!;
      const {
        view = "latest",
        limit = 30,
        offset = 0,
        sourceId,
        diverse,
        term,
        topicId,
        bucketFrom,
        bucketTo,
        insightTier,
        insightSourceGroup,
        insightLanguage,
        insightSourceId,
      } = request.query;
      const mix = diverse !== false && !sourceId;
      const hasDrilldown = Boolean(
        term ||
          topicId ||
          bucketFrom ||
          bucketTo ||
          insightTier ||
          insightSourceGroup ||
          insightLanguage ||
          insightSourceId,
      );
      const win = await resolveStoryWindow(actor, request.query);
      let drilldown: StoryDrilldownFilter | undefined;
      if (hasDrilldown) {
        let topicStoryKeys: Set<string> | undefined;
        if (topicId) {
          const computed = await resolveComputedInsights(actor, request.query);
          topicStoryKeys = computed.topicStoryKeys.get(topicId) ?? new Set<string>();
        }
        const parsedFrom = bucketFrom ? Date.parse(bucketFrom) : NaN;
        const parsedTo = bucketTo ? Date.parse(bucketTo) : NaN;
        drilldown = {
          term,
          topicId,
          topicStoryKeys,
          bucketFrom: Number.isFinite(parsedFrom) ? parsedFrom : undefined,
          bucketTo: Number.isFinite(parsedTo) ? parsedTo : undefined,
          insightTier,
          insightSourceGroup,
          insightLanguage,
          insightSourceId,
        };
      }
      return selectStoryFeed(win, view, limit, offset, mix, drilldown);
    },
  );
  api.get(
    "/v1/content/feed",
    {
      config: publicReadAuth,
      schema: { querystring: Type.Omit(ListQuery, ["projectId", "threadAware"]), response: ListResponse },
    },
    (request) => listContent(pool, request.actor!, request.query, undefined, true, resolveProjectScope, resolveContentVisibility),
  );
  api.get(
    "/v1/projects/:id/content",
    {
      config: projectReadAuth,
      schema: { params: ParamsId, querystring: Type.Omit(ListQuery, ["projectId"]), response: ListResponse },
    },
    (request) => listContent(pool, request.actor!, request.query, request.params.id, false, resolveProjectScope, resolveContentVisibility),
  );
  api.get(
    "/v1/content/:id",
    { config: publicReadAuth, schema: { params: ParamsId } },
    async (request) => {
      const compiled = compileContentFilter(
        request.actor!,
        {},
        undefined,
        {},
        false,
        resolveContentVisibility?.(request.actor!),
      );
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
      return readThread(
        pool,
        request.actor!,
        request.params.id,
        projectId,
        filter,
        view,
        resolveProjectScope,
        resolveContentVisibility,
      );
    },
  );
  await exportRoutes(app, pool, shutdown, assertExportAllowed, resolveProjectScope, resolveContentVisibility);
}
