import type { ResearchCollectionRestriction, UserQuotaOverride as QuotaOverrideDto } from '../../../../packages/contracts/src/collection.js';
export type { QueryHintsValue, ResearchPlanCollectRequest, ResearchPlanPreviewRequest, ResearchCollectionRestriction, UserQuotaOverride as QuotaOverrideDto } from '../../../../packages/contracts/src/collection.js';
import type { SourceCapability, SourceTarget } from '../../../../packages/contracts/src/source-content.js';
export type { CollectionSource, SourceCapability, SourceTarget } from '../../../../packages/contracts/src/source-content.js';
export type {
  CollectionSourceInput as SourceInput, CollectionSourceUpdate as SourcePatch,
  CollectionSourcePreview as SourcePreviewResult, CollectionSourceImport as SourceImport,
} from '../../../../packages/contracts/src/source-content.js';
export interface SourceImportResult {
  created: number;
  skipped: number;
  errors: Array<{ index: number; label: string; error: string }>;
}

export type Role = 'owner' | 'admin' | 'viewer';
export type ClientKind = 'browser' | 'machine';
export type Platform = 'reddit' | 'x' | 'bluesky' | 'web';
export type ContentKind = 'post' | 'comment' | 'article' | 'image' | 'video';
export type SearchScope = 'title' | 'text' | 'title_text';
export type SignalType = 'discussion' | 'pain';
export type DeliveryMode = 'pull' | 'push';
export type SourceState = 'active' | 'paused' | 'archived';
export type TargetType = 'search' | 'community' | 'account' | 'post' | 'feed';
export type ProviderName =
  | 'kaix'
  | 'red_crawler'
  | 'bluesky_appview'
  | 'twitterapis'
  | 'scrapebadger'
  | 'newsnow'
  | 'feed'
  | 'external_ingest';

export type PullProviderName = Exclude<ProviderName, 'external_ingest'>;
export type FallbackProviderName = 'scrapebadger' | 'red_crawler';

export type MachineScope =
  | 'sources:write'
  | 'read'
  | 'export'
  | 'ingest'
  | 'collect'
  | 'projects:write';

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    requestId: string;
    retryable: boolean;
  };
}

export class ApiError extends Error {
  status: number;
  code: string;
  requestId: string;
  retryable: boolean;
  retryAfterSeconds?: number;

  constructor(
    status: number,
    envelope: ApiErrorEnvelope['error'],
    retryAfterSeconds?: number,
  ) {
    super(envelope.message || `HTTP ${status}`);
    this.status = status;
    this.code = envelope.code || `http_${status}`;
    this.requestId = envelope.requestId || 'unknown';
    this.retryable = Boolean(envelope.retryable);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export type PlanTier = 'free' | 'pro';
export type SourceTier = 'T1' | 'T1_5' | 'T2';
export type StoryView = 'latest' | 'hot' | 'digest';
export type ChannelScope = 'info' | 'social' | 'all';
export type CredentialProviderName = 'apify' | 'twitterapis' | 'scrapebadger';

export type { StoryInsights, StoryInsightsQuery } from '../../../../packages/contracts/src/content-stories.js';

export interface StoryQuery {
  view?: StoryView;
  date?: string;
  limit?: number;
  offset?: number;
  sourceId?: string;
  platform?: Platform;
  channelScope?: ChannelScope;
  sourceGroup?: string;
  tier?: SourceTier;
  language?: string;
  includeTrends?: boolean;
  diverse?: boolean;
  term?: string;
  topicId?: string;
  bucketFrom?: string;
  bucketTo?: string;
  insightTier?: SourceTier;
  insightSourceGroup?: string;
  insightLanguage?: string;
  insightSourceId?: string;
}

export interface StoryEvidence {
  id: string;
  platform: Platform;
  title: string;
  url: string | null;
  author: string | null;
  thumbnail: string | null;
  sourceId: string;
  sourceLabel: string;
  tier: SourceTier;
  publishedAt: string | null;
  discoveredAt: string;
}

export interface StoryItem {
  storyKey: string;
  representative: StoryEvidence;
  excerpt: string | null;
  related: StoryEvidence[];
  relatedCount: number;
  sourceCount: number;
  heat48h: number;
  tierBreakdown: {
    T1: number;
    T1_5: number;
    T2: number;
  };
  sparkline48h: number[];
  change6h: number | null;
  trend: 'up' | 'down' | 'flat' | 'new' | 'unknown';
  badges: Array<'surge' | 'rising' | 'new'>;
  updatedAt: string;
}

export interface StoryFeed {
  view: StoryView;
  from: string;
  to: string;
  items: StoryItem[];
  totalCount: number;
  nextOffset: number | null;
  coverage: 'stored_sample';
}

export interface PublicSourceSummary {
  id: string;
  label: string;
  platform: Platform;
  sourceGroup: string | null;
  tier: SourceTier;
  locale: string | null;
  state: string;
  lastSuccessAt: string | null;
  count48h: number;
}

export interface PublicSourceDirectory {
  sources: PublicSourceSummary[];
  groupCounts: Record<string, number>;
}

export interface ContentFacetsQuery extends Omit<ContentFilter, 'from' | 'to'> {
  projectId?: string;
  sourceId?: string;
  threadAware?: boolean;
  from: string;
  to: string;
  bucket?: 'day' | '6h';
}

export interface ContentFacetPlatformBucket {
  platform: Platform;
  count: number;
  matchedContentCount: number;
}

export interface ContentFacets {
  count: number;
  matchedContentCount: number;
  timeline: Array<{
    bucket: string;
    count: number;
    matchedContentCount: number;
    byPlatform: ContentFacetPlatformBucket[];
  }>;
  distributions: {
    platforms: ContentFacetPlatformBucket[];
    kinds: Array<{
      kind: ContentKind;
      count: number;
      matchedContentCount: number;
    }>;
  };
  coverage: 'stored_sample';
}

export interface Actor {
  userId: string;
  email: string;
  role: Role;
  planTier?: PlanTier;
  clientKind: ClientKind;
  sessionId: string;
  scopes: string[];
  allowedSourceIds: string[] | null;
}

export interface ProviderCredentialStatus {
  provider: CredentialProviderName;
  connectors: string[];
  envVar: string;
  source: 'db' | 'env' | 'none';
  configured: boolean;
  keyHint: string | null;
  envConfigured: boolean;
  envHint: string | null;
  conflict?: boolean;
  revision: number;
  updatedAt: string | null;
  updatedByEmail: string | null;
}

export interface PlanPolicyDto {
  planTier: PlanTier;
  manualCollectEnabled: boolean;
  allowedProviders: string[];
  allowedSourceIds: string[] | null;
  dailyRequests: number | null;
  dailyResources: number | null;
  maxBatchLimit: number;
  maxCommentsPerPost: number;
  maxProjects?: number;
  maxLookbackDays?: number;
  allowProviderChoice?: boolean;
  exportEnabled?: boolean;
  allowAutoSchedule?: boolean;
  maxScheduledTasks?: number;
  minScheduleIntervalHours?: number;
  updatedAt: string;
  revision: number;
}

export interface EffectivePolicyDto {
  planTier: PlanTier;
  manualCollectEnabled: boolean;
  allowedProviders: string[];
  allowedSourceIds: string[] | null;
  dailyRequests: number | null;
  dailyResources: number | null;
  maxBatchLimit: number;
  maxCommentsPerPost: number;
  maxProjects?: number;
  maxLookbackDays?: number;
  allowProviderChoice?: boolean;
  exportEnabled?: boolean;
  allowAutoSchedule?: boolean;
  maxScheduledTasks?: number;
  minScheduleIntervalHours?: number;
  hasOverride: boolean;
}

export interface EffectiveCapabilitiesDto {
  bypassPlanLimits: boolean;
  canManageSources: boolean;
  canManageBudgets: boolean;
  canManageUserOverrides: boolean;
  canManagePlanPolicies: boolean;
  canManageMembers: boolean;
  canInviteAdmins: boolean;
  canChangeUserPlans: boolean;
}

export interface QuotasSummaryResponse {
  scope: 'personal' | 'admin';
  bypassPlanLimits?: boolean;
  effectiveCapabilities?: EffectiveCapabilitiesDto;
  resetsAtUtc: string;
  effectivePolicy: EffectivePolicyDto;
  myUsage: {
    requestsReserved: number;
    requestsExecuted: number;
    resourcesReserved: number;
    byProvider: Array<{
      provider: string;
      requests_reserved: number;
      requests_executed: number;
      resources_reserved: number;
    }>;
  };
  providerAvailability?: Array<{
    provider: string;
    platform: Platform;
    enabled: boolean;
    planAllowed: boolean;
    budgetEnabled: boolean;
  }>;
  planPolicies?: PlanPolicyDto[];
  users?: Array<{
    id: string;
    email: string;
    role: Role;
    status: string;
    planTier: PlanTier;
    quotaOverride: QuotaOverrideDto | null;
    todayUsage: {
      requestsReserved: number;
      requestsExecuted: number;
      resourcesReserved: number;
    };
  }>;
}

export interface RecentJobDto {
  id: string;
  sourceId: string;
  sourceLabel: string;
  platform: Platform;
  status: JobStatus;
  purpose: string;
  operation: 'collect' | 'radar' | 'refresh' | 'hydrate' | 'ingest';
  provider: ProviderName;
  phase: ProviderPhase | null;
  pageSize: number | null;
  recordsProcessed: number;
  recordsInserted: number;
  recordsUpdated: number;
  requestCount: number;
  requestDurationMs: number;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  requestedByUserId: string | null;
  requestedByClientKind: ClientKind | null;
  batchId?: string | null;
  projectId?: string | null;
  requesterEmail: string | null;
}

export interface CollectionBatchDto {
  id: string;
  jobId: string | null;
  sourceId: string;
  sourceLabel: string;
  platform: Platform;
  provider: ProviderName;
  deliveryMode: DeliveryMode;
  usageDomain?: 'research' | 'feed';
  label: string;
  itemCount: number;
  visibility?: 'private' | 'shared';
  createdAt: string;
  createdByUserId: string | null;
}

export interface ProjectBatchDto {
  batchId: string;
  jobId: string | null;
  sourceId: string;
  sourceLabel: string;
  platform: Platform;
  provider: ProviderName;
  deliveryMode: DeliveryMode;
  label: string;
  itemCount: number;
  visibility?: 'private' | 'shared';
  status: 'enabled' | 'disabled' | 'removed';
  addedAt: string;
  createdAt: string;
}

export interface ProviderFilterSupportDto {
  sortOptions: Array<'new' | 'top' | 'hot' | 'relevance'>;
  supportsTimeRange: boolean;
  supportsMinLikes: boolean;
  supportsMinComments: boolean;
  supportsExcludeReposts: boolean;
  supportsLanguage: boolean;
  engagementFilterMode: 'native' | 'post_filter' | 'none';
}

export interface ResearchPlanPreviewResponse {
  resolutionStatus: 'matched_source' | 'on_demand_available' | 'needs_admin_source' | 'blocked';
  executable: boolean;
  matchedSource: {
    id: string;
    label: string;
    platform: Platform;
    provider: string;
    target: SourceTarget;
    lastSuccessAt: string | null;
  } | null;
  resolvedTarget: { platform: string | null; type: string; value: string } | null;
  coverage: {
    status: 'empty' | 'unknown';
    existingItemCount: number;
    lastSuccessAt: string | null;
    note: string;
  };
  reusableBatches: Array<{
    id: string;
    label: string;
    itemCount: number;
    visibility: 'private' | 'shared';
    createdAt: string;
  }>;
  estimate: { requests: number; systemResources: number; personalResources: number };
  blockers: string[];
  restrictions?: ResearchCollectionRestriction[];
  fieldPolicy: {
    canEditTarget: boolean;
    canChooseProvider: boolean;
    canUseFallback: boolean;
    canIncludeComments: boolean;
    maxLookbackDays: number;
    maxBatchLimit: number;
    maxCommentsPerPost: number;
    supportedFilters?: ProviderFilterSupportDto;
  };
}

export interface GlobalSocialBudgetDto {
  dailySocialItemCeiling: number;
  autoHydrationEnabled: boolean;
  reservedToday: number;
  revision: number;
  updatedAt: string;
}

export interface LegacySourceCandidateDto {
  id: string;
  label: string;
  platform: Platform;
  primaryProvider: string;
  state: SourceState;
  feedLane: string;
  usageDomain: string;
  monitorManaged: boolean;
  scheduleEnabled: boolean;
  schedule: Record<string, unknown>;
  nextDueAt: string | null;
  revision: number;
  automaticCollectionBlocked: boolean;
  recentJobStatus: string | null;
  recentJobAt: string | null;
  unresolvedCharges: number;
  resourcesToday: number;
  classification: 'monitor_derived' | 'operator_owned' | 'unclassified';
  totalMonitorRefs: number;
  enabledMonitorRefs: number;
  monitorIds: string[];
}

export interface IntelMonitorDto {
  id: string;
  kind: 'keyword' | 'author_list' | 'community_bundle';
  name: string;
  config: {
    platforms: Array<'reddit' | 'x'>;
    keywords?: string[];
    competitorKeywords?: string[];
    handles?: Array<{ platform: 'reddit' | 'x'; handle: string }>;
    subreddits?: string[];
    sort?: 'top' | 'hot' | 'new';
    minLikes?: number;
    minComments?: number;
    excludeReposts?: boolean;
    language?: string;
  };
  scheduleIntervalHours: number;
  dailyItemBudget: number;
  enabled: boolean;
  projectId?: string | null;
  pausedReason?: string | null;
  lastDispatchedAt?: string | null;
  nextDueAt?: string | null;
  revision: number;
  sourceCount: number;
  targetCount: number;
  lastSuccessAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserAccountDto {
  id: string;
  email: string;
  role: Role;
  status: 'pending' | 'active' | 'disabled';
  planTier: PlanTier;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEventDto {
  id: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
  actorEmail: string | null;
}

export interface CapabilitiesResponse {
  providers: SourceCapability[];
  operations: string[];
  maxIngestItems: number;
  maxIngestBytes: number;
  maxOnlineItems: number;
  threadAware: boolean;
  automaticHydration: boolean;
}

export interface ContentFilter {
  sourceIds?: string[];
  batchIds?: string[];
  deliveryMode?: DeliveryMode;
  platform?: Platform;
  platforms?: Platform[];
  kind?: ContentKind;
  kinds?: ContentKind[];
  community?: string;
  communities?: string[];
  query?: string;
  anyTerms?: string[];
  allTerms?: string[];
  exclusions?: string[];
  searchScope?: SearchScope;
  signal?: SignalType;
  sourceGroup?: string;
  tier?: SourceTier;
  language?: string;
  languages?: string[];
  hasMedia?: boolean;
  from?: string;
  to?: string;
  timeBasis?: 'published' | 'collected';
}

export interface ListQuery extends ContentFilter {
  projectId?: string;
  sourceId?: string;
  threadAware?: boolean;
  limit?: number;
  cursor?: string;
  sort?: 'recent' | 'engagement';
}

export interface ProjectDataSummary {
  platforms: string[];
  source_labels: string[];
  item_count: number;
  shared_batch_count: number;
  private_batch_count: number;
  latest_batch_at: string | null;
}

export interface Project {
  id: string;
  name: string;
  description?: string | null;
  dataset_mode?: 'source_filter' | 'batch';
  visibility?: 'private' | 'shared';
  forked_from_project_id?: string | null;
  linked_monitor_id?: string | null;
  filter: ContentFilter;
  revision: number;
  thread_aware: boolean;
  include_push_in_trends: boolean;
  source_ids: string[];
  owner_user_id?: string | null;
  can_edit?: boolean;
  is_shared?: boolean;
  enabled_batch_count?: number;
  total_batch_count?: number;
  data_summary?: ProjectDataSummary;
  hydration?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface ProjectInput {
  name: string;
  description?: string | null;
  datasetMode?: 'source_filter' | 'batch';
  visibility?: 'private' | 'shared';
  sourceIds?: string[];
  filter?: ContentFilter;
  threadAware?: boolean;
  includePushInTrends?: boolean;
}

export interface OverviewFacet {
  day_group: 0 | 1;
  platform_group: 0 | 1;
  kind_group: 0 | 1;
  day: string | null;
  platform: Platform | null;
  kind: ContentKind | null;
  count: number;
  matchedContentCount: number;
}

export interface DayPlatformFacet {
  day: string;
  platform: string;
  count: number;
  matchedContentCount: number;
}

export interface SessionPayload {
  user: Actor | null;
  publicRead?: boolean;
  publicRegistration?: boolean;
  turnstileSiteKey?: string;
  mfaActive?: boolean;
}

export interface ProjectOverviewResponse {
  project: Project;
  contentCount: number;
  matchedContentCount: number;
  facets: OverviewFacet[];
  dayPlatformFacets?: DayPlatformFacet[];
  providers: string[];
  resolvedFilter: ContentFilter;
  coverage: 'stored_sample';
  threadAware: boolean;
}

export interface ContentAuthor {
  externalId: string | null;
  handle: string | null;
  displayName: string | null;
  url: string | null;
}

export interface ContentObservation {
  sourceId: string;
  provider: ProviderName;
  sourceObservedAt: string | null;
  fetchedAt: string;
  timeBasis: string;
  maturity: string;
  metrics: Record<string, number | null>;
  evidenceKey: string;
}

export interface PublicContent {
  id: string;
  platform: Platform;
  kind: ContentKind;
  externalId: string;
  title: string | null;
  text: string | null;
  url: string | null;
  language: string | null;
  author: ContentAuthor | null;
  publishedAt: string | null;
  firstFetchedAt: string;
  lastFetchedAt: string;
  availability: 'available' | 'removed' | 'deleted' | 'unknown';
  textState: 'full' | 'missing' | 'summary' | 'truncated';
  contextMissing?: boolean;
  references: Array<{ type: string; targetId?: string; url?: string }>;
  media: Array<{
    type: string;
    url: string;
    previewUrl?: string | null;
    altText?: string | null;
    durationSeconds?: number | null;
  }>;
  platformDetails: Record<string, unknown>;
  observations: ContentObservation[];
}

export interface ContentListResponse {
  items: PublicContent[];
  nextCursor: string | null;
  totalMatching: null;
  resolvedFilter: Record<string, unknown>;
  coverage: 'stored_sample';
}

export interface ThreadNode {
  item: PublicContent;
  depth: number;
  parentId: string | null;
  contextMissing: boolean;
  matched: boolean;
}

export interface ContentThreadResponse {
  root: PublicContent;
  nodes: ThreadNode[];
  contextMissing: boolean;
  capped: boolean;
}

export interface ExportJsonResult {
  items: PublicContent[];
  result: {
    exportedCount: number;
    truncated: boolean;
    nextCursor: string | null;
    complete: boolean;
  };
}

export type JobStatus = 'queued' | 'running' | 'retrying' | 'succeeded' | 'completed' | 'failed' | 'cancelled';
export type ProviderPhase = 'idle' | 'starting' | 'running' | 'reading' | 'unknown' | 'done' | 'failed';

export interface SourceJob {
  id: string;
  source_id: string;
  purpose?: string;
  status: JobStatus;
  operation: 'collect' | 'radar' | 'refresh' | 'hydrate' | 'ingest';
  provider: ProviderName;
  provider_state: {
    phase?: ProviderPhase;
    runId?: string;
  };
  phase?: ProviderPhase;
  next_run_at?: string | null;
  request_count?: number;
  records_processed: number;
  records_inserted?: number;
  records_updated?: number;
  error: string | null;
  result_summary?: {
    warning?: string;
    provider_run_id?: string;
    creditsUsed?: number;
  };
  request_json?: Record<string, unknown>;
  created_at: string;
}

export interface ProviderBudget {
  provider: PullProviderName;
  enabled: boolean;
  daily_requests: number;
  monthly_requests: number;
  daily_resources: number;
  monthly_resources: number;
  requests_today?: number;
  requests_month?: number;
  resources_today?: number;
  resources_month?: number;
  minimum_interval_ms: number;
  revision: number;
}

export interface SavedQueryDto {
  id: string;
  name: string;
  query: ContentFilter & { threadAware?: boolean; projectId?: string };
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface AnnotationSummary {
  content_id: string;
  favorite: boolean;
  note: string;
  revision: number;
  title: string | null;
  body_text: string | null;
  external_id: string;
}

export interface AnnotationDetail {
  favorite: boolean;
  note: string;
  revision: number;
}

export interface MachineKeyDto {
  id: string;
  label: string | null;
  scopes: MachineScope[];
  allowed_source_ids: string[] | null;
  expires_at: string;
}

// Validation helpers aligned with packages/contracts/src/source-content.ts
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hasControlChars(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export function isValidUuid(val: string): boolean {
  return UUID_V4_RE.test(val.trim());
}

export function validateSearchTerm(raw: string): string | null {
  const normalized = raw.normalize('NFKC').trim();
  if (!normalized) return null;
  if (hasControlChars(normalized)) {
    return 'Term cannot contain control characters.';
  }
  if (normalized.length > 200) {
    return 'Term length must be <= 200 characters.';
  }
  return null;
}

export function validateDateRange(from?: string, to?: string): string | null {
  if (!from || !to) return null;
  const f = Date.parse(from);
  const t = Date.parse(to);
  if (Number.isNaN(f) || Number.isNaN(t)) return 'Invalid ISO date format.';
  if (f >= t) return '"from" timestamp must be strictly earlier than "to".';
  return null;
}

export function validateFilterInput(filter: ContentFilter): string | null {
  if (filter.query) {
    const err = validateSearchTerm(filter.query);
    if (err) return `query: ${err}`;
  }
  const groups: Array<[string, string[] | undefined]> = [
    ['anyTerms', filter.anyTerms],
    ['allTerms', filter.allTerms],
    ['exclusions', filter.exclusions],
  ];
  for (const [label, arr] of groups) {
    if (!arr) continue;
    if (arr.length > 20) return `${label}: maximum 20 terms allowed.`;
    for (const item of arr) {
      const err = validateSearchTerm(item);
      if (err) return `${label} ("${item}"): ${err}`;
    }
  }
  return validateDateRange(filter.from, filter.to);
}

export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function generateUuidV4(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function formatSourceTarget(target: SourceTarget | undefined): string {
  if (!target) return '';
  switch (target.type) {
    case 'search': return target.query;
    case 'community': return target.community;
    case 'account': return target.account;
    case 'post': return target.postId;
    case 'feed': return target.url;
  }
}

export function formatContentAuthor(author: ContentAuthor | null | undefined): string {
  if (!author) return 'anonymous';
  if (author.handle) return `@${author.handle}`;
  if (author.displayName) return author.displayName;
  if (author.externalId) return `anon:${author.externalId.slice(0, 8)}`;
  return 'anonymous';
}

export function normalizeSourceJob(raw: Record<string, unknown>): SourceJob {
  const ps = (raw.provider_state ?? raw.providerState) as { phase?: ProviderPhase; runId?: string } | null | undefined;
  return {
    ...(raw as unknown as SourceJob),
    id: String(raw.id || ''),
    source_id: String(raw.source_id ?? raw.collection_source_id ?? ''),
    status: (raw.status as JobStatus) || 'queued',
    operation: (raw.operation as SourceJob['operation']) || 'collect',
    provider: (raw.provider as ProviderName) || 'external_ingest',
    provider_state: {
      phase: ps?.phase ?? (raw.phase as ProviderPhase | undefined),
      ...(ps?.runId ? { runId: ps.runId } : {}),
    },
    records_processed: Number(raw.records_processed ?? 0),
    error: raw.error ? String(raw.error) : null,
    created_at: String(raw.created_at ?? raw.createdAt ?? new Date().toISOString()),
  };
}

export type {
  DocCategory, DocKind, DocStatus, DocSummary, DocDetail, DocInput, DocPatch,
} from '../../../../packages/contracts/src/product-docs.js';

export type FeedMode = 'foryou' | 'hot' | 'following' | 'explore';
export type FeedCardLayout = 'hero_media' | 'quote_social' | 'discussion_thread' | 'link_preview' | 'compact_signal';
export type FeedEventType =
  | 'impression'
  | 'dwell'
  | 'open'
  | 'bookmark'
  | 'useful'
  | 'dismiss'
  | 'mute_source'
  | 'mute_topic'
  | 'mute_author';

export interface FeedCardDto {
  id: string;
  platform: Platform;
  cardLayout: FeedCardLayout;
  headline: string;
  tldr: string | null;
  url: string | null;
  media: Array<{
    type: 'image' | 'video' | 'audio' | 'link';
    url: string;
    previewUrl: string | null;
    domain: string | null;
  }>;
  discussion: {
    score: number | null;
    comments: number | null;
    views: number | null;
    likes: number | null;
    reposts: number | null;
    upvoteRatio: number | null;
    unifiedHeat: number;
    heatVelocity: 'surging' | 'rising' | 'steady';
  };
  author: {
    handle: string;
    displayName: string | null;
    avatarUrl: string | null;
    verified: boolean;
    followersCount: number | null;
  } | null;
  source: {
    id: string;
    label: string;
    community: string | null;
    flair: string | null;
    lane: string;
  };
  topCommentsPreview: Array<{ author: string; text: string; score: number | null }>;
  tags: string[];
  intentTag: 'discussion' | 'question' | 'comparison' | 'pain' | 'launch' | 'news' | null;
  publishedAt: string | null;
  reason: { channel: 'affinity' | 'hot' | 'explore' | 'rising' | 'following'; label: string };
  viewerState: { bookmarked: boolean; useful: boolean };
}

export interface FeedStreamResponseDto {
  mode: FeedMode;
  personalized: boolean;
  items: FeedCardDto[];
  meta: {
    candidateCount: number;
    unseenRemaining: number;
    exploreRatio: number;
    channelMix: Record<string, number>;
  };
}

export interface FeedHotResponseDto {
  window: string;
  from: string;
  to: string;
  totalCount: number;
  nextOffset: number | null;
  items: Array<{
    rank: number;
    card: FeedCardDto;
    sparkline: number[];
    corroborationCount: number;
  }>;
}

export interface FeedPreferencesDto {
  exploreRatio: number;
  followedTopics: string[];
  mutedSources: string[];
  mutedKeywords: string[];
  mutedAuthors: string[];
  includeNewsLane: boolean;
  updatedAt: string | null;
}

export interface FeedAdminSummaryDto {
  preferencesUsers: number;
  seenTotal: number;
  seenStale14d: number;
  seenDistinctUsers: number;
  affinityRows: number;
  eventsLast7d: number;
  staleEvents30d: number;
  eventBreakdown: Array<{ eventType: string; count7d: number }>;
  activeFeedLanes: Record<string, number>;
}

export interface PeriodDeltaDto {
  current: number;
  previous: number | null;
  delta: number | null;
  deltaPct: number | null;
  status: 'up' | 'down' | 'flat' | 'new' | 'unknown';
}

export interface MonitorPostRowDto {
  id: string;
  platform: Platform;
  kind: string;
  externalId: string;
  title: string | null;
  cleanExcerpt: string | null;
  url: string | null;
  publishedAt: string | null;
  authorHandle: string | null;
  authorDisplayName: string | null;
  authorAvatarUrl: string | null;
  authorVerified: boolean;
  authorFollowers: number | null;
  communityName: string | null;
  flair: string | null;
  externalDomain: string | null;
  intentTag: string | null;
  hashtags: string[];
  hasMedia: boolean;
  primaryMediaUrl: string | null;
  metricScore: number | null;
  metricComments: number | null;
  metricViews: number | null;
  metricLikes: number | null;
  metricReposts: number | null;
  metricBookmarks: number | null;
  upvoteRatio: number | null;
  engagementScore: number;
  discussionRatio: number;
  velocityScore: number;
  engagementRate?: { rate: number | null; basis: 'by_views' | 'by_followers' | 'unavailable' };
}

export interface AuthorDirectoryRowDto {
  platform: Platform;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  location: string | null;
  verified: boolean;
  followersCount: number | null;
  followingCount: number | null;
  statusesCount: number | null;
  postCount: number;
  avgEngagement: number;
  avgComments: number;
  totalLikesOrScore: number;
  totalViews: number;
  totalComments: number;
  totalReposts: number;
  totalBookmarks: number;
  topCommunities: string[];
  lastSeenAt: string;
}

export interface CommunityMatrixRowDto {
  subreddit: string;
  subscribers: number | null;
  postCount: number;
  uniqueAuthors: number;
  avgScore: number;
  avgComments: number;
  avgDiscussionRatio: number;
  p90Engagement: number;
  totalScore: number;
  totalComments: number;
  latestPostAt: string | null;
}

export interface MonitorOverviewResponseDto {
  monitor: IntelMonitorDto;
  window: { from: string; to: string; days: number; bucket: '6h' | '1d' };
  kpis: {
    posts: PeriodDeltaDto;
    comments: PeriodDeltaDto;
    totalEngagement: PeriodDeltaDto;
    views: PeriodDeltaDto;
    avgEngagementRate: number | null;
    discussionDepth: number;
  };
  timeline: Array<{
    bucketAt: string;
    platform: string;
    postCount: number;
    commentCount: number;
    sumScore: number;
    sumComments: number;
    sumViews: number;
    sumLikes: number;
  }>;
  shareOfVoice: Array<{ label: string; role: string; mentions: number; engagement: number; volumeShare: number; weightedShare: number }>;
  intentDistribution: Array<{ intent: string; count: number }>;
  geoCitedDomains: Array<{ domain: string; count: number; totalEngagement: number }>;
  cooccurringTerms: Array<{ term: string; count: number }>;
  topAuthors: AuthorDirectoryRowDto[];
  communities: CommunityMatrixRowDto[];
  coverage: {
    model: 'stored_sample';
    sampleSize: number;
    activeSources: number;
    totalSources: number;
    failedSources: number;
    lastSuccessAt: string | null;
  };
}

export interface MonitorPostsResponseDto {
  totalCount: number;
  nextOffset: number | null;
  items: MonitorPostRowDto[];
}

export interface AuthorProfileResponseDto {
  profile: AuthorDirectoryRowDto;
  er: { rate: number | null; basis: 'by_views' | 'by_followers' | 'unavailable' };
  timeline: Array<{ bucketAt: string; platform: string; postCount: number; sumScore: number; sumComments: number; sumViews: number; sumLikes: number }>;
  topPosts: MonitorPostRowDto[];
}

export interface CommunityDeepDiveResponseDto {
  subreddit: string;
  summary: CommunityMatrixRowDto;
  trend: Array<{ bucketAt: string; platform: string; postCount: number; sumScore: number; sumComments: number }>;
  flairs: Array<{ flair: string; count: number; avgScore: number }>;
  postingHeatmap: Array<{ dow: number; hour: number; count: number; avgEngagement: number }>;
  topAuthors: AuthorDirectoryRowDto[];
  topPosts: MonitorPostRowDto[];
}

export interface IntelligenceOpsSummaryDto {
  monitors: Array<{
    id: string;
    name: string;
    kind: 'keyword' | 'author_list' | 'community_bundle';
    ownerUserId: string;
    ownerEmail: string | null;
    ownerRole: string | null;
    projectId: string | null;
    enabled: boolean;
    pausedReason: string | null;
    scheduleIntervalHours: number;
    dailyItemBudget: number;
    lastDispatchedAt: string | null;
    nextDueAt: string | null;
    revision: number;
    requestsToday: number;
    resourcesToday: number;
    sourceCount: number;
  }>;
  rollups: {
    totalBuckets: number;
    buckets6h: number;
    buckets1d: number;
    distinctMonitors: number;
    latestUpdatedAt: string | null;
  };
  automation: {
    dailySocialItemCeiling: number;
    autoHydrationEnabled: boolean;
    socialResourcesReservedToday: number;
    hydrateQueuedOrRunning: number;
    hydrateSucceededToday: number;
    hydrateFailedToday: number;
    scheduledJobsToday: number;
  };
}
