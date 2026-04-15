import type {
  ProviderHealthAggregate,
  ProviderHealthWindowRepository,
  RecordProviderHealthWindowInput,
} from "../../../domain/repositories/provider-health-window-repository";
import type { SqlQueryable } from "../../postgres/postgres-client";
import {
  mapProviderHealthWindow,
  type ProviderHealthWindowRow,
} from "./postgres-row-mappers";

export class PostgresProviderHealthWindowRepository implements ProviderHealthWindowRepository {
  constructor(private readonly db: SqlQueryable) {}

  public async record(input: RecordProviderHealthWindowInput): Promise<void> {
    await this.db.query(
      `
      INSERT INTO provider_health_window (
        provider, target_id, mode, window_start,
        request_count, success_count, empty_response_count, fallback_count,
        candidate_count, accepted_count, filtered_out_count,
        duplicate_post_count, ingest_lag_seconds_sum, ingest_lag_sample_count,
        provider_diff_count, provider_diff_sample_count,
        error_count, rate_limit_count, timeout_count, circuit_open_count,
        last_status_code, last_error_code, last_error_message, updated_at
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8,
        $9, $10, $11,
        $12, $13, $14,
        $15, $16,
        $17, $18, $19, $20,
        $21, $22, $23, $24
      )
      ON CONFLICT (provider, target_id, mode, window_start)
      DO UPDATE SET
        request_count = provider_health_window.request_count + EXCLUDED.request_count,
        success_count = provider_health_window.success_count + EXCLUDED.success_count,
        empty_response_count = provider_health_window.empty_response_count + EXCLUDED.empty_response_count,
        fallback_count = provider_health_window.fallback_count + EXCLUDED.fallback_count,
        candidate_count = provider_health_window.candidate_count + EXCLUDED.candidate_count,
        accepted_count = provider_health_window.accepted_count + EXCLUDED.accepted_count,
        filtered_out_count = provider_health_window.filtered_out_count + EXCLUDED.filtered_out_count,
        duplicate_post_count = provider_health_window.duplicate_post_count + EXCLUDED.duplicate_post_count,
        ingest_lag_seconds_sum = provider_health_window.ingest_lag_seconds_sum + EXCLUDED.ingest_lag_seconds_sum,
        ingest_lag_sample_count = provider_health_window.ingest_lag_sample_count + EXCLUDED.ingest_lag_sample_count,
        provider_diff_count = provider_health_window.provider_diff_count + EXCLUDED.provider_diff_count,
        provider_diff_sample_count = provider_health_window.provider_diff_sample_count + EXCLUDED.provider_diff_sample_count,
        error_count = provider_health_window.error_count + EXCLUDED.error_count,
        rate_limit_count = provider_health_window.rate_limit_count + EXCLUDED.rate_limit_count,
        timeout_count = provider_health_window.timeout_count + EXCLUDED.timeout_count,
        circuit_open_count = provider_health_window.circuit_open_count + EXCLUDED.circuit_open_count,
        last_status_code = COALESCE(EXCLUDED.last_status_code, provider_health_window.last_status_code),
        last_error_code = COALESCE(EXCLUDED.last_error_code, provider_health_window.last_error_code),
        last_error_message = COALESCE(EXCLUDED.last_error_message, provider_health_window.last_error_message),
        updated_at = EXCLUDED.updated_at
      `,
      [
        input.provider,
        input.targetId,
        input.mode,
        input.windowStart,
        input.requestCountDelta,
        input.successCountDelta,
        input.emptyResponseCountDelta,
        input.fallbackCountDelta,
        input.candidateCountDelta,
        input.acceptedCountDelta,
        input.filteredOutCountDelta,
        input.duplicatePostCountDelta,
        input.ingestLagSecondsSumDelta,
        input.ingestLagSampleCountDelta,
        input.providerDiffCountDelta,
        input.providerDiffSampleCountDelta,
        input.errorCountDelta,
        input.rateLimitCountDelta,
        input.timeoutCountDelta,
        input.circuitOpenCountDelta,
        input.lastStatusCode ?? null,
        input.lastErrorCode ?? null,
        input.lastErrorMessage ?? null,
        input.updatedAt,
      ],
    );
  }

  public async listByTargetInRange(args: {
    targetId: string;
    from: string;
    to: string;
    mode?: "live" | "backfill";
  }) {
    const result = await this.db.query<ProviderHealthWindowRow>(
      `
      SELECT
        provider, target_id, mode, window_start,
        request_count, success_count, empty_response_count, fallback_count,
        candidate_count, accepted_count, filtered_out_count,
        duplicate_post_count, ingest_lag_seconds_sum, ingest_lag_sample_count,
        provider_diff_count, provider_diff_sample_count,
        error_count, rate_limit_count, timeout_count, circuit_open_count,
        last_status_code, last_error_code, last_error_message, updated_at
      FROM provider_health_window
      WHERE target_id = $1
        AND window_start >= $2::timestamptz
        AND window_start <= $3::timestamptz
        AND ($4::text IS NULL OR mode = $4::text)
      ORDER BY window_start ASC, provider ASC
      `,
      [args.targetId, args.from, args.to, args.mode ?? null],
    );
    return result.rows.map(mapProviderHealthWindow);
  }

  public async summarizeByProviderInRange(args: {
    from: string;
    to: string;
    targetId?: string;
    mode?: "live" | "backfill";
  }): Promise<ProviderHealthAggregate[]> {
    const result = await this.db.query<{
      provider: string;
      mode: "live" | "backfill";
      request_count: string | number;
      success_count: string | number;
      empty_response_count: string | number;
      fallback_count: string | number;
      candidate_count: string | number;
      accepted_count: string | number;
      filtered_out_count: string | number;
      duplicate_post_count: string | number;
      ingest_lag_seconds_sum: string | number;
      ingest_lag_sample_count: string | number;
      provider_diff_count: string | number;
      provider_diff_sample_count: string | number;
      error_count: string | number;
      rate_limit_count: string | number;
      timeout_count: string | number;
      circuit_open_count: string | number;
    }>(
      `
      SELECT
        provider,
        mode,
        SUM(request_count) AS request_count,
        SUM(success_count) AS success_count,
        SUM(empty_response_count) AS empty_response_count,
        SUM(fallback_count) AS fallback_count,
        SUM(candidate_count) AS candidate_count,
        SUM(accepted_count) AS accepted_count,
        SUM(filtered_out_count) AS filtered_out_count,
        SUM(duplicate_post_count) AS duplicate_post_count,
        SUM(ingest_lag_seconds_sum) AS ingest_lag_seconds_sum,
        SUM(ingest_lag_sample_count) AS ingest_lag_sample_count,
        SUM(provider_diff_count) AS provider_diff_count,
        SUM(provider_diff_sample_count) AS provider_diff_sample_count,
        SUM(error_count) AS error_count,
        SUM(rate_limit_count) AS rate_limit_count,
        SUM(timeout_count) AS timeout_count,
        SUM(circuit_open_count) AS circuit_open_count
      FROM provider_health_window
      WHERE window_start >= $1::timestamptz
        AND window_start <= $2::timestamptz
        AND ($3::uuid IS NULL OR target_id = $3::uuid)
        AND ($4::text IS NULL OR mode = $4::text)
      GROUP BY provider, mode
      ORDER BY provider ASC, mode ASC
      `,
      [args.from, args.to, args.targetId ?? null, args.mode ?? null],
    );

    return result.rows.map((row) => ({
      provider: row.provider,
      mode: row.mode,
      requestCount: Number(row.request_count),
      successCount: Number(row.success_count),
      emptyResponseCount: Number(row.empty_response_count),
      fallbackCount: Number(row.fallback_count),
      candidateCount: Number(row.candidate_count),
      acceptedCount: Number(row.accepted_count),
      filteredOutCount: Number(row.filtered_out_count),
      duplicatePostCount: Number(row.duplicate_post_count),
      ingestLagSecondsSum: Number(row.ingest_lag_seconds_sum),
      ingestLagSampleCount: Number(row.ingest_lag_sample_count),
      providerDiffCount: Number(row.provider_diff_count),
      providerDiffSampleCount: Number(row.provider_diff_sample_count),
      errorCount: Number(row.error_count),
      rateLimitCount: Number(row.rate_limit_count),
      timeoutCount: Number(row.timeout_count),
      circuitOpenCount: Number(row.circuit_open_count),
    }));
  }
}
