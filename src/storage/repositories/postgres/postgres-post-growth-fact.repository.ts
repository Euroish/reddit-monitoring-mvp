import type { PostGrowthFact } from "../../../domain/entities/post-growth-fact";
import type { PostGrowthFactRepository } from "../../../domain/repositories/post-growth-fact-repository";
import type { PostgresClient } from "../../postgres/postgres-client";
import { buildValuesPlaceholders, chunkArray } from "./postgres-sql.utils";
import { mapPostGrowthFact, type PostGrowthFactRow } from "./postgres-row-mappers";

export class PostgresPostGrowthFactRepository implements PostGrowthFactRepository {
  constructor(private readonly db: PostgresClient) {}

  public async upsertMany(rows: PostGrowthFact[]): Promise<void> {
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
            row.contentId,
            row.ageBucket,
            row.observedAt,
            row.ageMinutes,
            row.score,
            row.comments,
            row.scoreVelocityPerHour,
            row.commentVelocityPerHour,
            row.cohortPostCount,
            row.cohortMedianScoreVelocity,
            row.cohortMedianCommentVelocity,
            row.velocityZScore,
            row.driverScore,
            row.algorithmVersion,
            row.explainPayload ?? {},
          );
        }

        const placeholders = buildValuesPlaceholders(group.length, 16);
        await client.query(
          `
          INSERT INTO post_growth_fact (
            target_id, content_id, age_bucket, observed_at, age_minutes, score, comments,
            score_velocity_per_hour, comment_velocity_per_hour, cohort_post_count,
            cohort_median_score_velocity, cohort_median_comment_velocity, velocity_z_score,
            driver_score, algorithm_version, explain_payload
          ) VALUES ${placeholders}
          ON CONFLICT (target_id, content_id, age_bucket, observed_at)
          DO UPDATE SET
            age_minutes = EXCLUDED.age_minutes,
            score = EXCLUDED.score,
            comments = EXCLUDED.comments,
            score_velocity_per_hour = EXCLUDED.score_velocity_per_hour,
            comment_velocity_per_hour = EXCLUDED.comment_velocity_per_hour,
            cohort_post_count = EXCLUDED.cohort_post_count,
            cohort_median_score_velocity = EXCLUDED.cohort_median_score_velocity,
            cohort_median_comment_velocity = EXCLUDED.cohort_median_comment_velocity,
            velocity_z_score = EXCLUDED.velocity_z_score,
            driver_score = EXCLUDED.driver_score,
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
    fromIso: string;
    toIso: string;
    ageBuckets?: Array<"1h" | "6h" | "24h">;
    limit?: number;
  }): Promise<PostGrowthFact[]> {
    const values: unknown[] = [args.targetId, args.fromIso, args.toIso];
    const predicates = [
      "target_id = $1",
      "observed_at >= $2::timestamptz",
      "observed_at <= $3::timestamptz",
    ];

    if (args.ageBuckets && args.ageBuckets.length > 0) {
      values.push(args.ageBuckets);
      predicates.push(`age_bucket = ANY($${values.length}::post_growth_age_bucket_enum[])`);
    }

    const limit = args.limit ?? 500;
    values.push(limit);

    const result = await this.db.query<PostGrowthFactRow>(
      `
      SELECT target_id, content_id, age_bucket, observed_at, age_minutes, score, comments,
             score_velocity_per_hour, comment_velocity_per_hour, cohort_post_count,
             cohort_median_score_velocity, cohort_median_comment_velocity, velocity_z_score,
             driver_score, algorithm_version, explain_payload, updated_at
      FROM post_growth_fact
      WHERE ${predicates.join("\n        AND ")}
      ORDER BY observed_at ASC, age_bucket ASC, content_id ASC
      LIMIT $${values.length}
      `,
      values,
    );
    return result.rows.map(mapPostGrowthFact);
  }

  public async listTopByTargetInRange(args: {
    targetId: string;
    fromIso: string;
    toIso: string;
    ageBuckets?: Array<"1h" | "6h" | "24h">;
    limit?: number;
  }): Promise<PostGrowthFact[]> {
    const values: unknown[] = [args.targetId, args.fromIso, args.toIso];
    const predicates = [
      "target_id = $1",
      "observed_at >= $2::timestamptz",
      "observed_at <= $3::timestamptz",
    ];

    if (args.ageBuckets && args.ageBuckets.length > 0) {
      values.push(args.ageBuckets);
      predicates.push(`age_bucket = ANY($${values.length}::post_growth_age_bucket_enum[])`);
    }

    values.push(args.limit ?? 25);

    const result = await this.db.query<PostGrowthFactRow>(
      `
      WITH ranked AS (
        SELECT target_id, content_id, age_bucket, observed_at, age_minutes, score, comments,
               score_velocity_per_hour, comment_velocity_per_hour, cohort_post_count,
               cohort_median_score_velocity, cohort_median_comment_velocity, velocity_z_score,
               driver_score, algorithm_version, explain_payload, updated_at,
               ROW_NUMBER() OVER (
                 PARTITION BY content_id
                 ORDER BY driver_score DESC, observed_at DESC, age_minutes ASC, content_id ASC
               ) AS content_rank
        FROM post_growth_fact
        WHERE ${predicates.join("\n          AND ")}
      )
      SELECT target_id, content_id, age_bucket, observed_at, age_minutes, score, comments,
             score_velocity_per_hour, comment_velocity_per_hour, cohort_post_count,
             cohort_median_score_velocity, cohort_median_comment_velocity, velocity_z_score,
             driver_score, algorithm_version, explain_payload, updated_at
      FROM ranked
      WHERE content_rank = 1
      ORDER BY driver_score DESC, observed_at DESC, age_minutes ASC, content_id ASC
      LIMIT $${values.length}
      `,
      values,
    );

    return result.rows.map(mapPostGrowthFact);
  }
}
