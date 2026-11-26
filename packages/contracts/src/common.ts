import { Type, type Static, type TObject } from "@sinclair/typebox";

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
export const DateTime = Type.String({ format: "date-time" });
export const NullableText = Type.Union([Type.String(), Type.Null()]);
export const ParamsId = Type.Object({ id: Id });

export const Platform = Type.Union([
  Type.Literal("reddit"),
  Type.Literal("x"),
  Type.Literal("bluesky"),
  Type.Literal("web"),
]);

export const ChannelScope = Type.Union([
  Type.Literal("info"),
  Type.Literal("social"),
  Type.Literal("all"),
]);
export type ChannelScope = Static<typeof ChannelScope>;

export const Kind = Type.Union([
  Type.Literal("post"),
  Type.Literal("comment"),
  Type.Literal("article"),
  Type.Literal("image"),
  Type.Literal("video"),
]);

export const SourceTier = Type.Union([
  Type.Literal("T1"),
  Type.Literal("T1_5"),
  Type.Literal("T2"),
]);

export const SourceGroupPattern = "^[a-z0-9][a-z0-9_-]{0,47}$";
export const SourceGroup = Type.Union([Type.String({ pattern: SourceGroupPattern }), Type.Null()]);
export const SourceLocalePattern = "^[a-z]{2}(?:-[A-Z]{2})?$";
export const SourceLocale = Type.Union([Type.String({ pattern: SourceLocalePattern }), Type.Null()]);

export type ContentPlatform = Static<typeof Platform>;
export type PublicContentKind = Static<typeof Kind>;
