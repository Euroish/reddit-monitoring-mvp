import type {
  PostEngagementLatest,
  PostEngagementWindow,
} from "../entities/post-engagement";

export interface PostEngagementRepository {
  upsertLatestMany(rows: PostEngagementLatest[]): Promise<void>;
  upsertWindowedMany(rows: PostEngagementWindow[]): Promise<void>;
  listLatestByContentIdsInRange(args: {
    contentIds: string[];
    from: string;
    to: string;
  }): Promise<PostEngagementLatest[]>;
  listWindowedByTargetInRange(args: {
    targetId: string;
    from: string;
    to: string;
  }): Promise<PostEngagementWindow[]>;
}
