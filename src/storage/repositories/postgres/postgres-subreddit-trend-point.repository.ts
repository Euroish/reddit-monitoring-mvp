import type { SubredditTrendPoint } from "../../../domain/entities/subreddit-trend-point";
import type { SubredditTrendPointRepository } from "../../../domain/repositories/subreddit-trend-point-repository";
import type { PostgresClient } from "../../postgres/postgres-client";
import {
  mapSubredditTrendPoint,
  type SubredditTrendPointRow,
} from "./postgres-row-mappers";
import { buildValuesPlaceholders, chunkArray } from "./postgres-sql.utils";

export class PostgresSubredditTrendPointRepository
  implements SubredditTrendPointRepository
{
  constructor(private readonly db: PostgresClient) {}

  public async upsertMany(points: SubredditTrendPoint[]): Promise<void> {
    if (points.length === 0) {
      return;
    }

    const deduped = this.dedupePoints(points);
    const chunkSize = 1000;

    await this.db.withTransaction(async (client) => {
      for (const group of chunkArray(deduped, chunkSize)) {
        const values: unknown[] = [];
        for (const point of group) {
          values.push(
            point.targetId,
            point.windowStart,
            point.windowEnd,
            point.granularity ?? "6h",
            point.newPosts,
            point.activeUsers ?? null,
            point.subscribers ?? null,
            point.scoreSum ?? 0,
            point.commentSum ?? 0,
            point.highScorePostCount ?? 0,
            point.sampledPostCount ?? 0,
            point.activePostRatio ?? 0,
            point.deltaNewPostsVsPrevWindow,
            point.deltaActiveUsersVsPrevWindow,
            point.heatChangePct ?? 0,
            point.heatIndex ?? 0,
            point.surgeScore ?? 0,
            point.dispersionScore ?? 0,
            point.velocityScore ?? 0,
            point.accelerationScore ?? 0,
            point.baselineDeviationScore ?? 0,
            point.changeScore ?? 0,
            point.anomalyScore ?? 0,
            point.trendScore,
            point.algorithmVersion ?? "trend_v1",
            point.algorithmParams ?? {},
            point.sampleCount ?? 0,
            point.windowComplete ?? true,
            point.buildJobId ?? null,
            point.scoreComponents ?? {},
          );
        }

        const placeholders = buildValuesPlaceholders(group.length, 30);
        await client.query(
          `
          INSERT INTO subreddit_trend_point (
            target_id, window_start, window_end, granularity, new_posts, active_users, subscribers,
            score_sum, comment_sum, high_score_post_count, sampled_post_count, active_post_ratio,
            delta_new_posts_vs_prev_window, delta_active_users_vs_prev_window, heat_change_pct,
            heat_index, surge_score, dispersion_score, velocity_score, acceleration_score,
            baseline_deviation_score, change_score, anomaly_score, trend_score,
            algorithm_version, algorithm_params, sample_count, window_complete, build_job_id, score_components
          ) VALUES ${placeholders}
          ON CONFLICT (target_id, window_start, window_end)
          DO UPDATE SET
            granularity = EXCLUDED.granularity,
            new_posts = EXCLUDED.new_posts,
            active_users = EXCLUDED.active_users,
            subscribers = EXCLUDED.subscribers,
            score_sum = EXCLUDED.score_sum,
            comment_sum = EXCLUDED.comment_sum,
            high_score_post_count = EXCLUDED.high_score_post_count,
            sampled_post_count = EXCLUDED.sampled_post_count,
            active_post_ratio = EXCLUDED.active_post_ratio,
            delta_new_posts_vs_prev_window = EXCLUDED.delta_new_posts_vs_prev_window,
            delta_active_users_vs_prev_window = EXCLUDED.delta_active_users_vs_prev_window,
            heat_change_pct = EXCLUDED.heat_change_pct,
            heat_index = EXCLUDED.heat_index,
            surge_score = EXCLUDED.surge_score,
            dispersion_score = EXCLUDED.dispersion_score,
            velocity_score = EXCLUDED.velocity_score,
            acceleration_score = EXCLUDED.acceleration_score,
            baseline_deviation_score = EXCLUDED.baseline_deviation_score,
            change_score = EXCLUDED.change_score,
            anomaly_score = EXCLUDED.anomaly_score,
            trend_score = EXCLUDED.trend_score,
            algorithm_version = EXCLUDED.algorithm_version,
            algorithm_params = EXCLUDED.algorithm_params,
            sample_count = EXCLUDED.sample_count,
            window_complete = EXCLUDED.window_complete,
            build_job_id = EXCLUDED.build_job_id,
            score_components = EXCLUDED.score_components,
            updated_at = NOW()
          `,
          values,
        );
      }
    });
  }

  public async listByTargetInRange(args: {
    targetId: string;
    from: string;
    to: string;
  }): Promise<SubredditTrendPoint[]> {
    const result = await this.db.query<SubredditTrendPointRow>(
      `
      SELECT target_id, window_start, window_end, granularity, new_posts, active_users, subscribers,
             score_sum, comment_sum, high_score_post_count, sampled_post_count, active_post_ratio,
             delta_new_posts_vs_prev_window, delta_active_users_vs_prev_window, velocity_score,
             heat_change_pct, heat_index, surge_score, dispersion_score, acceleration_score,
             baseline_deviation_score, change_score, anomaly_score, trend_score,
             algorithm_version, algorithm_params, sample_count, window_complete, build_job_id, score_components
      FROM subreddit_trend_point
      WHERE target_id = $1
        AND window_start >= $2
        AND window_start <= $3
      ORDER BY window_start ASC
      `,
      [args.targetId, args.from, args.to],
    );

    return result.rows.map(mapSubredditTrendPoint);
  }

  public async listLatestByTargetsInRange(args: {
    targetIds: string[];
    from: string;
    to: string;
  }): Promise<SubredditTrendPoint[]> {
    if (args.targetIds.length === 0) {
      return [];
    }

    const result = await this.db.query<SubredditTrendPointRow>(
      `
      SELECT DISTINCT ON (target_id)
             target_id, window_start, window_end, granularity, new_posts, active_users, subscribers,
             score_sum, comment_sum, high_score_post_count, sampled_post_count, active_post_ratio,
             delta_new_posts_vs_prev_window, delta_active_users_vs_prev_window, velocity_score,
             heat_change_pct, heat_index, surge_score, dispersion_score, acceleration_score,
             baseline_deviation_score, change_score, anomaly_score, trend_score,
             algorithm_version, algorithm_params, sample_count, window_complete, build_job_id, score_components
      FROM subreddit_trend_point
      WHERE target_id = ANY($1::uuid[])
        AND window_start >= $2
        AND window_start <= $3
      ORDER BY target_id ASC, window_start DESC
      `,
      [args.targetIds, args.from, args.to],
    );

    return result.rows.map(mapSubredditTrendPoint);
  }

  private dedupePoints(points: SubredditTrendPoint[]): SubredditTrendPoint[] {
    const byWindow = new Map<string, SubredditTrendPoint>();

    for (const point of points) {
      const key = `${point.targetId}|${point.windowStart}|${point.windowEnd}`;
      byWindow.set(key, point);
    }

    return Array.from(byWindow.values());
  }
}
