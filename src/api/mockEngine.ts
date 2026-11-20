import {
  Actor,
  AnnotationDetail,
  AnnotationSummary,
  ApiError,
  CapabilitiesResponse,
  CollectionSource,
  ContentKind,
  ContentListResponse,
  ContentObservation,
  ContentThreadResponse,
  DEFAULT_CAPABILITIES,
  ExportJsonResult,
  ListQuery,
  MachineKeyDto,
  MachineScope,
  OverviewFacet,
  Platform,
  Project,
  ProjectInput,
  ProjectOverviewResponse,
  ProviderBudget,
  ProviderName,
  PublicContent,
  PullProviderName,
  Role,
  SavedQueryDto,
  SourceInput,
  SourceJob,
  ThreadNode,
  generateUuidV4,
  utf8ByteLength,
  validateFilterInput,
} from '../contracts/api';

const PAIN_RE =
  /\b(broken|bug|slow|expensive|pricing|sucks|frustrated|unusable|churn|blocked|timeout|hate|pain|issue|fail(?:ed|ing)?|refund)\b|崩溃|卡顿|太贵|难用|踩坑|报错|封号|吐槽/i;

function isPainSignal(item: PublicContent): boolean {
  const hay = `${item.title || ''} ${item.text || ''}`;
  if (PAIN_RE.test(hay)) return true;
  for (const obs of item.observations) {
    const score = obs.metrics['reddit.score'];
    const numComments = obs.metrics['reddit.num_comments'];
    if (
      item.platform === 'reddit' &&
      typeof score === 'number' &&
      typeof numComments === 'number' &&
      numComments >= Math.max(score, 1)
    ) {
      return true;
    }
  }
  return false;
}

function isDiscussionSignal(item: PublicContent): boolean {
  for (const obs of item.observations) {
    const rc = obs.metrics['reddit.num_comments'];
    const xr = obs.metrics['x.replies'];
    if (typeof rc === 'number' && rc >= 10) return true;
    if (typeof xr === 'number' && xr >= 5) return true;
  }
  return false;
}

function matchesTerms(item: PublicContent, filter: ListQuery): boolean {
  if (filter.platform && item.platform !== filter.platform) return false;
  if (filter.kind && item.kind !== filter.kind) return false;
  if (filter.sourceId && !item.observations.some((o) => o.sourceId === filter.sourceId)) return false;
  if (filter.sourceIds && filter.sourceIds.length > 0) {
    if (!item.observations.some((o) => filter.sourceIds!.includes(o.sourceId))) return false;
  }
  if (filter.from || filter.to) {
    if (!item.publishedAt) return false;
    const pub = Date.parse(item.publishedAt);
    if (filter.from && pub < Date.parse(filter.from)) return false;
    if (filter.to && pub >= Date.parse(filter.to)) return false;
  }
  if (filter.signal === 'pain' && !isPainSignal(item)) return false;
  if (filter.signal === 'discussion' && !isDiscussionSignal(item)) return false;

  const scope = filter.searchScope || 'title_text';
  const titleStr = (item.title || '').normalize('NFKC').toLowerCase();
  const textStr = (item.text || '').normalize('NFKC').toLowerCase();
  const matchSingle = (term: string) => {
    const needle = term.normalize('NFKC').trim().toLowerCase();
    if (!needle) return true;
    if (scope === 'title') return titleStr.includes(needle);
    if (scope === 'text') return textStr.includes(needle);
    // Do not match across U+001F separator
    return `${titleStr}\u001f${textStr}`.includes(needle);
  };

  if (filter.query && !matchSingle(filter.query)) return false;
  if (filter.anyTerms && filter.anyTerms.length > 0) {
    if (!filter.anyTerms.some(matchSingle)) return false;
  }
  if (filter.allTerms && filter.allTerms.length > 0) {
    if (!filter.allTerms.every(matchSingle)) return false;
  }
  if (filter.exclusions && filter.exclusions.length > 0) {
    if (filter.exclusions.some(matchSingle)) return false;
  }
  return true;
}

const SRC_REDDIT_KAIX = '11111111-1111-4111-8111-111111111101';
const SRC_REDDIT_RED = '11111111-1111-4111-8111-111111111102';
const SRC_X_SCRAPE = '11111111-1111-4111-8111-111111111103';
const SRC_BSKY = '11111111-1111-4111-8111-111111111104';
const SRC_WEB_HN = '11111111-1111-4111-8111-111111111105';
const SRC_PUSH_EXT = '11111111-1111-4111-8111-111111111106';

const PROJ_FINOPS = '22222222-2222-4222-8222-222222222201';
const PROJ_AGENT = '22222222-2222-4222-8222-222222222202';

const POST_1 = '33333333-3333-4333-8333-333333333301';
const POST_1_C1 = '33333333-3333-4333-8333-333333333302';
const POST_1_C2 = '33333333-3333-4333-8333-333333333303';
const POST_1_C3 = '33333333-3333-4333-8333-333333333304';
const POST_2 = '33333333-3333-4333-8333-333333333305';
const POST_3 = '33333333-3333-4333-8333-333333333306';
const POST_4 = '33333333-3333-4333-8333-333333333307';
const POST_5 = '33333333-3333-4333-8333-333333333308';
const POST_6 = '33333333-3333-4333-8333-333333333309';
const POST_7 = '33333333-3333-4333-8333-333333333310';
const POST_8 = '33333333-3333-4333-8333-333333333311';
const ORPHAN_C = '33333333-3333-4333-8333-333333333312';

interface MockState {
  actor: Actor | null;
  sources: CollectionSource[];
  projects: Project[];
  content: PublicContent[];
  threadLinks: Record<string, { rootId: string; parentId: string | null; depth: number }>;
  jobs: SourceJob[];
  budgets: ProviderBudget[];
  queries: SavedQueryDto[];
  annotations: Record<string, AnnotationDetail>;
  keys: Array<MachineKeyDto & { ownerId: string }>;
  invites: Record<string, Role>;
  idempotencyCache: Map<string, { sig: string; response: unknown }>;
}

function createInitialState(): MockState {
  const sources: CollectionSource[] = [
    {
      id: SRC_REDDIT_KAIX,
      platform: 'reddit',
      primary_provider: 'kaix',
      fallback_provider: 'red_crawler',
      label: 'r/SaaS & r/devops · Billing & SDK Pain',
      target: { type: 'community', value: 'SaaS', subreddit: 'SaaS' },
      content_kind: 'post',
      delivery_mode: 'pull',
      state: 'active',
      automatic_collection_blocked: false,
      revision: 3,
      created_at: '2026-11-01T08:00:00Z',
      updated_at: '2026-11-17T10:15:00Z',
    },
    {
      id: SRC_REDDIT_RED,
      platform: 'reddit',
      primary_provider: 'red_crawler',
      fallback_provider: null,
      label: 'r/LocalLLaMA · Inference Latency Monitor',
      target: { type: 'search', value: 'latency OR quantization', query: 'latency OR quantization' },
      content_kind: 'post',
      delivery_mode: 'pull',
      state: 'active',
      automatic_collection_blocked: true,
      revision: 2,
      created_at: '2026-11-03T09:20:00Z',
      updated_at: '2026-11-18T02:10:00Z',
    },
    {
      id: SRC_X_SCRAPE,
      platform: 'x',
      primary_provider: 'twitterapis',
      fallback_provider: 'scrapebadger',
      label: 'X · Cloud FinOps & Observability Complaints',
      target: { type: 'search', value: 'datadog pricing OR snowflake cost', query: 'datadog pricing OR snowflake cost' },
      content_kind: 'post',
      delivery_mode: 'pull',
      state: 'active',
      automatic_collection_blocked: false,
      revision: 4,
      created_at: '2026-11-02T12:00:00Z',
      updated_at: '2026-11-18T06:00:00Z',
    },
    {
      id: SRC_BSKY,
      platform: 'bluesky',
      primary_provider: 'bluesky_appview',
      fallback_provider: null,
      label: 'Bluesky · DevTools Founders Feed',
      target: { type: 'account', value: 'devtools.bsky.social', handle: 'devtools.bsky.social' },
      content_kind: 'post',
      delivery_mode: 'pull',
      state: 'active',
      automatic_collection_blocked: false,
      revision: 1,
      created_at: '2026-11-05T14:30:00Z',
      updated_at: '2026-11-16T18:00:00Z',
    },
    {
      id: SRC_WEB_HN,
      platform: 'web',
      primary_provider: 'newsnow',
      fallback_provider: null,
      label: 'Hacker News Frontpage Index',
      target: { type: 'search', value: 'hackernews', query: 'hackernews' },
      content_kind: 'article',
      delivery_mode: 'pull',
      state: 'active',
      automatic_collection_blocked: false,
      revision: 2,
      created_at: '2026-11-04T06:00:00Z',
      updated_at: '2026-11-18T04:30:00Z',
    },
    {
      id: SRC_PUSH_EXT,
      platform: 'web',
      primary_provider: 'external_ingest',
      fallback_provider: null,
      label: 'Partner Support Tickets (Push Ingest)',
      target: { type: 'feed', value: 'https://ingest.internal/support-bridge', url: 'https://ingest.internal/support-bridge' },
      content_kind: 'article',
      delivery_mode: 'push',
      state: 'active',
      automatic_collection_blocked: false,
      revision: 1,
      created_at: '2026-11-08T10:00:00Z',
      updated_at: '2026-11-15T11:20:00Z',
    },
  ];

  const projects: Project[] = [
    {
      id: PROJ_FINOPS,
      name: 'Cloud Pricing & Billing Friction Radar',
      filter: {
        anyTerms: ['pricing', 'billing', 'expensive', 'churn', 'cost'],
        searchScope: 'title_text',
      },
      revision: 5,
      thread_aware: true,
      include_push_in_trends: false,
      source_ids: [SRC_REDDIT_KAIX, SRC_X_SCRAPE, SRC_WEB_HN, SRC_PUSH_EXT],
      owner_user_id: '00000000-0000-4000-8000-000000000001',
      created_at: '2026-11-02T09:00:00Z',
      updated_at: '2026-11-18T07:15:00Z',
    },
    {
      id: PROJ_AGENT,
      name: 'LLM Inference & SDK Latency Signals',
      filter: {
        anyTerms: ['latency', 'timeout', 'quantization', 'sdk', 'agent'],
        searchScope: 'title_text',
      },
      revision: 2,
      thread_aware: true,
      include_push_in_trends: true,
      source_ids: [SRC_REDDIT_RED, SRC_BSKY, SRC_WEB_HN, SRC_PUSH_EXT],
      owner_user_id: '00000000-0000-4000-8000-000000000001',
      created_at: '2026-11-06T11:00:00Z',
      updated_at: '2026-11-17T22:00:00Z',
    },
    {
      id: '22222222-2222-4222-8222-222222222203',
      name: 'Smart Hardware · Cleaning & Design Pain',
      filter: {
        anyTerms: ['cleaning', 'latch', 'edge', 'filter', '猫砂盆', '清洁'],
        searchScope: 'title_text',
      },
      revision: 4,
      thread_aware: true,
      include_push_in_trends: false,
      source_ids: [SRC_REDDIT_KAIX, SRC_X_SCRAPE, SRC_BSKY, SRC_WEB_HN, SRC_PUSH_EXT],
      owner_user_id: '00000000-0000-4000-8000-000000000001',
      created_at: '2026-10-20T08:00:00Z',
      updated_at: '2026-11-18T09:12:00Z',
    },
  ];

  const content: PublicContent[] = [
    {
      id: POST_1,
      platform: 'reddit',
      kind: 'post',
      externalId: 't3_1g9k2ab',
      title: 'Why are observability vendors charging 4x for custom metrics cardinality?',
      text: 'Our billing jumped $18k/month after adding 3 Kubernetes labels. Seriously considering migrating away — pricing predictability is completely broken for mid-sized engineering teams.',
      url: 'https://reddit.com/r/devops/comments/1g9k2ab',
      language: 'en',
      author: {
        externalId: 'u_infra_lead',
        handle: 'infra_lead_ops',
        displayName: 'Infra Lead',
        url: 'https://reddit.com/u/infra_lead_ops',
      },
      publishedAt: '2026-11-10T14:22:00Z',
      firstFetchedAt: '2026-11-10T15:00:00Z',
      lastFetchedAt: '2026-11-18T06:00:00Z',
      availability: 'available',
      textState: 'full',
      references: [],
      media: [],
      platformDetails: { subreddit: 'devops', fullname: 't3_1g9k2ab', is_self: true },
      observations: [
        {
          sourceId: SRC_REDDIT_KAIX,
          provider: 'kaix',
          sourceObservedAt: '2026-11-10T15:00:00Z',
          fetchedAt: '2026-11-10T15:02:00Z',
          timeBasis: 'provider_snapshot',
          maturity: 'initial',
          metrics: { 'reddit.score': 142, 'reddit.num_comments': 48, 'reddit.upvote_ratio': 0.91 },
          evidenceKey: 'ev_1001',
        },
        {
          sourceId: SRC_REDDIT_KAIX,
          provider: 'kaix',
          sourceObservedAt: '2026-11-12T15:00:00Z',
          fetchedAt: '2026-11-12T15:03:00Z',
          timeBasis: 'provider_snapshot',
          maturity: 'mature',
          metrics: { 'reddit.score': 318, 'reddit.num_comments': 114, 'reddit.upvote_ratio': 0.94 },
          evidenceKey: 'ev_1002',
        },
        {
          sourceId: SRC_REDDIT_KAIX,
          provider: 'kaix',
          sourceObservedAt: null,
          fetchedAt: '2026-11-15T15:00:00Z',
          timeBasis: 'archive_initial',
          maturity: 'mature',
          metrics: { 'reddit.score': 345, 'reddit.num_comments': null, 'reddit.upvote_ratio': 0.94 },
          evidenceKey: 'ev_1003',
        },
        {
          sourceId: SRC_REDDIT_KAIX,
          provider: 'red_crawler',
          sourceObservedAt: '2026-11-17T12:00:00Z',
          fetchedAt: '2026-11-17T12:01:00Z',
          timeBasis: 'provider_snapshot',
          maturity: 'final',
          metrics: { 'reddit.score': 352, 'reddit.num_comments': 129, 'reddit.upvote_ratio': 0.95 },
          evidenceKey: 'ev_1004',
        },
      ],
    },
    {
      id: POST_1_C1,
      platform: 'reddit',
      kind: 'comment',
      externalId: 't1_k92aa1',
      title: null,
      text: 'Exact same pain point here. We wrote a pre-aggregation proxy because the per-series pricing model punished normal deployment rollouts.',
      url: 'https://reddit.com/r/devops/comments/1g9k2ab/comment/k92aa1',
      language: 'en',
      author: {
        externalId: 'u_sre_marta',
        handle: 'sre_marta',
        displayName: 'Marta Chen',
        url: 'https://reddit.com/u/sre_marta',
      },
      publishedAt: '2026-11-10T16:05:00Z',
      firstFetchedAt: '2026-11-11T08:00:00Z',
      lastFetchedAt: '2026-11-17T12:00:00Z',
      availability: 'available',
      textState: 'full',
      references: [{ type: 'reply_to', targetId: POST_1 }],
      media: [],
      platformDetails: { subreddit: 'devops', parent_id: 't3_1g9k2ab' },
      observations: [
        {
          sourceId: SRC_REDDIT_KAIX,
          provider: 'kaix',
          sourceObservedAt: '2026-11-12T15:00:00Z',
          fetchedAt: '2026-11-12T15:03:00Z',
          timeBasis: 'provider_snapshot',
          maturity: 'mature',
          metrics: { 'reddit.score': 94, 'reddit.num_comments': 6, 'reddit.upvote_ratio': null },
          evidenceKey: 'ev_c1',
        },
      ],
    },
    {
      id: POST_1_C2,
      platform: 'reddit',
      kind: 'comment',
      externalId: 't1_k92ab8',
      title: null,
      text: 'Did you test OpenTelemetry Collector tail sampling before switching? Curious if that cut your billing overage without dropping error traces.',
      url: 'https://reddit.com/r/devops/comments/1g9k2ab/comment/k92ab8',
      language: 'en',
      author: {
        externalId: 'u_infra_lead',
        handle: 'infra_lead_ops',
        displayName: 'Infra Lead',
        url: 'https://reddit.com/u/infra_lead_ops',
      },
      publishedAt: '2026-11-12T09:12:00Z',
      firstFetchedAt: '2026-11-12T15:03:00Z',
      lastFetchedAt: '2026-11-17T12:00:00Z',
      availability: 'available',
      textState: 'full',
      references: [{ type: 'reply_to', targetId: POST_1_C1 }],
      media: [],
      platformDetails: { subreddit: 'devops', parent_id: 't1_k92aa1' },
      observations: [
        {
          sourceId: SRC_REDDIT_KAIX,
          provider: 'kaix',
          sourceObservedAt: '2026-11-12T15:00:00Z',
          fetchedAt: '2026-11-12T15:03:00Z',
          timeBasis: 'provider_snapshot',
          maturity: 'mature',
          metrics: { 'reddit.score': 41, 'reddit.num_comments': 2 },
          evidenceKey: 'ev_c2',
        },
      ],
    },
    {
      id: POST_1_C3,
      platform: 'reddit',
      kind: 'comment',
      externalId: 't1_k92ac4',
      title: null,
      text: 'Yes — tail sampling cut ingest cost by 62% within 48 hours. Zero churn risk once cardinality alerts were enforced in CI.',
      url: 'https://reddit.com/r/devops/comments/1g9k2ab/comment/k92ac4',
      language: 'en',
      author: {
        externalId: 'u_sre_marta',
        handle: 'sre_marta',
        displayName: 'Marta Chen',
        url: 'https://reddit.com/u/sre_marta',
      },
      publishedAt: '2026-11-14T11:40:00Z',
      firstFetchedAt: '2026-11-14T12:00:00Z',
      lastFetchedAt: '2026-11-17T12:00:00Z',
      availability: 'available',
      textState: 'full',
      references: [{ type: 'reply_to', targetId: POST_1_C2 }],
      media: [],
      platformDetails: { subreddit: 'devops', parent_id: 't1_k92ab8' },
      observations: [
        {
          sourceId: SRC_REDDIT_KAIX,
          provider: 'kaix',
          sourceObservedAt: '2026-11-14T12:00:00Z',
          fetchedAt: '2026-11-14T12:02:00Z',
          timeBasis: 'provider_snapshot',
          maturity: 'mature',
          metrics: { 'reddit.score': 67, 'reddit.num_comments': 0 },
          evidenceKey: 'ev_c3',
        },
      ],
    },
    {
      id: POST_2,
      platform: 'reddit',
      kind: 'post',
      externalId: 't3_1g9z88q',
      title: 'Seat-based pricing vs usage tiers in B2B SaaS — what actually stops early churn?',
      text: 'Founders keep saying seat pricing causes friction for read-only stakeholders, yet usage billing scares finance teams with unpredictable spikes.',
      url: 'https://reddit.com/r/SaaS/comments/1g9z88q',
      language: 'en',
      author: {
        externalId: 'u_revops_dan',
        handle: 'revops_dan',
        displayName: 'Dan Kowalski',
        url: 'https://reddit.com/u/revops_dan',
      },
      publishedAt: '2026-11-11T10:15:00Z',
      firstFetchedAt: '2026-11-11T12:00:00Z',
      lastFetchedAt: '2026-11-16T08:00:00Z',
      availability: 'available',
      textState: 'full',
      references: [],
      media: [],
      platformDetails: { subreddit: 'SaaS', fullname: 't3_1g9z88q' },
      observations: [
        {
          sourceId: SRC_REDDIT_KAIX,
          provider: 'kaix',
          sourceObservedAt: '2026-11-11T12:00:00Z',
          fetchedAt: '2026-11-11T12:04:00Z',
          timeBasis: 'provider_snapshot',
          maturity: 'initial',
          metrics: { 'reddit.score': 28, 'reddit.num_comments': 37, 'reddit.upvote_ratio': 0.89 },
          evidenceKey: 'ev_2001',
        },
      ],
    },
    {
      id: POST_3,
      platform: 'x',
      kind: 'post',
      externalId: '1857392011442',
      title: null,
      text: 'Every FinOps review this quarter starts with the same complaint: cloud egress and metrics billing surprises eating 30% of infra budget. Predictable cost caps win renewals.',
      url: 'https://x.com/finops_radar/status/1857392011442',
      language: 'en',
      author: {
        externalId: 'x_9921',
        handle: 'finops_radar',
        displayName: 'Elena Vance',
        url: 'https://x.com/finops_radar',
      },
      publishedAt: '2026-11-14T18:30:00Z',
      firstFetchedAt: '2026-11-14T19:00:00Z',
      lastFetchedAt: '2026-11-18T05:00:00Z',
      availability: 'available',
      textState: 'full',
      references: [],
      media: [],
      platformDetails: { conversation_id: '1857392011442' },
      observations: [
        {
          sourceId: SRC_X_SCRAPE,
          provider: 'twitterapis',
          sourceObservedAt: '2026-11-14T19:00:00Z',
          fetchedAt: '2026-11-14T19:01:00Z',
          timeBasis: 'provider_snapshot',
          maturity: 'initial',
          metrics: { 'x.likes': 412, 'x.reposts': 88, 'x.replies': 19, 'x.quotes': 14, 'x.views': 38200, 'x.bookmarks': 129 },
          evidenceKey: 'ev_x1',
        },
        {
          sourceId: SRC_X_SCRAPE,
          provider: 'scrapebadger',
          sourceObservedAt: '2026-11-17T08:00:00Z',
          fetchedAt: '2026-11-17T08:02:00Z',
          timeBasis: 'provider_snapshot',
          maturity: 'final',
          metrics: { 'x.likes': 629, 'x.reposts': 134, 'x.replies': 26, 'x.quotes': 21, 'x.views': 59400, 'x.bookmarks': 210 },
          evidenceKey: 'ev_x2',
        },
      ],
    },
    {
      id: POST_4,
      platform: 'x',
      kind: 'post',
      externalId: '1858110299012',
      title: null,
      text: 'Honest question: why is sandboxed AI agent SDK billing still opaque until the end of the billing cycle? Real-time cost guardrails should be table stakes.',
      url: 'https://x.com/buildwithkai/status/1858110299012',
      language: 'en',
      author: {
        externalId: 'x_4410',
        handle: 'buildwithkai',
        displayName: 'Kai Nakamura',
        url: 'https://x.com/buildwithkai',
      },
      publishedAt: '2026-11-15T12:45:00Z',
      firstFetchedAt: '2026-11-15T13:10:00Z',
      lastFetchedAt: '2026-11-17T10:00:00Z',
      availability: 'available',
      textState: 'full',
      references: [],
      media: [],
      platformDetails: { conversation_id: '1858110299012' },
      observations: [
        {
          sourceId: SRC_X_SCRAPE,
          provider: 'scrapebadger',
          sourceObservedAt: '2026-11-16T09:00:00Z',
          fetchedAt: '2026-11-16T09:01:00Z',
          timeBasis: 'provider_snapshot',
          maturity: 'mature',
          metrics: { 'x.likes': 198, 'x.reposts': 32, 'x.replies': 9, 'x.quotes': 4, 'x.views': 14200, 'x.bookmarks': 64 },
          evidenceKey: 'ev_x3',
        },
      ],
    },
    {
      id: POST_5,
      platform: 'web',
      kind: 'article',
      externalId: 'hn_42155902',
      title: 'Show HN: Cutting cloud billing spikes by 70% with deterministic query budgets',
      text: 'We audited 140 production clusters and found exponential retry storms and unbounded full-table scans were the top drivers of surprise cloud billing.',
      url: 'https://news.ycombinator.com/item?id=42155902',
      language: 'en',
      author: {
        externalId: 'hn_jklein',
        handle: 'jklein',
        displayName: 'Jonas Klein',
        url: 'https://news.ycombinator.com/user?id=jklein',
      },
      publishedAt: '2026-11-16T09:20:00Z',
      firstFetchedAt: '2026-11-16T09:45:00Z',
      lastFetchedAt: '2026-11-18T04:30:00Z',
      availability: 'available',
      textState: 'full',
      references: [],
      media: [],
      platformDetails: { rank: 4, hn_id: '42155902' },
      observations: [
        {
          sourceId: SRC_WEB_HN,
          provider: 'newsnow',
          sourceObservedAt: '2026-11-16T10:00:00Z',
          fetchedAt: '2026-11-16T10:01:00Z',
          timeBasis: 'provider_snapshot',
          maturity: 'initial',
          metrics: { 'web.rank': 4 },
          evidenceKey: 'ev_hn1',
        },
      ],
    },
    {
      id: POST_6,
      platform: 'bluesky',
      kind: 'post',
      externalId: 'at://did:plc:dev123/app.bsky.feed.post/3lb2xyz',
      title: null,
      text: 'Running quantized 32B models locally eliminated our API timeout failures and dropped per-agent inference latency under 320ms p95.',
      url: 'https://bsky.app/profile/devtools.bsky.social/post/3lb2xyz',
      language: 'en',
      author: {
        externalId: 'did:plc:dev123',
        handle: 'devtools.bsky.social',
        displayName: 'DevTools Collective',
        url: 'https://bsky.app/profile/devtools.bsky.social',
      },
      publishedAt: '2026-11-17T15:10:00Z',
      firstFetchedAt: '2026-11-17T15:30:00Z',
      lastFetchedAt: '2026-11-17T15:30:00Z',
      availability: 'available',
      textState: 'full',
      references: [],
      media: [],
      platformDetails: { uri: 'at://did:plc:dev123/app.bsky.feed.post/3lb2xyz' },
      observations: [
        {
          sourceId: SRC_BSKY,
          provider: 'bluesky_appview',
          sourceObservedAt: '2026-11-17T15:30:00Z',
          fetchedAt: '2026-11-17T15:30:00Z',
          timeBasis: 'provider_snapshot',
          maturity: 'initial',
          metrics: { 'bluesky.likes': 164, 'bluesky.replies': 18, 'bluesky.reposts': 43, 'bluesky.quotes': 7 },
          evidenceKey: 'ev_bsky1',
        },
      ],
    },
    {
      id: POST_7,
      platform: 'reddit',
      kind: 'post',
      externalId: 't3_1ga019m',
      title: 'vLLM speculative decoding latency regression after FP8 quantization update',
      text: 'Anyone else seeing sporadic timeout errors on long-context agent runs? Throughput improved but p99 latency got worse.',
      url: 'https://reddit.com/r/LocalLLaMA/comments/1ga019m',
      language: 'en',
      author: {
        externalId: 'u_cuda_bench',
        handle: 'cuda_bench',
        displayName: 'cuda_bench',
        url: 'https://reddit.com/u/cuda_bench',
      },
      publishedAt: '2026-11-17T19:00:00Z',
      firstFetchedAt: '2026-11-17T19:15:00Z',
      lastFetchedAt: '2026-11-18T02:00:00Z',
      availability: 'available',
      textState: 'full',
      references: [],
      media: [],
      platformDetails: { subreddit: 'LocalLLaMA', fullname: 't3_1ga019m' },
      observations: [
        {
          sourceId: SRC_REDDIT_RED,
          provider: 'red_crawler',
          sourceObservedAt: '2026-11-18T02:00:00Z',
          fetchedAt: '2026-11-18T02:01:00Z',
          timeBasis: 'provider_snapshot',
          maturity: 'initial',
          metrics: { 'reddit.score': 89, 'reddit.num_comments': 24, 'reddit.upvote_ratio': 0.96 },
          evidenceKey: 'ev_red1',
        },
      ],
    },
    {
      id: POST_8,
      platform: 'web',
      kind: 'article',
      externalId: 'ticket_99402',
      title: 'Enterprise Ticket #99402: Invoice export latency & billing seat overage confusion',
      text: 'Imported partner ticket noting customer confusion on billing tier thresholds and CSV export timeout on 40k-row datasets.',
      url: null,
      language: 'en',
      author: {
        externalId: 'agent_zd_12',
        handle: 'support_ops',
        displayName: 'Support Ops Bridge',
        url: null,
      },
      publishedAt: null, // Deliberately unknown publish time to exercise day === null facet bucket!
      firstFetchedAt: '2026-11-15T11:20:00Z',
      lastFetchedAt: '2026-11-15T11:20:00Z',
      availability: 'available',
      textState: 'summary',
      references: [],
      media: [],
      platformDetails: { ticket_priority: 'high', origin: 'zendesk_push' },
      observations: [
        {
          sourceId: SRC_PUSH_EXT,
          provider: 'external_ingest',
          sourceObservedAt: null,
          fetchedAt: '2026-11-15T11:20:00Z',
          timeBasis: 'ingest_import',
          maturity: 'static',
          metrics: {},
          evidenceKey: 'ev_push1',
        },
      ],
    },
    {
      id: ORPHAN_C,
      platform: 'reddit',
      kind: 'comment',
      externalId: 't1_orphan88',
      title: null,
      text: 'Legacy SDK billing hooks silently failed when rate limits triggered without retry-after backoff.',
      url: 'https://reddit.com/r/SaaS/comments/unknown/comment/orphan88',
      language: 'en',
      author: {
        externalId: 'u_legacy_dev',
        handle: 'legacy_dev',
        displayName: 'legacy_dev',
        url: null,
      },
      publishedAt: null, // Unknown publishedAt also in Reddit pull!
      firstFetchedAt: '2026-11-18T05:00:00Z',
      lastFetchedAt: '2026-11-18T05:00:00Z',
      availability: 'available',
      textState: 'full',
      contextMissing: true,
      references: [{ type: 'reply_to', targetId: 'missing-root-t3' }],
      media: [],
      platformDetails: { subreddit: 'SaaS', parent_id: 't3_deleted_root' },
      observations: [
        {
          sourceId: SRC_REDDIT_KAIX,
          provider: 'kaix',
          sourceObservedAt: '2026-11-18T05:00:00Z',
          fetchedAt: '2026-11-18T05:01:00Z',
          timeBasis: 'provider_snapshot',
          maturity: 'initial',
          metrics: { 'reddit.score': 12, 'reddit.num_comments': 14 },
          evidenceKey: 'ev_orp1',
        },
      ],
    },
  ];

  // Enrich multi-week stored_sample dataset across Oct 20 - Nov 18 (deliberate UTC gaps: 11-02, 11-03, 11-08)
  const SEED_DAYS = [
    '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24',
    '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29',
    '2026-10-30', '2026-10-31', '2026-11-01',
    // Gap days 2026-11-02 and 2026-11-03 intentionally uncollected (never zero-filled)
    '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07',
    // Gap day 2026-11-08 intentionally uncollected
    '2026-11-09', '2026-11-13', '2026-11-18',
  ];
  const SEED_TOPICS: Array<{
    platform: Platform;
    kind: ContentKind;
    sourceId: string;
    provider: ProviderName;
    secondProvider?: ProviderName;
    community: string;
    author: string;
    title: string;
    text: string;
    baseScore: number;
    comments: number;
  }> = [
    {
      platform: 'reddit',
      kind: 'post',
      sourceId: SRC_REDDIT_KAIX,
      provider: 'kaix',
      secondProvider: 'red_crawler',
      community: 'r/devops',
      author: 'u/FinOps_Alex',
      title: 'Telemetry cardinality billing audit saved us $41k/yr in custom metrics overage',
      text: 'Unexpected pricing tier jumps and slow billing invoice exports pushed our team to drop high-churn spans before hitting quota limits.',
      baseScore: 264,
      comments: 68,
    },
    {
      platform: 'x',
      kind: 'post',
      sourceId: SRC_X_SCRAPE,
      provider: 'scrapebadger',
      secondProvider: 'twitterapis',
      community: '@cloud_economics',
      author: '@maya_FinOps',
      title: 'Opaque usage pricing tables cause procurement friction for engineering leads',
      text: 'When cloud vendor billing lacks deterministic caps, mid-market accounts churn at renewal. latency + cost predictability go hand in hand.',
      baseScore: 192,
      comments: 42,
    },
    {
      platform: 'bluesky',
      kind: 'post',
      sourceId: SRC_BSKY,
      provider: 'bluesky_appview',
      community: 'bsky.app · devtools',
      author: '@sam_systems.bsky.social',
      title: 'Quantization + local caching cut agent SDK p95 latency and billing cost by 60%',
      text: 'Moving inference preprocessing local eliminated timeout retries and cut API pricing overhead dramatically.',
      baseScore: 118,
      comments: 29,
    },
    {
      platform: 'web',
      kind: 'article',
      sourceId: SRC_WEB_HN,
      provider: 'newsnow',
      community: 'news.ycombinator.com',
      author: 'hn_architect',
      title: 'Designing hard cost & timeout guardrails into multi-step SDK agents',
      text: 'Analysis of billing spikes, infinite retry loops, and agent timeout recovery patterns across 80 production deployments.',
      baseScore: 146,
      comments: 31,
    },
    {
      platform: 'reddit',
      kind: 'comment',
      sourceId: SRC_REDDIT_KAIX,
      provider: 'kaix',
      community: 'r/CatAdvice',
      author: 'u/mochi_mom',
      title: 'After 90 days, cleaning the inner gasket edge and filter replacement cost is frustrating',
      text: 'Re-aligning the three bottom cleaning latches takes forever after washing; expensive proprietary cartridge pricing drives churn.',
      baseScore: 382,
      comments: 84,
    },
    {
      platform: 'reddit',
      kind: 'post',
      sourceId: SRC_REDDIT_RED,
      provider: 'red_crawler',
      community: 'r/LocalLLaMA',
      author: 'u/quant_runner',
      title: 'Why does streaming SDK timeout still spike under concurrent quantization batches?',
      text: 'Seeing latency jitter above 1.9s when agent tool calls fan out in parallel. Pricing per token hides the wasted compute.',
      baseScore: 215,
      comments: 54,
    },
  ];

  const DAILY_VOLUME_PROFILE = [3, 4, 2, 5, 3, 6, 4, 7, 5, 4, 6, 8, 5, 7, 6, 9, 5, 8, 7, 10];

  SEED_DAYS.forEach((day, idx) => {
    const countOnDay = DAILY_VOLUME_PROFILE[idx % DAILY_VOLUME_PROFILE.length];
    for (let k = 0; k < countOnDay; k++) {
      const tpl = SEED_TOPICS[(idx + k) % SEED_TOPICS.length];
      const seq = String(idx * 10 + k + 1).padStart(4, '0');
      const id = `77777777-7777-4777-8777-00000000${seq}`;
      const score0 = Math.round(tpl.baseScore * (0.45 + (idx % 4) * 0.12));
      const score1 = Math.round(score0 * 1.38);
      const score2 = tpl.kind === 'comment' && idx % 5 === 0 ? null : Math.round(score1 * 1.15);
      const obs: ContentObservation[] = [
        {
          sourceId: tpl.sourceId,
          provider: tpl.provider,
          sourceObservedAt: `${day}T09:15:00Z`,
          fetchedAt: `${day}T09:20:00Z`,
          timeBasis: 'provider_snapshot',
          maturity: 'initial',
          metrics:
            tpl.platform === 'reddit'
              ? { 'reddit.score': score0, 'reddit.num_comments': Math.round(tpl.comments * 0.6), 'reddit.upvote_ratio': 0.89 }
              : tpl.platform === 'x'
                ? { 'x.likes': score0, 'x.replies': Math.round(tpl.comments * 0.6), 'x.views': score0 * 48 }
                : tpl.platform === 'bluesky'
                  ? { 'bluesky.likes': score0, 'bluesky.replies': Math.round(tpl.comments * 0.6) }
                  : { 'web.rank': Math.max(1, 22 - (idx % 18)) },
          evidenceKey: `ev_seed_${seq}_a`,
        },
        {
          sourceId: tpl.sourceId,
          provider: tpl.secondProvider || tpl.provider,
          sourceObservedAt: `${day}T18:30:00Z`,
          fetchedAt: `${day}T18:35:00Z`,
          timeBasis: 'provider_snapshot',
          maturity: 'mature',
          metrics:
            tpl.platform === 'reddit'
              ? { 'reddit.score': score2, 'reddit.num_comments': tpl.comments, 'reddit.upvote_ratio': 0.93 }
              : tpl.platform === 'x'
                ? { 'x.likes': score1, 'x.replies': tpl.comments, 'x.views': score1 * 62 }
                : tpl.platform === 'bluesky'
                  ? { 'bluesky.likes': score1, 'bluesky.replies': tpl.comments }
                  : { 'web.rank': Math.max(1, 14 - (idx % 12)) },
          evidenceKey: `ev_seed_${seq}_b`,
        },
      ];
      content.push({
        id,
        platform: tpl.platform,
        kind: tpl.kind,
        externalId: `seed_${seq}`,
        title: `${tpl.title} (#${idx + 1})`,
        text: tpl.text,
        url: tpl.platform === 'reddit' ? `https://reddit.com/${tpl.community}/comments/seed_${seq}` : `https://siftline.example/item/seed_${seq}`,
        language: 'en',
        author: {
          externalId: `auth_${seq}`,
          handle: tpl.author,
          displayName: tpl.author,
          url: null,
        },
        publishedAt: `${day}T08:${String(10 + k * 14).padStart(2, '0')}:00Z`,
        firstFetchedAt: `${day}T09:20:00Z`,
        lastFetchedAt: `${day}T18:35:00Z`,
        availability: 'available',
        textState: 'full',
        references: [],
        media: [],
        platformDetails: { subreddit: tpl.community.replace(/^r\//, ''), community: tpl.community },
        observations: obs,
      });
    }
  });

  const threadLinks: MockState['threadLinks'] = {
    [POST_1]: { rootId: POST_1, parentId: null, depth: 0 },
    [POST_1_C1]: { rootId: POST_1, parentId: POST_1, depth: 1 },
    [POST_1_C2]: { rootId: POST_1, parentId: POST_1_C1, depth: 2 },
    [POST_1_C3]: { rootId: POST_1, parentId: POST_1_C2, depth: 3 },
  };

  const jobs: SourceJob[] = [
    {
      id: '44444444-4444-4444-8444-444444444401',
      source_id: SRC_REDDIT_KAIX,
      status: 'completed',
      operation: 'collect',
      provider: 'kaix',
      provider_state: { phase: 'done', runId: 'apify_run_9f83a1' },
      phase: 'done',
      request_count: 3,
      records_processed: 42,
      records_inserted: 19,
      records_updated: 23,
      error: null,
      result_summary: { provider_run_id: 'apify_run_9f83a1' },
      request_json: { subreddit: 'SaaS', limit: 50, includeComments: true, maxCommentsPerPost: 15 },
      created_at: '2026-11-17T10:15:00Z',
    },
    {
      id: '44444444-4444-4444-8444-444444444402',
      source_id: SRC_REDDIT_KAIX,
      status: 'completed',
      operation: 'hydrate',
      provider: 'kaix',
      provider_state: { phase: 'done', runId: 'apify_run_hyd771' },
      phase: 'done',
      request_count: 1,
      records_processed: 3,
      records_inserted: 3,
      records_updated: 0,
      error: null,
      result_summary: {
        warning: '2 posts yielded 0 new comments because post was locked upstream.',
        provider_run_id: 'apify_run_hyd771',
      },
      request_json: { contentIds: [POST_1], maxCommentsPerPost: 25 },
      created_at: '2026-11-17T12:00:00Z',
    },
    {
      id: '44444444-4444-4444-8444-444444444403',
      source_id: SRC_REDDIT_RED,
      status: 'running',
      operation: 'collect',
      provider: 'red_crawler',
      provider_state: { phase: 'unknown', runId: 'rc_run_pending_09' },
      phase: 'unknown',
      request_count: 1,
      records_processed: 11,
      records_inserted: 11,
      records_updated: 0,
      error: 'Upstream socket timed out while confirming batch completion; potential charge unconfirmed.',
      result_summary: { warning: 'Phase unknown: confirm potential vendor charge before retry or unblock.' },
      request_json: { query: 'latency OR quantization', limit: 100, includeComments: false },
      created_at: '2026-11-18T02:10:00Z',
    },
    {
      id: '44444444-4444-4444-8444-444444444404',
      source_id: SRC_X_SCRAPE,
      status: 'completed',
      operation: 'refresh',
      provider: 'scrapebadger',
      provider_state: { phase: 'done', runId: 'sb_ref_404' },
      phase: 'done',
      request_count: 1,
      records_processed: 2,
      records_inserted: 0,
      records_updated: 2,
      error: null,
      request_json: { contentIds: [POST_3, POST_4] },
      created_at: '2026-11-17T08:02:00Z',
    },
  ];

  const budgets: ProviderBudget[] = [
    {
      provider: 'kaix',
      enabled: true,
      daily_requests: 120,
      monthly_requests: 3000,
      daily_resources: 5000,
      monthly_resources: 120000,
      used_daily_requests: 28,
      used_monthly_requests: 642,
      used_daily_resources: 1120,
      used_monthly_resources: 29800,
      minimum_interval_ms: 2000,
      revision: 3,
    },
    {
      provider: 'red_crawler',
      enabled: true,
      daily_requests: 60,
      monthly_requests: 1500,
      daily_resources: 3000,
      monthly_resources: 60000,
      used_daily_requests: 51,
      used_monthly_requests: 910,
      used_daily_resources: 2650,
      used_monthly_resources: 42100,
      minimum_interval_ms: 3000,
      revision: 2,
    },
    {
      provider: 'twitterapis',
      enabled: true,
      daily_requests: 80,
      monthly_requests: 2000,
      daily_resources: 1600,
      monthly_resources: 40000,
      used_daily_requests: 14,
      used_monthly_requests: 310,
      used_daily_resources: 280,
      used_monthly_resources: 6200,
      minimum_interval_ms: 1500,
      revision: 1,
    },
    {
      provider: 'scrapebadger',
      enabled: true,
      daily_requests: 150,
      monthly_requests: 4500,
      daily_resources: 10000,
      monthly_resources: 250000,
      used_daily_requests: 19,
      used_monthly_requests: 408,
      used_daily_resources: 1240,
      used_monthly_resources: 31000,
      minimum_interval_ms: 1000,
      revision: 2,
    },
    {
      provider: 'newsnow',
      enabled: true,
      daily_requests: 240,
      monthly_requests: 7200,
      daily_resources: 7200,
      monthly_resources: 216000,
      used_daily_requests: 24,
      used_monthly_requests: 512,
      used_daily_resources: 720,
      used_monthly_resources: 15360,
      minimum_interval_ms: 5000,
      revision: 1,
    },
    {
      provider: 'feed',
      enabled: true,
      daily_requests: 200,
      monthly_requests: 6000,
      daily_resources: 6000,
      monthly_resources: 180000,
      used_daily_requests: 8,
      used_monthly_requests: 190,
      used_daily_resources: 240,
      used_monthly_resources: 5700,
      minimum_interval_ms: 5000,
      revision: 1,
    },
    {
      provider: 'bluesky_appview',
      enabled: true,
      daily_requests: 300,
      monthly_requests: 9000,
      daily_resources: 30000,
      monthly_resources: 900000,
      used_daily_requests: 11,
      used_monthly_requests: 284,
      used_daily_resources: 1100,
      used_monthly_resources: 28400,
      minimum_interval_ms: 500,
      revision: 1,
    },
  ];

  const queries: SavedQueryDto[] = [
    {
      id: '55555555-5555-4555-8555-555555555501',
      name: 'High-Pain Billing Complaints (Thread-Aware)',
      query: {
        anyTerms: ['pricing', 'billing', 'churn'],
        signal: 'pain',
        searchScope: 'title_text',
        threadAware: true,
        projectId: PROJ_FINOPS,
      },
      revision: 1,
      created_at: '2026-11-12T08:00:00Z',
      updated_at: '2026-11-16T14:20:00Z',
    },
    {
      id: '55555555-5555-4555-8555-555555555502',
      name: 'Inference Latency & Timeout Watch',
      query: {
        anyTerms: ['latency', 'timeout'],
        searchScope: 'title_text',
        threadAware: true,
      },
      revision: 1,
      created_at: '2026-11-15T10:30:00Z',
      updated_at: '2026-11-17T19:00:00Z',
    },
  ];

  const annotations: Record<string, AnnotationDetail> = {
    [POST_1]: {
      favorite: true,
      note: 'Strong root thread demonstrating metrics cardinality pricing backlash; tail sampling workaround validated in depth-3 reply.',
      revision: 2,
    },
    [POST_3]: {
      favorite: true,
      note: 'Cross-observed on both twitterapis and scrapebadger; 59.4K views benchmark.',
      revision: 1,
    },
  };

  const keys: Array<MachineKeyDto & { ownerId: string }> = [
    {
      id: '66666666-6666-4666-8666-666666666601',
      label: 'Support Ticket Push Bridge (Prod)',
      scopes: ['ingest', 'read'],
      allowed_source_ids: [SRC_PUSH_EXT],
      expires_at: '2027-01-15T00:00:00Z',
      ownerId: '00000000-0000-4000-8000-000000000001',
    },
    {
      id: '66666666-6666-4666-8666-666666666602',
      label: 'BI Warehouse Nightly Export',
      scopes: ['read', 'export'],
      allowed_source_ids: null,
      expires_at: '2026-12-30T00:00:00Z',
      ownerId: '00000000-0000-4000-8000-000000000001',
    },
  ];

  let initialActor: Actor | null = null;
  try {
    const saved = sessionStorage.getItem('siftline.demoActor');
    if (saved) initialActor = JSON.parse(saved) as Actor;
  } catch {
    initialActor = null;
  }

  return {
    actor: initialActor,
    sources,
    projects,
    content,
    threadLinks,
    jobs,
    budgets,
    queries,
    annotations,
    keys,
    invites: {
      'SIFT-INVITE-VIEWER-2026-DEMO-72CHAR-SAMPLE-KEY-000000000000000000001': 'viewer',
      'SIFT-INVITE-ADMIN-2026-DEMO-72CHAR-SAMPLE-KEY-0000000000000000000002': 'admin',
    },
    idempotencyCache: new Map(),
  };
}

let state: MockState = createInitialState();

function fail(status: number, code: string, message: string, retryable = false, retryAfter?: number): never {
  throw new ApiError(status, { code, message, requestId: `req_${Math.random().toString(36).slice(2, 10)}`, retryable }, retryAfter);
}

function requireAuth(): Actor {
  if (!state.actor) {
    fail(401, 'unauthorized', 'Authentication required.');
  }
  return state.actor;
}

function requireAdminOrOwner(): Actor {
  const actor = requireAuth();
  if (actor.role === 'viewer') {
    fail(403, 'forbidden', 'Viewer role is read-only outside /v1/workspace/*.');
  }
  return actor;
}

function checkIdempotency<T>(scope: string, key: string | undefined, body: unknown, fn: () => T): T {
  if (!key || key.length < 1 || key.length > 128 || /[^\x21-\x7e]/.test(key)) {
    fail(422, 'http_422', 'Missing or invalid Idempotency-Key header (must be 1..128 visible ASCII chars).');
  }
  const cacheKey = `${scope}:${key}`;
  const sig = JSON.stringify(body ?? {});
  const hit = state.idempotencyCache.get(cacheKey);
  if (hit) {
    if (hit.sig !== sig) {
      fail(409, 'http_409', 'Idempotency-Key reused with a different request payload.');
    }
    return hit.response as T;
  }
  const result = fn();
  state.idempotencyCache.set(cacheKey, { sig, response: result });
  return result;
}

export const mockEngine = {
  reset() {
    state = createInitialState();
  },

  setDemoRole(role: Role) {
    state.actor = {
      userId:
        role === 'owner'
          ? '00000000-0000-4000-8000-000000000001'
          : role === 'admin'
            ? '00000000-0000-4000-8000-000000000002'
            : '00000000-0000-4000-8000-000000000003',
      email: `${role}@siftline.io`,
      role,
      clientKind: 'browser',
      sessionId: `sess_demo_${role}`,
      scopes: role === 'viewer' ? ['read', 'workspace'] : ['*'],
      allowedSourceIds: null,
    };
    try {
      sessionStorage.setItem('siftline.demoActor', JSON.stringify(state.actor));
    } catch {
      // ignore
    }
  },

  async healthz() {
    return { ok: true };
  },

  async getSession(): Promise<{ user: Actor | null }> {
    return { user: state.actor };
  },

  async login(email: string, password: string): Promise<{ user: Actor }> {
    if (!email || email.length < 3 || !password) {
      fail(401, 'unauthorized', 'Invalid email or password');
    }
    const lower = email.toLowerCase().trim();
    const role: Role = lower.includes('viewer') ? 'viewer' : lower.includes('admin') ? 'admin' : 'owner';
    this.setDemoRole(role);
    state.actor!.email = lower;
    try {
      sessionStorage.setItem('siftline.demoActor', JSON.stringify(state.actor));
    } catch {
      // ignore
    }
    return { user: state.actor! };
  },

  async register(email: string, password: string, invite: string): Promise<{ registered: boolean }> {
    if (!email || password.length < 12) {
      fail(422, 'http_422', 'Password must be at least 12 characters.');
    }
    const role = state.invites[invite.trim()];
    if (!role) {
      fail(403, 'forbidden', 'Invite code is invalid, expired, or already redeemed.');
    }
    delete state.invites[invite.trim()];
    return { registered: true };
  },

  async logout(): Promise<{ loggedOut: boolean }> {
    state.actor = null;
    try {
      sessionStorage.removeItem('siftline.demoActor');
    } catch {
      // ignore
    }
    return { loggedOut: true };
  },

  async getCapabilities(): Promise<CapabilitiesResponse> {
    requireAuth();
    const providers = DEFAULT_CAPABILITIES.map((cap) => {
      const budget = state.budgets.find((b) => b.provider === cap.provider);
      return { ...cap, enabled: budget ? budget.enabled : cap.enabled };
    });
    return {
      providers,
      operations: [
        'ingest',
        'radar',
        'hydrate',
        'refresh_by_ids',
        'thread',
        'search',
        'stream_export',
        'saved_queries',
        'annotations',
      ],
      maxIngestItems: 100,
      maxIngestBytes: 1048576,
      maxOnlineItems: 2000,
      threadAware: true,
      automaticHydration: false,
    };
  },

  async getProjects(): Promise<{ projects: Project[] }> {
    requireAuth();
    return { projects: state.projects.map((p) => ({ ...p })) };
  },

  async getProject(id: string): Promise<Project> {
    requireAuth();
    const p = state.projects.find((item) => item.id === id);
    if (!p) fail(404, 'not_found', 'Project not found.');
    return { ...p };
  },

  async createProject(input: ProjectInput): Promise<Project> {
    const actor = requireAdminOrOwner();
    if (!input.name || input.name.length > 100) fail(422, 'http_422', 'Project name must be 1..100 characters.');
    if (!input.sourceIds || input.sourceIds.length < 1) fail(422, 'http_422', 'Select at least 1 source.');
    const filterErr = validateFilterInput(input.filter || {});
    if (filterErr) fail(422, 'http_422', filterErr);

    const created: Project = {
      id: generateUuidV4(),
      name: input.name.trim(),
      filter: input.filter || {},
      revision: 1,
      thread_aware: input.threadAware ?? true,
      include_push_in_trends: input.includePushInTrends ?? false,
      source_ids: [...new Set(input.sourceIds)],
      owner_user_id: actor.userId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    state.projects.unshift(created);
    return created;
  },

  async updateProject(id: string, input: ProjectInput & { revision: number }): Promise<Project> {
    requireAdminOrOwner();
    const idx = state.projects.findIndex((p) => p.id === id);
    if (idx === -1) fail(404, 'not_found', 'Project not found.');
    const cur = state.projects[idx];
    if (cur.revision !== input.revision) {
      fail(409, 'http_409', `Project revision mismatch (expected ${cur.revision}, got ${input.revision}).`);
    }
    if (!input.sourceIds || input.sourceIds.length < 1) fail(422, 'http_422', 'Select at least 1 source.');
    const filterErr = validateFilterInput(input.filter || {});
    if (filterErr) fail(422, 'http_422', filterErr);

    const updated: Project = {
      ...cur,
      name: input.name.trim(),
      source_ids: [...new Set(input.sourceIds)],
      filter: input.filter || {},
      thread_aware: input.threadAware ?? cur.thread_aware,
      include_push_in_trends: input.includePushInTrends ?? cur.include_push_in_trends,
      revision: cur.revision + 1,
      updated_at: new Date().toISOString(),
    };
    state.projects[idx] = updated;
    return updated;
  },

  async deleteProject(id: string, revision: number): Promise<{ deleted: boolean }> {
    requireAdminOrOwner();
    const idx = state.projects.findIndex((p) => p.id === id);
    if (idx === -1) fail(404, 'not_found', 'Project not found.');
    if (state.projects[idx].revision !== revision) {
      fail(409, 'http_409', `Project revision mismatch (expected ${state.projects[idx].revision}).`);
    }
    state.projects.splice(idx, 1);
    return { deleted: true };
  },

  async getProjectOverview(id: string): Promise<ProjectOverviewResponse> {
    requireAuth();
    const project = state.projects.find((p) => p.id === id);
    if (!project) fail(404, 'not_found', 'Project not found.');

    const pushIds = new Set(state.sources.filter((s) => s.delivery_mode === 'push').map((s) => s.id));
    const allowedSourceSet = new Set(
      project.source_ids.filter((sid) => project.include_push_in_trends || !pushIds.has(sid)),
    );

    const scopedItems = state.content.filter((item) =>
      item.observations.some((o) => allowedSourceSet.has(o.sourceId)),
    );
    const matchedItems = scopedItems.filter((item) => matchesTerms(item, project.filter));

    const anchorFor = (item: PublicContent) => {
      if (!project.thread_aware) return item.id;
      return state.threadLinks[item.id]?.rootId || item.id;
    };

    const uniqueAnchors = new Set(matchedItems.map(anchorFor));
    const dayMap = new Map<string, { anchors: Set<string>; matchedCount: number }>();
    const platformMap = new Map<Platform, { anchors: Set<string>; matchedCount: number }>();
    const kindMap = new Map<ContentKind, { anchors: Set<string>; matchedCount: number }>();
    const providerSet = new Set<string>();

    for (const item of matchedItems) {
      const anchor = anchorFor(item);
      const dayKey = item.publishedAt ? `${item.publishedAt.slice(0, 10)}T00:00:00Z` : '__NULL__';
      if (!dayMap.has(dayKey)) dayMap.set(dayKey, { anchors: new Set(), matchedCount: 0 });
      dayMap.get(dayKey)!.anchors.add(anchor);
      dayMap.get(dayKey)!.matchedCount += 1;

      if (!platformMap.has(item.platform)) platformMap.set(item.platform, { anchors: new Set(), matchedCount: 0 });
      platformMap.get(item.platform)!.anchors.add(anchor);
      platformMap.get(item.platform)!.matchedCount += 1;

      if (!kindMap.has(item.kind)) kindMap.set(item.kind, { anchors: new Set(), matchedCount: 0 });
      kindMap.get(item.kind)!.anchors.add(anchor);
      kindMap.get(item.kind)!.matchedCount += 1;

      for (const obs of item.observations) {
        if (allowedSourceSet.has(obs.sourceId)) {
          providerSet.add(obs.provider);
        }
      }
    }

    const facets: OverviewFacet[] = [];
    for (const [k, v] of [...dayMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      facets.push({
        day_group: 0,
        platform_group: 1,
        kind_group: 1,
        day: k === '__NULL__' ? null : k,
        platform: null,
        kind: null,
        count: v.anchors.size,
        matchedContentCount: v.matchedCount,
      });
    }
    for (const [plat, v] of platformMap.entries()) {
      facets.push({
        day_group: 1,
        platform_group: 0,
        kind_group: 1,
        day: null,
        platform: plat,
        kind: null,
        count: v.anchors.size,
        matchedContentCount: v.matchedCount,
      });
    }
    for (const [kind, v] of kindMap.entries()) {
      facets.push({
        day_group: 1,
        platform_group: 1,
        kind_group: 0,
        day: null,
        platform: null,
        kind,
        count: v.anchors.size,
        matchedContentCount: v.matchedCount,
      });
    }
    facets.push({
      day_group: 1,
      platform_group: 1,
      kind_group: 1,
      day: null,
      platform: null,
      kind: null,
      count: uniqueAnchors.size,
      matchedContentCount: matchedItems.length,
    });

    return {
      project: { ...project },
      contentCount: uniqueAnchors.size,
      matchedContentCount: matchedItems.length,
      facets,
      providers: [...providerSet],
      resolvedFilter: project.filter,
      coverage: 'stored_sample',
      threadAware: project.thread_aware,
    };
  },

  async listContent(query: ListQuery, pathProjectId?: string): Promise<ContentListResponse> {
    requireAuth();
    const filterErr = validateFilterInput(query);
    if (filterErr) fail(422, 'http_422', filterErr);

    const projectId = pathProjectId ?? query.projectId;
    const project = projectId ? state.projects.find((p) => p.id === projectId) : undefined;
    if (projectId && !project) fail(404, 'not_found', 'Project not found.');

    const merged: ListQuery = project
      ? {
          ...project.filter,
          ...query,
          sourceIds: query.sourceId ? [query.sourceId] : project.source_ids,
          threadAware: query.threadAware ?? project.thread_aware,
        }
      : { ...query };

    const scopeSig = JSON.stringify({ ...merged, cursor: undefined, rev: project?.revision ?? 0 });
    let offset = 0;
    if (query.cursor) {
      try {
        const parsed = JSON.parse(atob(query.cursor));
        if (parsed.sig !== scopeSig) {
          fail(409, 'cursor_scope_changed', 'Filter scope or project revision changed; cursor invalidated.');
        }
        offset = parsed.offset || 0;
      } catch (e) {
        if (e instanceof ApiError) throw e;
        fail(409, 'cursor_scope_changed', 'Invalid pagination cursor.');
      }
    }

    const matched = state.content.filter((item) => matchesTerms(item, merged));
    let outputItems: PublicContent[];
    if (merged.threadAware) {
      const seen = new Set<string>();
      outputItems = [];
      for (const item of matched) {
        const link = state.threadLinks[item.id];
        if (link && link.rootId !== item.id) {
          const root = state.content.find((c) => c.id === link.rootId);
          if (root) {
            if (!seen.has(root.id)) {
              seen.add(root.id);
              outputItems.push(root);
            }
            continue;
          }
          // Missing root -> emit hit node with contextMissing
          if (!seen.has(item.id)) {
            seen.add(item.id);
            outputItems.push({ ...item, contextMissing: true });
          }
          continue;
        }
        if (!seen.has(item.id)) {
          seen.add(item.id);
          outputItems.push(item);
        }
      }
    } else {
      outputItems = matched;
    }

    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
    const page = outputItems.slice(offset, offset + limit);
    const nextCursor =
      offset + limit < outputItems.length ? btoa(JSON.stringify({ sig: scopeSig, offset: offset + limit })) : null;

    return {
      items: page,
      nextCursor,
      totalMatching: null,
      resolvedFilter: merged as Record<string, unknown>,
      coverage: 'stored_sample',
    };
  },

  async getContentDetail(id: string): Promise<{ content: PublicContent }> {
    requireAuth();
    const item = state.content.find((c) => c.id === id);
    if (!item) fail(404, 'not_found', 'Content item not found.');
    return { content: item };
  },

  async getContentThread(
    id: string,
    query: ListQuery & { view?: 'top' | 'matches' | 'op' },
  ): Promise<ContentThreadResponse> {
    requireAuth();
    const seed = state.content.find((c) => c.id === id);
    if (!seed) fail(404, 'not_found', 'Content item not found.');

    const link = state.threadLinks[seed.id];
    const rootId = link ? link.rootId : seed.id;
    const root = state.content.find((c) => c.id === rootId) || seed;
    const rootContextMissing = Boolean(seed.contextMissing) || (link ? !state.content.some((c) => c.id === link.rootId) : false);

    const project = query.projectId ? state.projects.find((p) => p.id === query.projectId) : undefined;
    const filter: ListQuery = project ? { ...project.filter, ...query } : query;

    const members = state.content.filter((c) => {
      const l = state.threadLinks[c.id];
      return (l && l.rootId === rootId) || c.id === root.id;
    });

    const view = query.view || 'top';
    const rootHandle = root.author?.handle?.toLowerCase();

    let nodes: ThreadNode[] = members
      .filter((m) => m.id !== root.id)
      .map((m) => {
        const l = state.threadLinks[m.id] || { rootId, parentId: root.id, depth: 1 };
        const matched = matchesTerms(m, filter);
        return {
          item: m,
          depth: l.depth,
          parentId: l.parentId,
          contextMissing: Boolean(m.contextMissing),
          matched,
        };
      });

    if (view === 'matches') {
      nodes = nodes.filter((n) => n.matched);
    } else if (view === 'op') {
      nodes = nodes.filter((n) => rootHandle && n.item.author?.handle?.toLowerCase() === rootHandle);
    } else {
      nodes.sort((a, b) => {
        const sa = a.item.observations[0]?.metrics['reddit.score'] ?? 0;
        const sb = b.item.observations[0]?.metrics['reddit.score'] ?? 0;
        return a.depth - b.depth || (sb as number) - (sa as number);
      });
    }

    return {
      root,
      nodes,
      contextMissing: rootContextMissing,
      capped: false,
    };
  },

  async hydrateProject(
    projectId: string,
    payload: { contentIds: string[]; maxCommentsPerPost: number },
    idempotencyKey: string,
  ): Promise<{ jobIds: string[] }> {
    requireAdminOrOwner();
    const project = state.projects.find((p) => p.id === projectId);
    if (!project) fail(404, 'not_found', 'Project not found.');
    if (!payload.contentIds.length || payload.contentIds.length > 30) {
      fail(422, 'http_422', 'Select between 1 and 30 root Reddit posts to hydrate.');
    }
    return checkIdempotency(`hydrate:${projectId}`, idempotencyKey, payload, () => {
      const jobIds = payload.contentIds.map((cid) => {
        const jid = generateUuidV4();
        state.jobs.unshift({
          id: jid,
          source_id: SRC_REDDIT_KAIX,
          status: 'queued',
          operation: 'hydrate',
          provider: 'kaix',
          provider_state: { phase: 'starting' },
          phase: 'starting',
          records_processed: 0,
          error: null,
          request_json: { contentId: cid, maxCommentsPerPost: payload.maxCommentsPerPost },
          created_at: new Date().toISOString(),
        });
        return jid;
      });
      return { jobIds };
    });
  },

  async exportContent(
    params: ListQuery & { format?: 'json' | 'csv'; maxRows?: number },
  ): Promise<{ format: 'json' | 'csv'; filename: string; text: string; jsonResult?: ExportJsonResult }> {
    requireAuth();
    const listRes = await this.listContent({ ...params, limit: 100 });
    const maxRows = Math.min(Math.max(params.maxRows ?? 10000, 1), 50000);
    const items = listRes.items.slice(0, maxRows);
    const format = params.format || 'json';

    if (format === 'csv') {
      const safeCsv = (v: string | null) => {
        if (v == null) return '';
        let s = String(v).replace(/"/g, '""');
        if (/^[=+\-@]/.test(s)) s = `'${s}`;
        return `"${s}"`;
      };
      const rows = ['id,platform,kind,externalId,publishedAt,title,text'];
      for (const it of items) {
        rows.push(
          [
            safeCsv(it.id),
            safeCsv(it.platform),
            safeCsv(it.kind),
            safeCsv(it.externalId),
            safeCsv(it.publishedAt),
            safeCsv(it.title),
            safeCsv(it.text),
          ].join(','),
        );
      }
      return { format: 'csv', filename: 'content.csv', text: rows.join('\r\n') + '\r\n' };
    }

    const jsonResult: ExportJsonResult = {
      items,
      result: {
        exportedCount: items.length,
        truncated: Boolean(listRes.nextCursor),
        nextCursor: listRes.nextCursor,
        complete: true,
      },
    };
    return {
      format: 'json',
      filename: 'content.json',
      text: JSON.stringify(jsonResult, null, 2),
      jsonResult,
    };
  },

  async getSources(): Promise<{ sources: CollectionSource[]; capabilities: typeof DEFAULT_CAPABILITIES }> {
    requireAuth();
    const caps = DEFAULT_CAPABILITIES.map((c) => {
      const b = state.budgets.find((bg) => bg.provider === c.provider);
      return { ...c, enabled: b ? b.enabled : c.enabled };
    });
    return { sources: state.sources.map((s) => ({ ...s })), capabilities: caps };
  },

  async createSource(input: SourceInput): Promise<{ source: CollectionSource }> {
    requireAdminOrOwner();
    if (!input.label || input.label.length > 100) fail(422, 'http_422', 'Source label must be 1..100 characters.');
    if (input.deliveryMode === 'push' && input.primaryProvider !== 'external_ingest') {
      fail(422, 'http_422', 'Push sources must use primaryProvider="external_ingest".');
    }
    const created: CollectionSource = {
      id: generateUuidV4(),
      platform: input.platform,
      primary_provider: input.primaryProvider,
      fallback_provider: input.fallbackProvider || null,
      label: input.label.trim(),
      target: input.target,
      content_kind: input.contentKind,
      delivery_mode: input.deliveryMode,
      state: 'active',
      automatic_collection_blocked: false,
      revision: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    state.sources.unshift(created);
    return { source: created };
  },

  async updateSource(
    id: string,
    input: { fallbackProvider?: 'scrapebadger' | 'red_crawler' | null; state?: CollectionSource['state']; revision: number },
  ): Promise<{ updated: boolean }> {
    requireAdminOrOwner();
    const s = state.sources.find((item) => item.id === id);
    if (!s) fail(404, 'not_found', 'Source not found.');
    if (s.revision !== input.revision) {
      fail(409, 'http_409', `Source revision mismatch (expected ${s.revision}).`);
    }
    if (input.state) {
      s.state = input.state;
      if (input.state !== 'active') {
        state.jobs.forEach((j) => {
          if (j.source_id === id && j.status === 'queued') j.status = 'cancelled';
        });
      }
    }
    if (input.fallbackProvider !== undefined) {
      s.fallback_provider = input.fallbackProvider;
    }
    s.revision += 1;
    s.updated_at = new Date().toISOString();
    return { updated: true };
  },

  async collectSource(
    id: string,
    payload: {
      from: string;
      to: string;
      limit: number;
      includeComments?: boolean;
      useFallback?: boolean;
      maxCommentsPerPost?: number;
    },
    idempotencyKey: string,
  ): Promise<{ jobId: string }> {
    requireAdminOrOwner();
    const s = state.sources.find((item) => item.id === id);
    if (!s) fail(404, 'not_found', 'Source not found.');
    if (s.state !== 'active' || s.delivery_mode !== 'pull') {
      fail(422, 'http_422', 'Collection requires an active pull source.');
    }
    if (s.automatic_collection_blocked) {
      fail(409, 'http_409', 'Source has automatic_collection_blocked=true. Unblock with charge acknowledgement first.');
    }
    const provider = payload.useFallback && s.fallback_provider ? s.fallback_provider : s.primary_provider;
    const budget = state.budgets.find((b) => b.provider === provider);
    if (budget && !budget.enabled) {
      fail(422, 'http_422', `Provider "${provider}" is currently disabled in budget controls.`);
    }
    return checkIdempotency(`collect:${id}`, idempotencyKey, payload, () => {
      const jobId = generateUuidV4();
      state.jobs.unshift({
        id: jobId,
        source_id: id,
        status: 'completed',
        operation: 'collect',
        provider,
        provider_state: { phase: 'done', runId: `run_${jobId.slice(0, 8)}` },
        phase: 'done',
        request_count: 1,
        records_processed: Math.min(payload.limit, 12),
        records_inserted: 2,
        records_updated: Math.min(payload.limit, 10),
        error: null,
        request_json: payload as unknown as Record<string, unknown>,
        created_at: new Date().toISOString(),
      });
      if (budget) {
        budget.used_daily_requests = (budget.used_daily_requests || 0) + 1;
        budget.used_monthly_requests = (budget.used_monthly_requests || 0) + 1;
        budget.used_daily_resources = (budget.used_daily_resources || 0) + payload.limit;
        budget.used_monthly_resources = (budget.used_monthly_resources || 0) + payload.limit;
      }
      return { jobId };
    });
  },

  async refreshSource(id: string, payload: { contentIds: string[] }, idempotencyKey: string): Promise<{ jobId: string }> {
    requireAdminOrOwner();
    const s = state.sources.find((item) => item.id === id);
    if (!s) fail(404, 'not_found', 'Source not found.');
    if (payload.contentIds.length < 1 || payload.contentIds.length > 20) {
      fail(422, 'http_422', 'Provide 1..20 unique post content UUIDs.');
    }
    return checkIdempotency(`refresh:${id}`, idempotencyKey, payload, () => {
      const jobId = generateUuidV4();
      state.jobs.unshift({
        id: jobId,
        source_id: id,
        status: 'completed',
        operation: 'refresh',
        provider: s.fallback_provider === 'scrapebadger' ? 'scrapebadger' : s.primary_provider,
        provider_state: { phase: 'done', runId: `ref_${jobId.slice(0, 8)}` },
        phase: 'done',
        request_count: 1,
        records_processed: payload.contentIds.length,
        records_inserted: 0,
        records_updated: payload.contentIds.length,
        error: null,
        request_json: payload,
        created_at: new Date().toISOString(),
      });
      return { jobId };
    });
  },

  async ingestSource(
    id: string,
    rawJson: string,
    idempotencyKey: string,
  ): Promise<{ jobId: string; added: number; updated: number; accepted: number }> {
    requireAdminOrOwner();
    const s = state.sources.find((item) => item.id === id);
    if (!s) fail(404, 'not_found', 'Source not found.');
    if (s.delivery_mode !== 'push') fail(422, 'http_422', 'Ingest endpoint only accepts push delivery sources.');
    if (utf8ByteLength(rawJson) > 1048576) {
      fail(413, 'http_413', 'Payload exceeds 1 MiB ingest batch ceiling.');
    }
    let parsed: { items?: Array<Record<string, unknown>> };
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      fail(422, 'http_422', 'Invalid JSON body.');
    }
    const items = parsed.items || [];
    if (!Array.isArray(items) || items.length < 1 || items.length > 100) {
      fail(422, 'http_422', 'Batch must contain 1..100 items.');
    }
    for (const it of items) {
      if (typeof it.title === 'string' && utf8ByteLength(it.title) > 4096) {
        fail(413, 'http_413', 'Item title exceeds 4 KiB ceiling.');
      }
      if (typeof it.text === 'string' && utf8ByteLength(it.text) > 65536) {
        fail(413, 'http_413', 'Item text exceeds 64 KiB ceiling.');
      }
    }

    return checkIdempotency(`ingest:${id}`, idempotencyKey, parsed, () => {
      let added = 0;
      let updated = 0;
      for (const raw of items) {
        const externalId = String(raw.externalId || generateUuidV4());
        const existing = state.content.find((c) => c.externalId === externalId);
        if (existing) {
          updated += 1;
        } else {
          added += 1;
          state.content.unshift({
            id: generateUuidV4(),
            platform: (raw.platform as Platform) || s.platform,
            kind: (raw.kind as ContentKind) || s.content_kind,
            externalId,
            title: (raw.title as string) ?? null,
            text: (raw.text as string) ?? null,
            url: (raw.url as string) ?? null,
            language: (raw.language as string) || 'en',
            author: (raw.author as PublicContent['author']) || null,
            publishedAt: (raw.publishedAt as string) ?? null,
            firstFetchedAt: new Date().toISOString(),
            lastFetchedAt: new Date().toISOString(),
            availability: 'available',
            textState: 'full',
            references: [],
            media: [],
            platformDetails: (raw.platformDetails as Record<string, unknown>) || {},
            observations: [
              {
                sourceId: s.id,
                provider: 'external_ingest',
                sourceObservedAt: null,
                fetchedAt: new Date().toISOString(),
                timeBasis: 'ingest_import',
                maturity: 'static',
                metrics: {},
                evidenceKey: `ev_${Math.random().toString(36).slice(2, 8)}`,
              },
            ],
          });
        }
      }
      const jobId = generateUuidV4();
      state.jobs.unshift({
        id: jobId,
        source_id: id,
        status: 'completed',
        operation: 'ingest',
        provider: 'external_ingest',
        provider_state: { phase: 'done' },
        phase: 'done',
        records_processed: items.length,
        records_inserted: added,
        records_updated: updated,
        error: null,
        created_at: new Date().toISOString(),
      });
      return { jobId, added, updated, accepted: items.length };
    });
  },

  async getSourceJobs(sourceId: string): Promise<{ jobs: SourceJob[] }> {
    requireAuth();
    return { jobs: state.jobs.filter((j) => j.source_id === sourceId).slice(0, 50) };
  },

  async getJobsByIds(ids: string[]): Promise<{ jobs: SourceJob[] }> {
    requireAuth();
    const set = new Set(ids);
    return { jobs: state.jobs.filter((j) => set.has(j.id)) };
  },

  async getJobDetail(jobId: string): Promise<{ job: SourceJob }> {
    requireAuth();
    const j = state.jobs.find((item) => item.id === jobId);
    if (!j) fail(404, 'not_found', 'Job not found.');
    return { job: j };
  },

  async jobAction(
    jobId: string,
    action: 'cancel' | 'retry' | 'continue',
    acknowledgePotentialCharge?: boolean,
  ): Promise<{ job: SourceJob }> {
    requireAdminOrOwner();
    const job = state.jobs.find((j) => j.id === jobId);
    if (!job) fail(404, 'not_found', 'Job not found.');
    const phase = job.provider_state.phase;
    const risky = phase === 'starting' || phase === 'unknown';

    if ((action === 'retry' || action === 'continue') && risky && !acknowledgePotentialCharge) {
      fail(409, 'http_409', 'Job phase is starting/unknown. Confirm acknowledgePotentialCharge=true to proceed.');
    }
    if (action === 'continue' && !job.provider_state.runId) {
      fail(422, 'http_422', 'Continue is only valid when job holds a durable provider runId.');
    }

    if (action === 'cancel') {
      job.status = 'cancelled';
      if (risky) {
        const src = state.sources.find((s) => s.id === job.source_id);
        if (src) src.automatic_collection_blocked = true;
      }
    } else {
      job.status = 'completed';
      job.provider_state = { ...job.provider_state, phase: 'done' };
      job.phase = 'done';
      job.error = null;
      job.records_processed += 4;
    }
    return { job: { ...job } };
  },

  async unblockSource(sourceId: string, acknowledgePotentialCharge: boolean): Promise<{ unblocked: boolean }> {
    requireAdminOrOwner();
    const src = state.sources.find((s) => s.id === sourceId);
    if (!src) fail(404, 'not_found', 'Source not found.');
    const hasRisky = state.jobs.some(
      (j) =>
        j.source_id === sourceId &&
        (j.provider_state.phase === 'starting' || j.provider_state.phase === 'unknown'),
    );
    if (hasRisky && !acknowledgePotentialCharge) {
      fail(409, 'http_409', 'Unconfirmed charge risk on starting/unknown job. Acknowledge potential charge first.');
    }
    src.automatic_collection_blocked = false;
    state.jobs.forEach((j) => {
      if (j.source_id === sourceId && j.provider_state.phase === 'unknown') {
        j.provider_state.phase = 'failed';
        j.phase = 'failed';
        j.status = 'failed';
      }
    });
    src.revision += 1;
    return { unblocked: true };
  },

  async getBudgets(): Promise<{ budgets: ProviderBudget[] }> {
    requireAdminOrOwner();
    return { budgets: state.budgets.map((b) => ({ ...b })) };
  },

  async updateBudget(
    provider: PullProviderName,
    payload: {
      enabled: boolean;
      dailyRequests: number;
      monthlyRequests: number;
      dailyResources: number;
      monthlyResources: number;
      minimumIntervalMs: number;
      revision: number;
    },
  ): Promise<{ revision: number }> {
    requireAdminOrOwner();
    const b = state.budgets.find((item) => item.provider === provider);
    if (!b) fail(404, 'not_found', 'Provider budget not found.');
    if (b.revision !== payload.revision) {
      fail(409, 'http_409', `Budget revision conflict (expected ${b.revision}, received ${payload.revision}).`);
    }
    b.enabled = payload.enabled;
    b.daily_requests = payload.dailyRequests;
    b.monthly_requests = payload.monthlyRequests;
    b.daily_resources = payload.dailyResources;
    b.monthly_resources = payload.monthlyResources;
    b.minimum_interval_ms = payload.minimumIntervalMs;
    b.revision += 1;
    return { revision: b.revision };
  },

  async getSavedQueries(): Promise<{ queries: SavedQueryDto[] }> {
    requireAuth();
    return { queries: state.queries.map((q) => ({ ...q })) };
  },

  async createSavedQuery(payload: { name: string; filter: ListQuery }): Promise<{ id: string }> {
    requireAuth();
    if (!payload.name.trim() || payload.name.length > 100) {
      fail(422, 'http_422', 'Saved query name must be 1..100 characters.');
    }
    const err = validateFilterInput(payload.filter);
    if (err) fail(422, 'http_422', err);
    const id = generateUuidV4();
    const now = new Date().toISOString();
    state.queries.unshift({
      id,
      name: payload.name.trim(),
      query: payload.filter,
      revision: 1,
      created_at: now,
      updated_at: now,
    });
    return { id };
  },

  async deleteSavedQuery(id: string): Promise<{ deleted: boolean }> {
    requireAuth();
    state.queries = state.queries.filter((q) => q.id !== id);
    return { deleted: true };
  },

  async getAnnotations(): Promise<{ annotations: AnnotationSummary[] }> {
    requireAuth();
    const list: AnnotationSummary[] = [];
    for (const [cid, detail] of Object.entries(state.annotations)) {
      const c = state.content.find((x) => x.id === cid);
      if (!c) continue;
      list.push({
        content_id: cid,
        favorite: detail.favorite,
        note: detail.note,
        revision: detail.revision,
        title: c.title,
        body_text: c.text,
        external_id: c.externalId,
      });
    }
    return { annotations: list };
  },

  async getAnnotation(contentId: string): Promise<{ annotation: AnnotationDetail | null }> {
    requireAuth();
    return { annotation: state.annotations[contentId] || null };
  },

  async putAnnotation(
    contentId: string,
    payload: { favorite: boolean; note: string; revision: number },
  ): Promise<{ revision: number }> {
    requireAuth();
    if (payload.note.length > 2000) fail(422, 'http_422', 'Note cannot exceed 2000 characters.');
    const cur = state.annotations[contentId];
    const expected = cur ? cur.revision : 0;
    if (payload.revision !== expected) {
      fail(409, 'http_409', `Annotation revision conflict (expected ${expected}, received ${payload.revision}).`);
    }
    const nextRev = expected + 1;
    state.annotations[contentId] = { favorite: payload.favorite, note: payload.note, revision: nextRev };
    return { revision: nextRev };
  },

  async createInvite(role: 'viewer' | 'admin'): Promise<{ code: string }> {
    const actor = requireAdminOrOwner();
    if (role === 'admin' && actor.role !== 'owner') {
      fail(403, 'forbidden', 'Only owner can generate admin invite codes.');
    }
    const code = (`SIFT-${role.toUpperCase()}-${generateUuidV4()}-${generateUuidV4()}`).slice(0, 72);
    state.invites[code] = role;
    return { code };
  },

  async getMachineKeys(): Promise<{ keys: MachineKeyDto[] }> {
    const actor = requireAuth();
    return {
      keys: state.keys
        .filter((k) => actor.role === 'owner' || k.ownerId === actor.userId)
        .map(({ ownerId: _ownerId, ...rest }) => rest),
    };
  },

  async createMachineKey(payload: {
    label: string;
    scopes: MachineScope[];
    allowedSourceIds: string[];
    expiresInDays: number;
  }): Promise<{ id: string; token: string; expiresAt: string }> {
    const actor = requireAdminOrOwner();
    if (!payload.label.trim() || payload.label.length > 100) fail(422, 'http_422', 'Label must be 1..100 chars.');
    if (!payload.scopes.length) fail(422, 'http_422', 'Select at least 1 scope.');
    if (payload.scopes.includes('ingest') && (!payload.allowedSourceIds || !payload.allowedSourceIds.length)) {
      fail(422, 'http_422', 'allowedSourceIds must be non-empty when "ingest" scope is included.');
    }
    const id = generateUuidV4();
    const token = btoa(generateUuidV4() + generateUuidV4()).replace(/[+/=]/g, 'x').slice(0, 43);
    const expiresAt = new Date(Date.now() + payload.expiresInDays * 86400000).toISOString();
    state.keys.unshift({
      id,
      label: payload.label.trim(),
      scopes: [...new Set(payload.scopes)],
      allowed_source_ids: payload.allowedSourceIds.length ? payload.allowedSourceIds : null,
      expires_at: expiresAt,
      ownerId: actor.userId,
    });
    return { id, token, expiresAt };
  },

  async revokeMachineKey(id: string): Promise<{ revoked: boolean }> {
    const actor = requireAuth();
    const idx = state.keys.findIndex((k) => k.id === id && (actor.role === 'owner' || k.ownerId === actor.userId));
    if (idx === -1) fail(404, 'not_found', 'Key not found or not owned by current user.');
    state.keys.splice(idx, 1);
    return { revoked: true };
  },
};
