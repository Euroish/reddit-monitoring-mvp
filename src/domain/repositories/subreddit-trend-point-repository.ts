import type { SubredditTrendPoint } from "../entities/subreddit-trend-point";

export interface SubredditTrendPointRepository {
  upsertMany(points: SubredditTrendPoint[]): Promise<void>;
  listByTargetInRange(args: {
    targetId: string;
    from: string;
    to: string;
  }): Promise<SubredditTrendPoint[]>;
  listLatestByTargetsInRange(args: {
    targetIds: string[];
    from: string;
    to: string;
  }): Promise<SubredditTrendPoint[]>;
}
