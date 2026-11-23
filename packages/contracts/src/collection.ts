import { Type, type Static } from "@sinclair/typebox";
import {
  type ContentPlatform, DateTime, Id, Kind, NullableText, Platform,
  type PublicContentKind, SourceGroup, SourceGroupPattern, SourceLocale, SourceTier, strictMerge,
} from "./common";
import { ContentItem } from "./content";

const jobIdPattern = "[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}";
export const JobStatusQuery = Type.Object({
  ids: Type.String({ maxLength: 3699, pattern: `^${jobIdPattern}(?:,${jobIdPattern}){0,99}$` }),
}, { additionalProperties: false });

const selectorPart = "(?:[a-zA-Z][\\w-]*|\\*|[.#][a-zA-Z_-][\\w-]*)(?:[.#][a-zA-Z_-][\\w-]*)*";
const ListSelector = Type.String({ maxLength: 160, pattern: `^${selectorPart}(?:(?: +| *> *)${selectorPart}){0,7}$` });
const ListPath = Type.String({ maxLength: 160, pattern: "^[a-zA-Z0-9_-]+(?:\\.[a-zA-Z0-9_-]+){0,7}$" });
const feedList = (format: "web_list" | "json_list", field: typeof ListSelector) => Type.Object({
  format: Type.Literal(format),
  items: format === "json_list" ? Type.Union([field, Type.Literal("$")]) : field,
  link: field,
  title: field,
  summary: Type.Optional(field),
  publishedAt: Type.Optional(field),
  author: Type.Optional(field),
}, { additionalProperties: false });

export const Target = Type.Union([
  Type.Object({ type: Type.Literal("search"), query: Type.String({ minLength: 1, maxLength: 512 }) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("community"), community: Type.String({ minLength: 1, maxLength: 100 }), query: Type.Optional(Type.String({ maxLength: 200 })) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("account"), account: Type.String({ minLength: 1, maxLength: 253 }), query: Type.Optional(Type.String({ maxLength: 200 })) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("post"), postId: Type.String({ minLength: 1, maxLength: 100 }), query: Type.Optional(Type.String({ maxLength: 200 })) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("feed"), url: Type.String({ format: "uri", maxLength: 2000 }), list: Type.Optional(Type.Union([feedList("web_list", ListSelector), feedList("json_list", ListPath)])) }, { additionalProperties: false }),
]);

export const FallbackProvider = Type.Union([Type.Literal("scrapebadger"), Type.Literal("red_crawler")]);
export const SourceOwner = Type.Union([Type.String({ pattern: "^[a-z0-9][a-z0-9_-]{0,79}$" }), Type.Null()]);
export const SourceTags = Type.Array(
  Type.String({ minLength: 1, maxLength: 40, pattern: "^[a-z0-9][a-z0-9_-]{0,39}$" }),
  { maxItems: 20, uniqueItems: true },
);

export const SourceFetchPolicy = Type.Object({
  maxItems: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  timeoutMs: Type.Optional(Type.Integer({ minimum: 3000, maximum: 15000 })),
  stripTrackingParams: Type.Optional(Type.Boolean()),
  excludeTitlePatterns: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 80 }), { maxItems: 10 })),
}, { additionalProperties: false });

export const SourceHealth = Type.Object({
  consecutiveFailures: Type.Optional(Type.Integer({ minimum: 0 })),
  lastError: Type.Optional(NullableText),
  lastStatus: Type.Optional(NullableText),
  lastDurationMs: Type.Optional(Type.Number({ minimum: 0 })),
  lastTruncated: Type.Optional(Type.Boolean()),
  lastNotModified: Type.Optional(Type.Boolean()),
  lastFetchedCount: Type.Optional(Type.Integer({ minimum: 0 })),
  lastInsertedCount: Type.Optional(Type.Integer({ minimum: 0 })),
  totalRuns: Type.Optional(Type.Integer({ minimum: 0 })),
  truncatedRuns: Type.Optional(Type.Integer({ minimum: 0 })),
  notModifiedRuns: Type.Optional(Type.Integer({ minimum: 0 })),
}, { additionalProperties: true });

export const SourceSchedule = Type.Object({
  enabled: Type.Boolean(),
  cadenceSeconds: Type.Optional(Type.Integer({ minimum: 120, maximum: 43200 })),
  intervalSeconds: Type.Optional(Type.Integer({ minimum: 60, maximum: 86400 })),
  overlapSeconds: Type.Optional(Type.Integer({ minimum: 0, maximum: 3600 })),
  initialLookbackHours: Type.Optional(Type.Integer({ minimum: 1, maximum: 48 })),
  maxCatchupHours: Type.Optional(Type.Integer({ minimum: 1, maximum: 48 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  maxPages: Type.Optional(Type.Integer({ minimum: 1, maximum: 5 })),
}, { additionalProperties: false });

export const SourceInput = Type.Object(
  {
    platform: Platform,
    primaryProvider: Type.Union([
      Type.Literal("kaix"), Type.Literal("red_crawler"), Type.Literal("bluesky_appview"),
      Type.Literal("twitterapis"), Type.Literal("scrapebadger"), Type.Literal("newsnow"),
      Type.Literal("feed"), Type.Literal("external_ingest"),
    ]),
    fallbackProvider: Type.Optional(FallbackProvider),
    schedule: Type.Optional(SourceSchedule),
    tier: Type.Optional(SourceTier),
    ownerEntityId: Type.Optional(SourceOwner),
    sourceGroup: Type.Optional(SourceGroup),
    tags: Type.Optional(SourceTags),
    locale: Type.Optional(SourceLocale),
    fetchPolicy: Type.Optional(SourceFetchPolicy),
    label: Type.String({ minLength: 1, maxLength: 100 }),
    target: Target,
    contentKind: Kind,
    deliveryMode: Type.Union([Type.Literal("pull"), Type.Literal("push")]),
  },
  { additionalProperties: false },
);

export const SourceImportInput = Type.Union([
  Type.Object({ format: Type.Literal("json"), sources: Type.Array(SourceInput, { minItems: 1, maxItems: 200 }) }, { additionalProperties: false }),
  Type.Object({
    format: Type.Literal("opml"),
    opml: Type.String({ minLength: 10, maxLength: 524288 }),
    defaults: Type.Optional(Type.Object({
      sourceGroup: Type.Optional(SourceGroup), tier: Type.Optional(SourceTier),
      locale: Type.Optional(SourceLocale), schedule: Type.Optional(SourceSchedule), fetchPolicy: Type.Optional(SourceFetchPolicy),
    }, { additionalProperties: false })),
  }, { additionalProperties: false }),
]);

export const SourceListQuery = Type.Object({
  sourceGroup: Type.Optional(Type.String({ pattern: SourceGroupPattern })),
  tier: Type.Optional(SourceTier),
  state: Type.Optional(Type.Union([Type.Literal("active"), Type.Literal("paused"), Type.Literal("archived")])),
  truncatedOnly: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

export const SourcePreview = Type.Object({
  mode: Type.Union([Type.Literal("fetched"), Type.Literal("validated")]),
  target: Target,
  providerEnabled: Type.Boolean(),
  items: Type.Array(Type.Object({
    url: NullableText, title: NullableText, publishedAt: Type.Union([DateTime, Type.Null()]), summary: NullableText,
  })),
  feeds: Type.Array(Type.String()),
});

export const PublicSourceSummary = Type.Object({
  id: Id, label: Type.String(), platform: Platform, sourceGroup: SourceGroup, tier: SourceTier,
  locale: SourceLocale, state: Type.String(), lastSuccessAt: Type.Union([DateTime, Type.Null()]),
  count48h: Type.Integer({ minimum: 0 }),
}, { additionalProperties: false });

export const PublicSourceDirectory = Type.Object({
  sources: Type.Array(PublicSourceSummary),
  groupCounts: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
}, { additionalProperties: false });

export const Source = strictMerge([
  Type.Omit(SourceInput, [
    "primaryProvider", "fallbackProvider", "tier", "ownerEntityId",
    "sourceGroup", "tags", "locale", "fetchPolicy",
  ]),
  Type.Object({
    id: Id,
    state: Type.Union([
      Type.Literal("active"),
      Type.Literal("paused"),
      Type.Literal("archived"),
    ]),
    createdAt: DateTime,
    updatedAt: DateTime,
    primaryProvider: Type.String({ minLength: 1, maxLength: 64 }),
    fallbackProvider: NullableText,
    tier: SourceTier,
    ownerEntityId: SourceOwner,
    sourceGroup: SourceGroup,
    tags: SourceTags,
    locale: SourceLocale,
    fetchPolicy: SourceFetchPolicy,
    health: SourceHealth,
    hasHttpCache: Type.Optional(Type.Boolean()),
    revision: Type.Integer(),
    nextDueAt: Type.Optional(Type.Union([DateTime, Type.Null()])),
    lastCheckedAt: Type.Optional(Type.Union([DateTime, Type.Null()])),
    lastSuccessAt: Type.Optional(Type.Union([DateTime, Type.Null()])),
    automaticCollectionBlocked: Type.Optional(Type.Boolean()),
    usageDomain: Type.Optional(Type.Union([Type.Literal("research"), Type.Literal("feed")])),
    coverage: Type.Union([Type.Literal("unknown"), Type.Literal("partial")]),
  }),
]);

export const CredentialProvider = Type.Union([
  Type.Literal("apify"), Type.Literal("kaix"), Type.Literal("red_crawler"),
  Type.Literal("twitterapis"), Type.Literal("scrapebadger"),
]);

export const PlanPolicyInput = Type.Object(
  {
    manualCollectEnabled: Type.Boolean(),
    maxProjects: Type.Optional(Type.Integer({minimum:1,maximum:100})),
    maxLookbackDays: Type.Optional(Type.Integer({minimum:1,maximum:365})),
    allowProviderChoice: Type.Optional(Type.Boolean()),
    exportEnabled: Type.Optional(Type.Boolean()),
    allowedProviders: Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: 20, uniqueItems: true }),
    allowedSourceIds: Type.Union([Type.Array(Id, { maxItems: 1000, uniqueItems: true }), Type.Null()]),
    dailyRequests: Type.Union([Type.Integer({ minimum: 0, maximum: 100000 }), Type.Null()]),
    dailyResources: Type.Union([Type.Integer({ minimum: 0, maximum: 10000000 }), Type.Null()]),
    maxBatchLimit: Type.Integer({ minimum: 1, maximum: 2000 }),
    maxCommentsPerPost: Type.Integer({ minimum: 0, maximum: 50 }),
    revision: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

export const UserQuotaOverrideInput = Type.Object(
  {
    manualCollectEnabled: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
    allowedProviders: Type.Optional(Type.Union([Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: 20, uniqueItems: true }), Type.Null()])),
    allowedSourceIds: Type.Optional(Type.Union([Type.Array(Id, { maxItems: 1000, uniqueItems: true }), Type.Null()])),
    dailyRequests: Type.Optional(Type.Union([Type.Integer({ minimum: 0, maximum: 100000 }), Type.Null()])),
    dailyResources: Type.Optional(Type.Union([Type.Integer({ minimum: 0, maximum: 10000000 }), Type.Null()])),
    maxBatchLimit: Type.Optional(Type.Union([Type.Integer({ minimum: 1, maximum: 2000 }), Type.Null()])),
  },
  { additionalProperties: false },
);

export const ProviderCredentialInput = Type.Object(
  { apiKey: Type.String({ minLength: 8, maxLength: 512 }), revision: Type.Optional(Type.Integer({ minimum: 1 })) },
  { additionalProperties: false },
);

export const ProviderCredentialTestInput = Type.Object(
  { confirmPaidProbe: Type.Optional(Type.Boolean()) },
  { additionalProperties: false },
);

export const Ingest = Type.Object(
  { items: Type.Array(strictMerge([Type.Omit(ContentItem, ["id"]), Type.Object({ id: Type.Optional(Id) })]), { minItems: 1, maxItems: 100 }) },
  { additionalProperties: false },
);

export const Collect = Type.Object(
  {
    from: DateTime,
    to: DateTime,
    limit: Type.Integer({ minimum: 1, maximum: 300 }),
    includeComments: Type.Optional(Type.Boolean()),
    useFallback: Type.Optional(Type.Boolean()),
    maxCommentsPerPost: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 50 }),
    ),
    projectId: Type.Optional(Id),
  },
  { additionalProperties: false },
);

export const Refresh = Type.Object({
  contentIds: Type.Array(Id, { minItems: 1, maxItems: 20, uniqueItems: true }),
}, { additionalProperties: false });

export const Hydrate = Type.Object({
  contentIds: Type.Array(Id, { minItems: 1, maxItems: 30, uniqueItems: true }),
  maxCommentsPerPost: Type.Integer({ minimum: 1, maximum: 50 }),
}, { additionalProperties: false });

export type SourceTarget = Static<typeof Target>;
export type CollectionSource = Static<typeof Source>;

export interface MetricDefinition {
  key: string; label: string; unit: "count" | "ratio" | "rank"; cumulative: boolean;
  signed: boolean; contentKinds: PublicContentKind[]; direction: "higher" | "lower" | "neutral";
}

export interface SourceCapability {
  platform: ContentPlatform; provider: string; enabled: boolean; contentKinds: PublicContentKind[];
  targetTypes: SourceTarget["type"][]; keywordSearch: "scoped" | "global" | "none";
  metrics: MetricDefinition[]; observationModel: "archive" | "snapshot"; limitations: string[];
  refreshByIds?: boolean; requestResourceUpperBound?: number; automaticRequestReplay?: boolean;
}

const SourcePatch = Type.Partial(Type.Pick(SourceInput, [
  "label", "sourceGroup", "tags", "locale", "fetchPolicy", "schedule", "tier", "ownerEntityId",
]));

export const SourceUpdate = strictMerge([
  SourcePatch,
  Type.Object({
    fallbackProvider: Type.Optional(Type.Union([FallbackProvider, Type.Null()])),
    state: Type.Optional(Source.properties.state),
    revision: Type.Integer({ minimum: 1 }),
  }),
]);

export const ResearchPlanPreviewInput = Type.Object(
  {
    projectId: Type.Optional(Id),
    sourceId: Type.Optional(Id),
    platform: Type.Optional(Type.Union([Type.Literal("reddit"), Type.Literal("x"), Type.Literal("bluesky")])),
    targetType: Type.Optional(Type.Union([Type.Literal("community"), Type.Literal("account"), Type.Literal("search")])),
    targetValue: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
    from: DateTime,
    to: DateTime,
    limit: Type.Integer({ minimum: 1, maximum: 300 }),
    includeComments: Type.Optional(Type.Boolean()),
    maxCommentsPerPost: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
    useFallback: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export type ResearchPlanPreviewRequest = Static<typeof ResearchPlanPreviewInput>;

export type ResearchCollectionRestriction =
  | "target_unavailable" | "manual_disabled" | "provider_choice" | "scope_limit"
  | "provider_unavailable" | "charge_unresolved" | "source_inactive" | "source_access"
  | "budget_unavailable" | "quota_exhausted" | "unsupported_scope";

export const BatchVisibilityInput = Type.Object(
  { visibility: Type.Union([Type.Literal("private"), Type.Literal("shared")]) },
  { additionalProperties: false },
);

export const REDDIT_ARCHIVE_SOURCE_TAG = "reddit-archive";
export type CollectionSourceInput = Static<typeof SourceInput>;
export type CollectionSourceUpdate = Static<typeof SourceUpdate>;
export type CollectionSourcePreview = Static<typeof SourcePreview>;
export type CollectionSourceImport = Static<typeof SourceImportInput>;
