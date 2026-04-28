import type { SubredditCollectionCoverage } from "../../../domain/entities/subreddit-collection-coverage";
import type { SubredditCollectionCoverageRepository } from "../../../domain/repositories/subreddit-collection-coverage-repository";
import type { PostgresClient } from "../../postgres/postgres-client";
import {
  mapSubredditCollectionCoverage,
  type SubredditCollectionCoverageRow,
} from "./postgres-row-mappers";
import { buildValuesPlaceholders, chunkArray } from "./postgres-sql.utils";

export class PostgresSubredditCollectionCoverageRepository
  implements SubredditCollectionCoverageRepository
{
  constructor(private readonly db: PostgresClient) {}

  public async upsertMany(rows: SubredditCollectionCoverage[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    const chunkSize = 250;
    await this.db.withTransaction(async (client) => {
      for (const group of chunkArray(rows, chunkSize)) {
        const values: unknown[] = [];
        for (const row of group) {
          values.push(
            row.targetId,
            row.day,
            row.coverageStatus,
            row.coverageBasis,
            row.observedPostCount,
            row.totalEligiblePostCount,
            row.firstSeenPostAt ?? null,
            row.lastSeenPostAt ?? null,
            row.oldestNewListingSeenAt ?? null,
            row.newestNewListingSeenAt ?? null,
            row.liveWindowCount,
            row.missedLiveWindowCount,
            row.backfillCursor ?? null,
            row.backfillStopReason ?? null,
            row.listingHorizonHit,
            row.sourceLimited,
            row.generatedAt,
          );
        }

        const placeholders = buildValuesPlaceholders(group.length, 17);
        await client.query(
          `
          INSERT INTO subreddit_collection_coverage (
            target_id, day, coverage_status, coverage_basis, observed_post_count,
            total_eligible_post_count, first_seen_post_at, last_seen_post_at,
            oldest_new_listing_seen_at, newest_new_listing_seen_at, live_window_count,
            missed_live_window_count, backfill_cursor, backfill_stop_reason,
            listing_horizon_hit, source_limited, generated_at
          ) VALUES ${placeholders}
          ON CONFLICT (target_id, day)
          DO UPDATE SET
            coverage_status = EXCLUDED.coverage_status,
            coverage_basis = EXCLUDED.coverage_basis,
            observed_post_count = EXCLUDED.observed_post_count,
            total_eligible_post_count = EXCLUDED.total_eligible_post_count,
            first_seen_post_at = EXCLUDED.first_seen_post_at,
            last_seen_post_at = EXCLUDED.last_seen_post_at,
            oldest_new_listing_seen_at = EXCLUDED.oldest_new_listing_seen_at,
            newest_new_listing_seen_at = EXCLUDED.newest_new_listing_seen_at,
            live_window_count = EXCLUDED.live_window_count,
            missed_live_window_count = EXCLUDED.missed_live_window_count,
            backfill_cursor = EXCLUDED.backfill_cursor,
            backfill_stop_reason = EXCLUDED.backfill_stop_reason,
            listing_horizon_hit = EXCLUDED.listing_horizon_hit,
            source_limited = EXCLUDED.source_limited,
            generated_at = EXCLUDED.generated_at
          `,
          values,
        );
      }
    });
  }

  public async replaceRange(args: {
    targetId: string;
    fromDay: string;
    toDay: string;
    rows: SubredditCollectionCoverage[];
  }): Promise<void> {
    await this.db.query(
      `
      DELETE FROM subreddit_collection_coverage
      WHERE target_id = $1
        AND day >= $2::date
        AND day <= $3::date
      `,
      [args.targetId, args.fromDay, args.toDay],
    );
    await this.upsertMany(args.rows);
  }

  public async listByTargetInRange(args: {
    targetId: string;
    fromDay: string;
    toDay: string;
  }): Promise<SubredditCollectionCoverage[]> {
    const result = await this.db.query<SubredditCollectionCoverageRow>(
      `
      SELECT target_id, day, coverage_status, coverage_basis, observed_post_count,
             total_eligible_post_count, first_seen_post_at, last_seen_post_at,
             oldest_new_listing_seen_at, newest_new_listing_seen_at, live_window_count,
             missed_live_window_count, backfill_cursor, backfill_stop_reason,
             listing_horizon_hit, source_limited, generated_at
      FROM subreddit_collection_coverage
      WHERE target_id = $1
        AND day >= $2::date
        AND day <= $3::date
      ORDER BY day ASC
      `,
      [args.targetId, args.fromDay, args.toDay],
    );

    return result.rows.map(mapSubredditCollectionCoverage);
  }
}
