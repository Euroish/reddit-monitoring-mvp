import type { KeywordTrendDaily } from "../entities/keyword-trend-daily";

export interface KeywordTrendDailyRepository {
  upsertMany(rows: KeywordTrendDaily[]): Promise<void>;
  listByTargetInRange(args: {
    targetId: string;
    fromDay: string;
    toDay: string;
    keywords?: string[];
    tracks?: Array<"auto_keyword" | "explicit_query">;
    queryScopes?: Array<"subreddit" | "global">;
    limit?: number;
  }): Promise<KeywordTrendDaily[]>;
  listByQueryInRange(args: {
    normalizedQueryText: string;
    fromDay: string;
    toDay: string;
    track?: "auto_keyword" | "explicit_query";
    queryScope?: "subreddit" | "global";
    limit?: number;
  }): Promise<KeywordTrendDaily[]>;
}
