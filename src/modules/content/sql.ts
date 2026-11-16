import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type {
  PublicContentKind,
  ContentReference,
} from "../../../packages/contracts/src/source-content";
import type { CollectedContent } from "../../connectors/shared/content-provider.interface";
import { fail } from "../../storage/db";
import { publicSearchDocument } from "./search";

type Item = CollectedContent;
export type ContentBatchSource = {
  id: string;
  platformId: string;
  platform: Item["platform"];
  provider: string;
  contentKinds: readonly PublicContentKind[];
};
type PreparedNode = {
  item: Item;
  firstFetchedAt: string;
  lastFetchedAt: string;
};
export type PreparedContentBatch = {
  nodes: PreparedNode[];
  observations: { item: Item; hash: string }[];
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
function conflict(message: string): never {
  fail(409, message);
}
function identity(item: Pick<Item, "kind" | "externalId">) {
  return `${item.kind}:${item.externalId}`;
}
function compareVersion(a: Item, b: Item): number {
  const ao = a.observation.sourceObservedAt,
    bo = b.observation.sourceObservedAt;
  if ((ao !== null) !== (bo !== null)) return ao !== null ? 1 : -1;
  const time = Date.parse(ao ?? a.fetchedAt) - Date.parse(bo ?? b.fetchedAt);
  return (
    time ||
    Buffer.compare(
      Buffer.from(a.observation.evidenceKey),
      Buffer.from(b.observation.evidenceKey),
    )
  );
}
function snapshot(item: Item) {
  const { id, fetchedAt, observation, ...content } = item;
  const { fetchedAt: observationFetchedAt, ...evidence } = observation;
  return { content, evidence };
}
function mergeSameVersion(a: Item, b: Item): Item {
  const merged = { ...a };
  for (const key of ["title", "text"] as const) {
    if (a[key] !== null && b[key] !== null && a[key] !== b[key])
      conflict("Conflicting content in the same version");
    merged[key] = a[key] ?? b[key];
  }
  if (
    canonical({ ...snapshot(a).content, title: null, text: null }) !==
    canonical({ ...snapshot(b).content, title: null, text: null })
  )
    conflict("Conflicting content in the same version");
  return merged;
}

// Premerge before acquiring source/job locks; every independent observation survives.
export function prepareContentBatch(
  items: readonly Item[],
): PreparedContentBatch {
  if (
    items.length > 2000 ||
    Buffer.byteLength(JSON.stringify(items)) > 16 * 1024 * 1024
  )
    fail(413, "Content batch exceeds 2000 items or 16 MiB");
  const versions = new Map<string, Item[]>();
  const nodes = new Map<string, PreparedNode>(),
    observations = new Map<string, { item: Item; hash: string }>();
  for (const item of items) {
    if (item.platform !== items[0].platform)
      fail(422, "Page/source identity mismatch");
    const key = identity(item),
      obs = item.observation;
    const history = versions.get(key) ?? [];
    history.push(item);
    versions.set(key, history);
    if (
      item.platformDetails.platform !== item.platform ||
      !item.externalId ||
      !obs.evidenceKey ||
      !Number.isFinite(Date.parse(item.fetchedAt)) ||
      !Number.isFinite(Date.parse(obs.fetchedAt)) ||
      (obs.sourceObservedAt !== null &&
        !Number.isFinite(Date.parse(obs.sourceObservedAt)))
    )
      fail(422, "Invalid content batch identity or timestamp");
    const hash = createHash("sha256")
      .update(canonical(snapshot(item)))
      .digest("hex");
    const observationKey = canonical([
      key,
      obs.sourceId,
      obs.provider,
      obs.evidenceKey,
    ]);
    const existingObservation = observations.get(observationKey);
    if (existingObservation && existingObservation.hash !== hash)
      conflict("Conflicting observation evidence key");
    if (!existingObservation) observations.set(observationKey, { item, hash });
    const old = nodes.get(key);
    if (!old)
      nodes.set(key, {
        item,
        firstFetchedAt: item.fetchedAt,
        lastFetchedAt: item.fetchedAt,
      });
    else {
      const order = compareVersion(item, old.item);
      if (!order) old.item = mergeSameVersion(old.item, item);
      else if (order > 0) old.item = item;
      if (Date.parse(item.fetchedAt) < Date.parse(old.firstFetchedAt))
        old.firstFetchedAt = item.fetchedAt;
      if (Date.parse(item.fetchedAt) > Date.parse(old.lastFetchedAt))
        old.lastFetchedAt = item.fetchedAt;
    }
  }
  for (const [key, history] of versions) {
    const ordered = history.sort(compareVersion);
    let accepted = ordered[0];
    if (["deleted", "removed"].includes(accepted.availability))
      accepted = { ...accepted, title: null, text: null };
    for (const candidate of ordered.slice(1)) {
      if (
        candidate.observation.evidenceKey ===
          accepted.observation.evidenceKey &&
        candidate.observation.sourceObservedAt ===
          accepted.observation.sourceObservedAt
      )
        continue;
      accepted = {
        ...candidate,
        title:
          candidate.availability === "deleted" ||
          candidate.availability === "removed"
            ? null
            : (candidate.title ?? accepted.title),
        text:
          candidate.availability === "deleted" ||
          candidate.availability === "removed"
            ? null
            : (candidate.text ?? accepted.text),
      };
    }
    if (
      accepted.availability === "deleted" ||
      accepted.availability === "removed"
    )
      accepted = { ...accepted, title: null, text: null };
    nodes.get(key)!.item = accepted;
  }
  validateReferences([...nodes.values()].map((node) => node.item));
  return {
    nodes: [...nodes.values()].sort((a, b) =>
      Buffer.compare(
        Buffer.from(identity(a.item)),
        Buffer.from(identity(b.item)),
      ),
    ),
    observations: [...observations.values()],
  };
}

function validateReferences(items: Item[]): void {
  const nodes = new Map(items.map((item) => [identity(item), item]));
  for (const item of items) {
    if (
      item.platform === "reddit" &&
      !new RegExp(`^${item.kind === "post" ? "t3" : "t1"}_[a-z0-9]+$`).test(
        item.externalId,
      )
    )
      fail(422, "Invalid Reddit ID prefix");
    for (const relation of ["reply_to", "thread_root"] as const) {
      const refs = item.references.filter((ref) => ref.relation === relation);
      if (new Set(refs.map(identity)).size > 1)
        conflict("Contradictory content parent/root references");
    }
    for (const ref of item.references) {
      if (
        item.platform === "reddit" &&
        !new RegExp(`^${ref.kind === "post" ? "t3" : "t1"}_[a-z0-9]+$`).test(
          ref.externalId,
        )
      )
        fail(422, "Invalid Reddit reference prefix");
    }
    const root = item.references.find((ref) => ref.relation === "thread_root");
    let current: Item | undefined = item;
    const visited = new Set<string>();
    while (current) {
      const key = identity(current);
      if (visited.has(key)) conflict("Cyclic content parent chain");
      visited.add(key);
      const parent: ContentReference | undefined = current.references.find(
        (ref) => ref.relation === "reply_to",
      );
      const parentRoot = current.references.find(
        (ref) => ref.relation === "thread_root",
      );
      if (root && parentRoot && identity(root) !== identity(parentRoot))
        conflict("Cross-root content parent chain");
      if (
        root &&
        parent?.kind === "post" &&
        item.platform === "reddit" &&
        identity(parent) !== identity(root)
      )
        conflict("Cross-root content parent chain");
      current = parent ? nodes.get(identity(parent)) : undefined;
    }
  }
}

const newer = `(EXCLUDED.content_evidence_key <> content.content_evidence_key OR EXCLUDED.content_observed_at IS DISTINCT FROM content.content_observed_at) AND
  (EXCLUDED.content_observed_at IS NOT NULL, COALESCE(EXCLUDED.content_observed_at,EXCLUDED.content_version_fetched_at),EXCLUDED.content_evidence_key COLLATE "C") >
  (content.content_observed_at IS NOT NULL, COALESCE(content.content_observed_at,content.content_version_fetched_at),content.content_evidence_key COLLATE "C")`;
const replacementColumns = [
  "content_author",
  "content_media",
  "content_references",
  "platform_details",
  "availability",
  "content_observed_at",
  "content_evidence_key",
  "content_version_fetched_at",
];
const preservedColumns = ["url", "permalink", "language", "created_at_source"];
const sameVersionConflict = `EXCLUDED.content_evidence_key=content.content_evidence_key
  AND EXCLUDED.content_observed_at IS NOT DISTINCT FROM content.content_observed_at
  AND (EXCLUDED.availability<>content.availability
    OR (EXCLUDED.title IS NOT NULL AND content.title IS NOT NULL AND EXCLUDED.title<>content.title)
    OR (EXCLUDED.body_text IS NOT NULL AND content.body_text IS NOT NULL AND EXCLUDED.body_text<>content.body_text)
    OR EXCLUDED.content_references<>content.content_references
    OR EXCLUDED.content_media<>content.content_media
    OR EXCLUDED.platform_details IS DISTINCT FROM content.platform_details)`;
const assignments = [
  ...["title", "body_text"].map(
    (column) =>
      `${column}=CASE WHEN ${newer} THEN CASE WHEN EXCLUDED.availability IN ('deleted','removed') THEN NULL ELSE COALESCE(EXCLUDED.${column},content.${column}) END ELSE content.${column} END`,
  ),
  ...replacementColumns.map(
    (column) =>
      `${column}=CASE WHEN ${newer} THEN EXCLUDED.${column} ELSE content.${column} END`,
  ),
  ...preservedColumns.map(
    (column) =>
      `${column}=CASE WHEN ${newer} THEN COALESCE(EXCLUDED.${column},content.${column}) ELSE content.${column} END`,
  ),
  "first_seen_at=LEAST(content.first_seen_at,EXCLUDED.first_seen_at)",
  "last_seen_at=GREATEST(content.last_seen_at,EXCLUDED.last_seen_at)",
].join(",\n");

// Caller owns the transaction and source -> job locks. This function never opens one.
export async function commitContentBatch(
  client: PoolClient,
  source: ContentBatchSource,
  batch: PreparedContentBatch,
  now: string,
) {
  for (const { item } of batch.observations) {
    if (
      item.platform !== source.platform ||
      !source.contentKinds.includes(item.kind) ||
      item.observation.sourceId !== source.id ||
      item.observation.provider !== source.provider
    )
      fail(422, "Page/source identity mismatch");
  }
  if (!batch.nodes.length) return { added: 0, updated: 0 };
  const values = batch.nodes.map(({ item, firstFetchedAt, lastFetchedAt }) =>
    JSON.stringify({ ...item, firstFetchedAt, lastFetchedAt }),
  );
  const result = await client.query(
    `INSERT INTO content(id,source_id,external_id,kind,title,body_text,url,permalink,created_at_source,first_seen_at,last_seen_at,total_eligible,content_author,content_media,content_references,platform_details,language,availability,content_observed_at,content_evidence_key,content_version_fetched_at)
    SELECT (v->>'id')::uuid,$1,v->>'externalId',v->>'kind',
      CASE WHEN v->>'availability' IN ('removed','deleted') THEN NULL ELSE v->>'title' END,
      CASE WHEN v->>'availability' IN ('removed','deleted') THEN NULL ELSE v->>'text' END,
      v->>'url',v->>'url',(v->>'publishedAt')::timestamptz,(v->>'firstFetchedAt')::timestamptz,(v->>'lastFetchedAt')::timestamptz,FALSE,
      NULLIF(v->'author','null'::jsonb),v->'media',v->'references',v->'platformDetails',v->>'language',v->>'availability',
      (v->'observation'->>'sourceObservedAt')::timestamptz,v->'observation'->>'evidenceKey',(v->>'fetchedAt')::timestamptz
    FROM UNNEST($2::jsonb[]) AS input(v)
    ORDER BY (v->>'kind') COLLATE "C",(v->>'externalId') COLLATE "C"
    ON CONFLICT(source_id,kind,external_id) DO UPDATE SET ${assignments}
    WHERE NOT (${sameVersionConflict})
    RETURNING id,kind,external_id,title,body_text,(xmax=0) AS inserted`,
    [source.platformId, values],
  );
  if (result.rows.length !== batch.nodes.length)
    conflict("Conflicting content in the same version");
  const identities = new Map(
    result.rows.map((row) => [
      `${row.kind}:${row.external_id}`,
      row.id as string,
    ]),
  );
  const documents = result.rows.map((row) => {
    const document = publicSearchDocument(row.title, row.body_text, now);
    return JSON.stringify({ id: row.id, ...document });
  });
  await client.query(
    `INSERT INTO public_content_search_document(content_id,format_version,search_text,title_length,text_present,indexed_at,fingerprint)
    SELECT (v->>'id')::uuid,1,(v->>'normalizedTitle')||chr(31)||(v->>'normalizedText'),char_length(v->>'normalizedTitle'),(v->>'textPresent')::boolean,$2,(v->>'fingerprint')
    FROM UNNEST($1::jsonb[]) AS input(v)
    ON CONFLICT(content_id) DO UPDATE SET search_text=EXCLUDED.search_text,title_length=EXCLUDED.title_length,text_present=EXCLUDED.text_present,indexed_at=EXCLUDED.indexed_at,fingerprint=EXCLUDED.fingerprint,format_version=1`,
    [documents, now],
  );
  await client.query(
    `INSERT INTO content_discovery(content_id,collection_source_id,first_fetched_at,last_fetched_at)
    SELECT (v->>'id')::uuid,$2,(v->>'firstFetchedAt')::timestamptz,(v->>'lastFetchedAt')::timestamptz FROM UNNEST($1::jsonb[]) AS input(v)
    ON CONFLICT(content_id,collection_source_id) DO UPDATE SET first_fetched_at=LEAST(content_discovery.first_fetched_at,EXCLUDED.first_fetched_at),last_fetched_at=GREATEST(content_discovery.last_fetched_at,EXCLUDED.last_fetched_at)`,
    [
      batch.nodes.map((node) =>
        JSON.stringify({
          id: identities.get(identity(node.item)),
          firstFetchedAt: node.firstFetchedAt,
          lastFetchedAt: node.lastFetchedAt,
        }),
      ),
      source.id,
    ],
  );
  const observations = batch.observations.map(({ item, hash }) =>
    JSON.stringify({
      ...item.observation,
      id: identities.get(identity(item)),
      hash,
    }),
  );
  const inserted = await client.query(
    `INSERT INTO content_observation(content_id,collection_source_id,provider,source_observed_at,fetched_at,time_basis,maturity,metrics,evidence_key,payload_hash)
    SELECT (v->>'id')::uuid,$2,v->>'provider',(v->>'sourceObservedAt')::timestamptz,(v->>'fetchedAt')::timestamptz,v->>'timeBasis',v->>'maturity',v->'metrics',v->>'evidenceKey',v->>'hash' FROM UNNEST($1::jsonb[]) AS input(v)
    ON CONFLICT(content_id,collection_source_id,provider,evidence_key) DO UPDATE SET payload_hash=EXCLUDED.payload_hash
    WHERE (content_observation.payload_hash=EXCLUDED.payload_hash OR content_observation.payload_hash IS NULL)
      AND content_observation.source_observed_at IS NOT DISTINCT FROM EXCLUDED.source_observed_at
      AND content_observation.time_basis=EXCLUDED.time_basis AND content_observation.maturity=EXCLUDED.maturity AND content_observation.metrics=EXCLUDED.metrics
    RETURNING id`,
    [observations, source.id],
  );
  if (inserted.rowCount !== observations.length)
    conflict("Conflicting observation evidence key");
  const added = result.rows.filter((row) => row.inserted).length;
  return { added, updated: result.rows.length - added };
}

export function contentFromRow(
  row: import("pg").QueryResultRow,
): import("../../../packages/contracts/src/source-content").PublicContent {
  const iso = (value: Date | null) => value?.toISOString() ?? null;
  return {
    id: row.id,
    platform: row.platform,
    kind: row.kind,
    externalId: row.external_id,
    title: row.title,
    text: row.body_text,
    url: row.permalink ?? row.url,
    language: row.language,
    author: row.content_author,
    publishedAt: iso(row.created_at_source),
    firstFetchedAt: row.first_seen_at.toISOString(),
    lastFetchedAt: row.last_seen_at.toISOString(),
    availability: row.availability,
    references: row.content_references,
    media: row.content_media,
    platformDetails: row.platform_details,
    textState: row.body_text === null ? "missing" : "full",
    observations: row.observations ?? [],
  };
}
