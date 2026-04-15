import type { MetricsSnapshot } from "../../../domain/entities/metrics-snapshot";
import type { MetricsSnapshotRepository } from "../../../domain/repositories/metrics-snapshot-repository";
import type { PostgresClient } from "../../postgres/postgres-client";
import { SOURCE_IDS } from "../../postgres/postgres.constants";
import { mapMetricsSnapshot, type MetricsSnapshotRow } from "./postgres-row-mappers";
import { buildValuesPlaceholders, chunkArray } from "./postgres-sql.utils";

export class PostgresMetricsSnapshotRepository implements MetricsSnapshotRepository {
  constructor(private readonly db: PostgresClient) {}

  public async appendMany(snapshots: MetricsSnapshot[]): Promise<void> {
    if (snapshots.length === 0) {
      return;
    }

    const deduped = this.dedupeSnapshots(snapshots);
    const sourceId = SOURCE_IDS.reddit;
    const chunkSize = 1000;

    await this.db.withTransaction(async (client) => {
      for (const group of chunkArray(deduped, chunkSize)) {
        const values: unknown[] = [];
        for (const snapshot of group) {
          values.push(
            snapshot.snapshotAt,
            sourceId,
            snapshot.targetId,
            snapshot.contentId ?? null,
            snapshot.granularity,
            snapshot.metricName,
            snapshot.metricValue,
            snapshot.collectionJobId,
          );
        }

        const placeholders = buildValuesPlaceholders(group.length, 8);
        await client.query(
          `
          INSERT INTO metrics_snapshot (
            snapshot_at, source_id, target_id, content_id, granularity, metric_name, metric_value, collection_job_id
          ) VALUES ${placeholders}
          ON CONFLICT DO NOTHING
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
    metricNames: string[];
  }): Promise<MetricsSnapshot[]> {
    const result = await this.db.query<MetricsSnapshotRow>(
      `
      SELECT id, snapshot_at, target_id, content_id, granularity, metric_name, metric_value, collection_job_id, created_at
      FROM metrics_snapshot
      WHERE target_id = $1
        AND snapshot_at >= $2
        AND snapshot_at <= $3
        AND metric_name = ANY($4::metric_name_enum[])
      ORDER BY snapshot_at ASC, id ASC
      `,
      [args.targetId, args.from, args.to, args.metricNames],
    );

    return result.rows.map(mapMetricsSnapshot);
  }

  private dedupeSnapshots(snapshots: MetricsSnapshot[]): MetricsSnapshot[] {
    const byUniqueKey = new Map<string, MetricsSnapshot>();

    for (const snapshot of snapshots) {
      const key = [
        snapshot.targetId,
        snapshot.contentId ?? "__target_level__",
        snapshot.granularity,
        snapshot.metricName,
        snapshot.snapshotAt,
      ].join("|");
      byUniqueKey.set(key, snapshot);
    }

    return Array.from(byUniqueKey.values());
  }
}
