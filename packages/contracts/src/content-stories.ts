import { Type, type Static } from "@sinclair/typebox";
import {
  ChannelScope, DateTime, Id, Platform, SourceGroupPattern, SourceLocalePattern, SourceTier,
} from "./common";

const View = Type.Union([Type.Literal("latest"), Type.Literal("hot"), Type.Literal("digest")]);
export const MAX_STORY_LIMIT = 100;
export const MAX_STORY_OFFSET = 500;
export const StoryQuery = Type.Object({
  view: Type.Optional(View),
  date: Type.Optional(Type.String({ format: "date" })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_STORY_LIMIT })),
  offset: Type.Optional(Type.Integer({ minimum: 0, maximum: MAX_STORY_OFFSET })),
  sourceId: Type.Optional(Id),
  platform: Type.Optional(Platform),
  channelScope: Type.Optional(ChannelScope),
  sourceGroup: Type.Optional(Type.String({ pattern: SourceGroupPattern })),
  tier: Type.Optional(SourceTier),
  language: Type.Optional(Type.String({ pattern: SourceLocalePattern })),
  includeTrends: Type.Optional(Type.Boolean()),
  diverse: Type.Optional(Type.Boolean()),
  // Temporary drilldown filters triggered from Channel Insights interactions (do not alter base insights)
  term: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  topicId: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  bucketFrom: Type.Optional(DateTime),
  bucketTo: Type.Optional(DateTime),
  insightTier: Type.Optional(SourceTier),
  insightSourceGroup: Type.Optional(Type.String({ pattern: SourceGroupPattern })),
  insightLanguage: Type.Optional(Type.String({ pattern: SourceLocalePattern })),
  insightSourceId: Type.Optional(Id),
}, { additionalProperties: false });

export const StoryInsightsQuery = Type.Object({
  view: Type.Optional(View),
  date: Type.Optional(Type.String({ format: "date" })),
  sourceId: Type.Optional(Id),
  platform: Type.Optional(Platform),
  channelScope: Type.Optional(ChannelScope),
  sourceGroup: Type.Optional(Type.String({ pattern: SourceGroupPattern })),
  tier: Type.Optional(SourceTier),
  language: Type.Optional(Type.String({ pattern: SourceLocalePattern })),
  includeTrends: Type.Optional(Type.Boolean()),
  lang: Type.Optional(Type.Union([Type.Literal("zh"), Type.Literal("en")])),
}, { additionalProperties: false });

const nullableText = Type.Union([Type.String(), Type.Null()]);
const Evidence = Type.Object({
  id: Id,
  platform: Platform,
  title: Type.String(),
  url: nullableText,
  author: nullableText,
  thumbnail: nullableText,
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
  tierBreakdown: Type.Object({
    T1: Type.Integer({ minimum: 0 }),
    T1_5: Type.Integer({ minimum: 0 }),
    T2: Type.Integer({ minimum: 0 }),
  }),
  sparkline48h: Type.Array(Type.Number({ minimum: 0 }), { minItems: 8, maxItems: 8 }),
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
  totalCount: Type.Integer({ minimum: 0 }),
  nextOffset: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  coverage: Type.Literal("stored_sample"),
});
export type StoryFeed = Static<typeof StoryFeed>;
export type StoryEvidence = Static<typeof Evidence>;

const InsightPanelStatus = Type.Object({
  status: Type.Union([Type.Literal("ok"), Type.Literal("degraded"), Type.Literal("hidden")]),
  reason: Type.Optional(Type.String()),
});

export const StoryInsights = Type.Object({
  view: View,
  from: DateTime,
  to: DateTime,
  generatedAt: DateTime,
  timeAnchor: Type.Literal("published_or_discovered"),
  sample: Type.Object({
    analyzedCount: Type.Integer({ minimum: 0 }),
    windowTotalCount: Type.Integer({ minimum: 0 }),
    capped: Type.Boolean(),
    coverage: Type.Literal("stored_sample"),
  }),
  quality: Type.Object({
    textReadyCount: Type.Integer({ minimum: 0 }),
    textCoveragePct: Type.Number({ minimum: 0 }),
    activeSourceCount: Type.Integer({ minimum: 0 }),
    activeChannelCount: Type.Integer({ minimum: 0 }),
    activeTierCount: Type.Integer({ minimum: 0 }),
    activeLanguageCount: Type.Integer({ minimum: 0 }),
    isLowSample: Type.Boolean(),
  }),
  panels: Type.Object({
    activityTrend: InsightPanelStatus,
    hotKeywords: InsightPanelStatus,
    composition: InsightPanelStatus,
    risingTerms: InsightPanelStatus,
    topics: InsightPanelStatus,
  }),
  activityTrend: Type.Object({
    bucketGranularity: Type.Union([Type.Literal("2h"), Type.Literal("6h"), Type.Literal("day")]),
    summaryText: Type.String(),
    buckets: Type.Array(
      Type.Object({
        bucket: Type.String(),
        from: DateTime,
        to: DateTime,
        count: Type.Integer({ minimum: 0 }),
        isPartial: Type.Boolean(),
      }),
    ),
  }),
  hotKeywords: Type.Object({
    analyzedTextCount: Type.Integer({ minimum: 0 }),
    items: Type.Array(
      Type.Object({
        term: Type.String(),
        displayTerm: Type.String(),
        eventCount: Type.Integer({ minimum: 0 }),
        sharePct: Type.Number({ minimum: 0 }),
      }),
    ),
  }),
  composition: Type.Object({
    recommendedDimension: Type.Union([
      Type.Literal("channel"),
      Type.Literal("source"),
      Type.Literal("tier"),
      Type.Literal("language"),
    ]),
    allParticipatingSourceCount: Type.Integer({ minimum: 0 }),
    byChannel: Type.Array(
      Type.Object({
        key: Type.String(),
        label: Type.String(),
        count: Type.Integer({ minimum: 0 }),
        sharePct: Type.Number({ minimum: 0 }),
      }),
    ),
    bySource: Type.Array(
      Type.Object({
        key: Type.String(),
        label: Type.String(),
        tier: nullableText,
        isOther: Type.Boolean(),
        count: Type.Integer({ minimum: 0 }),
        sharePct: Type.Number({ minimum: 0 }),
      }),
    ),
    byTier: Type.Array(
      Type.Object({
        key: SourceTier,
        label: Type.String(),
        count: Type.Integer({ minimum: 0 }),
        sharePct: Type.Number({ minimum: 0 }),
      }),
    ),
    byLanguage: Type.Array(
      Type.Object({
        key: Type.String(),
        label: Type.String(),
        count: Type.Integer({ minimum: 0 }),
        sharePct: Type.Number({ minimum: 0 }),
      }),
    ),
  }),
  risingTerms: Type.Object({
    mode: Type.Union([Type.Literal("rising"), Type.Literal("emerging"), Type.Literal("hidden")]),
    comparabilityNote: Type.String(),
    splitAt: DateTime,
    previousWindowCount: Type.Integer({ minimum: 0 }),
    currentWindowCount: Type.Integer({ minimum: 0 }),
    items: Type.Array(
      Type.Object({
        term: Type.String(),
        displayTerm: Type.String(),
        currentCount: Type.Integer({ minimum: 0 }),
        previousCount: Type.Integer({ minimum: 0 }),
        currentRatePct: Type.Number({ minimum: 0 }),
        previousRatePct: Type.Number({ minimum: 0 }),
        deltaPctPoints: Type.Number(),
        isNew: Type.Boolean(),
        sparkline: Type.Array(Type.Integer({ minimum: 0 })),
      }),
    ),
  }),
  topics: Type.Object({
    mode: Type.Union([Type.Literal("nmf"), Type.Literal("cooccurrence_degraded"), Type.Literal("hidden")]),
    qualityNote: Type.Optional(Type.String()),
    clusterCount: Type.Integer({ minimum: 0 }),
    assignedCount: Type.Integer({ minimum: 0 }),
    unassignedCount: Type.Integer({ minimum: 0 }),
    items: Type.Array(
      Type.Object({
        topicId: Type.String(),
        label: Type.String(),
        keywords: Type.Array(Type.String()),
        docCount: Type.Integer({ minimum: 0 }),
        sharePct: Type.Number({ minimum: 0 }),
        isOther: Type.Boolean(),
        sampleTitles: Type.Array(Type.String()),
      }),
    ),
  }),
});

export type StoryInsights = Static<typeof StoryInsights>;
export type StoryInsightsQuery = Static<typeof StoryInsightsQuery>;

