import type { SubredditDailyFact } from "../entities/subreddit-daily-fact";

export interface SubredditDailyFactRepository {
  upsertMany(facts: SubredditDailyFact[]): Promise<void>;
  listByTargetInRange(args: {
    targetId: string;
    fromDay: string;
    toDay: string;
  }): Promise<SubredditDailyFact[]>;
  listLatestByTargetsInRange(args: {
    targetIds: string[];
    fromDay: string;
    toDay: string;
  }): Promise<SubredditDailyFact[]>;
}
