import { Type, type Static } from "@sinclair/typebox";
import { DateTime, Id, NullableText } from "./common";

export const AiEventType = Type.Union([
  Type.Literal("model_release"),
  Type.Literal("model_update"),
  Type.Literal("api_release"),
  Type.Literal("preview"),
  Type.Literal("ga"),
  Type.Literal("pricing_change"),
  Type.Literal("deprecation"),
  Type.Literal("retirement"),
  Type.Literal("other"),
]);

export const AiEventStatus = Type.Union([
  Type.Literal("released"),
  Type.Literal("announced_future"),
  Type.Literal("deprecated"),
  Type.Literal("retired"),
]);

export const AiDatePrecision = Type.Union([
  Type.Literal("day"),
  Type.Literal("month"),
  Type.Literal("unknown"),
]);

export const AiCandidateStatus = Type.Union([
  Type.Literal("pending"),
  Type.Literal("needs_info"),
  Type.Literal("approved"),
  Type.Literal("rejected"),
  Type.Literal("merged"),
  Type.Literal("deferred"),
]);

export const AiBenchmarkCategory = Type.Union([
  Type.Literal("general"),
  Type.Literal("coding"),
  Type.Literal("reasoning"),
  Type.Literal("speed_price"),
]);

export const AiVendorSchema = Type.Object({
  id: Id,
  slug: Type.String(),
  name: Type.String(),
  websiteUrl: Type.String(),
  logoUrl: NullableText,
  displayOrder: Type.Integer(),
  eventCount: Type.Optional(Type.Integer({ minimum: 0 })),
  modelCount: Type.Optional(Type.Integer({ minimum: 0 })),
});

export const AiEventReferenceSchema = Type.Object({
  id: Id,
  url: Type.String(),
  title: NullableText,
  sourceKind: Type.String(),
  contentId: Type.Union([Id, Type.Null()]),
  articlePublishedAt: Type.Union([DateTime, Type.Null()]),
  excerpt: NullableText,
  isPrimary: Type.Boolean(),
  verifiedAt: Type.Union([DateTime, Type.Null()]),
});

export const AiModelSummarySchema = Type.Object({
  id: Id,
  vendorId: Id,
  vendorSlug: Type.String(),
  vendorName: Type.String(),
  slug: Type.String(),
  family: NullableText,
  officialName: Type.String(),
  officialApiId: NullableText,
  modelKind: Type.String(),
  lifecycleState: Type.String(),
  openWeights: Type.Union([Type.Boolean(), Type.Null()]),
  licenseName: NullableText,
  modalities: Type.Array(Type.String()),
  contextWindow: Type.Union([Type.Integer(), Type.Null()]),
  summaryZh: NullableText,
  summaryEn: NullableText,
  revision: Type.Integer({ minimum: 1 }),
  updatedAt: DateTime,
});

export const AiSpecObservationSchema = Type.Object({
  id: Id,
  sourceKind: Type.String(),
  providerName: NullableText,
  contextLength: Type.Union([Type.Integer(), Type.Null()]),
  maxOutputTokens: Type.Union([Type.Integer(), Type.Null()]),
  currency: Type.String(),
  priceUnit: Type.String(),
  inputPrice: NullableText,
  outputPrice: NullableText,
  cacheReadPrice: NullableText,
  rawUnitNote: NullableText,
  observedAt: DateTime,
});

export const AiReleaseEventSchema = Type.Object({
  id: Id,
  vendorId: Id,
  vendorSlug: Type.String(),
  vendorName: Type.String(),
  modelId: Type.Union([Id, Type.Null()]),
  modelSlug: NullableText,
  modelName: NullableText,
  eventType: AiEventType,
  eventStatus: AiEventStatus,
  publicationStatus: Type.Union([
    Type.Literal("published"),
    Type.Literal("unpublished"),
    Type.Literal("corrected"),
  ]),
  title: Type.String(),
  eventDate: Type.String({ format: "date" }),
  datePrecision: Type.Union([Type.Literal("day"), Type.Literal("month")]),
  officialAnnouncedOn: Type.Union([Type.String({ format: "date" }), Type.Null()]),
  availableFrom: Type.Union([Type.String({ format: "date" }), Type.Null()]),
  effectiveOn: Type.Union([Type.String({ format: "date" }), Type.Null()]),
  summaryZh: NullableText,
  summaryEn: NullableText,
  keyChanges: Type.Array(Type.String()),
  sourceTier: Type.String(),
  verifiedAt: DateTime,
  revision: Type.Integer({ minimum: 1 }),
  references: Type.Array(AiEventReferenceSchema),
});

export const AiEventsQuery = Type.Object({
  vendor: Type.Optional(Type.String({ maxLength: 64 })),
  eventType: Type.Optional(AiEventType),
  eventStatus: Type.Optional(AiEventStatus),
  from: Type.Optional(Type.String({ format: "date" })),
  to: Type.Optional(Type.String({ format: "date" })),
  q: Type.Optional(Type.String({ maxLength: 120 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 5000 })),
}, { additionalProperties: false });

export const AiModelsQuery = Type.Object({
  vendor: Type.Optional(Type.String({ maxLength: 64 })),
  q: Type.Optional(Type.String({ maxLength: 120 })),
  lifecycleState: Type.Optional(Type.String({ maxLength: 32 })),
  openWeights: Type.Optional(Type.Boolean()),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 5000 })),
}, { additionalProperties: false });

export const AiUpdatesQuery = Type.Object({
  vendor: Type.Optional(Type.String({ maxLength: 64 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 60 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 1000 })),
}, { additionalProperties: false });

export const AiCandidatePatchBody = Type.Object({
  expectedRevision: Type.Integer({ minimum: 1 }),
  status: Type.Optional(AiCandidateStatus),
  vendorId: Type.Optional(Type.Union([Id, Type.Null()])),
  modelId: Type.Optional(Type.Union([Id, Type.Null()])),
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 240 })),
  suggestedEventType: Type.Optional(AiEventType),
  suggestedDate: Type.Optional(Type.Union([Type.String({ format: "date" }), Type.Null()])),
  datePrecision: Type.Optional(AiDatePrecision),
  reviewerNote: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),
  draftPayload: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
}, { additionalProperties: false });

export const AiPublishCandidateBody = Type.Object({
  expectedRevision: Type.Integer({ minimum: 1 }),
  vendorId: Id,
  modelId: Type.Optional(Type.Union([Id, Type.Null()])),
  eventType: AiEventType,
  eventStatus: Type.Optional(AiEventStatus),
  title: Type.String({ minLength: 1, maxLength: 240 }),
  eventDate: Type.String({ format: "date" }),
  datePrecision: Type.Union([Type.Literal("day"), Type.Literal("month")]),
  officialAnnouncedOn: Type.Optional(Type.Union([Type.String({ format: "date" }), Type.Null()])),
  availableFrom: Type.Optional(Type.Union([Type.String({ format: "date" }), Type.Null()])),
  effectiveOn: Type.Optional(Type.Union([Type.String({ format: "date" }), Type.Null()])),
  summaryZh: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),
  summaryEn: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),
  keyChanges: Type.Optional(Type.Array(Type.String({ maxLength: 240 }), { maxItems: 12 })),
  sourceTier: Type.Optional(Type.Union([
    Type.Literal("official"),
    Type.Literal("historical_verified"),
    Type.Literal("manual_verified"),
  ])),
  primaryReferenceUrl: Type.String({ minLength: 8, maxLength: 2000 }),
  primaryReferenceTitle: Type.Optional(Type.String({ maxLength: 240 })),
  createAlias: Type.Optional(Type.Object({
    sourceNamespace: Type.Union([
      Type.Literal("official"),
      Type.Literal("openrouter"),
      Type.Literal("litellm"),
      Type.Literal("hf"),
      Type.Literal("epoch"),
      Type.Literal("manual"),
    ]),
    alias: Type.String({ minLength: 1, maxLength: 256 }),
  })),
}, { additionalProperties: false });

export const AiLlmExtractionSchema = Type.Object({
  vendor: NullableText,
  official_model_name: NullableText,
  official_model_id: NullableText,
  event_type: Type.Union([
    Type.Literal("model_release"),
    Type.Literal("model_update"),
    Type.Literal("api_release"),
    Type.Literal("pricing_change"),
    Type.Literal("deprecation"),
    Type.Literal("other"),
    Type.Literal("unknown"),
  ]),
  announced_on: Type.Union([Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }), Type.Null()]),
  available_from: Type.Union([Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }), Type.Null()]),
  summary_zh: NullableText,
  key_changes: Type.Array(Type.String({ maxLength: 240 }), { maxItems: 8 }),
  use_cases: Type.Array(Type.String({ maxLength: 240 }), { maxItems: 8 }),
  evidence: Type.Array(Type.Object({
    field: Type.String(),
    source_reference_id: Type.String(),
    excerpt: Type.String({ maxLength: 400 }),
    claim: Type.String({ maxLength: 300 }),
  }), { maxItems: 20 }),
  insufficient_evidence: Type.Boolean(),
}, { additionalProperties: false });

export type AiVendor = Static<typeof AiVendorSchema>;
export type AiReleaseEvent = Static<typeof AiReleaseEventSchema>;
export type AiModelSummary = Static<typeof AiModelSummarySchema>;
export type AiLlmExtraction = Static<typeof AiLlmExtractionSchema>;
export const AiVendorSourceRoles = ["blog", "changelog", "docs", "release_notes", "model_card", "other"] as const;
export const AiVendorSourceBinding = Type.Object({
  sourceId: Type.String({ format: "uuid" }),
  vendorId: Type.String({ format: "uuid" }),
  sourceRole: Type.Union(AiVendorSourceRoles.map(role => Type.Literal(role))),
  isOfficial: Type.Boolean(),
}, { additionalProperties: false });
export type VendorSourceBinding = Static<typeof AiVendorSourceBinding>;
