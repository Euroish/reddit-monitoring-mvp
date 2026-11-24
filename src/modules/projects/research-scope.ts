import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { Actor } from "../../../packages/contracts/src/access";
import type { ContentPlatform } from "../../../packages/contracts/src/common";
import type { Filter } from "../../../packages/contracts/src/content";
import type {
  AnalysisScopeRequest,
  NormalizedAnalysisScope,
  ResearchBatchNode,
  ResearchScopeTreeResponse,
  ResearchTargetGroup,
} from "../../../packages/contracts/src/research";
import { fail } from "../../shared/errors";
import {
  contentVisibility,
  listSourcesByIds,
  loadAuthorizedBatches,
} from "../collection/index";
import { compileContentFilter, contentSourceTables, contentTables } from "../content/index";
import { projectSources, type Project } from "./sql";

export interface AuthorizedTargetMember {
  targetKey: string;
  targetLabel: string;
  targetType: string;
  sourceId: string;
  platform: ContentPlatform;
  batches: ResearchBatchNode[];
}

export interface ResolvedResearchContext {
  project: Project;
  dataVersion: string;
  targetGroups: ResearchTargetGroup[];
  scope: NormalizedAnalysisScope;
  /** Non-empty only when emptySelection is false */
  effectiveBatchMappings: Array<{
    batchId: string;
    sourceId: string;
    targetKey: string;
    targetLabel: string;
    targetType: string;
  }>;
  effectiveSourceMappings: Array<{
    sourceId: string;
    targetKey: string;
    targetLabel: string;
    targetType: string;
  }>;
  useBatchMappings: boolean;
}

export function deriveTargetIdentity(source: {
  id: string;
  label: string;
  target: Record<string, unknown>;
}): { key: string; label: string; targetType: string } {
  const t = source.target ?? {};
  const targetType = typeof t.type === "string" ? t.type : "source";
  if (targetType === "search" && typeof t.query === "string" && t.query.trim()) {
    const q = t.query.trim();
    return { key: `search:${q.toLowerCase()}`, label: q, targetType: "search" };
  }
  if (targetType === "community" && typeof t.community === "string" && t.community.trim()) {
    const c = t.community.trim().replace(/^r\//i, "");
    return { key: `community:${c.toLowerCase()}`, label: `r/${c}`, targetType: "community" };
  }
  if (targetType === "account" && typeof t.account === "string" && t.account.trim()) {
    const a = t.account.trim().replace(/^@/, "");
    return { key: `account:${a.toLowerCase()}`, label: `@${a}`, targetType: "account" };
  }
  return { key: `source:${source.id}`, label: source.label, targetType };
}

function buildTargetGroups(
  sources: Awaited<ReturnType<typeof listSourcesByIds>>,
  batches: Array<{
    batchId: string;
    jobId: string | null;
    sourceId: string;
    sourceLabel: string;
    platform: string;
    provider: string;
    deliveryMode: string;
    label: string;
    itemCount: number;
    visibility: "private" | "shared";
    status: "enabled" | "disabled" | "removed" | "source_linked";
    createdAt: string;
  }>,
): ResearchTargetGroup[] {
  const byKey = new Map<
    string,
    {
      key: string;
      label: string;
      targetType: string;
      platforms: Set<ContentPlatform>;
      sourceIds: Set<string>;
      batches: ResearchBatchNode[];
    }
  >();
  const sourceTargetMap = new Map<string, { key: string; label: string; targetType: string; platform: ContentPlatform }>();

  for (const s of sources) {
    const ident = deriveTargetIdentity({ id: s.id, label: s.label, target: s.target as Record<string, unknown> });
    sourceTargetMap.set(s.id, { ...ident, platform: s.platform as ContentPlatform });
    let grp = byKey.get(ident.key);
    if (!grp) {
      grp = {
        key: ident.key,
        label: ident.label,
        targetType: ident.targetType,
        platforms: new Set<ContentPlatform>(),
        sourceIds: new Set<string>(),
        batches: [],
      };
      byKey.set(ident.key, grp);
    }
    grp.platforms.add(s.platform as ContentPlatform);
    grp.sourceIds.add(s.id);
  }

  for (const b of batches) {
    const known = sourceTargetMap.get(b.sourceId);
    const key = known?.key ?? `source:${b.sourceId}`;
    const label = known?.label ?? b.sourceLabel;
    const targetType = known?.targetType ?? "source";
    let grp = byKey.get(key);
    if (!grp) {
      grp = {
        key,
        label,
        targetType,
        platforms: new Set<ContentPlatform>(),
        sourceIds: new Set<string>(),
        batches: [],
      };
      byKey.set(key, grp);
    }
    grp.platforms.add(b.platform as ContentPlatform);
    grp.sourceIds.add(b.sourceId);
    grp.batches.push({
      batchId: b.batchId,
      jobId: b.jobId,
      sourceId: b.sourceId,
      sourceLabel: b.sourceLabel,
      platform: b.platform as ContentPlatform,
      provider: b.provider,
      deliveryMode: b.deliveryMode,
      label: b.label,
      itemCount: b.itemCount,
      visibility: b.visibility,
      status: b.status,
      createdAt: b.createdAt,
    });
  }

  return [...byKey.values()]
    .map((g) => ({
      key: g.key,
      label: g.label,
      targetType: g.targetType,
      platforms: [...g.platforms].sort(),
      sourceIds: [...g.sourceIds].sort(),
      batchCount: g.batches.length,
      totalBatchItems: g.batches.reduce((sum, b) => sum + b.itemCount, 0),
      batches: g.batches.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

async function loadAuthorizedProjectBatches(
  db: Pool | PoolClient,
  actor: Actor,
  project: Project,
) {
  if (project.dataset_mode === "batch") {
    const { rows } = await db.query<{ batch_id: string; status: "enabled" | "disabled" }>(
      `SELECT batch_id, status FROM monitor_project_batch
       WHERE project_id=$1 AND status='enabled'
       ORDER BY added_at DESC, batch_id DESC`,
      [project.id],
    );
    const authorized = await loadAuthorizedBatches(
      db,
      actor,
      rows.map((r) => r.batch_id),
    );
    const authMap = new Map(authorized.map((b) => [b.batchId, b]));
    return rows.flatMap((r) => {
      const b = authMap.get(r.batch_id);
      return b ? [{ ...b, status: r.status }] : [];
    });
  }

  if (!project.source_ids.length) return [];
  const { rows } = await db.query<{ id: string }>(
    `SELECT cb.id FROM collection_batch cb
     WHERE cb.collection_source_id = ANY($1::uuid[])
       AND cb.discarded_at IS NULL
       AND ($2::uuid[] IS NULL OR cb.collection_source_id = ANY($2::uuid[]))
       AND (NOT $3::boolean OR cb.visibility = 'shared' OR cb.created_by_user_id = $4::uuid)
     ORDER BY cb.created_at DESC, cb.id DESC
     LIMIT 200`,
    [project.source_ids, actor.allowedSourceIds, actor.role === "viewer", actor.userId ?? null],
  );
  const authorized = await loadAuthorizedBatches(
    db,
    actor,
    rows.map((r) => r.id),
  );
  return authorized.map((b) => ({ ...b, status: "source_linked" as const }));
}

function computeDataVersion(
  project: Project,
  targetGroups: ResearchTargetGroup[],
  latestDiscoveryIso: string | null,
): string {
  const sig = {
    id: project.id,
    rev: project.revision,
    mode: project.dataset_mode,
    sources: [...project.source_ids].sort(),
    batches: targetGroups
      .flatMap((g) => g.batches.map((b) => `${b.batchId}:${b.itemCount}:${b.status}`))
      .sort(),
    latestDiscoveryIso,
  };
  return createHash("sha256").update(JSON.stringify(sig)).digest("hex").slice(0, 16);
}

export async function resolveResearchContext(
  db: Pool | PoolClient,
  actor: Actor,
  projectId: string,
  input: AnalysisScopeRequest = {},
): Promise<ResolvedResearchContext> {
  const project = await projectSources(db, actor, projectId);
  if (input.from && input.to && Date.parse(input.from) >= Date.parse(input.to)) {
    fail(422, "from must precede to");
  }
  const batches = await loadAuthorizedProjectBatches(db, actor, project);
  const allSourceIds = [...new Set([...project.source_ids, ...batches.map((b) => b.sourceId)])];
  const sources = await listSourcesByIds(db, allSourceIds);
  const targetGroups = buildTargetGroups(sources, batches);

  const authorizedSourceIds =
    actor.allowedSourceIds === null
      ? allSourceIds
      : allSourceIds.filter((id) => actor.allowedSourceIds!.includes(id));

  let latestDiscoveryIso: string | null = null;
  if (authorizedSourceIds.length > 0) {
    const { rows } = await db.query<{ latest: Date | null }>(
      `SELECT MAX(last_fetched_at) AS latest
       FROM content_discovery
       WHERE collection_source_id = ANY($1::uuid[])`,
      [authorizedSourceIds],
    );
    latestDiscoveryIso = rows[0]?.latest ? rows[0].latest.toISOString() : null;
  }
  const dataVersion = computeDataVersion(project, targetGroups, latestDiscoveryIso);

  const batchLookup = new Map<string, { batchId: string; sourceId: string; targetKey: string; targetLabel: string; targetType: string }>();
  const sourceLookup = new Map<string, { sourceId: string; targetKey: string; targetLabel: string; targetType: string }>();
  for (const grp of targetGroups) {
    for (const sid of grp.sourceIds) {
      sourceLookup.set(sid, {
        sourceId: sid,
        targetKey: grp.key,
        targetLabel: grp.label,
        targetType: grp.targetType,
      });
    }
    for (const b of grp.batches) {
      batchLookup.set(b.batchId, {
        batchId: b.batchId,
        sourceId: b.sourceId,
        targetKey: grp.key,
        targetLabel: grp.label,
        targetType: grp.targetType,
      });
    }
  }

  let emptySelection = false;
  let effectiveBatchMappings: ResolvedResearchContext["effectiveBatchMappings"] = [];
  let effectiveSourceMappings: ResolvedResearchContext["effectiveSourceMappings"] = [];
  let useBatchMappings = project.dataset_mode === "batch";

  if (input.batchIds !== undefined) {
    useBatchMappings = true;
    const requested = new Set(input.batchIds);
    effectiveBatchMappings = [...batchLookup.values()].filter((m) => requested.has(m.batchId));
    if (effectiveBatchMappings.length === 0) emptySelection = true;
  } else if (input.sourceIds !== undefined) {
    const requested = new Set(input.sourceIds);
    if (useBatchMappings) {
      effectiveBatchMappings = [...batchLookup.values()].filter((m) => requested.has(m.sourceId));
      if (effectiveBatchMappings.length === 0) emptySelection = true;
    } else {
      effectiveSourceMappings = [...sourceLookup.values()].filter((m) => requested.has(m.sourceId));
      if (effectiveSourceMappings.length === 0) emptySelection = true;
    }
  } else if (input.targetKeys !== undefined) {
    const requested = new Set(input.targetKeys);
    if (useBatchMappings) {
      effectiveBatchMappings = [...batchLookup.values()].filter((m) => requested.has(m.targetKey));
      if (effectiveBatchMappings.length === 0) emptySelection = true;
    } else {
      effectiveSourceMappings = [...sourceLookup.values()].filter((m) => requested.has(m.targetKey));
      if (effectiveSourceMappings.length === 0) emptySelection = true;
    }
  } else if (useBatchMappings) {
    effectiveBatchMappings = [...batchLookup.values()];
    if (effectiveBatchMappings.length === 0) emptySelection = true;
  } else {
    effectiveSourceMappings = [...sourceLookup.values()];
    if (effectiveSourceMappings.length === 0) emptySelection = true;
  }

  const selectedSourceIds = useBatchMappings
    ? [...new Set(effectiveBatchMappings.map((m) => m.sourceId))]
    : [...new Set(effectiveSourceMappings.map((m) => m.sourceId))];
  const selectedBatchIds = useBatchMappings
    ? [...new Set(effectiveBatchMappings.map((m) => m.batchId))]
    : [];
  const selectedTargetKeys = useBatchMappings
    ? [...new Set(effectiveBatchMappings.map((m) => m.targetKey))]
    : [...new Set(effectiveSourceMappings.map((m) => m.targetKey))];

  const scope: NormalizedAnalysisScope = {
    emptySelection,
    selectedTargetKeys: selectedTargetKeys.sort(),
    selectedSourceIds: selectedSourceIds.sort(),
    selectedBatchIds: selectedBatchIds.sort(),
    from: input.from ?? null,
    to: input.to ?? null,
    timeBasis: input.timeBasis ?? "published",
    platforms: [...(input.platforms ?? [])].sort() as ContentPlatform[],
    kinds: [...(input.kinds ?? [])].sort() as Array<"post" | "comment" | "article">,
    communities: [...(input.communities ?? [])].map((c) => c.trim().replace(/^r\//i, "").toLowerCase()).filter(Boolean).sort(),
    languages: [...(input.languages ?? [])].sort(),
    signal: input.signal ?? null,
    threadAware: input.threadAware ?? project.thread_aware,
    bucket: input.bucket ?? "day",
    includeUndated: input.includeUndated ?? true,
  };

  return {
    project,
    dataVersion,
    targetGroups,
    scope,
    effectiveBatchMappings,
    effectiveSourceMappings,
    useBatchMappings,
  };
}

export function buildScopedSql(
  actor: Actor,
  ctx: ResolvedResearchContext,
): {
  cteSql: string;
  values: unknown[];
} {
  const { project, scope, effectiveBatchMappings, effectiveSourceMappings, useBatchMappings } = ctx;
  const requestFilter: Filter = {
    ...(scope.from ? { from: scope.from } : {}),
    ...(scope.to ? { to: scope.to } : {}),
    timeBasis: scope.timeBasis,
    ...(scope.platforms.length ? { platforms: scope.platforms } : {}),
    ...(scope.kinds.length ? { kinds: scope.kinds } : {}),
    ...(scope.communities.length ? { communities: scope.communities } : {}),
    ...(scope.languages.length ? { languages: scope.languages } : {}),
    ...(scope.signal ? { signal: scope.signal } : {}),
  };

  const pullOnly = !useBatchMappings && !project.include_push_in_trends && !project.filter.deliveryMode;
  const vis = useBatchMappings ? undefined : contentVisibility(actor);
  const compiled = compileContentFilter(
    actor,
    requestFilter,
    scope.selectedSourceIds,
    project.filter,
    pullOnly,
    vis,
  );
  const values = [...compiled.values];
  const bind = (val: unknown) => {
    values.push(val);
    return `$${values.length}`;
  };

  let membershipCte: string;
  if (useBatchMappings) {
    const bIds = bind(effectiveBatchMappings.map((m) => m.batchId));
    const tKeys = bind(effectiveBatchMappings.map((m) => m.targetKey));
    const tLabels = bind(effectiveBatchMappings.map((m) => m.targetLabel));
    const tTypes = bind(effectiveBatchMappings.map((m) => m.targetType));
    membershipCte = `
      mapping AS (
        SELECT * FROM UNNEST(${bIds}::uuid[], ${tKeys}::text[], ${tLabels}::text[], ${tTypes}::text[])
        AS m(batch_id, target_key, target_label, target_type)
      ),
      raw_memberships AS (
        SELECT DISTINCT
          cbi.content_id,
          m.target_key,
          m.target_label,
          m.target_type,
          cb.collection_source_id AS source_id
        FROM mapping m
        JOIN collection_batch cb ON cb.id = m.batch_id AND cb.discarded_at IS NULL
        JOIN collection_batch_item cbi ON cbi.batch_id = cb.id
        JOIN content_discovery d ON d.content_id = cbi.content_id AND d.collection_source_id = cb.collection_source_id
      )`;
  } else {
    const sIds = bind(effectiveSourceMappings.map((m) => m.sourceId));
    const tKeys = bind(effectiveSourceMappings.map((m) => m.targetKey));
    const tLabels = bind(effectiveSourceMappings.map((m) => m.targetLabel));
    const tTypes = bind(effectiveSourceMappings.map((m) => m.targetType));
    membershipCte = `
      mapping AS (
        SELECT * FROM UNNEST(${sIds}::uuid[], ${tKeys}::text[], ${tLabels}::text[], ${tTypes}::text[])
        AS m(source_id, target_key, target_label, target_type)
      ),
      raw_memberships AS (
        SELECT DISTINCT
          d.content_id,
          m.target_key,
          m.target_label,
          m.target_type,
          d.collection_source_id AS source_id
        FROM mapping m
        JOIN content_discovery d ON d.collection_source_id = m.source_id
      )`;
  }

  const tables = compiled.needsSearchDocument ? contentTables : contentSourceTables;
  const includeUndatedClause = scope.includeUndated ? "" : ` AND ${scope.timeBasis === "collected" ? "c.first_seen_at" : "c.created_at_source"} IS NOT NULL`;

  const cteSql = `WITH ${membershipCte},
    dedup_content AS (
      SELECT DISTINCT ON (c.id)
        c.id,
        c.source_id AS platform_id,
        c.kind,
        c.external_id,
        c.title,
        c.body_text,
        c.clean_excerpt,
        COALESCE(c.permalink, c.url) AS url,
        c.language,
        c.author_handle,
        c.community_name,
        c.external_domain,
        c.intent_tag,
        c.created_at_source,
        c.first_seen_at,
        c.metric_score,
        c.metric_comments,
        c.metric_views,
        c.metric_likes,
        c.metric_reposts,
        c.metric_bookmarks,
        c.engagement_score,
        c.discussion_ratio,
        c.content_references,
        p.code AS platform
      FROM ${tables}
      JOIN raw_memberships rm ON rm.content_id = c.id
      WHERE c.availability = 'available' AND (${compiled.text})${includeUndatedClause}
      ORDER BY c.id
    ),
    scoped_memberships AS (
      SELECT rm.content_id, rm.target_key, rm.target_label, rm.target_type, rm.source_id
      FROM raw_memberships rm
      JOIN dedup_content dc ON dc.id = rm.content_id
    )`;

  return { cteSql, values };
}

export async function getProjectResearchScopeTree(
  pool: Pool,
  actor: Actor,
  projectId: string,
): Promise<ResearchScopeTreeResponse> {
  const ctx = await resolveResearchContext(pool, actor, projectId, {});
  const baseResponse: ResearchScopeTreeResponse = {
    project: {
      id: ctx.project.id,
      name: ctx.project.name,
      description: ctx.project.description,
      datasetMode: ctx.project.dataset_mode,
      visibility: ctx.project.visibility,
      revision: ctx.project.revision,
      threadAware: ctx.project.thread_aware,
      includePushInTrends: ctx.project.include_push_in_trends,
      canEdit: ctx.project.can_edit,
    },
    dataVersion: ctx.dataVersion,
    targetGroups: ctx.targetGroups,
    availablePlatforms: [],
    availableKinds: [],
    availableCommunities: [],
    availableLanguages: [],
    dateBounds: {
      minPublishedAt: null,
      maxPublishedAt: null,
      minCollectedAt: null,
      maxCollectedAt: null,
      totalCount: 0,
      undatedCount: 0,
    },
  };

  if (ctx.scope.emptySelection) return baseResponse;

  const { cteSql, values } = buildScopedSql(actor, ctx);
  const { rows: [summary] } = await pool.query<{
    platforms: Array<{ platform: ContentPlatform; count: number }> | null;
    kinds: Array<{ kind: "post" | "comment" | "article"; count: number }> | null;
    communities: Array<{ community: string; count: number }> | null;
    languages: Array<{ language: string; count: number }> | null;
    min_pub: Date | null;
    max_pub: Date | null;
    min_col: Date | null;
    max_col: Date | null;
    total_count: number;
    undated_count: number;
  }>(
    `${cteSql}
    SELECT
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('platform', platform, 'count', cnt) ORDER BY cnt DESC, platform), '[]'::jsonb)
       FROM (SELECT platform, COUNT(*)::int AS cnt FROM dedup_content GROUP BY platform) p) AS platforms,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', kind, 'count', cnt) ORDER BY cnt DESC, kind), '[]'::jsonb)
       FROM (SELECT kind, COUNT(*)::int AS cnt FROM dedup_content GROUP BY kind) k) AS kinds,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('community', community_name, 'count', cnt) ORDER BY cnt DESC, community_name), '[]'::jsonb)
       FROM (SELECT community_name, COUNT(*)::int AS cnt FROM dedup_content WHERE community_name IS NOT NULL GROUP BY community_name ORDER BY cnt DESC LIMIT 60) cm) AS communities,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('language', language, 'count', cnt) ORDER BY cnt DESC, language), '[]'::jsonb)
       FROM (SELECT language, COUNT(*)::int AS cnt FROM dedup_content WHERE language IS NOT NULL GROUP BY language ORDER BY cnt DESC LIMIT 30) lg) AS languages,
      MIN(created_at_source) AS min_pub,
      MAX(created_at_source) AS max_pub,
      MIN(first_seen_at) AS min_col,
      MAX(first_seen_at) AS max_col,
      COUNT(*)::int AS total_count,
      COUNT(*) FILTER (WHERE created_at_source IS NULL)::int AS undated_count
    FROM dedup_content`,
    values,
  );

  if (!summary) return baseResponse;
  return {
    ...baseResponse,
    availablePlatforms: summary.platforms ?? [],
    availableKinds: summary.kinds ?? [],
    availableCommunities: summary.communities ?? [],
    availableLanguages: summary.languages ?? [],
    dateBounds: {
      minPublishedAt: summary.min_pub?.toISOString() ?? null,
      maxPublishedAt: summary.max_pub?.toISOString() ?? null,
      minCollectedAt: summary.min_col?.toISOString() ?? null,
      maxCollectedAt: summary.max_col?.toISOString() ?? null,
      totalCount: summary.total_count ?? 0,
      undatedCount: summary.undated_count ?? 0,
    },
  };
}
