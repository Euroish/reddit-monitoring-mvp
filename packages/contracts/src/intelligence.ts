import { Type, type Static } from "@sinclair/typebox";
import { DateTime, Id, Platform } from "./common";

export const MonitorKind = Type.Union([
  Type.Literal("keyword"),
  Type.Literal("author_list"),
  Type.Literal("community_bundle"),
]);

export const SocialPlatform = Type.Union([
  Type.Literal("reddit"),
  Type.Literal("x"),
]);

export const MonitorConfig = Type.Object({
  platforms: Type.Array(SocialPlatform, { minItems: 1, maxItems: 2, uniqueItems: true }),
  keywords: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 160 }), { maxItems: 10, uniqueItems: true })),
  competitorKeywords: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 160 }), { maxItems: 10, uniqueItems: true })),
  handles: Type.Optional(Type.Array(Type.Object({
    platform: SocialPlatform,
    handle: Type.String({ minLength: 1, maxLength: 64 }),
  }, { additionalProperties: false }), { maxItems: 60 })),
  subreddits: Type.Optional(Type.Array(Type.String({ minLength: 2, maxLength: 40 }), { maxItems: 30, uniqueItems: true })),
  sort: Type.Optional(Type.Union([Type.Literal("top"), Type.Literal("hot"), Type.Literal("new")])),
  minLikes: Type.Optional(Type.Integer({ minimum: 0, maximum: 1000000 })),
  minComments: Type.Optional(Type.Integer({ minimum: 0, maximum: 100000 })),
  excludeReposts: Type.Optional(Type.Boolean()),
  language: Type.Optional(Type.String({ minLength: 2, maxLength: 8 })),
}, { additionalProperties: false });

export const MonitorCreateBody = Type.Object({
  kind: MonitorKind,
  name: Type.String({ minLength: 1, maxLength: 120 }),
  config: MonitorConfig,
  scheduleIntervalHours: Type.Optional(Type.Integer({ minimum: 1, maximum: 168 })),
  dailyItemBudget: Type.Optional(Type.Integer({ minimum: 20, maximum: 20000 })),
  enabled: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

export const MonitorPatchBody = Type.Object({
  revision: Type.Integer({ minimum: 1 }),
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  config: Type.Optional(MonitorConfig),
  scheduleIntervalHours: Type.Optional(Type.Integer({ minimum: 1, maximum: 168 })),
  dailyItemBudget: Type.Optional(Type.Integer({ minimum: 20, maximum: 20000 })),
  enabled: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

export const IntelMonitor = Type.Object({
  id: Id,
  kind: MonitorKind,
  name: Type.String(),
  config: MonitorConfig,
  scheduleIntervalHours: Type.Integer(),
  dailyItemBudget: Type.Integer(),
  enabled: Type.Boolean(),
  revision: Type.Integer(),
  sourceCount: Type.Integer({ minimum: 0 }),
  targetCount: Type.Integer({ minimum: 0 }),
  lastSuccessAt: Type.Union([DateTime, Type.Null()]),
  createdAt: DateTime,
  updatedAt: DateTime,
});

export const MonitorCollectBody = Type.Object({
  lookbackHours: Type.Optional(Type.Integer({ minimum: 1, maximum: 720 })),
  limitPerSource: Type.Optional(Type.Integer({ minimum: 10, maximum: 200 })),
  includeComments: Type.Optional(Type.Boolean()),
  maxCommentsPerPost: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
}, { additionalProperties: false });

export const MonitorOverviewQuery = Type.Object({
  days: Type.Optional(Type.Integer({ minimum: 1, maximum: 90 })),
  bucket: Type.Optional(Type.Union([Type.Literal("6h"), Type.Literal("1d")])),
}, { additionalProperties: false });

export const MonitorPostsQuery = Type.Object({
  sort: Type.Optional(Type.Union([
    Type.Literal("heat"), Type.Literal("score"), Type.Literal("comments"),
    Type.Literal("views"), Type.Literal("newest"),
  ])),
  platform: Type.Optional(Platform),
  intent: Type.Optional(Type.String({ maxLength: 32 })),
  community: Type.Optional(Type.String({ maxLength: 64 })),
  author: Type.Optional(Type.String({ maxLength: 64 })),
  domain: Type.Optional(Type.String({ maxLength: 120 })),
  days: Type.Optional(Type.Integer({ minimum: 1, maximum: 90 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 2000 })),
}, { additionalProperties: false });

export const AuthorListQuery = Type.Object({
  platform: Type.Optional(SocialPlatform),
  monitorId: Type.Optional(Id),
  search: Type.Optional(Type.String({ maxLength: 64 })),
  sort: Type.Optional(Type.Union([Type.Literal("followers"), Type.Literal("engagement"), Type.Literal("posts")])),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
}, { additionalProperties: false });

export const AuthorProfileParams = Type.Object({
  platform: SocialPlatform,
  handle: Type.String({ minLength: 1, maxLength: 64 }),
}, { additionalProperties: false });

export const AuthorProfileQuery = Type.Object({
  days: Type.Optional(Type.Integer({ minimum: 1, maximum: 90 })),
  monitorId: Type.Optional(Id),
}, { additionalProperties: false });

export const CommunityListQuery = Type.Object({
  monitorId: Type.Optional(Id),
  days: Type.Optional(Type.Integer({ minimum: 1, maximum: 90 })),
  sort: Type.Optional(Type.Union([Type.Literal("heat"), Type.Literal("posts"), Type.Literal("comments")])),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
}, { additionalProperties: false });

export const CommunityParams = Type.Object({
  subreddit: Type.String({ minLength: 2, maxLength: 40 }),
}, { additionalProperties: false });

export const CommunityDeepDiveQuery = Type.Object({
  days: Type.Optional(Type.Integer({ minimum: 1, maximum: 90 })),
  monitorId: Type.Optional(Id),
}, { additionalProperties: false });

export type IntelMonitorDto = Static<typeof IntelMonitor>;
export type MonitorConfigValue = Static<typeof MonitorConfig>;
export type MonitorKindValue = Static<typeof MonitorKind>;
