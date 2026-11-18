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
export const Target = Type.Union([
  Type.Object(
    {
      type: Type.Literal("search"),
      query: Type.String({ minLength: 1, maxLength: 200 }),
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
    label: Type.String({ minLength: 1, maxLength: 100 }),
    target: Target,
    contentKind: Kind,
    deliveryMode: Type.Union([Type.Literal("pull"), Type.Literal("push")]),
  },
  { additionalProperties: false },
);
export const Source = strictMerge([
  Type.Omit(SourceInput, ["primaryProvider", "fallbackProvider"]),
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
    revision: Type.Integer(),
    coverage: Type.Union([Type.Literal("unknown"), Type.Literal("partial")]),
  }),
]);
export const ContentFilter = Type.Object(
  {
    sourceId: Type.Optional(Id),
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
