import type { MonitorTarget } from "../../../domain/entities/monitor-target";
import type { MonitorTargetRepository } from "../../../domain/repositories/monitor-target-repository";
import type { SqlQueryable } from "../../postgres/postgres-client";
import { SOURCE_IDS } from "../../postgres/postgres.constants";
import { mapMonitorTarget, type MonitorTargetRow } from "./postgres-row-mappers";

export class PostgresMonitorTargetRepository implements MonitorTargetRepository {
  constructor(private readonly db: SqlQueryable) {}

  public async listSubreddits(): Promise<MonitorTarget[]> {
    const result = await this.db.query<MonitorTargetRow>(
      `
      SELECT id, target_type, external_id, canonical_name, status, config_json, created_at, updated_at
      FROM monitor_target
      WHERE source_id = $1
        AND target_type = 'subreddit'
      ORDER BY canonical_name ASC
      `,
      [SOURCE_IDS.reddit],
    );

    return result.rows.map(mapMonitorTarget);
  }

  public async findActiveSubreddits(): Promise<MonitorTarget[]> {
    return (await this.listSubreddits()).filter((target) => target.status === "active");
  }

  public async findById(targetId: string): Promise<MonitorTarget | null> {
    const result = await this.db.query<MonitorTargetRow>(
      `
      SELECT id, target_type, external_id, canonical_name, status, config_json, created_at, updated_at
      FROM monitor_target
      WHERE source_id = $1
        AND target_type = 'subreddit'
        AND id = $2
      LIMIT 1
      `,
      [SOURCE_IDS.reddit, targetId],
    );

    return result.rows.length > 0 ? mapMonitorTarget(result.rows[0]) : null;
  }

  public async findByCanonicalName(canonicalName: string): Promise<MonitorTarget | null> {
    const result = await this.db.query<MonitorTargetRow>(
      `
      SELECT id, target_type, external_id, canonical_name, status, config_json, created_at, updated_at
      FROM monitor_target
      WHERE source_id = $1
        AND target_type = 'subreddit'
        AND canonical_name = $2
      LIMIT 1
      `,
      [SOURCE_IDS.reddit, canonicalName],
    );

    return result.rows.length > 0 ? mapMonitorTarget(result.rows[0]) : null;
  }

  public async upsert(target: MonitorTarget): Promise<MonitorTarget> {
    const result = await this.db.query<MonitorTargetRow>(
      `
      INSERT INTO monitor_target (
        id, source_id, target_type, external_id, canonical_name, status, config_json, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
      ON CONFLICT (source_id, target_type, canonical_name)
      DO UPDATE SET
        external_id = EXCLUDED.external_id,
        status = EXCLUDED.status,
        config_json = EXCLUDED.config_json,
        updated_at = EXCLUDED.updated_at
      RETURNING id, target_type, external_id, canonical_name, status, config_json, created_at, updated_at
      `,
      [
        target.id,
        SOURCE_IDS[target.source],
        target.targetType,
        target.externalId ?? null,
        target.canonicalName,
        target.status,
        JSON.stringify(target.config ?? {}),
        target.createdAt,
        target.updatedAt,
      ],
    );

    return mapMonitorTarget(result.rows[0]);
  }
}
