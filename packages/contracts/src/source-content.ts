/** Shared content contract. Platform is the publisher; provider is the acquisition channel. */
export type ContentPlatform = "reddit" | "x" | "instagram" | "web";
export type PublicContentKind = "post" | "comment" | "article" | "image" | "video";
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type SourceTarget =
  | { type: "community"; community: string; query?: string }
  | { type: "account"; account: string; query?: string }
  | { type: "post"; postId: string; query?: string }
  | { type: "search"; query: string }
  | { type: "feed"; url: string };

/** IDs remain strings, including X snowflakes. No mandatory title, author or published timestamp. */
export interface ContentAuthor { externalId: string | null; handle: string | null; displayName: string | null; url: string | null }
export interface ContentReference { kind: PublicContentKind; externalId: string; relation: "reply_to" | "thread_root" | "quote" | "repost" }
export interface ContentMedia { type: "image" | "video" | "audio" | "link"; url: string; previewUrl: string | null; altText: string | null; durationSeconds: number | null }
export type PlatformDetails =
  ( { platform: "reddit"; community: string; flair: string | null; nsfw: boolean | null }
  | { platform: "x"; conversationId: string | null; isReply: boolean | null; isRepost: boolean | null; isQuote: boolean | null; sensitive: boolean | null }
  | { platform: "instagram"; mediaProduct: "feed" | "story" | "reel" | "unknown"; caption: string | null; carouselIds: string[] }
  | { platform: "web"; publisher: string | null; canonicalUrl: string | null; feedUrl: string | null } )
  & { /** Allowlisted, namespaced extra fields; never an unfiltered upstream payload. */ extensions?: Record<string, JsonValue> };
export interface MetricDefinition {
  key: string; label: string; unit: "count" | "ratio" | "rank"; cumulative: boolean; signed: boolean;
  contentKinds: PublicContentKind[];
  direction: "higher" | "lower" | "neutral";
}
export interface ContentObservation {
  provider: string; sourceId: string; sourceObservedAt: string | null; fetchedAt: string;
  timeBasis: "archive_initial" | "archive_refresh" | "provider_snapshot" | "unknown";
  maturity: "initial" | "refreshed" | "unknown";
  metrics: Record<string, number | null>;
  evidenceKey: string;
}
export interface PublicContent {
  id: string; platform: ContentPlatform; kind: PublicContentKind; externalId: string;
  title: string | null; text: string | null; url: string | null; language: string | null;
  author: ContentAuthor | null; publishedAt: string | null; firstFetchedAt: string; lastFetchedAt: string;
  availability: "available" | "removed" | "deleted" | "unknown";
  references: ContentReference[]; media: ContentMedia[]; platformDetails: PlatformDetails;
  observations: ContentObservation[];
}
export interface SourceCapability {
  platform: ContentPlatform; provider: string; enabled: boolean;
  contentKinds: PublicContentKind[]; targetTypes: SourceTarget["type"][];
  keywordSearch: "scoped" | "global" | "none"; metrics: MetricDefinition[];
  observationModel: "archive" | "snapshot"; limitations: string[];
}
export interface CollectionSource {
  id: string; platform: ContentPlatform; provider: string; label: string; target: SourceTarget;
  contentKind: PublicContentKind; createdAt: string; lastSuccessAt: string | null;
  latestPublishedAt: string | null; coverage: "unknown" | "partial";
}
export interface CreateCollectionSourceRequest {
  platform: ContentPlatform; provider: string; label?: string; target: SourceTarget; contentKind: PublicContentKind;
}
export interface StartSourceCollectionRequest { from?: string; to?: string; pageSize?: number; maxPages?: number }
export interface SourceCollectionJob {
  id: string; sourceId: string; status: "queued" | "running" | "retrying" | "succeeded" | "failed";
  from: string; to: string; pageSize: number; maxPages: number; pagesCommitted: number; recordsProcessed: number;
  checkpoint: JsonValue | null; coverage: "unknown" | "partial"; exhausted: boolean;
  attempts: number; error: string | null; nextRunAt: string; createdAt: string; finishedAt: string | null;
}
export interface ContentQuery {
  platform?: ContentPlatform; provider?: string; sourceId?: string; kind?: PublicContentKind;
  query?: string; from?: string; to?: string; limit?: number; cursor?: string;
}
export interface ContentListResponse {
  ok: true; requestId: string; items: PublicContent[]; nextCursor: string | null;
  coverage: "stored_sample"; queryScope: "collected_content";
}
export interface ContentStatsResponse {
  ok: true; requestId: string; total: number; byKind: { kind: PublicContentKind; count: number }[];
  daily: { day: string; count: number }[]; scope: "collected_content";
  /** Unknown publish dates count toward total but do not appear in published-day buckets. */
  unknownPublishedAtCount: number;
}
export interface SourceListResponse { ok: true; requestId: string; sources: CollectionSource[]; capabilities: SourceCapability[] }
export interface CollectionSourceResponse { ok: true; requestId: string; source: CollectionSource }
export interface SourceJobResponse { ok: true; requestId: string; job: SourceCollectionJob }
