import { Type, type Static } from "@sinclair/typebox";
import { DateTime, Id, Platform, SourceTier } from "./source-content";

const View = Type.Union([Type.Literal("latest"), Type.Literal("hot"), Type.Literal("digest")]);
export const StoryQuery = Type.Object({
  view: Type.Optional(View),
  date: Type.Optional(Type.String({ format: "date" })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
  sourceId: Type.Optional(Id),
  platform: Type.Optional(Platform),
}, { additionalProperties: false });

const nullableText = Type.Union([Type.String(), Type.Null()]);
const Evidence = Type.Object({
  id: Id,
  platform: Platform,
  title: Type.String(),
  url: nullableText,
  author: nullableText,
  sourceId: Id,
  sourceLabel: Type.String(),
  tier: SourceTier,
  publishedAt: Type.Union([DateTime, Type.Null()]),
  discoveredAt: DateTime,
});

const Story = Type.Object({
  storyKey: Type.String(),
  representative: Evidence,
  excerpt: nullableText,
  related: Type.Array(Evidence),
  relatedCount: Type.Integer(),
  sourceCount: Type.Integer(),
  heat48h: Type.Number(),
  change6h: Type.Union([Type.Number(), Type.Null()]),
  trend: Type.Union([Type.Literal("up"), Type.Literal("down"), Type.Literal("flat"), Type.Literal("new"), Type.Literal("unknown")]),
  badges: Type.Array(Type.Union([Type.Literal("surge"), Type.Literal("rising"), Type.Literal("new")])),
  updatedAt: DateTime,
});

export const StoryFeed = Type.Object({
  view: View,
  from: DateTime,
  to: DateTime,
  items: Type.Array(Story),
  coverage: Type.Literal("stored_sample"),
});
export type StoryFeed = Static<typeof StoryFeed>;
export type StoryEvidence = Static<typeof Evidence>;
