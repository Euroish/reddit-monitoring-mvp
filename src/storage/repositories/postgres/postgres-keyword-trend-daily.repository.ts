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
            row.track,
            row.normalizedQueryText,
            row.queryScope,
            row.sampledPosts,
            row.matchedPosts,
            row.qualifiedMatchedPosts,
            row.mentionRate,
            row.qualifiedMentionRate,
            row.matchedScoreSum,
            row.matchedCommentSum,
            row.keywordHeat,
            row.algorithmVersion,
            row.explainPayload,
            row.sourceType,
          );
        }

        const placeholders = buildValuesPlaceholders(group.length, 17);
        await client.query(
          `
          INSERT INTO keyword_trend_daily (
            target_id, day, keyword, track, normalized_query_text, query_scope,
            sampled_posts, matched_posts, qualified_matched_posts,
            mention_rate, qualified_mention_rate, matched_score_sum, matched_comment_sum,
            keyword_heat, algorithm_version, explain_payload, source_type
          ) VALUES ${placeholders}
          ON CONFLICT (target_id, day, track, normalized_query_text, query_scope)
          DO UPDATE SET
            keyword = EXCLUDED.keyword,
            sampled_posts = EXCLUDED.sampled_posts,
            matched_posts = EXCLUDED.matched_posts,
            qualified_matched_posts = EXCLUDED.qualified_matched_posts,
            mention_rate = EXCLUDED.mention_rate,
            qualified_mention_rate = EXCLUDED.qualified_mention_rate,
            matched_score_sum = EXCLUDED.matched_score_sum,
            matched_comment_sum = EXCLUDED.matched_comment_sum,
            keyword_heat = EXCLUDED.keyword_heat,
            algorithm_version = EXCLUDED.algorithm_version,
            explain_payload = EXCLUDED.explain_payload,
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
    tracks?: Array<"auto_keyword" | "explicit_query">;
    queryScopes?: Array<"subreddit" | "global">;
    limit?: number;
  }): Promise<KeywordTrendDaily[]> {
    const keywords =
      args.keywords && args.keywords.length > 0
        ? args.keywords.map((item) => item.trim().toLowerCase()).filter(Boolean)
        : [];
    const tracks = args.tracks && args.tracks.length > 0 ? args.tracks : null;
    const queryScopes = args.queryScopes && args.queryScopes.length > 0 ? args.queryScopes : null;

    if (keywords.length > 0 || tracks || queryScopes) {
      const predicates: string[] = [
        "target_id = $1",
        "day >= $2::date",
        "day <= $3::date",
      ];
      const values: unknown[] = [args.targetId, args.fromDay, args.toDay];
      let bindIndex = values.length + 1;
      if (keywords.length > 0) {
        predicates.push(
          `(normalized_query_text = ANY($${bindIndex}::text[]) OR keyword = ANY($${bindIndex}::text[]))`,
        );
        values.push(keywords);
        bindIndex += 1;
      }
      if (tracks) {
        predicates.push(`track = ANY($${bindIndex}::keyword_trend_track_enum[])`);
        values.push(tracks);
        bindIndex += 1;
      }
      if (queryScopes) {
        predicates.push(`query_scope = ANY($${bindIndex}::keyword_query_scope_enum[])`);
        values.push(queryScopes);
      }

      const result = await this.db.query<KeywordTrendDailyRow>(
        `
        SELECT target_id, day, keyword, track, normalized_query_text, query_scope,
               sampled_posts, matched_posts, qualified_matched_posts,
               mention_rate, qualified_mention_rate, matched_score_sum, matched_comment_sum,
               keyword_heat, algorithm_version, explain_payload, source_type, updated_at
        FROM keyword_trend_daily
        WHERE ${predicates.join("\n          AND ")}
        ORDER BY track ASC, normalized_query_text ASC, day ASC
        `,
        values,
      );
      return result.rows.map(mapKeywordTrendDaily);
    }

    const limit = args.limit ?? 10;
    const result = await this.db.query<KeywordTrendDailyRow>(
      `
      WITH top_keywords AS (
        SELECT normalized_query_text
        FROM keyword_trend_daily
        WHERE target_id = $1
          AND day >= $2::date
          AND day <= $3::date
          AND track = 'auto_keyword'
        GROUP BY normalized_query_text
        ORDER BY SUM(matched_posts) DESC, normalized_query_text ASC
        LIMIT $4
      )
      SELECT k.target_id, k.day, k.keyword, k.track, k.normalized_query_text, k.query_scope,
             k.sampled_posts, k.matched_posts, k.qualified_matched_posts,
             k.mention_rate, k.qualified_mention_rate, k.matched_score_sum, k.matched_comment_sum,
             k.keyword_heat, k.algorithm_version, k.explain_payload, k.source_type, k.updated_at
      FROM keyword_trend_daily k
      INNER JOIN top_keywords t ON t.normalized_query_text = k.normalized_query_text
      WHERE k.target_id = $1
        AND k.day >= $2::date
        AND k.day <= $3::date
        AND k.track = 'auto_keyword'
      ORDER BY k.track ASC, k.normalized_query_text ASC, k.day ASC
      `,
      [args.targetId, args.fromDay, args.toDay, limit],
    );
    return result.rows.map(mapKeywordTrendDaily);
  }

  public async listByQueryInRange(args: {
    normalizedQueryText: string;
    fromDay: string;
    toDay: string;
    track?: "auto_keyword" | "explicit_query";
    queryScope?: "subreddit" | "global";
    limit?: number;
  }): Promise<KeywordTrendDaily[]> {
    const predicates = [
      "normalized_query_text = $1",
      "day >= $2::date",
      "day <= $3::date",
    ];
    const values: unknown[] = [
      args.normalizedQueryText.trim().toLowerCase(),
      args.fromDay,
      args.toDay,
    ];
    let bindIndex = values.length + 1;

    if (args.track) {
      predicates.push(`track = $${bindIndex}::keyword_trend_track_enum`);
      values.push(args.track);
      bindIndex += 1;
    }
    if (args.queryScope) {
      predicates.push(`query_scope = $${bindIndex}::keyword_query_scope_enum`);
      values.push(args.queryScope);
      bindIndex += 1;
    }

    const limit =
      typeof args.limit === "number" && Number.isFinite(args.limit) && args.limit > 0
        ? Math.max(1, Math.trunc(args.limit))
        : undefined;
    const limitClause = limit ? `LIMIT $${bindIndex}` : "";
    if (limit) {
      values.push(limit);
    }

    const result = await this.db.query<KeywordTrendDailyRow>(
      `
      SELECT target_id, day, keyword, track, normalized_query_text, query_scope,
             sampled_posts, matched_posts, qualified_matched_posts,
             mention_rate, qualified_mention_rate, matched_score_sum, matched_comment_sum,
             keyword_heat, algorithm_version, explain_payload, source_type, updated_at
      FROM keyword_trend_daily
      WHERE ${predicates.join("\n        AND ")}
      ORDER BY day ASC, target_id ASC
      ${limitClause}
      `,
      values,
    );
    return result.rows.map(mapKeywordTrendDaily);
  }
}
