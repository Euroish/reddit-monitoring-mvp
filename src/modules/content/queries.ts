import type { Pool, PoolClient } from "pg";
import type { Actor } from "../../../packages/contracts/src/access";
import type { Filter } from "../../../packages/contracts/src/content";
import {
  compileContentFilter,
  contentSourceTables,
  contentTables,
  escapeLike,
  matchedAnchors,
  normalizePublicSearchText,
  type ContentVisibilityResolver,
} from "./search";

export async function findHydratableRedditPosts(
  db: Pool | PoolClient,
  actor: Actor,
  scope: { sourceIds: string[]; filter: Filter; batchMembership?: import("./search").BatchMembership },
  contentIds: string[],
): Promise<Array<{ external_id: string; source_id: string }>> {
  if (!contentIds.length || !scope.sourceIds.length) return [];
  const compiled = compileContentFilter(actor, {}, scope.sourceIds, scope.filter, false, scope.batchMembership);
  const match = matchedAnchors(compiled, true);
  compiled.values.push(contentIds, scope.sourceIds);
  const tables = compiled.needsSearchDocument ? contentTables : contentSourceTables;
  return (
    await db.query<{ external_id: string; source_id: string }>(
      `${match.cte}
      SELECT c.external_id, target.id AS source_id
      FROM ${tables} ${match.joins}
      JOIN LATERAL (
        SELECT cs.id FROM content_discovery d JOIN collection_source cs ON cs.id=d.collection_source_id
        WHERE d.content_id=c.id AND cs.id=ANY($${compiled.values.length}::uuid[]) AND cs.primary_provider='kaix'
          AND cs.delivery_mode='pull' AND cs.state='active' AND NOT cs.automatic_collection_blocked
        ORDER BY cs.id LIMIT 1
      ) target ON true
      WHERE p.code='reddit' AND c.kind='post' AND c.external_id ~ '^t3_[a-z0-9]{2,32}$'
        AND c.id=ANY($${compiled.values.length - 1}::uuid[])
        ${match.where === "TRUE" ? "" : `AND (${match.where})`}
      ORDER BY target.id,c.id`,
      compiled.values,
    )
  ).rows;
}

export async function findRefreshablePostsForSource(
  db: Pool | PoolClient,
  sourceId: string,
  contentIds: string[],
): Promise<string[]> {
  if (!contentIds.length) return [];
  return (
    await db.query<{ external_id: string }>(
      `SELECT c.external_id FROM content c JOIN content_discovery d ON d.content_id=c.id
       WHERE d.collection_source_id=$1 AND c.id=ANY($2::uuid[]) AND c.kind='post' ORDER BY c.external_id`,
      [sourceId, contentIds],
    )
  ).rows.map(({ external_id }) => external_id);
}

export async function countDiscoveriesBySourceSince(
  db: Pool | PoolClient,
  hours: number,
): Promise<Map<string, number>> {
  const rows = (
    await db.query<{ collection_source_id: string; cnt: number }>(
      `SELECT collection_source_id, COUNT(*)::int AS cnt
       FROM content_discovery
       WHERE first_fetched_at >= NOW() - make_interval(hours => $1)
       GROUP BY collection_source_id`,
      [hours],
    )
  ).rows;
  return new Map(rows.map((r) => [r.collection_source_id, Number(r.cnt)]));
}

export async function loadAnnotatedContentByIds(
  db: Pool | PoolClient,
  actor: Actor,
  contentIds: string[],
  resolveContentVisibility?: ContentVisibilityResolver,
): Promise<Map<string, { id: string; title: string | null; body_text: string | null; external_id: string }>> {
  const unique = [...new Set(contentIds)];
  if (!unique.length) return new Map();
  const compiled = compileContentFilter(actor, {}, undefined, {}, false, resolveContentVisibility?.(actor));
  compiled.values.push(unique);
  const rows = (
    await db.query<{ id: string; title: string | null; body_text: string | null; external_id: string }>(
      `SELECT c.id, c.title, c.body_text, c.external_id
       FROM content c JOIN source p ON p.id=c.source_id
       WHERE ${compiled.text} AND c.id=ANY($${compiled.values.length}::uuid[])`,
      compiled.values,
    )
  ).rows;
  return new Map(rows.map((r) => [r.id, r]));
}

export async function isContentVisibleToActor(
  db: Pool | PoolClient,
  actor: Actor,
  contentId: string,
  resolveContentVisibility?: ContentVisibilityResolver,
): Promise<boolean> {
  const compiled = compileContentFilter(actor, {}, undefined, {}, false, resolveContentVisibility?.(actor));
  compiled.values.push(contentId);
  const res = await db.query(
    `SELECT 1 FROM content c JOIN source p ON p.id=c.source_id WHERE ${compiled.text} AND c.id=$${compiled.values.length} LIMIT 1`,
    compiled.values,
  );
  return Boolean(res.rowCount);
}

export interface AiFirsthandArticleRow {
  contentId: string;
  collectionSourceId: string;
  title: string;
  bodyText: string | null;
  url: string | null;
  publishedAt: string | null;
  sortTs: string;
}

export async function listAiFirsthandArticles(
  db: Pool | PoolClient,
  opts: {
    sourceIds: string[];
    sinceHours?: number;
    dateFrom?: string | null;
    dateTo?: string | null;
    cursorSortTs?: string;
    cursorId?: string;
    order?: "asc" | "desc";
    limit: number;
  },
): Promise<AiFirsthandArticleRow[]> {
  if (opts.order === "asc") {
    return (
      await db.query<AiFirsthandArticleRow>(
        `SELECT DISTINCT ON (sort_ts, c.id)
                c.id AS "contentId", cs.id AS "collectionSourceId",
                c.title, c.body_text AS "bodyText",
                COALESCE(c.permalink, c.url) AS url,
                c.created_at_source::text AS "publishedAt",
                COALESCE(c.created_at_source, d.first_fetched_at)::text AS sort_ts,
                COALESCE(c.created_at_source, d.first_fetched_at)::text AS "sortTs"
         FROM content c
         JOIN content_discovery d ON d.content_id = c.id
         JOIN collection_source cs ON cs.id = d.collection_source_id
         WHERE (cs.source_group = 'ai-firsthand' OR cs.id = ANY($1::uuid[]))
           AND c.title IS NOT NULL
           AND ($2::date IS NULL OR COALESCE(c.created_at_source, d.first_fetched_at)::date >= $2::date)
           AND ($3::date IS NULL OR COALESCE(c.created_at_source, d.first_fetched_at)::date <= $3::date)
           AND ($4::timestamptz IS NULL OR (COALESCE(c.created_at_source, d.first_fetched_at), c.id) > ($4::timestamptz, $5::uuid))
         ORDER BY sort_ts ASC, c.id ASC, (cs.id = ANY($1::uuid[])) DESC, cs.id ASC
         LIMIT $6`,
        [
          opts.sourceIds,
          opts.dateFrom ?? null,
          opts.dateTo ?? null,
          opts.cursorSortTs ?? null,
          opts.cursorId ?? "00000000-0000-0000-0000-000000000000",
          opts.limit,
        ],
      )
    ).rows;
  }
  return (
    await db.query<AiFirsthandArticleRow>(
      `SELECT DISTINCT ON (c.id)
              c.id AS "contentId", cs.id AS "collectionSourceId",
              c.title, c.body_text AS "bodyText",
              COALESCE(c.permalink, c.url) AS url,
              c.created_at_source::text AS "publishedAt",
              COALESCE(c.created_at_source, d.first_fetched_at)::text AS "sortTs"
       FROM content c
       JOIN content_discovery d ON d.content_id = c.id
       JOIN collection_source cs ON cs.id = d.collection_source_id
       WHERE (cs.source_group = 'ai-firsthand' OR cs.id = ANY($1::uuid[]))
         AND c.title IS NOT NULL
         AND ($2::int IS NULL OR COALESCE(c.created_at_source, d.first_fetched_at) >= NOW() - make_interval(hours => $2))
       ORDER BY c.id, (cs.id = ANY($1::uuid[])) DESC, COALESCE(c.created_at_source, d.first_fetched_at) DESC, cs.id ASC
       LIMIT $3`,
      [opts.sourceIds, opts.sinceHours ?? null, opts.limit],
    )
  ).rows;
}

export async function searchAiOfficialArticlesByTerm(
  db: Pool | PoolClient,
  opts: { sourceIds: string[]; term: string; observedAtIso: string; limit?: number },
): Promise<Array<{ id: string; title: string | null; url: string | null; published_at: string | null }>> {
  const norm = normalizePublicSearchText(opts.term);
  if (!norm) return [];
  const normPattern = `%${escapeLike(norm)}%`;
  const rawPattern = `%${escapeLike(opts.term)}%`;
  const pair = norm.match(/[\p{L}\p{N}]{2}/u)?.[0];
  const needsBigram = Boolean(pair && !/[\p{L}\p{N}]{3}/u.test(norm));
  const limit = Math.min(20, Math.max(1, opts.limit ?? 3));
  const normExpr = needsBigram
    ? "public_search_bigrams(doc.search_text) @> ARRAY[$4::text] AND doc.search_text LIKE $5"
    : "doc.search_text LIKE $4";
  const params = needsBigram
    ? [opts.sourceIds, opts.observedAtIso, limit, pair!, normPattern, rawPattern]
    : [opts.sourceIds, opts.observedAtIso, limit, normPattern, rawPattern];
  const rawIdx = needsBigram ? "$6" : "$5";
  return (
    await db.query<{ id: string; title: string | null; url: string | null; published_at: string | null }>(
      `SELECT DISTINCT ON (c.id) c.id, c.title, COALESCE(c.permalink, c.url) AS url,
              COALESCE(c.created_at_source, d.first_fetched_at)::text AS published_at
       FROM content c
       JOIN content_discovery d ON d.content_id = c.id
       JOIN collection_source cs ON cs.id = d.collection_source_id
       LEFT JOIN public_content_search_document doc ON doc.content_id = c.id
       WHERE (cs.source_group = 'ai-firsthand' OR cs.id = ANY($1::uuid[]))
         AND COALESCE(c.created_at_source, d.first_fetched_at) BETWEEN ($2::timestamptz - INTERVAL '48 hours') AND ($2::timestamptz + INTERVAL '48 hours')
         AND ((${normExpr}) OR (doc.content_id IS NULL AND (c.title ILIKE ${rawIdx} OR c.body_text ILIKE ${rawIdx})))
       ORDER BY c.id, published_at DESC NULLS LAST
       LIMIT $3`,
      params,
    )
  ).rows;
}

export async function listAiOfficialFeedUpdates(
  db: Pool | PoolClient,
  opts: { sourceIds: string[]; restrictToSourceIds?: boolean; limit: number; offset: number },
): Promise<
  Array<{
    contentId: string;
    collectionSourceId: string;
    title: string;
    url: string | null;
    bodyText: string | null;
    publishedAt: Date | null;
    sourceName: string;
    sourceGroup: string | null;
    sourceTier: string;
  }>
> {
  if (opts.restrictToSourceIds && !opts.sourceIds.length) return [];
  const scopeFilter = opts.restrictToSourceIds
    ? "cs.id = ANY($1::uuid[])"
    : "(cs.source_group = 'ai-firsthand' OR cs.id = ANY($1::uuid[]))";
  return (
    await db.query(
      `SELECT * FROM (
         SELECT DISTINCT ON (c.id)
                c.id AS "contentId", cs.id AS "collectionSourceId",
                c.title, COALESCE(c.permalink, c.url) AS url, c.body_text AS "bodyText",
                COALESCE(c.created_at_source, d.first_fetched_at) AS "publishedAt",
                cs.label AS "sourceName", cs.source_group AS "sourceGroup", cs.tier AS "sourceTier"
         FROM content c
         JOIN content_discovery d ON d.content_id = c.id
         JOIN collection_source cs ON cs.id = d.collection_source_id
         WHERE ${scopeFilter} AND c.title IS NOT NULL
         ORDER BY c.id, (cs.id = ANY($1::uuid[])) DESC, COALESCE(c.created_at_source, d.first_fetched_at) DESC NULLS LAST, cs.id ASC
       ) ranked
       ORDER BY "publishedAt" DESC NULLS LAST, "contentId" DESC
       LIMIT $2 OFFSET $3`,
      [opts.sourceIds, opts.limit, opts.offset],
    )
  ).rows;
}

export async function hasSourceDiscoveries(
  db: Pool | PoolClient,
  sourceId: string,
): Promise<boolean> {
  const { rowCount } = await db.query(
    "SELECT 1 FROM content_discovery WHERE collection_source_id=$1 LIMIT 1",
    [sourceId],
  );
  return Boolean(rowCount);
}


export async function isWebArticlePullSource(db: Pool | PoolClient, id: string) {
  const { rowCount } = await db.query(
    "SELECT cs.id FROM collection_source cs JOIN source s ON s.id=cs.platform_id WHERE cs.id=$1 " +
      "AND s.code='web' AND cs.delivery_mode='pull' AND cs.content_kind='article'",
    [id],
  );
  return Boolean(rowCount);
}

export async function findCommunityHydrationCandidates(
  db: PoolClient, sourceId: string, community: string,
): Promise<string[]> {
  const { rows } = await db.query<{ external_id: string }>(
    `WITH recent_posts AS (
       SELECT c.external_id, c.metric_comments, c.engagement_score
       FROM content_discovery d
       JOIN content c ON c.id=d.content_id
       WHERE d.collection_source_id=$1 AND c.community_name=$2
         AND c.kind='post' AND c.availability='available'
         AND c.external_id ~ '^t3_[a-z0-9]{2,32}$'
         AND COALESCE(c.created_at_source,c.first_seen_at) >= now()-interval '7 days'
         AND c.metric_comments IS NOT NULL
     ), threshold AS (
       SELECT percentile_cont(0.8) WITHIN GROUP (ORDER BY metric_comments) AS p80
       FROM recent_posts
     )
     SELECT external_id FROM recent_posts CROSS JOIN threshold
     WHERE metric_comments > p80
     ORDER BY metric_comments DESC, engagement_score DESC, external_id`,
    [sourceId, community],
  );
  return rows.map(({ external_id }) => external_id);
}

export async function countSourceSamples(db: Pool, id: string, from: string, to: string, membership?: import("./search").BatchMembership) {
  const values: unknown[] = [id, from, to];
  const restricted = membership?.contains(value => "$" + values.push(value), "d.content_id");
  const { rows: [row] } = await db.query<{ count: string }>(
    "SELECT COUNT(DISTINCT d.content_id)::text AS count FROM content_discovery d JOIN content c ON c.id=d.content_id " +
      "WHERE d.collection_source_id=$1 AND c.created_at_source >= $2 AND c.created_at_source < $3" +
      (restricted ? " AND " + restricted : ""), values,
  );
  return Number(row?.count ?? 0);
}
