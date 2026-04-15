import type { ISODateTime, SourceCode, UUID } from "../../shared/types/common";

export type MonitorTargetType = "subreddit";
export type MonitorTargetStatus = "active" | "paused";

export interface MonitorTarget {
  id: UUID;
  source: SourceCode;
  targetType: MonitorTargetType;
  externalId?: string;
  canonicalName: string;
  status: MonitorTargetStatus;
  config: Record<string, unknown>;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

