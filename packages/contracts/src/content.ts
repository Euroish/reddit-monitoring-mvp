import { Type, type Static } from "@sinclair/typebox";
import {
  DateTime, Id, Kind, NullableText, Platform,
  SourceGroupPattern, SourceLocalePattern, SourceTier, strictMerge,
} from "./common";

export const CardLayout = Type.Union([
  Type.Literal("hero_media"),
  Type.Literal("quote_social"),
  Type.Literal("discussion_thread"),
  Type.Literal("link_preview"),
  Type.Literal("compact_signal"),
]);

export const IntentTag = Type.Union([
  Type.Literal("discussion"),
  Type.Literal("question"),
  Type.Literal("comparison"),
  Type.Literal("pain"),
  Type.Literal("launch"),
  Type.Literal("news"),
]);

export const Reference = Type.Object(
  {
    kind: Kind,
    externalId: Type.String({ minLength: 1, maxLength: 1000 }),
    relation: Type.Union([
      Type.Literal("reply_to"), Type.Literal("thread_root"), Type.Literal("quote"), Type.Literal("repost"),
    ]),
  },
  { additionalProperties: false },
);

const OptionalNullableText = Type.Optional(NullableText);
const OptionalNullableCount = Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]));
const OptionalNullableBool = Type.Optional(Type.Union([Type.Boolean(), Type.Null()]));

export const Author = Type.Object(
  {
    externalId: NullableText,
    handle: NullableText,
    displayName: NullableText,
    url: NullableText,
    avatarUrl: OptionalNullableText,
    bio: OptionalNullableText,
    location: OptionalNullableText,
    verified: OptionalNullableBool,
    followersCount: OptionalNullableCount,
    followingCount: OptionalNullableCount,
    statusesCount: OptionalNullableCount,
    accountCreatedAt: Type.Optional(Type.Union([DateTime, Type.Null()])),
  },
  { additionalProperties: false },
);

export const Media = Type.Object(
  {
    type: Type.Union([Type.Literal("image"), Type.Literal("video"), Type.Literal("audio"), Type.Literal("link")]),
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
      domain: OptionalNullableText,
      isSelf: OptionalNullableBool,
      stickied: OptionalNullableBool,
      awards: OptionalNullableCount,
      crossposts: OptionalNullableCount,
      authorFlair: OptionalNullableText,
      subredditSubscribers: OptionalNullableCount,
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
      hashtags: Type.Optional(Type.Array(Type.String({ maxLength: 100 }), { maxItems: 50 })),
      mentions: Type.Optional(Type.Array(Type.String({ maxLength: 100 }), { maxItems: 50 })),
      cashtags: Type.Optional(Type.Array(Type.String({ maxLength: 40 }), { maxItems: 30 })),
      externalDomain: OptionalNullableText,
      extensions,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      platform: Type.Literal("web"), publisher: NullableText, canonicalUrl: NullableText, feedUrl: NullableText,
      channel: Type.Optional(NullableText),
      textCompleteness: Type.Optional(Type.Union([Type.Literal("full"), Type.Literal("summary"), Type.Literal("title_only")])),
      extensions,
    },
    { additionalProperties: false },
  ),
  Type.Object({ platform: Type.Literal("bluesky"), cid: NullableText, extensions }, { additionalProperties: false }),
]);

export const Observation = Type.Object(
  {
    sourceId: Id,
    provider: Type.String({ minLength: 1, maxLength: 64 }),
    sourceObservedAt: Type.Union([DateTime, Type.Null()]),
    fetchedAt: DateTime,
    timeBasis: Type.Union([
      Type.Literal("archive_initial"), Type.Literal("archive_refresh"), Type.Literal("provider_snapshot"), Type.Literal("unknown"),
    ]),
    maturity: Type.Union([Type.Literal("initial"), Type.Literal("refreshed"), Type.Literal("unknown")]),
    metrics: Type.Record(Type.String({ maxLength: 100 }), Type.Union([Type.Number(), Type.Null()])),
    evidenceKey: Type.String({ minLength: 1, maxLength: 256 }),
  },
  { additionalProperties: false },
);

export const ContentItem = Type.Object(
  {
    id: Id, platform: Platform, kind: Kind, externalId: Type.String({ minLength: 1, maxLength: 1000 }),
    title: NullableText, text: NullableText, url: NullableText, language: NullableText,
    author: Type.Union([Author, Type.Null()]), publishedAt: Type.Union([DateTime, Type.Null()]), fetchedAt: DateTime,
    availability: Type.Union([Type.Literal("available"), Type.Literal("removed"), Type.Literal("deleted"), Type.Literal("unknown")]),
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
    textState: Type.Union([Type.Literal("full"), Type.Literal("missing"), Type.Literal("summary"), Type.Literal("truncated")]),
  }),
]);

export const ContentFilter = Type.Object(
  {
    sourceId: Type.Optional(Id),
    deliveryMode: Type.Optional(Type.Union([Type.Literal("pull"), Type.Literal("push")])),
    platform: Type.Optional(Platform),
    kind: Type.Optional(Kind),
    query: Type.Optional(Type.String({ minLength: 1, maxLength: 200, pattern: "^[^\\u0000-\\u001f]*$" })),
    anyTerms: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { maxItems: 20 })),
    allTerms: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { maxItems: 20 })),
    exclusions: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { maxItems: 20 })),
    from: Type.Optional(DateTime),
    to: Type.Optional(DateTime),
    threadAware: Type.Optional(Type.Boolean()),
    signal: Type.Optional(Type.Union([Type.Literal("discussion"), Type.Literal("pain")])),
    sourceGroup: Type.Optional(Type.String({ pattern: SourceGroupPattern })),
    tier: Type.Optional(SourceTier),
    language: Type.Optional(Type.String({ pattern: SourceLocalePattern })),
    hasMedia: Type.Optional(Type.Boolean()),
    searchScope: Type.Optional(Type.Union([Type.Literal("title"), Type.Literal("text"), Type.Literal("title_text")])),
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

const FacetCounts = Type.Object({ count: Type.Integer({ minimum: 0 }), matchedContentCount: Type.Integer({ minimum: 0 }) });
const PlatformFacet = strictMerge([Type.Object({ platform: Platform }), FacetCounts]);
export const ContentFacets = strictMerge([
  FacetCounts,
  Type.Object({
    timeline: Type.Array(strictMerge([Type.Object({ bucket: DateTime, byPlatform: Type.Array(PlatformFacet) }), FacetCounts])),
    distributions: Type.Object({
      platforms: Type.Array(PlatformFacet),
      kinds: Type.Array(strictMerge([Type.Object({ kind: Kind }), FacetCounts])),
    }),
    coverage: Type.Literal("stored_sample"),
  }),
]);

export type ContentReference = Static<typeof Reference>;
export type ContentAuthor = Static<typeof Author>;
export type ContentMedia = Static<typeof Media>;
export type PlatformDetails = Static<typeof Details>;
export type ContentObservation = Static<typeof Observation>;
export type PublicContent = Static<typeof Content>;
export type Filter = Static<typeof ContentFilter>;
export type ContentCardLayout = Static<typeof CardLayout>;
export type ContentIntentTag = Static<typeof IntentTag>;
