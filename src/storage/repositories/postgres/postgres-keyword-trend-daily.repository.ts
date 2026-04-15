import type { KeywordTrendDaily } from "../../../domain/entities/keyword-trend-daily";
import type { KeywordTrendDailyRepository } from "../../../domain/repositories/keyword-trend-daily-repository";
import type { PostgresClient } from "../../postgres/postgres-client";
import { mapKeywordTrendDaily, type KeywordTrendDailyRow } from "./postgres-row-mappers";
import { buildValuesPlaceholders, chunkArray } from "./postgres-sql.utils";

export class PostgresKeywordTrendDailyRepository implements KeywordTrendDailyRepository {
  constructor(private readonly db: PostgresClient) {}

  public async upsertMany(rows: KeywordTrendDaily[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    const chunkSize = 300;
    await this.db.withTransaction(async (client) => {
      for (const group of chunkArray(rows, chunkSize)) {
        const values: unknown[] = [];
        for (const row of group) {
          values.push(
            row.targetId,
            row.day,
            row.keyword,
            row.sampledPosts,
            row.matchedPosts,
            row.qualifiedMatchedPosts,
            row.mentionRate,
            row.qualifiedMentionRate,
            row.matchedScoreSum,
            row.matchedCommentSum,
            row.keywordHeat,
            row.sourceType,
          );
        }

        const placeholders = buildValuesPlaceholders(group.length, 12);
        await client.query(
          `
          INSERT INTO keyword_trend_daily (
            target_id, day, keyword, sampled_posts, matched_posts, qualified_matched_posts,
            mention_rate, qualified_mention_rate, matched_score_sum, matched_comment_sum,
            keyword_heat, source_type
          ) VALUES ${placeholders}
          ON CONFLICT (target_id, day, keyword)
          DO UPDATE SET
            sampled_posts = EXCLUDED.sampled_posts,
            matched_posts = EXCLUDED.matched_posts,
            qualified_matched_posts = EXCLUDED.qualified_matched_posts,
            mention_rate = EXCLUDED.mention_rate,
            qualified_mention_rate = EXCLUDED.qualified_mention_rate,
            matched_score_sum = EXCLUDED.matched_score_sum,
            matched_comment_sum = EXCLUDED.matched_comment_sum,
            keyword_heat = EXCLUDED.keyword_heat,
            source_type = EXCLUDED.source_type,
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
    keywords?: string[];
    limit?: number;
  }): Promise<KeywordTrendDaily[]> {
    const keywords =
      args.keywords && args.keywords.length > 0
        ? args.keywords.map((item) => item.trim().toLowerCase()).filter(Boolean)
        : [];

    if (keywords.length > 0) {
      const result = await this.db.query<KeywordTrendDailyRow>(
        `
        SELECT target_id, day, keyword, sampled_posts, matched_posts, qualified_matched_posts,
               mention_rate, qualified_mention_rate, matched_score_sum, matched_comment_sum,
               keyword_heat, source_type, updated_at
        FROM keyword_trend_daily
        WHERE target_id = $1
          AND day >= $2::date
          AND day <= $3::date
          AND keyword = ANY($4::text[])
        ORDER BY keyword ASC, day ASC
        `,
        [args.targetId, args.fromDay, args.toDay, keywords],
      );
      return result.rows.map(mapKeywordTrendDaily);
    }

    const limit = args.limit ?? 10;
    const result = await this.db.query<KeywordTrendDailyRow>(
      `
      WITH top_keywords AS (
        SELECT keyword
        FROM keyword_trend_daily
        WHERE target_id = $1
          AND day >= $2::date
          AND day <= $3::date
        GROUP BY keyword
        ORDER BY SUM(matched_posts) DESC, keyword ASC
        LIMIT $4
      )
      SELECT k.target_id, k.day, k.keyword, k.sampled_posts, k.matched_posts, k.qualified_matched_posts,
             k.mention_rate, k.qualified_mention_rate, k.matched_score_sum, k.matched_comment_sum,
             k.keyword_heat, k.source_type, k.updated_at
      FROM keyword_trend_daily k
      INNER JOIN top_keywords t ON t.keyword = k.keyword
      WHERE k.target_id = $1
        AND k.day >= $2::date
        AND k.day <= $3::date
      ORDER BY k.keyword ASC, k.day ASC
      `,
      [args.targetId, args.fromDay, args.toDay, limit],
    );
    return result.rows.map(mapKeywordTrendDaily);
  }
}

