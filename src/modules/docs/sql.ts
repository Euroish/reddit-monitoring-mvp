import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { Actor } from "../../../packages/contracts/src/access";
import {
  type DocCategory,
  type DocDetail,
  type DocInput,
  type DocKind,
  type DocPatch,
  type DocStatus,
  type DocSummary,
} from "../../../packages/contracts/src/product-docs";
import { fail } from "../../shared/errors";

/**
 * Product documentation pages (doc_page).
 * One row per document. kind=markdown renders an internal page, kind=link points
 * at an external (already hosted) URL, kind=file stores one attachment (PDF) inline.
 */

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const SUMMARY_COLS =
  "id,slug,category,title,summary,kind,pinned,sort_rank,status,external_url,file_name,file_mime,octet_length(file_bytes) AS file_size,updated_at";
const DETAIL_COLS = `${SUMMARY_COLS},body_md,revision,created_at`;

interface DocRow {
  id: string;
  slug: string;
  category: DocCategory;
  title: string;
  summary: string;
  kind: DocKind;
  body_md?: string;
  pinned: boolean;
  sort_rank: number;
  status: DocStatus;
  external_url: string | null;
  file_name: string | null;
  file_mime: string | null;
  file_size: number | null;
  revision?: number;
  created_at?: Date;
  updated_at: Date;
}

export function isManager(actor: Actor | null | undefined) {
  return Boolean(actor && actor.clientKind === "browser" && actor.role !== "viewer");
}

function toSummary(row: DocRow): DocSummary {
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
    updatedAt: row.updated_at.toISOString(),
  };
}

function toDetail(row: DocRow): DocDetail {
  return {
    ...toSummary(row),
    bodyMd: row.body_md ?? "",
    fileMime: row.file_mime,
    revision: row.revision ?? 1,
    createdAt: (row.created_at ?? row.updated_at).toISOString(),
  };
}

function normalizeUrl(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^https:\/\/[^\s]+$/i.test(trimmed)) {
    fail(400, "External documents require an https:// link");
  }
  return trimmed;
}

function decodeFile(file: { name: string; mime: string; dataBase64: string }) {
  // 附件只收 PDF：Content-Type 若由客户端决定，配合 inline 响应就是同源存储型 XSS
  const mime = file.mime.trim().toLowerCase();
  if (mime !== "application/pdf") fail(400, "Only PDF attachments are supported");
  const buffer = Buffer.from(file.dataBase64.replace(/^data:[^;]+;base64,/, ""), "base64");
  if (!buffer.length) fail(400, "Empty attachment");
  if (buffer.length > MAX_FILE_BYTES) fail(413, "Attachment exceeds the 8 MB limit");
  if (buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
    fail(400, "Attachment is not a valid PDF file");
  }
  return { name: file.name, mime: "application/pdf", bytes: buffer };
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
  const row = (
    await pool.query<DocRow>(
      `SELECT ${DETAIL_COLS} FROM doc_page WHERE slug=$1 AND ($2::boolean OR status='published')`,
      [slug, isManager(actor)],
    )
  ).rows[0];
  if (!row) fail(404, "Document not found");
  return toDetail(row);
}

export async function getDocAttachment(pool: Pool, actor: Actor | null, slug: string) {
  const row = (
    await pool.query<{ kind: DocKind; file_bytes: Buffer | null; file_name: string | null }>(
      "SELECT kind,file_bytes,file_name FROM doc_page WHERE slug=$1 AND ($2::boolean OR status='published')",
      [slug, isManager(actor)],
    )
  ).rows[0];
  if (!row) fail(404, "Document not found");
  if (row.kind !== "file" || !row.file_bytes) fail(404, "Document has no attachment");
  return {
    bytes: row.file_bytes,
    name: row.file_name ?? "document.pdf",
  };
}

export async function createDocPage(pool: Pool, actor: Actor, input: DocInput) {
  if (!input.title.trim()) fail(400, "Document title is required");
  const externalUrl = input.kind === "link" ? normalizeUrl(input.externalUrl) : null;
  if (input.kind === "link" && !externalUrl) fail(400, "External documents require an https:// link");
  const attachment = input.kind === "file" ? decodeFile(input.file ?? fail(400, "Attachment required")) : null;
  const id = randomUUID();
  const row = (
    await pool.query(
      `INSERT INTO doc_page
        (id,slug,category,title,summary,kind,body_md,external_url,file_name,file_mime,file_bytes,
         pinned,sort_rank,status,created_by,updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)
       RETURNING ${DETAIL_COLS}`,
      [
        id,
        `doc-${id.replace(/-/g, "").slice(0, 10)}`,
        input.category,
        input.title.trim(),
        input.summary?.trim() ?? "",
        input.kind,
        input.kind === "markdown" ? input.bodyMd ?? "" : "",
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

function resolveValidatedDocFields(current: DocRow, patch: DocPatch) {
  if (patch.title !== undefined && !patch.title.trim()) fail(400, "Document title is required");
  const kind = patch.kind ?? current.kind;
  const attachment = patch.file ? decodeFile(patch.file) : null;
  const externalUrl = kind === "link" ? normalizeUrl(patch.externalUrl ?? current.external_url) : null;
  if (kind === "link" && !externalUrl) fail(400, "External documents require an https:// link");
  if (kind === "file" && !attachment && (current.kind !== "file" || current.file_size === null)) {
    fail(400, "Attachment required");
  }
  const summary = patch.summary === undefined ? current.summary : patch.summary.trim();
  const bodyMd = kind === "markdown" ? (patch.bodyMd ?? current.body_md ?? "") : "";
  return { kind, attachment, externalUrl, summary, bodyMd };
}

function buildUpdatePayload(id: string, actor: Actor, current: DocRow, patch: DocPatch) {
  const resolved = resolveValidatedDocFields(current, patch);
  const fileTouched = Boolean(resolved.attachment) || resolved.kind !== current.kind;
  const values: unknown[] = [
    id, (patch.title ?? current.title).trim(), patch.category ?? current.category, resolved.summary,
    resolved.kind, resolved.bodyMd, resolved.externalUrl, patch.pinned ?? current.pinned,
    patch.sortRank ?? current.sort_rank, patch.status ?? current.status, actor.userId,
  ];
  const sets = [
    "title=$2", "category=$3", "summary=$4", "kind=$5", "body_md=$6",
    "external_url=$7", "pinned=$8", "sort_rank=$9", "status=$10",
    "revision=revision+1", "updated_at=NOW()", "updated_by=$11",
  ];
  if (fileTouched) {
    const file = resolved.kind === "file" ? resolved.attachment : null;
    values.push(file?.name ?? null, file?.mime ?? null, file?.bytes ?? null);
    sets.push(`file_name=$${values.length - 2}`, `file_mime=$${values.length - 1}`, `file_bytes=$${values.length}`);
  }
  values.push(patch.expectedRevision ?? current.revision);
  return { sets, values };
}

export async function updateDocPage(pool: Pool, actor: Actor, id: string, patch: DocPatch) {
  const current = (await pool.query(`SELECT ${DETAIL_COLS} FROM doc_page WHERE id = $1`, [id])).rows[0] as
    | DocRow
    | undefined;
  if (!current) fail(404, "Document not found");
  const { sets, values } = buildUpdatePayload(id, actor, current, patch);
  const where = `id=$1 AND revision=$${values.length}`;
  const row = (
    await pool.query(`UPDATE doc_page SET ${sets.join(",")} WHERE ${where} RETURNING ${DETAIL_COLS}`, values)
  ).rows[0] as DocRow | undefined;
  if (!row) fail(409, "Document was modified by someone else; reload and retry");
  return toDetail(row);
}

export async function deleteDocPage(pool: Pool, actor: Actor, id: string) {
  if (!isManager(actor)) fail(403, "Administrator access required");
  const result = await pool.query("DELETE FROM doc_page WHERE id = $1", [id]);
  if (!result.rowCount) fail(404, "Document not found");
  return { deleted: true };
}
