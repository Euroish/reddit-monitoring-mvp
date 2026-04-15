import type { PostSearchDocument } from "../../../domain/entities/post-search-document";
import type { PostSearchDocumentRepository } from "../../../domain/repositories/post-search-document-repository";
import type { SqlQueryable } from "../../postgres/postgres-client";
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
        row.bodySnippet ?? null,
        row.permalink,
        row.createdAtSource,
        `${row.title} ${row.bodySnippet ?? ""}`.toLowerCase(),
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
        search_text = LOWER(CONCAT_WS(' ', EXCLUDED.title, COALESCE(EXCLUDED.body_snippet, '')))
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
        LEFT(c.body_text, 800),
        c.permalink,
        c.created_at_source,
        LOWER(CONCAT_WS(' ', c.title, COALESCE(c.body_text, ''))),
        NOW()
      FROM content c
      INNER JOIN monitor_target t
        ON t.id = c.target_id
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
