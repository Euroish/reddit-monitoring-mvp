import { randomUUID } from "node:crypto";
import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { ParamsId, type Actor } from "../../../packages/contracts/src/source-content";
import { fail } from "../../storage/db";

/**
 * Product documentation pages (052 -> 053: doc_page).
 * One row per document. kind=markdown renders an internal page, kind=link points
 * at an external (already hosted) URL, kind=file stores one attachment (PDF) inline.
 */

const DocCategory = Type.Union([
  Type.Literal("feature"),
  Type.Literal("terms"),
  Type.Literal("notice"),
]);
const DocKind = Type.Union([
  Type.Literal("markdown"),
  Type.Literal("link"),
  Type.Literal("file"),
]);
const DocStatus = Type.Union([Type.Literal("draft"), Type.Literal("published")]);

const DocFile = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 200 }),
    mime: Type.String({ minLength: 3, maxLength: 120 }),
    dataBase64: Type.String({ minLength: 1, maxLength: 12000000 }),
  },
  { additionalProperties: false },
);

const DocPayload = Type.Object(
  {
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
  },
  { additionalProperties: false },
);

const DocPatch = Type.Partial(DocPayload, { additionalProperties: false });

const ParamsSlug = Type.Object(
  { slug: Type.String({ minLength: 1, maxLength: 80 }) },
  { additionalProperties: false },
);

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const SUMMARY_COLS =
  "id,slug,category,title,summary,kind,pinned,sort_rank,status,external_url,file_name,file_mime,octet_length(file_bytes) AS file_size,updated_at";

interface DocRow {
  id: string;
  slug: string;
  category: string;
  title: string;
  summary: string;
  kind: string;
  body_md?: string;
  pinned: boolean;
  sort_rank: number;
  status: string;
  external_url: string | null;
  file_name: string | null;
  file_mime: string | null;
  file_bytes?: Buffer | null;
  file_size: number | null;
  revision?: number;
  created_at?: Date;
  updated_at: Date;
}

function isManager(actor: Actor | null | undefined) {
  return Boolean(actor && actor.clientKind === "browser" && actor.role !== "viewer");
}

function toSummary(row: DocRow) {
  return {
    id: row.id,
    slug: row.slug,
    category: row.category,
    title: row.title,
    summary: row.summary,
    kind: row.kind,
    pinned: row.pinned,
    sortRank: row.sort_rank,
    status: row.status,
    externalUrl: row.external_url,
    fileName: row.file_name,
    fileSize: row.file_size === null ? null : Number(row.file_size),
    updatedAt: row.updated_at,
  };
}

function toDetail(row: DocRow) {
  return {
    ...toSummary(row),
    bodyMd: row.body_md ?? "",
    fileMime: row.file_mime,
    revision: row.revision ?? 1,
    createdAt: row.created_at ?? row.updated_at,
  };
}

function normalizeUrl(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^https:\/\/[^\s]+$/i.test(trimmed))
    fail(400, "External documents require an https:// link");
  return trimmed;
}

function decodeFile(file: { name: string; mime: string; dataBase64: string }) {
  const buffer = Buffer.from(file.dataBase64.replace(/^data:[^;]+;base64,/, ""), "base64");
  if (!buffer.length) fail(400, "Empty attachment");
  if (buffer.length > MAX_FILE_BYTES) fail(413, "Attachment exceeds the 8 MB limit");
  return { name: file.name, mime: file.mime, bytes: buffer };
}

export async function listDocPages(pool: Pool, actor: Actor | null) {
  const rows = (
    await pool.query(
      `SELECT ${SUMMARY_COLS} FROM doc_page
       WHERE ($1::boolean OR status = 'published')
       ORDER BY pinned DESC, sort_rank ASC, updated_at DESC, id`,
      [isManager(actor)],
    )
  ).rows as DocRow[];
  return rows.map(toSummary);
}

export async function getDocPage(pool: Pool, actor: Actor | null, slug: string) {
  const row = (await pool.query("SELECT * FROM doc_page WHERE slug = $1", [slug])).rows[0] as
    | DocRow
    | undefined;
  if (!row) fail(404, "Document not found");
  if (row.status !== "published" && !isManager(actor)) fail(404, "Document not found");
  return toDetail(row);
}

export async function getDocAttachment(pool: Pool, actor: Actor | null, slug: string) {
  const row = (await pool.query("SELECT * FROM doc_page WHERE slug = $1", [slug])).rows[0] as
    | DocRow
    | undefined;
  if (!row) fail(404, "Document not found");
  if (row.status !== "published" && !isManager(actor)) fail(404, "Document not found");
  if (row.kind !== "file" || !row.file_bytes) fail(404, "Document has no attachment");
  return {
    bytes: row.file_bytes,
    name: row.file_name ?? "document.pdf",
    mime: row.file_mime ?? "application/octet-stream",
  };
}

export async function createDocPage(
  pool: Pool,
  actor: Actor,
  input: {
    title: string;
    category: string;
    summary?: string;
    kind: string;
    bodyMd?: string;
    externalUrl?: string;
    pinned?: boolean;
    sortRank?: number;
    status?: string;
    file?: { name: string; mime: string; dataBase64: string };
  },
) {
  const externalUrl = input.kind === "link" ? normalizeUrl(input.externalUrl) : null;
  if (input.kind === "link" && !externalUrl) fail(400, "External documents require an https:// link");
  const attachment = input.kind === "file" ? decodeFile(input.file ?? fail(400, "Attachment required")) : null;
  if (input.kind === "file" && !attachment) fail(400, "Attachment required");
  const id = randomUUID();
  const row = (
    await pool.query(
      `INSERT INTO doc_page
        (id,slug,category,title,summary,kind,body_md,external_url,file_name,file_mime,file_bytes,
         pinned,sort_rank,status,created_by,updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)
       RETURNING *`,
      [
        id,
        `doc-${id.replace(/-/g, "").slice(0, 10)}`,
        input.category,
        input.title.trim(),
        input.summary?.trim() ?? "",
        input.kind,
        input.bodyMd ?? "",
        externalUrl,
        attachment?.name ?? null,
        attachment?.mime ?? null,
        attachment?.bytes ?? null,
        input.pinned ?? false,
        input.sortRank ?? 100,
        input.status ?? "published",
        actor.userId,
      ],
    )
  ).rows[0] as DocRow;
  return toDetail(row);
}

export async function updateDocPage(
  pool: Pool,
  actor: Actor,
  id: string,
  patch: {
    title?: string;
    category?: string;
    summary?: string;
    kind?: string;
    bodyMd?: string;
    externalUrl?: string;
    pinned?: boolean;
    sortRank?: number;
    status?: string;
    file?: { name: string; mime: string; dataBase64: string };
  },
) {
  const current = (await pool.query("SELECT * FROM doc_page WHERE id = $1", [id])).rows[0] as
    | DocRow
    | undefined;
  if (!current) fail(404, "Document not found");
  const kind = patch.kind ?? current.kind;
  const attachment = patch.file ? decodeFile(patch.file) : null;
  const externalUrl =
    kind === "link"
      ? normalizeUrl(patch.externalUrl ?? current.external_url)
      : null;
  if (kind === "link" && !externalUrl) fail(400, "External documents require an https:// link");
  const keepFile = kind === "file" ? (attachment?.bytes ?? current.file_bytes ?? null) : null;
  if (kind === "file" && !keepFile) fail(400, "Attachment required");
  const row = (
    await pool.query(
      `UPDATE doc_page SET
         title=$2,category=$3,summary=$4,kind=$5,body_md=$6,external_url=$7,
         file_name=$8,file_mime=$9,file_bytes=$10,pinned=$11,sort_rank=$12,status=$13,
         revision=revision+1,updated_at=NOW(),updated_by=$14
       WHERE id=$1 RETURNING *`,
      [
        id,
        (patch.title ?? current.title).trim(),
        patch.category ?? current.category,
        patch.summary === undefined ? current.summary : patch.summary.trim(),
        kind,
        patch.bodyMd === undefined ? current.body_md ?? "" : patch.bodyMd,
        externalUrl,
        kind === "file" ? attachment?.name ?? current.file_name : null,
        kind === "file" ? attachment?.mime ?? current.file_mime : null,
        keepFile,
        patch.pinned === undefined ? current.pinned : patch.pinned,
        patch.sortRank === undefined ? current.sort_rank : patch.sortRank,
        patch.status === undefined ? current.status : patch.status,
        actor.userId,
      ],
    )
  ).rows[0] as DocRow;
  return toDetail(row);
}

export async function deleteDocPage(pool: Pool, actor: Actor, id: string) {
  if (!isManager(actor)) fail(403, "Administrator access required");
  const result = await pool.query("DELETE FROM doc_page WHERE id = $1", [id]);
  if (!result.rowCount) fail(404, "Document not found");
  return { deleted: true };
}

function asciiName(name: string) {
  return name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
}

export async function docsRoutes(app: FastifyInstance, pool: Pool) {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();
  const requireManager = (actor: Actor | null) => {
    if (!isManager(actor)) fail(403, "Administrator access required");
    return actor as Actor;
  };

  api.get("/v1/docs", async (request) => ({
    docs: await listDocPages(pool, request.actor),
  }));

  api.get(
    "/v1/docs/:slug",
    { schema: { params: ParamsSlug } },
    async (request) => ({
      doc: await getDocPage(pool, request.actor, request.params.slug),
    }),
  );

  api.get(
    "/v1/docs/:slug/file",
    { schema: { params: ParamsSlug } },
    async (request, reply) => {
      const file = await getDocAttachment(pool, request.actor, request.params.slug);
      return reply
        .header("Content-Type", file.mime)
        .header("Content-Length", String(file.bytes.length))
        .header(
          "Content-Disposition",
          `inline; filename="${asciiName(file.name)}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        )
        .header("Cache-Control", "private, max-age=60")
        .send(file.bytes);
    },
  );

  api.post(
    "/v1/docs",
    { schema: { body: DocPayload }, bodyLimit: 12 * 1024 * 1024 },
    async (request) => ({
      doc: await createDocPage(pool, requireManager(request.actor), request.body),
    }),
  );

  api.patch(
    "/v1/docs/:id",
    { schema: { params: ParamsId, body: DocPatch }, bodyLimit: 12 * 1024 * 1024 },
    async (request) => ({
      doc: await updateDocPage(pool, requireManager(request.actor), request.params.id, request.body),
    }),
  );

  api.delete(
    "/v1/docs/:id",
    { schema: { params: ParamsId } },
    async (request) => deleteDocPage(pool, requireManager(request.actor), request.params.id),
  );
}
