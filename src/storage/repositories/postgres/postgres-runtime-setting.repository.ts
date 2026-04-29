import type { RuntimeSettingRepository } from "../../../domain/repositories/runtime-setting-repository";
import type { SqlQueryable } from "../../postgres/postgres-client";

interface RuntimeSettingRow {
  setting_key: string;
  value_json: Record<string, unknown>;
  updated_at: string | Date;
}

export class PostgresRuntimeSettingRepository implements RuntimeSettingRepository {
  constructor(private readonly db: SqlQueryable) {}

  public async getJson<TValue extends Record<string, unknown> = Record<string, unknown>>(key: string): Promise<TValue | null> {
    const result = await this.db.query<RuntimeSettingRow>(
      `
      SELECT setting_key, value_json, updated_at
      FROM runtime_setting
      WHERE setting_key = $1
      LIMIT 1
      `,
      [key],
    );
    return (result.rows[0]?.value_json as TValue | undefined) ?? null;
  }

  public async setJson<TValue extends Record<string, unknown> = Record<string, unknown>>(key: string, value: TValue, updatedAt: string): Promise<TValue> {
    await this.db.query(
      `
      INSERT INTO runtime_setting (setting_key, value_json, updated_at)
      VALUES ($1, $2::jsonb, $3)
      ON CONFLICT (setting_key)
      DO UPDATE SET
        value_json = EXCLUDED.value_json,
        updated_at = EXCLUDED.updated_at
      `,
      [key, JSON.stringify(value), updatedAt],
    );
    return value;
  }
}
