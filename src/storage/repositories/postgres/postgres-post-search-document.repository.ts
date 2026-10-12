import type { PostSearchDocument } from "../../../domain/entities/post-search-document";
import type { PostSearchDocumentRepository, PostSearchSummary, SummarizePostSearchInput } from "../../../domain/repositories/post-search-document-repository";
import { normalizeSearchTerm, postgresSearchTermPattern } from "../../../shared/text/search-terms";
import type { SqlQueryable } from "../../postgres/postgres-client";
import {
  buildSearchText,
  retainSearchBodySnippet,
  SEARCH_BODY_SNIPPET_MAX_CHARS,
} from "../../../shared/text/content-text-retention";
import {
  mapPostSearchDocument,
  type PostSearchDocumentRow,
} from "./postgres-row-mappers";

function toTsQuery(tokens: string[]): string {
  return tokens.map((token) => `${token}:*`).join(" | ");
}

export class PostgresPostSearchDocumentRepository
  implements PostSearchDocumentRepository
{
  constructor(private readonly db: SqlQueryable) {}

  public async upsertMany(rows: PostSearchDocument[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    const values: unknown[] = [];
    const placeholders: string[] = [];
    let valueIndex = 1;
    for (const row of rows) {
      placeholders.push(
        `($${valueIndex}, $${valueIndex + 1}, $${valueIndex + 2}, $${valueIndex + 3}, $${valueIndex + 4}, $${valueIndex + 5}, $${valueIndex + 6}, $${valueIndex + 7}, NOW())`,
      );
      values.push(
        row.contentId,
        row.targetId,
        row.canonicalSubreddit,
        row.title,
        retainSearchBodySnippet(row.bodySnippet) ?? null,
        row.permalink,
        row.createdAtSource,
        buildSearchText({
          title: row.title,
          bodyText: row.bodySnippet,
        }),
      );
      valueIndex += 8;
    }

    await this.db.query(
      `
      INSERT INTO post_search_document (
        content_id, target_id, canonical_subreddit, title, body_snippet, permalink, created_at_source, search_text, updated_at
      ) VALUES ${placeholders.join(", ")}
      ON CONFLICT (content_id)
      DO UPDATE SET
        target_id = EXCLUDED.target_id,
        canonical_subreddit = EXCLUDED.canonical_subreddit,
        title = EXCLUDED.title,
        body_snippet = EXCLUDED.body_snippet,
        permalink = EXCLUDED.permalink,
        created_at_source = EXCLUDED.created_at_source,
        updated_at = NOW(),
        search_text = EXCLUDED.search_text
      WHERE (post_search_document.target_id, post_search_document.canonical_subreddit, post_search_document.title, post_search_document.body_snippet, post_search_document.permalink, post_search_document.created_at_source, post_search_document.search_text)
        IS DISTINCT FROM (EXCLUDED.target_id, EXCLUDED.canonical_subreddit, EXCLUDED.title, EXCLUDED.body_snippet, EXCLUDED.permalink, EXCLUDED.created_at_source, EXCLUDED.search_text)
      `,
      values,
    );
  }

  public async seedFromContent(limit: number): Promise<number> {
    const result = await this.db.query(
      `
      INSERT INTO post_search_document (
        content_id, target_id, canonical_subreddit, title, body_snippet, permalink, created_at_source, search_text, updated_at
      )
      SELECT
        c.id,
        c.target_id,
        t.canonical_name,
        c.title,
        LEFT(c.body_text, ${SEARCH_BODY_SNIPPET_MAX_CHARS}),
        c.permalink,
        c.created_at_source,
        LOWER(CONCAT_WS(' ', c.title, LEFT(COALESCE(c.body_text, ''), ${SEARCH_BODY_SNIPPET_MAX_CHARS}))),
        NOW()
      FROM content c
      INNER JOIN monitor_target t
        ON t.id = c.target_id
      INNER JOIN source s ON s.id = c.source_id
      LEFT JOIN post_search_document indexed ON indexed.content_id = c.id
      WHERE s.code = 'reddit' AND c.kind = 'post'
        AND c.title IS NOT NULL AND c.permalink IS NOT NULL AND c.created_at_source IS NOT NULL
        AND (indexed.content_id IS NULL OR
          (indexed.target_id, indexed.canonical_subreddit, indexed.title, indexed.body_snippet, indexed.permalink, indexed.created_at_source, indexed.search_text)
          IS DISTINCT FROM
          (c.target_id, t.canonical_name, c.title, LEFT(c.body_text, ${SEARCH_BODY_SNIPPET_MAX_CHARS}), c.permalink, c.created_at_source,
           LOWER(CONCAT_WS(' ', c.title, LEFT(COALESCE(c.body_text, ''), ${SEARCH_BODY_SNIPPET_MAX_CHARS})))))
      ORDER BY c.created_at_source DESC
      LIMIT $1
      ON CONFLICT (content_id)
      DO UPDATE SET
        target_id = EXCLUDED.target_id,
        canonical_subreddit = EXCLUDED.canonical_subreddit,
        title = EXCLUDED.title,
        body_snippet = EXCLUDED.body_snippet,
        permalink = EXCLUDED.permalink,
        created_at_source = EXCLUDED.created_at_source,
        search_text = EXCLUDED.search_text,
        updated_at = NOW()
      WHERE (post_search_document.target_id, post_search_document.canonical_subreddit, post_search_document.title, post_search_document.body_snippet, post_search_document.permalink, post_search_document.created_at_source, post_search_document.search_text)
        IS DISTINCT FROM (EXCLUDED.target_id, EXCLUDED.canonical_subreddit, EXCLUDED.title, EXCLUDED.body_snippet, EXCLUDED.permalink, EXCLUDED.created_at_source, EXCLUDED.search_text)
      `,
      [limit],
    );

    return result.rowCount ?? 0;
  }

  public async countByScope(args: { canonicalSubreddit?: string }): Promise<number> {
    const params: unknown[] = [];
    let whereSql = "";
    if (args.canonicalSubreddit) {
      params.push(args.canonicalSubreddit);
      whereSql = "WHERE canonical_subreddit = $1";
    }

    const result = await this.db.query<{ count: string | number }>(
      `
      SELECT COUNT(*) AS count
      FROM post_search_document
      ${whereSql}
      `,
      params,
    );

    return Number(result.rows[0]?.count ?? 0);
  }

  public async summarizeSearch(args: SummarizePostSearchInput): Promise<PostSearchSummary> {
    const values: unknown[] = [
      args.tokens.map(postgresSearchTermPattern),
      (args.negativeTokens ?? []).map(postgresSearchTermPattern),
      args.tokens.map(normalizeSearchTerm),
      args.canonicalSubreddit ?? null,
      args.createdAtFrom ?? null,
      args.createdAtTo ?? null,
      args.sampleLimit,
    ];
    const result = await this.db.query<{
      total_scope_docs: number | string; candidate_count: number | string;
      support_count: number | string; qualified_count: number | string;
      documents: PostSearchDocumentRow[];
    }>(`
      WITH scope AS MATERIALIZED (
        SELECT d.*, LOWER(normalize(CONCAT_WS(' ', d.title, d.body_snippet), NFKC)) AS haystack
        FROM post_search_document d
        WHERE ($4::text IS NULL OR d.canonical_subreddit = $4)
          AND ($5::timestamptz IS NULL OR d.created_at_source >= $5)
          AND ($6::timestamptz IS NULL OR d.created_at_source < $6)
      ), scored AS MATERIALIZED (
        SELECT scope.*,
          (SELECT COUNT(*) FROM unnest($1::text[]) AS token(pattern) WHERE haystack ~ token.pattern) AS match_score,
          EXISTS(SELECT 1 FROM unnest($3::text[]) AS token(term) WHERE STRPOS(haystack, token.term) > 0) AS candidate
        FROM scope
      ), matched AS MATERIALIZED (
        SELECT * FROM scored
        WHERE match_score > 0
          AND NOT EXISTS(SELECT 1 FROM unnest($2::text[]) AS token(pattern) WHERE haystack ~ token.pattern)
      ), samples AS (
        SELECT content_id, target_id, canonical_subreddit, title, body_snippet, permalink,
               created_at_source, match_score
        FROM matched
        ORDER BY match_score DESC, created_at_source DESC, content_id ASC LIMIT $7
      )
      SELECT
        (SELECT COUNT(*) FROM scope) AS total_scope_docs,
        GREATEST((SELECT COUNT(*) FROM scored WHERE candidate), (SELECT COUNT(*) FROM matched)) AS candidate_count,
        (SELECT COUNT(*) FROM matched) AS support_count,
        (SELECT COUNT(*) FROM matched WHERE CHAR_LENGTH(TRIM(title)) >= 20 AND CHAR_LENGTH(TRIM(COALESCE(body_snippet, ''))) >= 40) AS qualified_count,
        COALESCE((SELECT json_agg(samples) FROM samples), '[]'::json) AS documents
      `, values);
    const row = result.rows[0];
    return {
      totalScopeDocs: Number(row?.total_scope_docs ?? 0),
      candidateCount: Number(row?.candidate_count ?? 0),
      supportCount: Number(row?.support_count ?? 0),
      qualifiedCount: Number(row?.qualified_count ?? 0),
      documents: (row?.documents ?? []).map(mapPostSearchDocument),
    };
  }

  public async search(args: {
    tokens: string[];
    canonicalSubreddit?: string;
    limit: number;
    createdAtFrom?: string;
    createdAtTo?: string;
  }): Promise<PostSearchDocument[]> {
    if (args.tokens.length === 0) {
      return [];
    }

    const tsQuery = toTsQuery(args.tokens);
    const params: unknown[] = [tsQuery];
    let whereSql = "d.search_tsv @@ q.ts_query";
    if (args.canonicalSubreddit) {
      params.push(args.canonicalSubreddit);
      whereSql += ` AND d.canonical_subreddit = $${params.length}`;
    }
    if (args.createdAtFrom) {
      params.push(args.createdAtFrom);
      whereSql += ` AND d.created_at_source >= $${params.length}`;
    }
    if (args.createdAtTo) {
      params.push(args.createdAtTo);
      whereSql += ` AND d.created_at_source < $${params.length}`;
    }
    params.push(args.limit);
    const limitParam = `$${params.length}`;

    const result = await this.db.query<PostSearchDocumentRow>(
      `
      WITH q AS (
        SELECT to_tsquery('simple', $1) AS ts_query
      )
      SELECT
        d.content_id, d.target_id, d.canonical_subreddit, d.title, d.body_snippet,
        d.permalink, d.created_at_source,
        ts_rank(d.search_tsv, q.ts_query) AS match_score
      FROM post_search_document d
      CROSS JOIN q
      WHERE ${whereSql}
      ORDER BY match_score DESC, d.created_at_source DESC
      LIMIT ${limitParam}
      `,
      params,
    );

    return result.rows.map(mapPostSearchDocument);
  }
}
