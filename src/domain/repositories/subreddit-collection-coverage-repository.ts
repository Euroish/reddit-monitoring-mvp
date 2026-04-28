import type { SubredditCollectionCoverage } from "../entities/subreddit-collection-coverage";

export interface SubredditCollectionCoverageRepository {
  upsertMany(rows: SubredditCollectionCoverage[]): Promise<void>;
  replaceRange(args: {
    targetId: string;
    fromDay: string;
    toDay: string;
    rows: SubredditCollectionCoverage[];
  }): Promise<void>;
  listByTargetInRange(args: {
    targetId: string;
    fromDay: string;
    toDay: string;
  }): Promise<SubredditCollectionCoverage[]>;
}
