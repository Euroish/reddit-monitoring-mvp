import type { KeywordTrendDaily } from "../entities/keyword-trend-daily";

export interface KeywordTrendDailyRepository {
  upsertMany(rows: KeywordTrendDaily[]): Promise<void>;
  listByTargetInRange(args: {
    targetId: string;
    fromDay: string;
    toDay: string;
    keywords?: string[];
    limit?: number;
  }): Promise<KeywordTrendDaily[]>;
}

