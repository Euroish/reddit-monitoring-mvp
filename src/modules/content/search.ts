import { createHash } from "node:crypto";
import type {
  Actor,
  Filter,
} from "../../../packages/contracts/src/source-content";
import { fail } from "../../storage/db";

export function normalizePublicSearchText(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}
export function publicSearchDocument(
  title: string | null,
  text: string | null,
  indexedAt: string,
) {
  return {
    normalizedTitle: normalizePublicSearchText(title ?? ""),
    normalizedText: normalizePublicSearchText(text ?? ""),
    textPresent: text !== null,
    fingerprint: createHash("sha256")
      .update(JSON.stringify([1, title, text]))
      .digest("hex"),
    indexedAt,
  };
}
export function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}
export function compileContentFilter(
  actor: Pick<Actor, "allowedSourceIds">,
  filter: Filter,
  projectSourceIds?: readonly string[],
) {
  const values: unknown[] = [];
  const bind = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  const discovery = ["d.content_id=c.id"];
  if (actor.allowedSourceIds !== null)
    discovery.push(
      `d.collection_source_id=ANY(${bind(actor.allowedSourceIds)}::uuid[])`,
    );
  if (projectSourceIds)
    discovery.push(
      `d.collection_source_id=ANY(${bind(projectSourceIds)}::uuid[])`,
    );
  if (filter.sourceId)
    discovery.push(`d.collection_source_id=${bind(filter.sourceId)}::uuid`);
  const where = [
    `EXISTS(SELECT 1 FROM content_discovery d JOIN collection_source cs ON cs.id=d.collection_source_id WHERE ${discovery.join(" AND ")})`,
  ];
  if (filter.platform) where.push(`p.code=${bind(filter.platform)}`);
  if (filter.kind) where.push(`c.kind=${bind(filter.kind)}`);
  if (filter.from)
    where.push(`c.created_at_source>=${bind(filter.from)}::timestamptz`);
  if (filter.to)
    where.push(`c.created_at_source<${bind(filter.to)}::timestamptz`);
  if (
    filter.from &&
    filter.to &&
    Date.parse(filter.from) >= Date.parse(filter.to)
  )
    fail(422, "from must precede to");
  const predicate = (raw: string) => {
    const term = normalizePublicSearchText(raw);
    if (!term || /[\u0000-\u001f]/u.test(term))
      fail(422, "Search terms cannot be empty or contain controls");
    if (
      !/[\p{L}\p{N}]{3}/u.test(term) &&
      !filter.sourceId &&
      !projectSourceIds &&
      !filter.from &&
      !filter.to &&
      actor.allowedSourceIds === null
    )
      fail(422, "Short searches require a source or date range");
    const pattern = bind(`%${escapeLike(term)}%`);
    const candidate = `doc.search_text LIKE ${pattern}`;
    const selected =
      filter.searchScope === "title"
        ? "substring(doc.search_text FROM 1 FOR doc.title_length)"
        : filter.searchScope === "text"
          ? "substring(doc.search_text FROM doc.title_length+2)"
          : null;
    return selected
      ? `(${candidate} AND ${selected} LIKE ${pattern})`
      : candidate;
  };
  if (filter.query) where.push(predicate(filter.query));
  if (filter.anyTerms?.length)
    where.push(`(${filter.anyTerms.map(predicate).join(" OR ")})`);
  for (const term of filter.allTerms ?? []) where.push(predicate(term));
  for (const term of filter.exclusions ?? [])
    where.push(`NOT (${predicate(term)})`);
  return {
    text: where.join(" AND "),
    values,
    discovery: discovery.join(" AND "),
  };
}
export function filterSignature(
  actor: Pick<Actor, "allowedSourceIds">,
  filter: Filter,
) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        actor.allowedSourceIds,
        Object.entries(filter).sort(([a], [b]) => a.localeCompare(b)),
      ]),
    )
    .digest("hex");
}
export function decodeCursor(
  cursor: string,
  signature: string,
): { time: string | null; id: string } {
  try {
    const data = JSON.parse(Buffer.from(cursor, "base64url").toString());
    if (
      data.signature !== signature ||
      !/^[a-f0-9-]{36}$/.test(data.id) ||
      (data.time !== null &&
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(data.time))
    )
      throw Error();
    return data;
  } catch {
    return fail(422, "Invalid cursor or changed query scope");
  }
}
