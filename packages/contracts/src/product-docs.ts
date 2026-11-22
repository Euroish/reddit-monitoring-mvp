import { Type, type Static } from "@sinclair/typebox";
import { DateTime, Id, NullableText } from "./common";

export const DocCategory = Type.Union([
  Type.Literal("feature"), Type.Literal("terms"), Type.Literal("notice"),
]);
export const DocKind = Type.Union([
  Type.Literal("markdown"), Type.Literal("link"), Type.Literal("file"),
]);
export const DocStatus = Type.Union([Type.Literal("draft"), Type.Literal("published")]);
export const DocFile = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200 }),
  mime: Type.String({ minLength: 3, maxLength: 120 }),
  dataBase64: Type.String({ minLength: 1, maxLength: 12000000 }),
}, { additionalProperties: false });

export const DocInput = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 120 }),
  category: DocCategory,
  summary: Type.Optional(Type.String({ maxLength: 400 })),
  kind: DocKind,
  bodyMd: Type.Optional(Type.String({ maxLength: 200000 })),
  externalUrl: Type.Optional(Type.String({ maxLength: 2048 })),
  pinned: Type.Optional(Type.Boolean()),
  sortRank: Type.Optional(Type.Integer({ minimum: 0, maximum: 9999 })),
  status: Type.Optional(DocStatus),
  file: Type.Optional(DocFile),
}, { additionalProperties: false });

export const DocPatch = Type.Object({
  ...Type.Partial(DocInput).properties,
  expectedRevision: Type.Optional(Type.Integer({ minimum: 1 })),
}, { additionalProperties: false });

export const DocSummary = Type.Object({
  id: Id,
  slug: Type.String(),
  category: DocCategory,
  title: Type.String(),
  summary: Type.String(),
  kind: DocKind,
  pinned: Type.Boolean(),
  sortRank: Type.Integer(),
  status: DocStatus,
  externalUrl: NullableText,
  fileName: NullableText,
  fileSize: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  updatedAt: DateTime,
}, { additionalProperties: false });

export const DocDetail = Type.Object({
  ...DocSummary.properties,
  bodyMd: Type.String(),
  fileMime: NullableText,
  revision: Type.Integer({ minimum: 1 }),
  createdAt: DateTime,
}, { additionalProperties: false });

export type DocCategory = Static<typeof DocCategory>;
export type DocKind = Static<typeof DocKind>;
export type DocStatus = Static<typeof DocStatus>;
export type DocInput = Static<typeof DocInput>;
export type DocPatch = Static<typeof DocPatch>;
export type DocSummary = Static<typeof DocSummary>;
export type DocDetail = Static<typeof DocDetail>;
