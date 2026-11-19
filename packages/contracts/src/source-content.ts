import { Type, type TObject, type Static } from "@sinclair/typebox";

export function strictMerge<T extends TObject[]>(schemas: [...T]) {
  return Type.Composite(schemas, { additionalProperties: false });
}
export const IdempotencyHeaders = Type.Object({
  "idempotency-key": Type.String({
    minLength: 1,
    maxLength: 128,
    pattern: "^[\\x21-\\x7e]+$",
  }),
});

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export const Id = Type.String({ format: "uuid" });
const jobIdPattern = "[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}";
export const JobStatusQuery = Type.Object({
  ids: Type.String({ maxLength: 3699, pattern: `^${jobIdPattern}(?:,${jobIdPattern}){0,99}$` }),
}, { additionalProperties: false });
export const DateTime = Type.String({ format: "date-time" });
export const NullableText = Type.Union([Type.String(), Type.Null()]);
export const Platform = Type.Union([
  Type.Literal("reddit"),
  Type.Literal("x"),
  Type.Literal("bluesky"),
  Type.Literal("web"),
]);
export const Kind = Type.Union([
  Type.Literal("post"),
  Type.Literal("comment"),
  Type.Literal("article"),
  Type.Literal("image"),
  Type.Literal("video"),
]);
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
  Type.Object(
    {
      type: Type.Literal("search"),
      query: Type.String({ minLength: 1, maxLength: 512 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("community"),
      community: Type.String({ minLength: 1, maxLength: 100 }),
      query: Type.Optional(Type.String({ maxLength: 200 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("account"),
      account: Type.String({ minLength: 1, maxLength: 253 }),
      query: Type.Optional(Type.String({ maxLength: 200 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("post"),
      postId: Type.String({ minLength: 1, maxLength: 100 }),
      query: Type.Optional(Type.String({ maxLength: 200 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("feed"),
      url: Type.String({ format: "uri", maxLength: 2000 }),
      list: Type.Optional(Type.Union([feedList("web_list", ListSelector), feedList("json_list", ListPath)])),
    },
    { additionalProperties: false },
  ),
]);
export const Reference = Type.Object(
  {
    kind: Kind,
    externalId: Type.String({ minLength: 1, maxLength: 1000 }),
    relation: Type.Union([
      Type.Literal("reply_to"),
      Type.Literal("thread_root"),
      Type.Literal("quote"),
      Type.Literal("repost"),
    ]),
  },
  { additionalProperties: false },
);
export const Author = Type.Object(
  {
    externalId: NullableText,
    handle: NullableText,
    displayName: NullableText,
    url: NullableText,
  },
  { additionalProperties: false },
);
export const Media = Type.Object(
  {
    type: Type.Union([
      Type.Literal("image"),
      Type.Literal("video"),
      Type.Literal("audio"),
      Type.Literal("link"),
    ]),
    url: Type.String(),
    previewUrl: NullableText,
    altText: NullableText,
    durationSeconds: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
  },
  { additionalProperties: false },
);
const extensions = Type.Optional(Type.Record(Type.String(), Type.Any()));
export const Details = Type.Union([
  Type.Object(
    {
      platform: Type.Literal("reddit"),
      community: Type.String(),
      flair: NullableText,
      nsfw: Type.Union([Type.Boolean(), Type.Null()]),
      extensions,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      platform: Type.Literal("x"),
      conversationId: NullableText,
      isReply: Type.Union([Type.Boolean(), Type.Null()]),
      isRepost: Type.Union([Type.Boolean(), Type.Null()]),
      isQuote: Type.Union([Type.Boolean(), Type.Null()]),
      sensitive: Type.Union([Type.Boolean(), Type.Null()]),
      extensions,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      platform: Type.Literal("web"),
      publisher: NullableText,
      canonicalUrl: NullableText,
      feedUrl: NullableText,
      channel: Type.Optional(NullableText),
      textCompleteness: Type.Optional(Type.Union([
        Type.Literal("full"),
        Type.Literal("summary"),
        Type.Literal("title_only"),
      ])),
      extensions,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { platform: Type.Literal("bluesky"), cid: NullableText, extensions },
    { additionalProperties: false },
  ),
]);
export const Observation = Type.Object(
  {
    sourceId: Id,
    provider: Type.String({ minLength: 1, maxLength: 64 }),
    sourceObservedAt: Type.Union([DateTime, Type.Null()]),
    fetchedAt: DateTime,
    timeBasis: Type.Union([
      Type.Literal("archive_initial"),
      Type.Literal("archive_refresh"),
      Type.Literal("provider_snapshot"),
      Type.Literal("unknown"),
    ]),
    maturity: Type.Union([
      Type.Literal("initial"),
      Type.Literal("refreshed"),
      Type.Literal("unknown"),
    ]),
    metrics: Type.Record(
      Type.String({ maxLength: 100 }),
      Type.Union([Type.Number(), Type.Null()]),
    ),
    evidenceKey: Type.String({ minLength: 1, maxLength: 256 }),
  },
  { additionalProperties: false },
);
export const ContentItem = Type.Object(
  {
    id: Id,
    platform: Platform,
    kind: Kind,
    externalId: Type.String({ minLength: 1, maxLength: 1000 }),
    title: NullableText,
    text: NullableText,
    url: NullableText,
    language: NullableText,
    author: Type.Union([Author, Type.Null()]),
    publishedAt: Type.Union([DateTime, Type.Null()]),
    fetchedAt: DateTime,
    availability: Type.Union([
      Type.Literal("available"),
      Type.Literal("removed"),
      Type.Literal("deleted"),
      Type.Literal("unknown"),
    ]),
    references: Type.Array(Reference, { maxItems: 20 }),
    media: Type.Array(Media, { maxItems: 100 }),
    platformDetails: Details,
    observation: Observation,
  },
  { additionalProperties: false },
);
export const Content = strictMerge([
  Type.Omit(ContentItem, ["fetchedAt", "observation"]),
  Type.Object({
    firstFetchedAt: DateTime,
    lastFetchedAt: DateTime,
    observations: Type.Array(Observation),
    contextMissing: Type.Optional(Type.Boolean()),
    textState: Type.Union([
      Type.Literal("full"),
      Type.Literal("missing"),
      Type.Literal("summary"),
      Type.Literal("truncated"),
    ]),
  }),
]);
export const FallbackProvider = Type.Union([Type.Literal("scrapebadger"), Type.Literal("red_crawler")]);
export const SourceTier = Type.Union([Type.Literal("T1"), Type.Literal("T1_5"), Type.Literal("T2")]);
export const SourceOwner = Type.Union([Type.String({ pattern: "^[a-z0-9][a-z0-9_-]{0,79}$" }), Type.Null()]);
export const SourceGroupPattern = "^[a-z0-9][a-z0-9_-]{0,47}$";
export const SourceGroup = Type.Union([Type.String({ pattern: SourceGroupPattern }), Type.Null()]);
export const SourceLocalePattern = "^[a-z]{2}(?:-[A-Z]{2})?$";
export const SourceLocale = Type.Union([Type.String({ pattern: SourceLocalePattern }), Type.Null()]);
export const SourceTags = Type.Array(
  Type.String({ minLength: 1, maxLength: 40, pattern: "^[a-z0-9][a-z0-9_-]{0,39}$" }),
  { maxItems: 20, uniqueItems: true },
);
export const SourceFetchPolicy = Type.Object({
  maxItems: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  timeoutMs: Type.Optional(Type.Integer({ minimum: 3000, maximum: 15000 })),
  stripTrackingParams: Type.Optional(Type.Boolean()),
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
      Type.Literal("kaix"),
      Type.Literal("red_crawler"),
      Type.Literal("bluesky_appview"),
      Type.Literal("twitterapis"),
      Type.Literal("scrapebadger"),
      Type.Literal("newsnow"),
      Type.Literal("feed"),
      Type.Literal("external_ingest"),
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
  Type.Object({
    format: Type.Literal("json"),
    sources: Type.Array(SourceInput, { minItems: 1, maxItems: 200 }),
  }, { additionalProperties: false }),
  Type.Object({
    format: Type.Literal("opml"),
    opml: Type.String({ minLength: 10, maxLength: 524288 }),
    defaults: Type.Optional(Type.Object({
      sourceGroup: Type.Optional(SourceGroup),
      tier: Type.Optional(SourceTier),
      locale: Type.Optional(SourceLocale),
      schedule: Type.Optional(SourceSchedule),
      fetchPolicy: Type.Optional(SourceFetchPolicy),
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
    url: NullableText,
    title: NullableText,
    publishedAt: Type.Union([DateTime, Type.Null()]),
    summary: NullableText,
  })),
  feeds: Type.Array(Type.String()),
});
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
    coverage: Type.Union([Type.Literal("unknown"), Type.Literal("partial")]),
  }),
]);
export const ContentFilter = Type.Object(
  {
    sourceId: Type.Optional(Id),
    deliveryMode: Type.Optional(Type.Union([Type.Literal("pull"), Type.Literal("push")])),
    platform: Type.Optional(Platform),
    kind: Type.Optional(Kind),
    query: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 200,
        pattern: "^[^\\u0000-\\u001f]*$",
      }),
    ),
    anyTerms: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 200 }), {
        maxItems: 20,
      }),
    ),
    allTerms: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 200 }), {
        maxItems: 20,
      }),
    ),
    exclusions: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 200 }), {
        maxItems: 20,
      }),
    ),
    from: Type.Optional(DateTime),
    to: Type.Optional(DateTime),
    threadAware: Type.Optional(Type.Boolean()),
    signal: Type.Optional(Type.Union([Type.Literal("discussion"), Type.Literal("pain")])),
    sourceGroup: Type.Optional(Type.String({ pattern: SourceGroupPattern })),
    tier: Type.Optional(SourceTier),
    language: Type.Optional(Type.String({ pattern: SourceLocalePattern })),
    hasMedia: Type.Optional(Type.Boolean()),
    searchScope: Type.Optional(
      Type.Union([
        Type.Literal("title"),
        Type.Literal("text"),
        Type.Literal("title_text"),
      ]),
    ),
  },
  { additionalProperties: false },
);
export const ResearchFilter = strictMerge([ContentFilter, Type.Object({ projectId: Type.Optional(Id) })]);
export const ListQuery = strictMerge([
  ResearchFilter,
  Type.Object({
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    cursor: Type.Optional(Type.String({ maxLength: 4096 })),
  }),
]);
export const ContentFacetsQuery = strictMerge([
  Type.Omit(ResearchFilter, ["from", "to"]),
  Type.Object({
    from: DateTime,
    to: DateTime,
    bucket: Type.Optional(Type.Union([Type.Literal("day"), Type.Literal("6h")])),
  }),
]);
const FacetCounts = Type.Object({
  count: Type.Integer({ minimum: 0 }),
  matchedContentCount: Type.Integer({ minimum: 0 }),
});
const PlatformFacet = strictMerge([Type.Object({ platform: Platform }), FacetCounts]);
export const ContentFacets = strictMerge([
  FacetCounts,
  Type.Object({
    timeline: Type.Array(strictMerge([
      Type.Object({ bucket: DateTime, byPlatform: Type.Array(PlatformFacet) }),
      FacetCounts,
    ])),
    distributions: Type.Object({
      platforms: Type.Array(PlatformFacet),
      kinds: Type.Array(strictMerge([Type.Object({ kind: Kind }), FacetCounts])),
    }),
    coverage: Type.Literal("stored_sample"),
  }),
]);
export const ActorSchema = Type.Object({
  userId: Id,
  email: Type.String(),
  role: Type.Union([
    Type.Literal("owner"),
    Type.Literal("admin"),
    Type.Literal("viewer"),
  ]),
  clientKind: Type.Union([Type.Literal("browser"), Type.Literal("machine")]),
  sessionId: Id,
  scopes: Type.Array(Type.String()),
  allowedSourceIds: Type.Union([Type.Array(Id), Type.Null()]),
});
export const Scopes = [
  "sources:write",
  "read",
  "export",
  "ingest",
  "collect",
  "projects:write",
] as const;
export const ParamsId = Type.Object({ id: Id });
export const Login = Type.Object(
  {
    email: Type.String({ minLength: 3, maxLength: 254 }),
    password: Type.String({ minLength: 1, maxLength: 128 }),
  },
  { additionalProperties: false },
);
export const MachineKeyInput = Type.Object(
  {
    label: Type.String({ minLength: 1, maxLength: 100 }),
    scopes: Type.Array(Type.Union(Scopes.map((scope) => Type.Literal(scope))), {
      minItems: 1,
      uniqueItems: true,
    }),
    allowedSourceIds: Type.Array(Id, { maxItems: 1000, uniqueItems: true }),
    expiresInDays: Type.Integer({ minimum: 1, maximum: 90 }),
  },
  { additionalProperties: false },
);
export const Ingest = Type.Object(
  {
    items: Type.Array(
      strictMerge([
        Type.Omit(ContentItem, ["id"]),
        Type.Object({ id: Type.Optional(Id) }),
      ]),
      { minItems: 1, maxItems: 100 },
    ),
  },
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
export const ProjectInput = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 100 }),
    sourceIds: Type.Array(Id, { minItems: 1, maxItems: 100 }),
    filter: ContentFilter,
    threadAware: Type.Optional(Type.Boolean()),
    includePushInTrends: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type ContentPlatform = Static<typeof Platform>;
export type PublicContentKind = Static<typeof Kind>;
export type SourceTarget = Static<typeof Target>;
export type ContentReference = Static<typeof Reference>;
export type ContentAuthor = Static<typeof Author>;
export type ContentMedia = Static<typeof Media>;
export type PlatformDetails = Static<typeof Details>;
export type ContentObservation = Static<typeof Observation>;
export type PublicContent = Static<typeof Content>;
export type CollectionSource = Static<typeof Source>;
export type Filter = Static<typeof ContentFilter>;
export type Actor = Static<typeof ActorSchema>;
export interface MetricDefinition {
  key: string;
  label: string;
  unit: "count" | "ratio" | "rank";
  cumulative: boolean;
  signed: boolean;
  contentKinds: PublicContentKind[];
  direction: "higher" | "lower" | "neutral";
}
export interface SourceCapability {
  platform: ContentPlatform;
  provider: string;
  enabled: boolean;
  contentKinds: PublicContentKind[];
  targetTypes: SourceTarget["type"][];
  keywordSearch: "scoped" | "global" | "none";
  metrics: MetricDefinition[];
  observationModel: "archive" | "snapshot";
  limitations: string[];
  refreshByIds?: boolean;
  requestResourceUpperBound?: number;
  automaticRequestReplay?: boolean;
}
