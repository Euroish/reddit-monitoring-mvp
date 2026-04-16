import type { SubredditDailyFact } from "../../../domain/entities/subreddit-daily-fact";
import type { SubredditDailyFactRepository } from "../../../domain/repositories/subreddit-daily-fact-repository";
import type { PostgresClient } from "../../postgres/postgres-client";
import {
  buildValuesPlaceholders,
  chunkArray,
} from "./postgres-sql.utils";
import {
  mapSubredditDailyFact,
  type SubredditDailyFactRow,
} from "./postgres-row-mappers";

export class PostgresSubredditDailyFactRepository implements SubredditDailyFactRepository {
  constructor(private readonly db: PostgresClient) {}

  public async upsertMany(facts: SubredditDailyFact[]): Promise<void> {
    if (facts.length === 0) {
      return;
    }

    const chunkSize = 250;
    await this.db.withTransaction(async (client) => {
      for (const group of chunkArray(facts, chunkSize)) {
        const values: unknown[] = [];
        for (const fact of group) {
          values.push(
            fact.targetId,
            fact.day,
            fact.postVolume,
            fact.qualifiedPostVolume,
            fact.sampledPostVolume,
            fact.scoreSum,
            fact.commentSum,
            fact.subscriberCount,
            fact.activeUserCount,
            fact.activePostRatio,
            fact.dispersionScore,
            fact.impactScoreSum,
            fact.impactPostVolume,
            fact.topImpactShare,
            fact.heatPrice,
            fact.heatChangePct,
            fact.ema7,
            fact.ema30,
            fact.subredditTier,
            fact.qualityThresholdScore,
            fact.qualityThresholdComments,
            fact.algorithmVersion,
            fact.explainPayload ?? {},
          );
        }

        const placeholders = buildValuesPlaceholders(group.length, 23);
        await client.query(
          `
          INSERT INTO subreddit_daily_fact (
            target_id, day, post_volume, qualified_post_volume, sampled_post_volume, score_sum,
            comment_sum, subscriber_count, active_user_count, active_post_ratio, dispersion_score,
            impact_score_sum, impact_post_volume, top_impact_share, heat_price, heat_change_pct,
            ema7, ema30, subreddit_tier, quality_threshold_score, quality_threshold_comments,
            algorithm_version, explain_payload
          ) VALUES ${placeholders}
          ON CONFLICT (target_id, day)
          DO UPDATE SET
            post_volume = EXCLUDED.post_volume,
            qualified_post_volume = EXCLUDED.qualified_post_volume,
            sampled_post_volume = EXCLUDED.sampled_post_volume,
            score_sum = EXCLUDED.score_sum,
            comment_sum = EXCLUDED.comment_sum,
            subscriber_count = EXCLUDED.subscriber_count,
            active_user_count = EXCLUDED.active_user_count,
            active_post_ratio = EXCLUDED.active_post_ratio,
            dispersion_score = EXCLUDED.dispersion_score,
            impact_score_sum = EXCLUDED.impact_score_sum,
            impact_post_volume = EXCLUDED.impact_post_volume,
            top_impact_share = EXCLUDED.top_impact_share,
            heat_price = EXCLUDED.heat_price,
            heat_change_pct = EXCLUDED.heat_change_pct,
            ema7 = EXCLUDED.ema7,
            ema30 = EXCLUDED.ema30,
            subreddit_tier = EXCLUDED.subreddit_tier,
            quality_threshold_score = EXCLUDED.quality_threshold_score,
            quality_threshold_comments = EXCLUDED.quality_threshold_comments,
            algorithm_version = EXCLUDED.algorithm_version,
            explain_payload = EXCLUDED.explain_payload,
            updated_at = NOW()
          `,
          values,
        );
      }
    });
  }

  public async listByTargetInRange(args: {
    targetId: string;
    fromDay: string;
    toDay: string;
  }): Promise<SubredditDailyFact[]> {
    const result = await this.db.query<SubredditDailyFactRow>(
      `
      SELECT target_id, day, post_volume, qualified_post_volume, sampled_post_volume, score_sum,
             comment_sum, subscriber_count, active_user_count, active_post_ratio, dispersion_score,
             impact_score_sum, impact_post_volume, top_impact_share, heat_price, heat_change_pct,
             ema7, ema30, subreddit_tier, quality_threshold_score, quality_threshold_comments,
             algorithm_version, explain_payload, updated_at
      FROM subreddit_daily_fact
      WHERE target_id = $1
        AND day >= $2::date
        AND day <= $3::date
      ORDER BY day ASC
      `,
      [args.targetId, args.fromDay, args.toDay],
    );

    return result.rows.map(mapSubredditDailyFact);
  }

  public async listLatestByTargetsInRange(args: {
    targetIds: string[];
    fromDay: string;
    toDay: string;
  }): Promise<SubredditDailyFact[]> {
    if (args.targetIds.length === 0) {
      return [];
    }

    const result = await this.db.query<SubredditDailyFactRow>(
      `
      SELECT DISTINCT ON (target_id)
             target_id, day, post_volume, qualified_post_volume, sampled_post_volume, score_sum,
             comment_sum, subscriber_count, active_user_count, active_post_ratio, dispersion_score,
             impact_score_sum, impact_post_volume, top_impact_share, heat_price, heat_change_pct,
             ema7, ema30, subreddit_tier, quality_threshold_score, quality_threshold_comments,
             algorithm_version, explain_payload, updated_at
      FROM subreddit_daily_fact
      WHERE target_id = ANY($1::uuid[])
        AND day >= $2::date
        AND day <= $3::date
      ORDER BY target_id, day DESC
      `,
      [args.targetIds, args.fromDay, args.toDay],
    );

    return result.rows.map(mapSubredditDailyFact);
  }
}
