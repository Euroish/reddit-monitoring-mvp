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
  refreshByIds?: boolean;
  /** Provider may return/bill a fixed page even when a smaller page is requested. */
  requestResourceUpperBound?: number;
}
export interface SourceSchedule { enabled: boolean; cadenceSeconds: number; overlapSeconds: number; initialLookbackHours: number; maxCatchupHours: number; pageSize: number; maxPages: number }
export interface SourceRefresh { enabled: boolean; afterHours: number; minIntervalHours: number; maxAttempts: number; batchSize: number }
export interface CollectionSource {
  id: string; platform: ContentPlatform; provider: string; label: string; target: SourceTarget;
  contentKind: PublicContentKind; createdAt: string; lastSuccessAt: string | null;
  latestPublishedAt: string | null; coverage: "unknown" | "partial";
  state: "active" | "paused" | "archived"; group: string | null; updatedAt: string;
  schedule: SourceSchedule; refresh: SourceRefresh; nextDueAt: string | null; incrementalTo: string | null;
}
export interface CreateCollectionSourceRequest {
  platform: ContentPlatform; provider: string; label?: string; target: SourceTarget; contentKind: PublicContentKind;
}
export interface StartSourceCollectionRequest { from?: string; to?: string; pageSize?: number; maxPages?: number }
export interface UpdateCollectionSourceRequest { label?: string; group?: string | null; schedule?: Partial<SourceSchedule>; refresh?: Partial<SourceRefresh> }
export interface SourceProviderBudget { provider: string; enabled: boolean; dailyRequests: number; monthlyRequests: number; dailyResources: number; monthlyResources: number }
export interface SourceProviderUsage { provider: string; day: string; month: string; dailyRequests: number; monthlyRequests: number; dailyResources: number; monthlyResources: number; budget: SourceProviderBudget }
export interface SourceCollectionJob {
  id: string; sourceId: string; status: "queued" | "running" | "retrying" | "succeeded" | "failed" | "cancelled";
  from: string; to: string; pageSize: number; maxPages: number; pagesCommitted: number; recordsProcessed: number;
  checkpoint: JsonValue | null; coverage: "unknown" | "partial"; exhausted: boolean;
  attempts: number; error: string | null; nextRunAt: string; createdAt: string; finishedAt: string | null;
  purpose: "manual" | "scheduled" | "refresh"; parentJobId: string | null; refreshIds: string[];
  recordsInserted: number; recordsUpdated: number;
  /** Registered adapter attempts; cancellation/lease loss may prevent a fenced write. Not a provider bill. */
  requestCount?: number; requestDurationMs?: number;
}
export interface SourceJobQuery { sourceId?: string; status?: SourceCollectionJob["status"]; limit?: number }
export interface SourceWorkerHeartbeat { id: string; startedAt: string; lastHeartbeatAt: string; state: "active" | "draining" | "stopped"; lastJobId: string | null }
export interface SourceOps {
  checkedAt: string; workers: (SourceWorkerHeartbeat & { stale: boolean })[];
  queue: { status: SourceCollectionJob["status"]; count: number }[]; oldestQueuedAt: string | null;
  sources: { sourceId: string; state: CollectionSource["state"]; lastSuccessAgeHours: number | null; latestPublishedAgeHours: number | null; coverage: CollectionSource["coverage"]; nextDueAt: string | null; activeJobs: number }[];
  providers: SourceProviderUsage[];
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
export interface SourceListResponse { ok: true; requestId: string; sources: CollectionSource[]; capabilities: SourceCapability[]; providers?: SourceProviderUsage[] }
export interface CollectionSourceResponse { ok: true; requestId: string; source: CollectionSource }
export interface SourceJobResponse { ok: true; requestId: string; job: SourceCollectionJob }
export interface SourceJobsResponse { ok: true; requestId: string; jobs: SourceCollectionJob[] }
export interface SourceOpsResponse { ok: true; requestId: string; ops: SourceOps }
export interface ContentWorkbenchResponse {
  ok: true; requestId: string; generatedAt: string;
  stats: Omit<ContentStatsResponse, "ok" | "requestId">;
  byPlatform: { platform: ContentPlatform; count: number }[];
  byProvider: { provider: string; count: number }[];
  sources: CollectionSource[]; capabilities: SourceCapability[];
  scope: "collected_content"; providerCountsMayOverlap: true; metricComparison: "platform_units_only";
}
export interface ContentExportResponse {
  ok: true; requestId: string; exportedAt: string; scope: "collected_content"; coverage: "stored_sample";
  filters: ContentQuery; totalMatching: number; exportedCount: number; maxItems: number;
  truncated: boolean; nextCursor: string | null; items: PublicContent[];
}
