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

export interface Actor {
  userId: string;
  email: string;
  role: Role;
  clientKind: ClientKind;
  sessionId: string;
  scopes: string[];
  allowedSourceIds: string[] | null;
}

export interface SourceCapability {
  platform: Platform;
  provider: PullProviderName;
  enabled: boolean;
  targetTypes: TargetType[];
  contentKinds: ContentKind[];
  maxLimit: number;
  supportsComments: boolean;
  maxCommentsPerPost: number | null;
  postOnlyComments?: boolean;
  nonPostLimit?: number;
  refreshByIds: boolean;
  automaticRequestReplay: boolean;
  fallbackAllowed: FallbackProviderName[];
  metrics: Array<{ key: string; direction?: 'higher' | 'lower' }>;
  notes?: string;
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
  platform?: Platform;
  kind?: ContentKind;
  query?: string;
  anyTerms?: string[];
  allTerms?: string[];
  exclusions?: string[];
  searchScope?: SearchScope;
  signal?: SignalType;
  from?: string;
  to?: string;
}

export interface ListQuery extends ContentFilter {
  projectId?: string;
  sourceId?: string;
  threadAware?: boolean;
  limit?: number;
  cursor?: string;
}

export interface Project {
  id: string;
  name: string;
  filter: ContentFilter;
  revision: number;
  thread_aware: boolean;
  include_push_in_trends: boolean;
  source_ids: string[];
  owner_user_id?: string | null;
  hydration?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface ProjectInput {
  name: string;
  sourceIds: string[];
  filter: ContentFilter;
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

export interface ProjectOverviewResponse {
  project: Project;
  contentCount: number;
  matchedContentCount: number;
  facets: OverviewFacet[];
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
  media: Array<{ type: string; url: string }>;
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

export interface SourceTarget {
  type: TargetType;
  value: string;
  subreddit?: string;
  query?: string;
  handle?: string;
  postId?: string;
  url?: string;
}

export interface CollectionSource {
  id: string;
  platform: Platform;
  primary_provider: ProviderName;
  fallback_provider: FallbackProviderName | null;
  label: string;
  target: SourceTarget;
  content_kind: ContentKind;
  delivery_mode: DeliveryMode;
  state: SourceState;
  automatic_collection_blocked: boolean;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface SourceInput {
  platform: Platform;
  primaryProvider: ProviderName;
  fallbackProvider?: FallbackProviderName;
  label: string;
  target: SourceTarget;
  contentKind: ContentKind;
  deliveryMode: DeliveryMode;
}

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type ProviderPhase = 'idle' | 'starting' | 'running' | 'reading' | 'unknown' | 'done' | 'failed';

export interface SourceJob {
  id: string;
  source_id: string;
  status: JobStatus;
  operation: 'collect' | 'refresh' | 'hydrate' | 'ingest';
  provider: ProviderName;
  provider_state: {
    phase: ProviderPhase;
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
  used_daily_requests?: number;
  used_monthly_requests?: number;
  used_daily_resources?: number;
  used_monthly_resources?: number;
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

// Authoritative capability matrix from Section 3.3.2
export const DEFAULT_CAPABILITIES: SourceCapability[] = [
  {
    platform: 'reddit',
    provider: 'kaix',
    enabled: true,
    targetTypes: ['community', 'account', 'post', 'search'],
    contentKinds: ['post', 'comment'],
    maxLimit: 300,
    supportsComments: true,
    maxCommentsPerPost: 50,
    refreshByIds: true,
    automaticRequestReplay: false,
    fallbackAllowed: ['red_crawler'],
    metrics: [
      { key: 'reddit.score', direction: 'higher' },
      { key: 'reddit.num_comments', direction: 'higher' },
      { key: 'reddit.upvote_ratio', direction: 'higher' },
    ],
    notes: 'Search limit * (comments ? maxC + 1 : 1) <= 2000; single post up to 50 comments.',
  },
  {
    platform: 'reddit',
    provider: 'red_crawler',
    enabled: true,
    targetTypes: ['community', 'account', 'post', 'search'],
    contentKinds: ['post', 'comment'],
    maxLimit: 100,
    nonPostLimit: 100,
    supportsComments: true,
    postOnlyComments: true,
    maxCommentsPerPost: 50,
    refreshByIds: false,
    automaticRequestReplay: false,
    fallbackAllowed: [],
    metrics: [
      { key: 'reddit.score', direction: 'higher' },
      { key: 'reddit.num_comments', direction: 'higher' },
      { key: 'reddit.upvote_ratio', direction: 'higher' },
    ],
    notes: 'Non-post targets max 100 & disallow comments; post target max 50 comments.',
  },
  {
    platform: 'x',
    provider: 'twitterapis',
    enabled: true,
    targetTypes: ['search', 'account'],
    contentKinds: ['post'],
    maxLimit: 20,
    supportsComments: false,
    maxCommentsPerPost: null,
    refreshByIds: false,
    automaticRequestReplay: false,
    fallbackAllowed: ['scrapebadger'],
    metrics: [
      { key: 'x.likes', direction: 'higher' },
      { key: 'x.reposts', direction: 'higher' },
      { key: 'x.replies', direction: 'higher' },
      { key: 'x.quotes', direction: 'higher' },
      { key: 'x.views', direction: 'higher' },
      { key: 'x.bookmarks', direction: 'higher' },
    ],
    notes: 'limit <= 20, comments disabled.',
  },
  {
    platform: 'x',
    provider: 'scrapebadger',
    enabled: true,
    targetTypes: ['search', 'account'],
    contentKinds: ['post'],
    maxLimit: 100,
    supportsComments: false,
    maxCommentsPerPost: null,
    refreshByIds: true,
    automaticRequestReplay: false,
    fallbackAllowed: [],
    metrics: [
      { key: 'x.likes', direction: 'higher' },
      { key: 'x.reposts', direction: 'higher' },
      { key: 'x.replies', direction: 'higher' },
      { key: 'x.quotes', direction: 'higher' },
      { key: 'x.views', direction: 'higher' },
      { key: 'x.bookmarks', direction: 'higher' },
    ],
    notes: 'limit <= 100, supports refreshByIds (1..20 IDs).',
  },
  {
    platform: 'web',
    provider: 'newsnow',
    enabled: true,
    targetTypes: ['search'],
    contentKinds: ['article'],
    maxLimit: 30,
    supportsComments: false,
    maxCommentsPerPost: null,
    refreshByIds: false,
    automaticRequestReplay: true,
    fallbackAllowed: [],
    metrics: [{ key: 'web.rank', direction: 'lower' }],
    notes: 'search target query="hackernews", limit <= 30.',
  },
  {
    platform: 'web',
    provider: 'feed',
    enabled: true,
    targetTypes: ['feed'],
    contentKinds: ['article'],
    maxLimit: 30,
    supportsComments: false,
    maxCommentsPerPost: null,
    refreshByIds: false,
    automaticRequestReplay: true,
    fallbackAllowed: [],
    metrics: [],
    notes: 'Only allowlisted HTTPS URLs in FEED_ALLOWED_URLS; limit <= 30.',
  },
  {
    platform: 'bluesky',
    provider: 'bluesky_appview',
    enabled: true,
    targetTypes: ['account'],
    contentKinds: ['post'],
    maxLimit: 100,
    supportsComments: false,
    maxCommentsPerPost: null,
    refreshByIds: false,
    automaticRequestReplay: true,
    fallbackAllowed: [],
    metrics: [
      { key: 'bluesky.likes', direction: 'higher' },
      { key: 'bluesky.replies', direction: 'higher' },
      { key: 'bluesky.reposts', direction: 'higher' },
      { key: 'bluesky.quotes', direction: 'higher' },
    ],
    notes: 'Account handle or did:, limit <= 100.',
  },
];

// Validation helpers matching Section 5.2 & Section 3
const THREE_ALNUM_RE = /[\p{L}\p{N}]{3}/u;
const CONTROL_CHARS_RE = /[\u0000-\u001F\u007F]/;
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUuid(val: string): boolean {
  return UUID_V4_RE.test(val.trim());
}

export function validateSearchTerm(raw: string): string | null {
  const normalized = raw.normalize('NFKC').trim();
  if (!normalized) return null;
  if (CONTROL_CHARS_RE.test(normalized)) {
    return 'Term cannot contain control characters.';
  }
  if (normalized.length > 200) {
    return 'Term length must be <= 200 characters.';
  }
  if (!THREE_ALNUM_RE.test(normalized)) {
    return 'Term must contain at least 3 consecutive Unicode letters or digits.';
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
