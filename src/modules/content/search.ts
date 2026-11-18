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
  requestFilter: Filter,
  projectSourceIds?: readonly string[],
  projectFilter: Filter = {},
  pullOnly = false,
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
  if (pullOnly) discovery.push("cs.delivery_mode='pull'");
  const visible = discovery.join(" AND ");
  for (const scope of [projectFilter, requestFilter]) {
    if (scope.sourceId) discovery.push(`d.collection_source_id=${bind(scope.sourceId)}::uuid`);
  }
  const where = [
    `EXISTS(SELECT 1 FROM content_discovery d JOIN collection_source cs ON cs.id=d.collection_source_id WHERE ${discovery.join(" AND ")})`,
  ];
  for (const filter of [projectFilter, requestFilter]) {
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
    if (filter.signal) {
      const metric = (key: string) => `(latest.metrics->>'${key}')::numeric`;
      const qualifies = filter.signal === "discussion"
        ? `(p.code='reddit' AND ${metric("reddit.num_comments")}>=10 OR p.code='x' AND ${metric("x.replies")}>=5)`
        : `(p.code='reddit' AND ${metric("reddit.score")} IS NOT NULL AND ${metric("reddit.num_comments")}>=GREATEST(${metric("reddit.score")},1))`;
      const observed = `EXISTS (SELECT 1 FROM (
        SELECT DISTINCT ON (o.collection_source_id,o.provider) o.metrics FROM content_observation o
        WHERE o.content_id=c.id AND EXISTS (SELECT 1 FROM content_discovery d JOIN collection_source cs ON cs.id=d.collection_source_id
          WHERE ${discovery.join(" AND ")} AND d.collection_source_id=o.collection_source_id)
        ORDER BY o.collection_source_id,o.provider,o.source_observed_at DESC NULLS LAST,o.fetched_at DESC,o.id DESC
      ) latest WHERE ${qualifies})`;
      where.push(filter.signal === "pain"
        ? `(doc.search_text ~ '(frustrat|doesn.t work|broken|pain point|workaround|不好用|报错|卡住|痛点)' OR ${observed})`
        : observed);
    }
  }
  return {
    text: where.join(" AND "),
    values,
    discovery: discovery.join(" AND "),
    visible,
  };
}
export function filterSignature(
  actor: Pick<Actor, "allowedSourceIds">,
  filter: Filter,
  project?: { id: string; revision: number },
) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        actor.allowedSourceIds,
        project,
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
      typeof data.signature !== "string" || !/^[a-f0-9-]{36}$/.test(data.id) ||
      (data.time !== null &&
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(data.time))
    )
      throw Error();
    if (data.signature !== signature) fail(409, "cursor_scope_changed");
    return data;
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 409) throw error;
    return fail(422, "Invalid cursor");
  }
}

export function contentSelect(discovery: string, extraColumns = "") {
  return `SELECT c.*,p.code AS platform,to_char(c.created_at_source,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time,
    COALESCE((SELECT jsonb_agg(latest.payload) FROM (
      SELECT DISTINCT ON(o.collection_source_id,o.provider) jsonb_build_object('sourceId',o.collection_source_id,'provider',o.provider,'sourceObservedAt',o.source_observed_at,'fetchedAt',o.fetched_at,'timeBasis',o.time_basis,'maturity',o.maturity,'metrics',o.metrics,'evidenceKey',o.evidence_key) AS payload
      FROM content_observation o WHERE o.content_id=c.id AND EXISTS(SELECT 1 FROM content_discovery d JOIN collection_source cs ON cs.id=d.collection_source_id WHERE ${discovery} AND d.collection_source_id=o.collection_source_id)
      ORDER BY o.collection_source_id,o.provider,o.source_observed_at DESC NULLS LAST,o.fetched_at DESC,o.id DESC) latest),'[]'::jsonb) AS observations${extraColumns}
    FROM content c JOIN source p ON p.id=c.source_id JOIN public_content_search_document doc ON doc.content_id=c.id`;
}

export function matchedAnchors(compiled: ReturnType<typeof compileContentFilter>, threadAware: boolean) {
  if (!threadAware) return { cte: "", joins: "", where: compiled.text, columns: "" };
  return {
    cte: `WITH anchors AS (
      SELECT COALESCE(root.id,c.id) AS id, BOOL_OR(root.id IS NULL AND ref.value IS NOT NULL) AS context_missing
      FROM content c JOIN source p ON p.id=c.source_id JOIN public_content_search_document doc ON doc.content_id=c.id
      LEFT JOIN LATERAL (
        SELECT value FROM jsonb_array_elements(c.content_references) r(value)
        WHERE value->>'relation'='thread_root' LIMIT 1
      ) ref ON true
      LEFT JOIN LATERAL (
        SELECT c.id FROM content c WHERE c.source_id=p.id AND c.kind=ref.value->>'kind' AND c.external_id=ref.value->>'externalId'
        AND EXISTS (SELECT 1 FROM content_discovery d JOIN collection_source cs ON cs.id=d.collection_source_id WHERE ${compiled.visible})
      ) root ON true
      WHERE ${compiled.text} GROUP BY COALESCE(root.id,c.id)
    )`,
    joins: "JOIN anchors ON anchors.id=c.id",
    where: "TRUE",
    columns: ", anchors.context_missing",
  };
}
