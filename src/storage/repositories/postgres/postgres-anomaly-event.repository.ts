import type { AnomalyEvent } from "../../../domain/entities/anomaly-event";
import type { AnomalyEventRepository } from "../../../domain/repositories/anomaly-event-repository";
import type { PostgresClient } from "../../postgres/postgres-client";
import { mapAnomalyEvent, type AnomalyEventRow } from "./postgres-row-mappers";
import { buildValuesPlaceholders, chunkArray } from "./postgres-sql.utils";

export class PostgresAnomalyEventRepository implements AnomalyEventRepository {
  constructor(private readonly db: PostgresClient) {}

  public async upsertMany(rows: AnomalyEvent[]): Promise<void> {
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
            row.signalType,
            row.signalKey,
            row.observedAt,
            row.windowStart ?? null,
            row.windowEnd ?? null,
            row.anomalyScore,
            row.algorithmVersion,
            row.explainPayload ?? {},
          );
        }

        const placeholders = buildValuesPlaceholders(group.length, 9);
        await client.query(
          `
          INSERT INTO anomaly_event (
            target_id, signal_type, signal_key, observed_at, window_start, window_end,
            anomaly_score, algorithm_version, explain_payload
          ) VALUES ${placeholders}
          ON CONFLICT (target_id, signal_type, signal_key, observed_at)
          DO UPDATE SET
            window_start = EXCLUDED.window_start,
            window_end = EXCLUDED.window_end,
            anomaly_score = EXCLUDED.anomaly_score,
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
    signalTypes?: Array<"volume" | "quality" | "keyword" | "driver">;
    limit?: number;
  }): Promise<AnomalyEvent[]> {
    const values: unknown[] = [args.targetId, args.fromIso, args.toIso];
    const predicates = [
      "target_id = $1",
      "observed_at >= $2::timestamptz",
      "observed_at <= $3::timestamptz",
    ];

    if (args.signalTypes && args.signalTypes.length > 0) {
      values.push(args.signalTypes);
      predicates.push(`signal_type = ANY($${values.length}::anomaly_signal_type_enum[])`);
    }

    values.push(args.limit ?? 500);

    const result = await this.db.query<AnomalyEventRow>(
      `
      SELECT target_id, signal_type, signal_key, observed_at, window_start, window_end,
             anomaly_score, algorithm_version, explain_payload, updated_at
      FROM anomaly_event
      WHERE ${predicates.join("\n        AND ")}
      ORDER BY observed_at ASC, signal_type ASC, signal_key ASC
      LIMIT $${values.length}
      `,
      values,
    );

    return result.rows.map(mapAnomalyEvent);
  }
}
