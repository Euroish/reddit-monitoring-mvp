import type { RuntimeSettingRepository } from "../../../domain/repositories/runtime-setting-repository";

export class InMemoryRuntimeSettingRepository implements RuntimeSettingRepository {
  private readonly values = new Map<string, Record<string, unknown>>();

  public async getJson<TValue extends Record<string, unknown> = Record<string, unknown>>(key: string): Promise<TValue | null> {
    return (this.values.get(key) as TValue | undefined) ?? null;
  }

  public async setJson<TValue extends Record<string, unknown> = Record<string, unknown>>(key: string, value: TValue): Promise<TValue> {
    this.values.set(key, value);
    return value;
  }
}
