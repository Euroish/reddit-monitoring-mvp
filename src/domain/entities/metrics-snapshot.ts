import type { ISODateTime, SourceCode, UUID } from "../../shared/types/common";

export type SnapshotGranularity = "15m" | "1h" | "6h" | "1d";

export type MetricName =
  | "subscribers"
  | "active_users"
  | "new_posts_15m"
  | "score"
  | "num_comments"
  | "upvote_ratio";

export interface MetricsSnapshot {
  id?: number;
  snapshotAt: ISODateTime;
  source: SourceCode;
  targetId: UUID;
  contentId?: UUID;
  granularity: SnapshotGranularity;
  metricName: MetricName;
  metricValue: number;
  collectionJobId: UUID;
  createdAt?: ISODateTime;
}
