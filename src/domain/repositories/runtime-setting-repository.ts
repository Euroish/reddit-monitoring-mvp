export interface RuntimeSettingRepository {
  getJson<TValue extends Record<string, unknown> = Record<string, unknown>>(key: string): Promise<TValue | null>;
  setJson<TValue extends Record<string, unknown> = Record<string, unknown>>(key: string, value: TValue, updatedAt: string): Promise<TValue>;
}
