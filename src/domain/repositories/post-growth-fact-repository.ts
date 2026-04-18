import type {
  PostGrowthAgeBucket,
  PostGrowthFact,
} from "../entities/post-growth-fact";

export interface PostGrowthFactRepository {
  upsertMany(rows: PostGrowthFact[]): Promise<void>;
  listByTargetInRange(args: {
    targetId: string;
    fromIso: string;
    toIso: string;
    ageBuckets?: PostGrowthAgeBucket[];
    limit?: number;
  }): Promise<PostGrowthFact[]>;
  listTopByTargetInRange(args: {
    targetId: string;
    fromIso: string;
    toIso: string;
    ageBuckets?: PostGrowthAgeBucket[];
    limit?: number;
  }): Promise<PostGrowthFact[]>;
}
