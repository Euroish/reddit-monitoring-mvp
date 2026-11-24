import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { Actor } from "../../../packages/contracts/src/access";
import type { Filter } from "../../../packages/contracts/src/content";
import { fail } from "../../shared/errors";

export interface BatchMembership {
  contains: (bind: (value: unknown) => string, column: "c.id" | "d.content_id" | "o.content_id") => string;
}

export type ContentVisibilityResolver = (
  actor: Actor,
  options?: { publicOnly?: boolean },
) => BatchMembership;

export interface ContentScope {
  id: string;
  revision: number;
  source_ids: string[];
  filter: Filter;
  thread_aware: boolean;
  include_push_in_trends: boolean;
  batchMembership?: BatchMembership;
}

export type ContentScopeResolver = (
  db: Pool | PoolClient,
  actor: Actor,
  projectId: string,
) => Promise<ContentScope>;

export const MAX_INDEXED_BODY_CHARS = 1500;

export function normalizePublicSearchText(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

export function publicSearchDocument(
  title: string | null,
  text: string | null,
  indexedAt: string,
) {
  const normalizedTitle = normalizePublicSearchText(title ?? "");
  const rawBody = normalizePublicSearchText(text ?? "");
  const normalizedText =
    rawBody.length <= MAX_INDEXED_BODY_CHARS
      ? rawBody
      : Array.from(rawBody).slice(0, MAX_INDEXED_BODY_CHARS).join("");
  return {
    normalizedTitle,
    normalizedText,
    textPresent: text !== null,
    fingerprint: createHash("sha256")
      .update(JSON.stringify([2, normalizedTitle, normalizedText, text !== null]))
      .digest("hex"),
    indexedAt,
  };
}

export function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function buildTextPredicate(
  raw: string,
  searchScope: Filter["searchScope"],
  bind: (value: unknown) => string,
) {
  const term = normalizePublicSearchText(raw);
  if (!term || /[\u0000-\u001f]/u.test(term)) {
    fail(422, "Search terms cannot be empty or contain controls");
  }
  const pair = term.match(/[\p{L}\p{N}]{2}/u)?.[0];
  if (!pair) fail(422, "Search terms need at least two consecutive letters or digits");
  const pattern = bind(`%${escapeLike(term)}%`);
  const phrase = `doc.search_text LIKE ${pattern}`;
  const bigram = /[\p{L}\p{N}]{3}/u.test(term)
    ? null
    : `public_search_bigrams(doc.search_text) @> ARRAY[${bind(pair)}::text]`;
  const candidate = bigram ? `(${bigram} AND ${phrase})` : phrase;
  const selected =
    searchScope === "title"
      ? "substring(doc.search_text FROM 1 FOR doc.title_length)"
      : searchScope === "text"
        ? "substring(doc.search_text FROM doc.title_length+2)"
        : null;
  return selected ? `(${candidate} AND ${selected} LIKE ${pattern})` : candidate;
}

function buildSignalPredicate(signal: NonNullable<Filter["signal"]>, discoveryExpr: string) {
  const metric = (key: string) => `(latest.metrics->>'${key}')::numeric`;
  const qualifies =
    signal === "discussion"
      ? `(p.code='reddit' AND ${metric("reddit.num_comments")}>=10 OR p.code='x' AND ${metric("x.replies")}>=5)`
      : `(p.code='reddit' AND ${metric("reddit.score")} IS NOT NULL AND ${metric("reddit.num_comments")}>=GREATEST(${metric("reddit.score")},1))`;
  const observed = `EXISTS (SELECT 1 FROM (
        SELECT DISTINCT ON (o.collection_source_id,o.provider) o.metrics FROM content_observation o
        WHERE o.content_id=c.id AND EXISTS (SELECT 1 FROM content_discovery d JOIN collection_source cs ON cs.id=d.collection_source_id
          WHERE ${discoveryExpr} AND d.collection_source_id=o.collection_source_id)
        ORDER BY o.collection_source_id,o.provider,o.source_observed_at DESC NULLS LAST,o.fetched_at DESC,o.id DESC
      ) latest WHERE ${qualifies})`;
  return signal === "pain"
    ? `(doc.search_text ~ '(frustrat|doesn.t work|broken|pain point|workaround|不好用|报错|卡住|痛点)' OR ${observed})`
    : observed;
}

function applyScopeFilter(
  filter: Filter,
  bind: (value: unknown) => string,
  discoveryExpr: string,
  where: string[],
): boolean {
  let needsSearchDocument = false;
  if (filter.platform) where.push(`p.code=${bind(filter.platform)}`);
  if (filter.kind) where.push(`c.kind=${bind(filter.kind)}`);
  if (filter.language) where.push(`c.language=${bind(filter.language)}`);
  if (filter.hasMedia !== undefined) {
    where.push(filter.hasMedia ? "jsonb_array_length(c.content_media)>0" : "jsonb_array_length(c.content_media)=0");
  }
  if (filter.from) where.push(`c.created_at_source>=${bind(filter.from)}::timestamptz`);
  if (filter.to) where.push(`c.created_at_source<${bind(filter.to)}::timestamptz`);
  if (filter.from && filter.to && Date.parse(filter.from) >= Date.parse(filter.to)) {
    fail(422, "from must precede to");
  }
  const pred = (raw: string) => {
    needsSearchDocument = true;
    return buildTextPredicate(raw, filter.searchScope, bind);
  };
  if (filter.query) where.push(pred(filter.query));
  if (filter.anyTerms?.length) where.push(`(${filter.anyTerms.map(pred).join(" OR ")})`);
  for (const term of filter.allTerms ?? []) where.push(pred(term));
  for (const term of filter.exclusions ?? []) where.push(`NOT (${pred(term)})`);
  if (filter.signal) {
    if (filter.signal === "pain") needsSearchDocument = true;
    where.push(buildSignalPredicate(filter.signal, discoveryExpr));
  }
  return needsSearchDocument;
}

export function compileContentFilter(
  actor: Pick<Actor, "allowedSourceIds">,
  requestFilter: Filter,
  projectSourceIds?: readonly string[],
  projectFilter: Filter = {},
  pullOnly = false,
  batchMembership?: BatchMembership,
) {
  const values: unknown[] = [];
  const bind = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  const discovery = ["d.content_id=c.id"];
  if (actor.allowedSourceIds !== null) {
    discovery.push(`d.collection_source_id=ANY(${bind(actor.allowedSourceIds)}::uuid[])`);
  }
  if (projectSourceIds) {
    discovery.push(`d.collection_source_id=ANY(${bind(projectSourceIds)}::uuid[])`);
  }
  if (batchMembership) discovery.push(batchMembership.contains(bind, "d.content_id"));
  if (pullOnly) discovery.push("cs.delivery_mode='pull'");
  for (const scope of [projectFilter, requestFilter]) {
    if (scope.deliveryMode) discovery.push(`cs.delivery_mode=${bind(scope.deliveryMode)}`);
  }
  const visible = discovery.join(" AND ");
  for (const scope of [projectFilter, requestFilter]) {
    if (scope.sourceId) discovery.push(`d.collection_source_id=${bind(scope.sourceId)}::uuid`);
    if (scope.sourceGroup) discovery.push(`cs.source_group=${bind(scope.sourceGroup)}`);
    if (scope.tier) discovery.push(`cs.tier=${bind(scope.tier)}`);
  }
  const discoveryExpr = discovery.join(" AND ");
  const where = [
    `EXISTS(SELECT 1 FROM content_discovery d JOIN collection_source cs ON cs.id=d.collection_source_id WHERE ${discoveryExpr})`,
  ];
  let needsSearchDocument = false;
  for (const filter of [projectFilter, requestFilter]) {
    if (applyScopeFilter(filter, bind, discoveryExpr, where)) needsSearchDocument = true;
  }
  return {
    text: where.join(" AND "),
    values,
    discovery: discoveryExpr,
    visible,
    needsSearchDocument,
  };
}

export function filterSignature(
  actor: Pick<Actor, "allowedSourceIds" | "role" | "userId">,
  filter: Filter,
  project?: { id: string; revision: number },
) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        actor.allowedSourceIds,
        actor.role === "viewer" ? actor.userId : "staff",
        project,
        Object.entries(filter).sort(([a], [b]) => a.localeCompare(b)),
      ]),
    )
    .digest("hex");
}

export function decodeCursor(cursor: string, signature: string): { time: string | null; id: string } {
  try {
    const data = JSON.parse(Buffer.from(cursor, "base64url").toString());
    if (
      typeof data.signature !== "string" || !/^[a-f0-9-]{36}$/.test(data.id) ||
      (data.time !== null && !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(data.time))
    ) {
      throw Error();
    }
    if (data.signature !== signature) fail(409, "cursor_scope_changed");
    return data;
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 409) throw error;
    return fail(422, "Invalid cursor");
  }
}

export const contentColumns = `c.*,p.code AS platform,to_char(c.created_at_source,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time`;
export const contentSourceTables = "content c JOIN source p ON p.id=c.source_id";
export const contentTables = `${contentSourceTables} LEFT JOIN public_content_search_document doc ON doc.content_id=c.id`;

function latestObservations(discovery: string, from: string) {
  return `SELECT DISTINCT ON(o.content_id,o.collection_source_id,o.provider) o.content_id,
    jsonb_build_object('sourceId',o.collection_source_id,'provider',o.provider,'sourceObservedAt',o.source_observed_at,
      'fetchedAt',o.fetched_at,'timeBasis',o.time_basis,'maturity',o.maturity,'metrics',o.metrics,'evidenceKey',o.evidence_key) AS payload
    FROM ${from}
    AND EXISTS (SELECT 1 FROM content_discovery d JOIN collection_source cs ON cs.id=d.collection_source_id
      WHERE ${discovery} AND d.collection_source_id=o.collection_source_id)
    ORDER BY o.content_id,o.collection_source_id,o.provider,o.source_observed_at DESC NULLS LAST,o.fetched_at DESC,o.id DESC`;
}

export function contentSelect(discovery: string, extraColumns = "", needsSearchDocument = false) {
  const latest = latestObservations(discovery, "content_observation o WHERE o.content_id=c.id");
  const tables = needsSearchDocument ? contentTables : contentSourceTables;
  return `SELECT ${contentColumns},COALESCE((SELECT jsonb_agg(payload) FROM (${latest}) snapshots),'[]'::jsonb) AS observations${extraColumns}
    FROM ${tables}`;
}

export function pageObservations(discovery: string) {
  const latest = latestObservations(discovery, "page c JOIN content_observation o ON o.content_id=c.id WHERE TRUE");
  return `SELECT c.*,COALESCE(o.observations,'[]'::jsonb) AS observations
    FROM page c LEFT JOIN (
      SELECT content_id,jsonb_agg(payload ORDER BY payload->>'sourceId',payload->>'provider') AS observations
      FROM (${latest}) snapshots GROUP BY content_id
    ) o ON o.content_id=c.id ORDER BY c.created_at_source DESC NULLS LAST,c.id DESC`;
}

export function matchingNodes(compiled: ReturnType<typeof compileContentFilter>, threadAware: boolean) {
  const tables = compiled.needsSearchDocument ? contentTables : contentSourceTables;
  return `SELECT c.id,c.created_at_source,c.kind,p.code AS platform,
      ${threadAware ? "COALESCE(root.id,c.id) AS anchor_id,root.id IS NULL AND ref.value IS NOT NULL AS context_missing" : "c.id AS anchor_id,FALSE AS context_missing"}
    FROM ${tables}
    ${threadAware ? `LEFT JOIN LATERAL (
        SELECT value FROM jsonb_array_elements(c.content_references) r(value)
        WHERE value->>'relation'='thread_root' LIMIT 1
      ) ref ON true
      LEFT JOIN LATERAL (
        SELECT c.id FROM content c WHERE c.source_id=p.id AND c.kind=ref.value->>'kind' AND c.external_id=ref.value->>'externalId'
        AND EXISTS (SELECT 1 FROM content_discovery d JOIN collection_source cs ON cs.id=d.collection_source_id WHERE ${compiled.visible})
      ) root ON true` : ""}
    WHERE ${compiled.text}`;
}

export function matchedAnchors(compiled: ReturnType<typeof compileContentFilter>, threadAware: boolean) {
  if (!threadAware) return { cte: "", joins: "", where: compiled.text, columns: "" };
  return {
    cte: `WITH anchors AS MATERIALIZED (
      SELECT anchor_id AS id, BOOL_OR(context_missing) AS context_missing
      FROM (${matchingNodes(compiled, true)}) matched GROUP BY anchor_id
    )`,
    joins: "JOIN anchors ON anchors.id=c.id",
    where: "TRUE",
    columns: ", anchors.context_missing",
  };
}
