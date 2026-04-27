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
      SELECT provider, target_id, mode, cursor, rewind_cursor, oldest_observed_at, newest_observed_at,
             live_requested_from_iso, live_coverage_status, live_listing_horizon_hit,
             backfill_target_from_iso, backfill_coverage_status, backfill_stop_reason,
             last_fetched_at, updated_at
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

  public async list(args: {
    mode?: "live" | "backfill";
    targetId?: string;
    provider?: string;
  }) {
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
    if (args.provider) {
      values.push(args.provider);
      conditions.push(`provider = $${values.length}`);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await this.db.query<CrawlCursorRow>(
      `
      SELECT provider, target_id, mode, cursor, rewind_cursor, oldest_observed_at, newest_observed_at,
             live_requested_from_iso, live_coverage_status, live_listing_horizon_hit,
             backfill_target_from_iso, backfill_coverage_status, backfill_stop_reason,
             last_fetched_at, updated_at
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
        provider, target_id, mode, cursor, rewind_cursor, oldest_observed_at, newest_observed_at,
        live_requested_from_iso, live_coverage_status, live_listing_horizon_hit,
        backfill_target_from_iso, backfill_coverage_status, backfill_stop_reason,
        last_fetched_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (provider, target_id, mode)
      DO UPDATE SET
        cursor = EXCLUDED.cursor,
        rewind_cursor = EXCLUDED.rewind_cursor,
        oldest_observed_at = EXCLUDED.oldest_observed_at,
        newest_observed_at = EXCLUDED.newest_observed_at,
        live_requested_from_iso = EXCLUDED.live_requested_from_iso,
        live_coverage_status = EXCLUDED.live_coverage_status,
        live_listing_horizon_hit = EXCLUDED.live_listing_horizon_hit,
        backfill_target_from_iso = EXCLUDED.backfill_target_from_iso,
        backfill_coverage_status = EXCLUDED.backfill_coverage_status,
        backfill_stop_reason = EXCLUDED.backfill_stop_reason,
        last_fetched_at = EXCLUDED.last_fetched_at,
        updated_at = EXCLUDED.updated_at
      `,
      [
        input.provider,
        input.targetId,
        input.mode,
        input.cursor,
        input.rewindCursor ?? null,
        input.oldestObservedAt ?? null,
        input.newestObservedAt ?? null,
        input.liveRequestedFromIso ?? null,
        input.liveCoverageStatus ?? null,
        input.liveListingHorizonHit ?? null,
        input.backfillTargetFromIso ?? null,
        input.backfillCoverageStatus ?? null,
        input.backfillStopReason ?? null,
        input.lastFetchedAt ?? null,
        input.updatedAt,
      ],
    );
  }
}
