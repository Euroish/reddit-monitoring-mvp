import { Type, type Static } from "@sinclair/typebox";
import {
  ChannelScope, DateTime, Id, NullableText, Platform, SourceGroupPattern, SourceLocalePattern,
} from "./common";
import { CardLayout, IntentTag } from "./content";

export const FeedMode = Type.Union([
  Type.Literal("foryou"),
  Type.Literal("hot"),
  Type.Literal("following"),
  Type.Literal("explore"),
]);

export const FeedReasonChannel = Type.Union([
  Type.Literal("affinity"),
  Type.Literal("hot"),
  Type.Literal("explore"),
  Type.Literal("rising"),
  Type.Literal("following"),
]);

export const FeedEventType = Type.Union([
  Type.Literal("impression"),
  Type.Literal("dwell"),
  Type.Literal("open"),
  Type.Literal("bookmark"),
  Type.Literal("useful"),
  Type.Literal("dismiss"),
  Type.Literal("mute_source"),
  Type.Literal("mute_topic"),
  Type.Literal("mute_author"),
]);

export const FeedCard = Type.Object({
  id: Id,
  platform: Platform,
  cardLayout: CardLayout,
  headline: Type.String(),
  tldr: NullableText,
  url: NullableText,
  media: Type.Array(Type.Object({
    type: Type.Union([Type.Literal("image"), Type.Literal("video"), Type.Literal("audio"), Type.Literal("link")]),
    url: Type.String(),
    previewUrl: NullableText,
    domain: NullableText,
  })),
  discussion: Type.Object({
    score: Type.Union([Type.Integer(), Type.Null()]),
    comments: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    views: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    likes: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    reposts: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    upvoteRatio: Type.Union([Type.Number(), Type.Null()]),
    unifiedHeat: Type.Number({ minimum: 0, maximum: 100 }),
    heatVelocity: Type.Union([Type.Literal("surging"), Type.Literal("rising"), Type.Literal("steady")]),
  }),
  author: Type.Union([
    Type.Object({
      handle: Type.String(),
      displayName: NullableText,
      avatarUrl: NullableText,
      verified: Type.Boolean(),
      followersCount: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    }),
    Type.Null(),
  ]),
  source: Type.Object({
    id: Id,
    label: Type.String(),
    community: NullableText,
    flair: NullableText,
    lane: Type.String(),
  }),
  topCommentsPreview: Type.Array(Type.Object({
    author: Type.String(),
    text: Type.String(),
    score: Type.Union([Type.Integer(), Type.Null()]),
  })),
  tags: Type.Array(Type.String()),
  intentTag: Type.Union([IntentTag, Type.Null()]),
  publishedAt: Type.Union([DateTime, Type.Null()]),
  reason: Type.Object({
    channel: FeedReasonChannel,
    label: Type.String(),
  }),
  viewerState: Type.Object({
    bookmarked: Type.Boolean(),
    useful: Type.Boolean(),
  }),
});

export const FeedStreamQuery = Type.Object({
  mode: Type.Optional(FeedMode),
  topic: Type.Optional(Type.String({ pattern: SourceGroupPattern })),
  platform: Type.Optional(Platform),
  channelScope: Type.Optional(ChannelScope),
  language: Type.Optional(Type.String({ pattern: SourceLocalePattern })),
  includeNews: Type.Optional(Type.Boolean()),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 40 })),
  excludeIds: Type.Optional(Type.String({ maxLength: 4500 })),
  seed: Type.Optional(Type.String({ maxLength: 64 })),
}, { additionalProperties: false });

export const FeedStreamResponse = Type.Object({
  mode: FeedMode,
  personalized: Type.Boolean(),
  items: Type.Array(FeedCard),
  meta: Type.Object({
    candidateCount: Type.Integer({ minimum: 0 }),
    unseenRemaining: Type.Integer({ minimum: 0 }),
    exploreRatio: Type.Number({ minimum: 0, maximum: 0.5 }),
    channelMix: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
  }),
});

export const FeedHotQuery = Type.Object({
  window: Type.Optional(Type.Union([Type.Literal("6h"), Type.Literal("24h"), Type.Literal("48h"), Type.Literal("7d")])),
  platform: Type.Optional(Platform),
  channelScope: Type.Optional(ChannelScope),
  topic: Type.Optional(Type.String({ pattern: SourceGroupPattern })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 60 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 300 })),
}, { additionalProperties: false });

export const FeedHotResponse = Type.Object({
  window: Type.String(),
  from: DateTime,
  to: DateTime,
  totalCount: Type.Integer({ minimum: 0 }),
  nextOffset: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  items: Type.Array(Type.Object({
    rank: Type.Integer({ minimum: 1 }),
    card: FeedCard,
    sparkline: Type.Array(Type.Number()),
    corroborationCount: Type.Integer({ minimum: 1 }),
  })),
});

export const FeedEventBatchBody = Type.Object({
  events: Type.Array(Type.Object({
    contentId: Id,
    eventType: FeedEventType,
    dwellMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 600000 })),
    meta: Type.Optional(Type.Record(Type.String({ maxLength: 40 }), Type.String({ maxLength: 200 }))),
  }, { additionalProperties: false }), { minItems: 1, maxItems: 50 }),
}, { additionalProperties: false });

export const FeedPreferences = Type.Object({
  exploreRatio: Type.Number({ minimum: 0, maximum: 0.5 }),
  followedTopics: Type.Array(Type.String()),
  mutedSources: Type.Array(Id),
  mutedKeywords: Type.Array(Type.String()),
  mutedAuthors: Type.Array(Type.String()),
  includeNewsLane: Type.Boolean(),
  updatedAt: Type.Union([DateTime, Type.Null()]),
});

export const FeedPreferencesPatch = Type.Object({
  exploreRatio: Type.Optional(Type.Number({ minimum: 0, maximum: 0.5 })),
  followedTopics: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 48 }), { maxItems: 30, uniqueItems: true })),
  mutedSources: Type.Optional(Type.Array(Id, { maxItems: 100, uniqueItems: true })),
  mutedKeywords: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 80 }), { maxItems: 50, uniqueItems: true })),
  mutedAuthors: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 80 }), { maxItems: 100, uniqueItems: true })),
  includeNewsLane: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

export type FeedCardDto = Static<typeof FeedCard>;
export type FeedEventTypeValue = Static<typeof FeedEventType>;
export type FeedModeValue = Static<typeof FeedMode>;
