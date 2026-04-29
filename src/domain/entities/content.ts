import type { ISODateTime, SourceCode, UUID } from "../../shared/types/common";

export type ContentKind = "post";
export type ContentDiscoverySource =
  | "new_listing"
  | "hot_listing"
  | "best_listing"
  | "rising_listing"
  | "top_supplement"
  | "unknown";
export type ContentCollectionMode = "live" | "backfill";
export type ContentFirstListing = "new" | "hot" | "best" | "rising" | "top" | "unknown";

export interface Content {
  id: UUID;
  source: SourceCode;
  targetId: UUID;
  accountId?: UUID;
  externalId: string;
  kind: ContentKind;
  title: string;
  bodyText?: string;
  url?: string;
  permalink: string;
  createdAtSource: ISODateTime;
  firstSeenAt: ISODateTime;
  lastSeenAt: ISODateTime;
  discoverySource?: ContentDiscoverySource;
  firstCollectionMode?: ContentCollectionMode;
  firstListing?: ContentFirstListing;
  firstTimeRange?: string;
  firstCollectionJobId?: UUID;
  totalEligible?: boolean;
}
