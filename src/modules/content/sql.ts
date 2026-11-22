import type { PoolClient } from "pg";
import { stableUuidFromString } from "../../shared/ids/stable-id";
import { detectLanguage } from "../../shared/text/language";
import { fail } from "../../shared/errors";
import { publicSearchDocument } from "./search";
import { heuristicV1Enricher, toAuthorProfileRecord, type AuthorProfileRecord } from "./enrich";
import {
  canonical,
  type ContentBatchSource,
  type PreparedContentBatch,
} from "./batch";
export { prepareContentBatch } from "./batch";
export type { ContentBatchSource, PreparedContentBatch } from "./batch";
const conflict = (message: string): never => fail(409, message);
const identity = (item: { kind: string; externalId: string }) =>
  `${item.kind}:${item.externalId}`;

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
const promotedReplacementColumns = [
  "author_handle",
  "community_name",
  "external_domain",
  "hashtags",
  "has_media",
  "primary_media_url",
  "card_layout",
  "metric_score",
  "metric_comments",
  "metric_views",
  "metric_likes",
  "metric_reposts",
  "metric_bookmarks",
  "upvote_ratio",
  "engagement_score",
  "discussion_ratio",
  "metrics_updated_at",
];
const preservedColumns = ["url", "permalink", "language", "created_at_source"];
// Multiple discovery channels can carry the same version of an article.
const sameVersionConflict = `EXCLUDED.content_evidence_key=content.content_evidence_key
  AND EXCLUDED.content_observed_at IS NOT DISTINCT FROM content.content_observed_at
  AND (EXCLUDED.availability<>content.availability
    OR (EXCLUDED.title IS NOT NULL AND content.title IS NOT NULL AND EXCLUDED.title<>content.title)
    OR (EXCLUDED.body_text IS NOT NULL AND content.body_text IS NOT NULL AND EXCLUDED.body_text<>content.body_text)
    OR EXCLUDED.content_references<>content.content_references
    OR EXCLUDED.content_media<>content.content_media
    OR (EXCLUDED.platform_details-'feedUrl') IS DISTINCT FROM (content.platform_details-'feedUrl'))`;
const sameVersion = `EXCLUDED.content_evidence_key=content.content_evidence_key
  AND EXCLUDED.content_observed_at IS NOT DISTINCT FROM content.content_observed_at`;
const changed = `(${newer}) OR ((${sameVersion}) AND content.availability NOT IN ('deleted','removed') AND
  ((content.title IS NULL AND EXCLUDED.title IS NOT NULL) OR (content.body_text IS NULL AND EXCLUDED.body_text IS NOT NULL)))`;
const enrichmentGuard = `content.enrichment_version > EXCLUDED.enrichment_version`;
const assignments = [
  ...["title", "body_text"].map(
    (column) =>
      `${column}=CASE WHEN ${newer} THEN CASE WHEN EXCLUDED.availability IN ('deleted','removed') THEN NULL ELSE COALESCE(EXCLUDED.${column},content.${column}) END ELSE CASE WHEN (${sameVersion}) AND content.availability NOT IN ('deleted','removed') THEN COALESCE(content.${column},EXCLUDED.${column}) ELSE content.${column} END END`,
  ),
  ...replacementColumns.map(
    (column) =>
      `${column}=CASE WHEN ${newer} THEN EXCLUDED.${column} ELSE content.${column} END`,
  ),
  ...promotedReplacementColumns.map(
    (column) =>
      `${column}=CASE WHEN (${newer}) OR ((${sameVersion}) AND content.availability NOT IN ('deleted','removed')) THEN EXCLUDED.${column} ELSE content.${column} END`,
  ),
  ...["clean_excerpt", "intent_tag", "intent_confidence", "enrichment_version", "enrichment_source"].map(
    (column) =>
      `${column}=CASE WHEN ${enrichmentGuard} THEN content.${column} WHEN (${newer}) OR ((${sameVersion}) AND content.availability NOT IN ('deleted','removed')) THEN EXCLUDED.${column} ELSE content.${column} END`,
  ),
  `velocity_score=CASE WHEN ${newer} THEN GREATEST(0, (EXCLUDED.engagement_score - content.engagement_score) / GREATEST(0.25, EXTRACT(EPOCH FROM (COALESCE(EXCLUDED.metrics_updated_at, NOW()) - COALESCE(content.metrics_updated_at, content.first_seen_at))) / 3600.0))::real ELSE content.velocity_score END`,
  ...preservedColumns.map(
    (column) =>
      `${column}=CASE WHEN ${newer} THEN COALESCE(EXCLUDED.${column},content.${column}) ELSE content.${column} END`,
  ),
  "first_seen_at=LEAST(content.first_seen_at,EXCLUDED.first_seen_at)",
  "last_seen_at=GREATEST(content.last_seen_at,EXCLUDED.last_seen_at)",
].join(",\n");

function hasConflictingContentVersion(
  row: import("pg").QueryResultRow,
  item: PreparedContentBatch["nodes"][number]["item"],
) {
  const observedMs = item.observation.sourceObservedAt ? Date.parse(item.observation.sourceObservedAt) : undefined;
  if (row.content_evidence_key !== item.observation.evidenceKey || row.content_observed_at?.getTime() !== observedMs) {
    return false;
  }
  return (
    (item.title !== null && row.title !== null && item.title !== row.title) ||
    (item.text !== null && row.body_text !== null && item.text !== row.body_text) ||
    item.availability !== row.availability ||
    canonical(item.references) !== canonical(row.content_references) ||
    canonical(item.media) !== canonical(row.content_media) ||
    canonical({ ...item.platformDetails, feedUrl: undefined }) !==
      canonical({ ...row.platform_details, feedUrl: undefined })
  );
}

async function resolveMissingBatchNodes(
  client: PoolClient,
  platformId: string,
  nodes: PreparedContentBatch["nodes"],
  rows: import("pg").QueryResultRow[],
) {
  if (rows.length === nodes.length) return;
  const returned = new Set(rows.map((row) => `${row.kind}:${row.external_id}`));
  const missing = nodes.filter((node) => !returned.has(identity(node.item)));
  const stored = await client.query(
    `SELECT c.* FROM content c JOIN UNNEST($2::jsonb[]) v
      ON c.kind=v->>'kind' AND c.external_id=v->>'externalId' WHERE c.source_id=$1 FOR UPDATE OF c`,
    [platformId, missing.map((node) => JSON.stringify(node.item))],
  );
  for (const row of stored.rows) {
    const node = missing.find((candidate) => identity(candidate.item) === `${row.kind}:${row.external_id}`)!;
    if (hasConflictingContentVersion(row, node.item)) conflict("Conflicting content in the same version");
    rows.push({ ...row, inserted: false, changed: false });
  }
  if (rows.length !== nodes.length) conflict("Content identity resolution failed");
}

function mergeProfileRecord(prev: AuthorProfileRecord | undefined, next: AuthorProfileRecord): AuthorProfileRecord {
  if (!prev) return next;
  return {
    handle: next.handle,
    externalId: next.externalId ?? prev.externalId,
    displayName: next.displayName ?? prev.displayName,
    avatarUrl: next.avatarUrl ?? prev.avatarUrl,
    bio: next.bio ?? prev.bio,
    location: next.location ?? prev.location,
    verified: next.verified || prev.verified,
    followersCount: next.followersCount ?? prev.followersCount,
    followingCount: next.followingCount ?? prev.followingCount,
    statusesCount: next.statusesCount ?? prev.statusesCount,
    accountCreatedAt: next.accountCreatedAt ?? prev.accountCreatedAt,
    lastSeenAt: Date.parse(next.lastSeenAt) > Date.parse(prev.lastSeenAt) ? next.lastSeenAt : prev.lastSeenAt,
  };
}

async function upsertAuthorProfiles(client: PoolClient, platformId: string, nodes: PreparedContentBatch["nodes"]) {
  const byHandle = new Map<string, AuthorProfileRecord>();
  for (const { item } of nodes) {
    const rec = toAuthorProfileRecord(item);
    if (rec) byHandle.set(rec.handle, mergeProfileRecord(byHandle.get(rec.handle), rec));
  }
  if (!byHandle.size) return;
  const profiles = [...byHandle.values()].sort((a, b) => a.handle.localeCompare(b.handle));
  await client.query(
    `INSERT INTO content_author_profile(
       platform_id,author_handle,author_external_id,display_name,avatar_url,bio,location,
       verified,followers_count,following_count,statuses_count,account_created_at,last_seen_at,metrics_updated_at
     )
     SELECT $1,v->>'handle',v->>'externalId',v->>'displayName',v->>'avatarUrl',v->>'bio',v->>'location',
       COALESCE((v->>'verified')::boolean,false),(v->>'followersCount')::bigint,(v->>'followingCount')::bigint,
       (v->>'statusesCount')::bigint,(v->>'accountCreatedAt')::timestamptz,(v->>'lastSeenAt')::timestamptz,(v->>'lastSeenAt')::timestamptz
     FROM UNNEST($2::jsonb[]) AS input(v)
     ON CONFLICT(platform_id,author_handle) DO UPDATE SET
       author_external_id=COALESCE(EXCLUDED.author_external_id,content_author_profile.author_external_id),
       display_name=COALESCE(EXCLUDED.display_name,content_author_profile.display_name),
       avatar_url=COALESCE(EXCLUDED.avatar_url,content_author_profile.avatar_url),
       bio=COALESCE(EXCLUDED.bio,content_author_profile.bio),
       location=COALESCE(EXCLUDED.location,content_author_profile.location),
       verified=(content_author_profile.verified OR EXCLUDED.verified),
       followers_count=COALESCE(EXCLUDED.followers_count,content_author_profile.followers_count),
       following_count=COALESCE(EXCLUDED.following_count,content_author_profile.following_count),
       statuses_count=COALESCE(EXCLUDED.statuses_count,content_author_profile.statuses_count),
       account_created_at=COALESCE(EXCLUDED.account_created_at,content_author_profile.account_created_at),
       last_seen_at=GREATEST(content_author_profile.last_seen_at,EXCLUDED.last_seen_at),
       metrics_updated_at=GREATEST(content_author_profile.metrics_updated_at,EXCLUDED.metrics_updated_at)`,
    [platformId, profiles.map((p) => JSON.stringify(p))],
  );
}

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
    JSON.stringify({
      ...item,
      language: item.language ?? detectLanguage(item.title, item.text),
      id: stableUuidFromString(`${item.platform}:content:${item.kind}:${item.externalId}`),
      firstFetchedAt,
      lastFetchedAt,
      enriched: heuristicV1Enricher.enrich(item),
    }),
  );
  const result = await client.query(
    `WITH input AS (SELECT v FROM UNNEST($2::jsonb[]) AS input(v)),
    prior AS MATERIALIZED (
      SELECT c.*,
        (c.content_evidence_key=v->'observation'->>'evidenceKey'
         AND c.content_observed_at IS NOT DISTINCT FROM (v->'observation'->>'sourceObservedAt')::timestamptz
         AND ((c.title IS NOT NULL AND v->>'title' IS NOT NULL AND c.title<>v->>'title')
           OR (c.body_text IS NOT NULL AND v->>'text' IS NOT NULL AND c.body_text<>v->>'text')
           OR c.availability<>v->>'availability' OR c.content_references<>v->'references'
           OR c.content_media<>v->'media' OR (c.platform_details-'feedUrl') IS DISTINCT FROM ((v->'platformDetails')-'feedUrl'))) AS conflict
      FROM content c JOIN input ON c.source_id=$1 AND c.kind=v->>'kind' AND c.external_id=v->>'externalId'
    ), written AS (
    INSERT INTO content(
      id,source_id,external_id,kind,title,body_text,url,permalink,created_at_source,first_seen_at,last_seen_at,
      content_author,content_media,content_references,platform_details,language,availability,
      content_observed_at,content_evidence_key,content_version_fetched_at,
      author_handle,community_name,external_domain,hashtags,has_media,primary_media_url,card_layout,
      clean_excerpt,intent_tag,intent_confidence,enrichment_version,enrichment_source,
      metric_score,metric_comments,metric_views,metric_likes,metric_reposts,metric_bookmarks,upvote_ratio,
      engagement_score,discussion_ratio,velocity_score,metrics_updated_at
    )
    SELECT (v->>'id')::uuid,$1,v->>'externalId',v->>'kind',
      CASE WHEN v->>'availability' IN ('removed','deleted') THEN NULL ELSE v->>'title' END,
      CASE WHEN v->>'availability' IN ('removed','deleted') THEN NULL ELSE v->>'text' END,
      v->>'url',v->>'url',(v->>'publishedAt')::timestamptz,(v->>'firstFetchedAt')::timestamptz,(v->>'lastFetchedAt')::timestamptz,
      NULLIF(v->'author','null'::jsonb),v->'media',v->'references',v->'platformDetails',v->>'language',v->>'availability',
      (v->'observation'->>'sourceObservedAt')::timestamptz,v->'observation'->>'evidenceKey',(v->>'fetchedAt')::timestamptz,
      v->'enriched'->>'authorHandle',v->'enriched'->>'communityName',v->'enriched'->>'externalDomain',
      ARRAY(SELECT jsonb_array_elements_text(v->'enriched'->'hashtags')),
      (v->'enriched'->>'hasMedia')::boolean,v->'enriched'->>'primaryMediaUrl',v->'enriched'->>'cardLayout',
      v->'enriched'->>'cleanExcerpt',v->'enriched'->>'intentTag',(v->'enriched'->>'intentConfidence')::real,
      (v->'enriched'->>'enrichmentVersion')::smallint,v->'enriched'->>'enrichmentSource',
      (v->'enriched'->>'metricScore')::integer,(v->'enriched'->>'metricComments')::integer,(v->'enriched'->>'metricViews')::bigint,
      (v->'enriched'->>'metricLikes')::integer,(v->'enriched'->>'metricReposts')::integer,(v->'enriched'->>'metricBookmarks')::integer,
      (v->'enriched'->>'upvoteRatio')::real,COALESCE((v->'enriched'->>'engagementScore')::real,0),
      COALESCE((v->'enriched'->>'discussionRatio')::real,0),
      CASE WHEN (v->>'publishedAt')::timestamptz IS NOT NULL
        THEN (COALESCE((v->'enriched'->>'engagementScore')::real,0) / GREATEST(1.0, EXTRACT(EPOCH FROM ((v->>'fetchedAt')::timestamptz - (v->>'publishedAt')::timestamptz)) / 3600.0))::real
        ELSE 0 END,
      (v->>'fetchedAt')::timestamptz
    FROM input
    ORDER BY (v->>'kind') COLLATE "C",(v->>'externalId') COLLATE "C"
    ON CONFLICT(source_id,kind,external_id) DO UPDATE SET ${assignments}
    WHERE NOT (${sameVersionConflict}) AND ((${changed})
      OR EXCLUDED.first_seen_at<content.first_seen_at OR EXCLUDED.last_seen_at>content.last_seen_at+interval '6 hours')
    RETURNING content.*,(xmax=0) AS inserted
    ) SELECT w.id,w.kind,w.external_id,w.title,w.body_text,w.inserted,
        (w.title,w.body_text,w.content_evidence_key,w.content_observed_at,w.content_version_fetched_at,w.content_author,w.availability,w.platform_details,w.content_media,w.content_references,w.url,w.language,w.created_at_source)
        IS DISTINCT FROM
        (p.title,p.body_text,p.content_evidence_key,p.content_observed_at,p.content_version_fetched_at,p.content_author,p.availability,p.platform_details,p.content_media,p.content_references,p.url,p.language,p.created_at_source) AS changed
      FROM written w LEFT JOIN prior p USING(id)
      UNION ALL SELECT c.id,c.kind,c.external_id,c.title,c.body_text,FALSE,FALSE FROM prior p JOIN content c USING(id)
      WHERE NOT p.conflict AND NOT EXISTS(SELECT 1 FROM written w WHERE w.id=p.id)`,
    [source.platformId, values],
  );
  await resolveMissingBatchNodes(client, source.platformId, batch.nodes, result.rows);
  await upsertAuthorProfiles(client, source.platformId, batch.nodes);
  const identities = new Map(result.rows.map((row) => [`${row.kind}:${row.external_id}`, row.id as string]));
  const documents = result.rows.filter((row) => row.changed).map((row) => JSON.stringify({ id: row.id, ...publicSearchDocument(row.title, row.body_text, now) }));
  if (documents.length) {
    await client.query(
      `INSERT INTO public_content_search_document(content_id,format_version,search_text,title_length,text_present,indexed_at,fingerprint)
      SELECT (v->>'id')::uuid,1,(v->>'normalizedTitle')||chr(31)||(v->>'normalizedText'),char_length(v->>'normalizedTitle'),(v->>'textPresent')::boolean,$2,(v->>'fingerprint')
      FROM UNNEST($1::jsonb[]) AS input(v)
      ON CONFLICT(content_id) DO UPDATE SET search_text=EXCLUDED.search_text,title_length=EXCLUDED.title_length,text_present=EXCLUDED.text_present,indexed_at=EXCLUDED.indexed_at,fingerprint=EXCLUDED.fingerprint,format_version=1
      WHERE public_content_search_document.fingerprint IS DISTINCT FROM EXCLUDED.fingerprint`,
      [documents, now],
    );
  }
  await client.query(
    `INSERT INTO content_discovery(content_id,collection_source_id,first_fetched_at,last_fetched_at)
    SELECT (v->>'id')::uuid,$2,(v->>'firstFetchedAt')::timestamptz,(v->>'lastFetchedAt')::timestamptz FROM UNNEST($1::jsonb[]) AS input(v)
    ON CONFLICT(content_id,collection_source_id) DO UPDATE SET first_fetched_at=LEAST(content_discovery.first_fetched_at,EXCLUDED.first_fetched_at),last_fetched_at=GREATEST(content_discovery.last_fetched_at,EXCLUDED.last_fetched_at) WHERE EXCLUDED.first_fetched_at<content_discovery.first_fetched_at OR EXCLUDED.last_fetched_at>content_discovery.last_fetched_at+interval '6 hours'`,
    [batch.nodes.map((node) => JSON.stringify({ id: identities.get(identity(node.item)), firstFetchedAt: node.firstFetchedAt, lastFetchedAt: node.lastFetchedAt })), source.id],
  );
  const observations = batch.observations.map(({ item, hash }) => JSON.stringify({ ...item.observation, id: identities.get(identity(item)), hash }));
  const inserted = await client.query(
    `INSERT INTO content_observation(content_id,collection_source_id,provider,source_observed_at,fetched_at,time_basis,maturity,metrics,evidence_key,payload_hash)
    SELECT (v->>'id')::uuid,$2,v->>'provider',(v->>'sourceObservedAt')::timestamptz,(v->>'fetchedAt')::timestamptz,v->>'timeBasis',v->>'maturity',v->'metrics',v->>'evidenceKey',v->>'hash' FROM UNNEST($1::jsonb[]) AS input(v)
    ON CONFLICT(content_id,collection_source_id,provider,evidence_key) DO UPDATE SET payload_hash=EXCLUDED.payload_hash
    WHERE content_observation.payload_hash IS NULL
      AND content_observation.source_observed_at IS NOT DISTINCT FROM EXCLUDED.source_observed_at
      AND content_observation.time_basis=EXCLUDED.time_basis AND content_observation.maturity=EXCLUDED.maturity AND content_observation.metrics=EXCLUDED.metrics
    RETURNING id`,
    [observations, source.id],
  );
  if (inserted.rowCount !== observations.length) {
    const verified = await client.query<{ ok: number }>(
      `SELECT count(*)::int AS ok FROM UNNEST($1::jsonb[]) v
      JOIN content_observation o ON o.content_id=(v->>'id')::uuid AND o.collection_source_id=$2
        AND o.provider=v->>'provider' AND o.evidence_key=v->>'evidenceKey'
      WHERE o.payload_hash=v->>'hash'
        AND o.source_observed_at IS NOT DISTINCT FROM (v->>'sourceObservedAt')::timestamptz
        AND o.time_basis=v->>'timeBasis' AND o.maturity=v->>'maturity' AND o.metrics=v->'metrics'`,
      [observations, source.id],
    );
    if (verified.rows[0]?.ok !== observations.length) conflict("Conflicting observation evidence key");
  }
  const added = result.rows.filter((row) => row.inserted).length;
  return { added, updated: result.rows.filter((row) => !row.inserted && row.changed).length };
}

export function contentFromRow(
  row: import("pg").QueryResultRow,
): import("../../../packages/contracts/src/content").PublicContent {
  const iso = (value: Date | null) => value?.toISOString() ?? null;
  const hasText = typeof row.body_text === "string" && row.body_text.trim().length > 0;
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
    ...(row.context_missing === undefined ? {} : { contextMissing: row.context_missing }),
    media: row.content_media,
    platformDetails: row.platform_details,
    textState: !hasText ? "missing" : row.platform_details?.textCompleteness === "summary" ? "summary" : "full",
    observations: row.observations ?? [],
  };
}
