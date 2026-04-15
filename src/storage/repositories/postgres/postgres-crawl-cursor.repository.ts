import type {
  CrawlCursorRepository,
  ResolveCrawlCursorInput,
  UpsertCrawlCursorInput,
} from "../../../domain/repositories/crawl-cursor-repository";
import type { SqlQueryable } from "../../postgres/postgres-client";
import { mapCrawlCursor, type CrawlCursorRow } from "./postgres-row-mappers";

export class PostgresCrawlCursorRepository implements CrawlCursorRepository {
  constructor(private readonly db: SqlQueryable) {}

  public async resolve(input: ResolveCrawlCursorInput) {
    const result = await this.db.query<CrawlCursorRow>(
      `
      SELECT provider, target_id, mode, cursor, rewind_cursor, last_fetched_at, updated_at
      FROM crawl_cursor
      WHERE provider = $1
        AND target_id = $2
        AND mode = $3
      LIMIT 1
      `,
      [input.provider, input.targetId, input.mode],
    );
    if (result.rows.length === 0) {
      return null;
    }
    return mapCrawlCursor(result.rows[0]);
  }

  public async list(args: { mode?: "live" | "backfill"; targetId?: string }) {
    const conditions: string[] = [];
    const values: string[] = [];

    if (args.mode) {
      values.push(args.mode);
      conditions.push(`mode = $${values.length}`);
    }
    if (args.targetId) {
      values.push(args.targetId);
      conditions.push(`target_id = $${values.length}`);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await this.db.query<CrawlCursorRow>(
      `
      SELECT provider, target_id, mode, cursor, rewind_cursor, last_fetched_at, updated_at
      FROM crawl_cursor
      ${whereClause}
      ORDER BY updated_at DESC, provider ASC, target_id ASC
      `,
      values,
    );
    return result.rows.map(mapCrawlCursor);
  }

  public async upsert(input: UpsertCrawlCursorInput): Promise<void> {
    await this.db.query(
      `
      INSERT INTO crawl_cursor (
        provider, target_id, mode, cursor, rewind_cursor, last_fetched_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (provider, target_id, mode)
      DO UPDATE SET
        cursor = EXCLUDED.cursor,
        rewind_cursor = EXCLUDED.rewind_cursor,
        last_fetched_at = EXCLUDED.last_fetched_at,
        updated_at = EXCLUDED.updated_at
      `,
      [
        input.provider,
        input.targetId,
        input.mode,
        input.cursor,
        input.rewindCursor ?? null,
        input.lastFetchedAt ?? null,
        input.updatedAt,
      ],
    );
  }
}
