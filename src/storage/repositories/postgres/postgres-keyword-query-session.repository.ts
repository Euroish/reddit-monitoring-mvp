import type {
  KeywordQuerySamplePost,
  KeywordQuerySession,
} from "../../../domain/entities/keyword-query-session";
import type {
  FindReusableKeywordQuerySessionInput,
  KeywordPulsePoint5mUpsertInput,
  KeywordQueryResultSummary,
  KeywordQueryResultSummaryTotals,
  KeywordQuerySessionRecord,
  KeywordQuerySessionRepository,
  UpdateKeywordQuerySessionLiveRefreshInput,
} from "../../../domain/repositories/keyword-query-session-repository";
import type { PostgresClient } from "../../postgres/postgres-client";
import {
  mapKeywordPulsePoint5m,
  mapKeywordQuerySamplePost,
  mapKeywordQuerySession,
  type KeywordPulsePoint5mRow,
  type KeywordQuerySamplePostRow,
  type KeywordQuerySessionRow,
} from "./postgres-row-mappers";

export class PostgresKeywordQuerySessionRepository
  implements KeywordQuerySessionRepository
{
  constructor(private readonly db: PostgresClient) {}

  public async createWithSamples(
    session: KeywordQuerySession,
    samples: KeywordQuerySamplePost[],
  ): Promise<void> {
    await this.db.withTransaction(async (client) => {
      await client.query(
        `
        INSERT INTO keyword_query_session (
          id, query_text, normalized_query_text, canonical_subreddit, status, coverage_level,
          support_count, confidence_level, mention_rate, qualified_mention_rate,
          source_type_summary, degraded_reason, explain_payload, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10,
          $11, $12, $13, $14, $15
        )
        `,
        [
          session.id,
          session.queryText,
          session.normalizedQueryText,
          session.canonicalSubreddit ?? null,
          session.status,
          session.coverageLevel,
          session.supportCount,
          session.confidenceLevel,
          session.mentionRate,
          session.qualifiedMentionRate,
          JSON.stringify(session.sourceTypeSummary),
          session.degradedReason ?? null,
          JSON.stringify(session.explainPayload),
          session.createdAt,
          session.updatedAt,
        ],
      );

      if (samples.length === 0) {
        return;
      }

      const values: unknown[] = [];
      const placeholders: string[] = [];
      let valueIndex = 1;
      for (const sample of samples) {
        placeholders.push(
          `($${valueIndex}, $${valueIndex + 1}, $${valueIndex + 2}, $${valueIndex + 3}, $${valueIndex + 4}, $${valueIndex + 5}, $${valueIndex + 6}, $${valueIndex + 7}, $${valueIndex + 8}, $${valueIndex + 9}, NOW())`,
        );
        values.push(
          sample.queryId,
          sample.contentId,
          sample.rank,
          sample.matchScore,
          sample.sourceType,
          sample.dataQuality,
          sample.canonicalSubreddit,
          sample.title,
          sample.permalink,
          sample.createdAtSource,
        );
        valueIndex += 10;
      }

      await client.query(
        `
        INSERT INTO keyword_query_sample_post (
          query_id, content_id, rank, match_score, source_type, data_quality,
          canonical_subreddit, title, permalink, created_at_source, created_at
        ) VALUES ${placeholders.join(", ")}
        ON CONFLICT (query_id, content_id)
        DO UPDATE SET
          rank = EXCLUDED.rank,
          match_score = EXCLUDED.match_score,
          source_type = EXCLUDED.source_type,
          data_quality = EXCLUDED.data_quality,
          canonical_subreddit = EXCLUDED.canonical_subreddit,
          title = EXCLUDED.title,
          permalink = EXCLUDED.permalink,
          created_at_source = EXCLUDED.created_at_source
        `,
        values,
      );
    });
  }

  public async findById(
    queryId: string,
    sampleLimit: number,
    pulsePointLimit = 24,
  ): Promise<KeywordQuerySessionRecord | null> {
    const sessionResult = await this.db.query<KeywordQuerySessionRow>(
      `
      SELECT
        id, query_text, normalized_query_text, canonical_subreddit, status, coverage_level,
        support_count, confidence_level, mention_rate, qualified_mention_rate,
        source_type_summary, degraded_reason, explain_payload, created_at, updated_at
      FROM keyword_query_session
      WHERE id = $1
      LIMIT 1
      `,
      [queryId],
    );

    if (sessionResult.rows.length === 0) {
      return null;
    }

    const sampleResult = await this.db.query<KeywordQuerySamplePostRow>(
      `
      SELECT
        query_id, content_id, rank, match_score, source_type, data_quality,
        canonical_subreddit, title, permalink, created_at_source
      FROM keyword_query_sample_post
      WHERE query_id = $1
      ORDER BY rank ASC, created_at_source DESC
      LIMIT $2
      `,
      [queryId, sampleLimit],
    );

    const pulsePointResult = await this.db.query<KeywordPulsePoint5mRow>(
      `
      SELECT
        query_id, bucket_start, bucket_end, source_type, mention_count, qualified_mention_count,
        mention_rate, qualified_mention_rate, data_quality, representative_samples, updated_at
      FROM keyword_pulse_point_5m
      WHERE query_id = $1
      ORDER BY bucket_start DESC, source_type ASC
      LIMIT $2
      `,
      [queryId, pulsePointLimit],
    );

    return {
      session: mapKeywordQuerySession(sessionResult.rows[0]),
      samples: sampleResult.rows.map(mapKeywordQuerySamplePost),
      pulsePoints5m: pulsePointResult.rows.map(mapKeywordPulsePoint5m),
    };
  }

  public async findReusableSession(
    input: FindReusableKeywordQuerySessionInput,
  ): Promise<KeywordQuerySessionRecord | null> {
    const result = await this.db.query<{ id: string }>(
      `
      SELECT id
      FROM keyword_query_session
      WHERE normalized_query_text = $1
        AND canonical_subreddit IS NOT DISTINCT FROM $2
        AND updated_at >= $3
        AND status <> 'degraded'
      ORDER BY updated_at DESC
      LIMIT 1
      `,
      [input.normalizedQueryText, input.canonicalSubreddit ?? null, input.minUpdatedAt],
    );
    const queryId = result.rows[0]?.id;
    if (!queryId) {
      return null;
    }
    return this.findById(queryId, input.sampleLimit, input.pulsePointLimit);
  }

  public async replaceSamples(queryId: string, samples: KeywordQuerySamplePost[]): Promise<void> {
    await this.db.withTransaction(async (client) => {
      await client.query(`DELETE FROM keyword_query_sample_post WHERE query_id = $1`, [queryId]);
      if (samples.length === 0) {
        return;
      }

      const values: unknown[] = [];
      const placeholders: string[] = [];
      let valueIndex = 1;
      for (const sample of samples) {
        placeholders.push(
          `($${valueIndex}, $${valueIndex + 1}, $${valueIndex + 2}, $${valueIndex + 3}, $${valueIndex + 4}, $${valueIndex + 5}, $${valueIndex + 6}, $${valueIndex + 7}, $${valueIndex + 8}, $${valueIndex + 9}, NOW())`,
        );
        values.push(
          queryId,
          sample.contentId,
          sample.rank,
          sample.matchScore,
          sample.sourceType,
          sample.dataQuality,
          sample.canonicalSubreddit,
          sample.title,
          sample.permalink,
          sample.createdAtSource,
        );
        valueIndex += 10;
      }

      await client.query(
        `
        INSERT INTO keyword_query_sample_post (
          query_id, content_id, rank, match_score, source_type, data_quality,
          canonical_subreddit, title, permalink, created_at_source, created_at
        ) VALUES ${placeholders.join(", ")}
        `,
        values,
      );
    });
  }

  public async listLiveRefreshCandidates(args: {
    statuses: KeywordQuerySession["status"][];
    limit: number;
  }): Promise<KeywordQuerySession[]> {
    if (args.statuses.length === 0 || args.limit <= 0) {
      return [];
    }

    const result = await this.db.query<KeywordQuerySessionRow>(
      `
      SELECT
        id, query_text, normalized_query_text, canonical_subreddit, status, coverage_level,
        support_count, confidence_level, mention_rate, qualified_mention_rate,
        source_type_summary, degraded_reason, explain_payload, created_at, updated_at
      FROM keyword_query_session
      WHERE status = ANY($1::text[])
      ORDER BY created_at ASC
      LIMIT $2
      `,
      [args.statuses, args.limit],
    );
    return result.rows.map(mapKeywordQuerySession);
  }

  public async upsertResultSummary(summary: KeywordQueryResultSummary): Promise<void> {
    await this.db.query(
      `
      INSERT INTO keyword_query_result_summary (
        query_id, bucket_start, mention_count, qualified_mention_count,
        mention_rate, qualified_mention_rate, source_type, updated_at
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8
      )
      ON CONFLICT (query_id, bucket_start)
      DO UPDATE SET
        mention_count = EXCLUDED.mention_count,
        qualified_mention_count = EXCLUDED.qualified_mention_count,
        mention_rate = EXCLUDED.mention_rate,
        qualified_mention_rate = EXCLUDED.qualified_mention_rate,
        source_type = EXCLUDED.source_type,
        updated_at = EXCLUDED.updated_at
      `,
      [
        summary.queryId,
        summary.bucketStart,
        summary.mentionCount,
        summary.qualifiedMentionCount,
        summary.mentionRate,
        summary.qualifiedMentionRate,
        summary.sourceType,
        summary.updatedAt,
      ],
    );
  }

  public async upsertPulsePoint(input: KeywordPulsePoint5mUpsertInput): Promise<void> {
    await this.db.query(
      `
      INSERT INTO keyword_pulse_point_5m (
        query_id, bucket_start, bucket_end, source_type, mention_count, qualified_mention_count,
        mention_rate, qualified_mention_rate, data_quality, representative_samples, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10::jsonb, $11
      )
      ON CONFLICT (query_id, bucket_start, source_type)
      DO UPDATE SET
        bucket_end = EXCLUDED.bucket_end,
        mention_count = EXCLUDED.mention_count,
        qualified_mention_count = EXCLUDED.qualified_mention_count,
        mention_rate = EXCLUDED.mention_rate,
        qualified_mention_rate = EXCLUDED.qualified_mention_rate,
        data_quality = EXCLUDED.data_quality,
        representative_samples = EXCLUDED.representative_samples,
        updated_at = EXCLUDED.updated_at
      `,
      [
        input.queryId,
        input.bucketStart,
        input.bucketEnd,
        input.sourceType,
        input.mentionCount,
        input.qualifiedMentionCount,
        input.mentionRate,
        input.qualifiedMentionRate,
        input.dataQuality,
        JSON.stringify(input.representativeSamples),
        input.updatedAt,
      ],
    );
  }

  public async getResultSummaryTotals(queryId: string): Promise<KeywordQueryResultSummaryTotals> {
    const result = await this.db.query<{
      mention_count: string | number;
      qualified_mention_count: string | number;
    }>(
      `
      SELECT
        COALESCE(SUM(mention_count), 0) AS mention_count,
        COALESCE(SUM(qualified_mention_count), 0) AS qualified_mention_count
      FROM keyword_query_result_summary
      WHERE query_id = $1
      `,
      [queryId],
    );
    const row = result.rows[0];
    return {
      mentionCount: Number(row?.mention_count ?? 0),
      qualifiedMentionCount: Number(row?.qualified_mention_count ?? 0),
    };
  }

  public async updateLiveRefresh(input: UpdateKeywordQuerySessionLiveRefreshInput): Promise<void> {
    await this.db.query(
      `
      UPDATE keyword_query_session
      SET
        status = $2,
        coverage_level = $3,
        support_count = $4,
        confidence_level = $5,
        mention_rate = $6,
        qualified_mention_rate = $7,
        source_type_summary = $8::jsonb,
        degraded_reason = $9,
        explain_payload = $10::jsonb,
        updated_at = $11
      WHERE id = $1
      `,
      [
        input.queryId,
        input.status,
        input.coverageLevel,
        input.supportCount,
        input.confidenceLevel,
        input.mentionRate,
        input.qualifiedMentionRate,
        JSON.stringify(input.sourceTypeSummary),
        input.degradedReason ?? null,
        JSON.stringify(input.explainPayload),
        input.updatedAt,
      ],
    );
  }

  public async countActiveSessions(args: {
    statuses: KeywordQuerySession["status"][];
    updatedSinceIso: string;
  }): Promise<number> {
    if (args.statuses.length === 0) {
      return 0;
    }
    const result = await this.db.query<{ count: string | number }>(
      `
      SELECT COUNT(*) AS count
      FROM keyword_query_session
      WHERE status = ANY($1::text[])
        AND updated_at >= $2
      `,
      [args.statuses, args.updatedSinceIso],
    );
    return Number(result.rows[0]?.count ?? 0);
  }
}
