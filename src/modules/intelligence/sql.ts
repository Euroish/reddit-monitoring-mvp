import { createHash, randomUUID } from "node:crypto";
import type { Static } from "@sinclair/typebox";
import type { Pool, PoolClient } from "pg";
import type { Actor } from "../../../packages/contracts/src/access";
import type {
  IntelMonitorDto,
  MonitorCollectBody,
  MonitorCreateBody,
  MonitorPatchBody,
} from "../../../packages/contracts/src/intelligence";
import type { ContentProvider } from "../../connectors/shared/content-provider.interface";
import { notifyChannel } from "../../platform/pg-notify";
import { fail } from "../../shared/errors";
import { transaction } from "../../storage/db";
import { canonical } from "../content/index";
import {
  cancelUnstartedMonitorHydrations,
  checkAndDebitViewerQuota,
  enqueueCollectionForSource,
  getUserRoleStatus,
  listLegacySources,
  listSourcesByIds,
  loadEffectivePolicyForUser,
  reconcileLegacySource,
} from "../collection/index";
import {
  estimateMonitorCollection,
  lockMonitorLifecycle,
  monitorSourceIds,
  provisionMonitorSources,
  reconcileMonitorSources,
} from "./provisioning";

export type AssertWritableProjectFn = (db: Pool | PoolClient, actor: Actor, projectId: string) => Promise<unknown>;

export interface MonitorWithSources {
  monitor: IntelMonitorDto;
  sourceIds: string[];
  targets: Array<{ targetKind: string; targetValue: string; platform: string }>;
}

function mapMonitorRow(
  r: Record<string, unknown>,
  sourceCount: number,
  targetCount: number,
  lastSuccessAt: string | null,
): IntelMonitorDto {
  return {
    id: String(r.id),
    kind: r.kind as IntelMonitorDto["kind"],
    name: String(r.name),
    config: r.config as IntelMonitorDto["config"],
    scheduleIntervalHours: Number(r.schedule_interval_hours),
    dailyItemBudget: Number(r.daily_item_budget),
    enabled: Boolean(r.enabled),
    projectId: (r.project_id as string | null | undefined) ?? null,
    pausedReason: (r.paused_reason as string | null | undefined) ?? null,
    lastDispatchedAt: r.last_dispatched_at instanceof Date ? r.last_dispatched_at.toISOString() : null,
    nextDueAt: r.next_due_at instanceof Date ? r.next_due_at.toISOString() : null,
    revision: Number(r.revision),
    sourceCount,
    targetCount,
    lastSuccessAt,
    createdAt: (r.created_at as Date).toISOString(),
    updatedAt: (r.updated_at as Date).toISOString(),
  };
}

const monitorAccess = `($2::uuid IS NULL OR m.owner_user_id=$2)
  AND ($3::uuid[] IS NULL OR NOT EXISTS (
    SELECT 1 FROM intel_monitor_source ms
    WHERE ms.monitor_id=m.id AND NOT (ms.collection_source_id=ANY($3))
  ))`;

function isStaffBrowser(actor: Actor) {
  return actor.clientKind === "browser" && (actor.role === "owner" || actor.role === "admin");
}

function monitorAccessParameters(actor: Actor) {
  return [isStaffBrowser(actor) ? null : actor.userId, actor.allowedSourceIds] as const;
}

async function selectMonitor(db: Pool | PoolClient, actor: Actor, id: string, lock = false) {
  const { rows: [row] } = await db.query(
    `SELECT m.* FROM intel_monitor m WHERE m.id=$1 AND ${monitorAccess}${lock ? " FOR UPDATE OF m" : ""}`,
    [id, ...monitorAccessParameters(actor)],
  );
  if (!row) fail(404, "Monitor not found");
  return row;
}

export async function listMonitors(pool: Pool, actor: Actor, kind?: string): Promise<IntelMonitorDto[]> {
  const { rows } = await pool.query(
    `SELECT m.*,
       COALESCE(ARRAY(SELECT ms.collection_source_id FROM intel_monitor_source ms WHERE ms.monitor_id=m.id ORDER BY ms.collection_source_id), '{}') AS source_ids,
       (SELECT COUNT(*)::int FROM intel_monitor_target mt WHERE mt.monitor_id=m.id) AS target_count
     FROM intel_monitor m
     WHERE ($1::text IS NULL OR m.kind=$1) AND ${monitorAccess}
     ORDER BY m.updated_at DESC, m.id DESC`,
    [kind ?? null, ...monitorAccessParameters(actor)],
  );
  const allSrcIds = [...new Set(rows.flatMap((r) => r.source_ids as string[]))];
  const sources = await listSourcesByIds(pool, allSrcIds);
  const srcMap = new Map(sources.map((s) => [s.id, s]));

  return rows.map((r) => {
    const srcIds = (r.source_ids as string[]) ?? [];
    const lastDates = srcIds
      .map((id) => srcMap.get(id)?.lastSuccessAt)
      .filter((v): v is string => Boolean(v))
      .sort();
    return mapMonitorRow(
      r,
      srcIds.length,
      r.target_count ?? 0,
      lastDates.length ? lastDates[lastDates.length - 1] : null,
    );
  });
}

export async function loadMonitor(db: Pool | PoolClient, actor: Actor, id: string): Promise<MonitorWithSources> {
  const { rows: [row] } = await db.query(
    `SELECT m.*,
       ARRAY(SELECT ms.collection_source_id FROM intel_monitor_source ms
         WHERE ms.monitor_id=m.id ORDER BY ms.collection_source_id) AS source_ids,
       COALESCE((SELECT jsonb_agg(jsonb_build_object('targetKind', mt.target_kind, 'targetValue', mt.target_value,
         'platform', mt.platform) ORDER BY mt.target_kind, mt.platform, mt.target_value)
         FROM intel_monitor_target mt WHERE mt.monitor_id=m.id), '[]') AS targets
     FROM intel_monitor m WHERE m.id=$1 AND ${monitorAccess}`,
    [id, ...monitorAccessParameters(actor)],
  );
  if (!row) fail(404, "Monitor not found");
  const sourceIds: string[] = row.source_ids;
  const targets: MonitorWithSources["targets"] = row.targets;
  const sources = await listSourcesByIds(db, sourceIds);
  const lastDates = sources.map((s) => s.lastSuccessAt).filter((v): v is string => Boolean(v)).sort();
  return {
    monitor: mapMonitorRow(row, sourceIds.length, targets.length, lastDates.length ? lastDates[lastDates.length - 1] : null),
    sourceIds,
    targets,
  };
}

async function assertMonitorSchedulePolicy(
  client: PoolClient,
  actor: Actor,
  opts: { platforms: string[]; intervalHours: number; enabling: boolean; excludeMonitorId?: string },
) {
  if (isStaffBrowser(actor)) return;
  if (actor.clientKind !== "browser") {
    fail(403, "An authenticated browser session is required to configure monitoring");
  }
  const policy = await loadEffectivePolicyForUser(client, actor.userId, true);
  if (!policy.allowAutoSchedule) {
    fail(403, "Continuous auto-schedule monitoring is not enabled for your plan");
  }
  if (policy.allowedSourceIds !== null) {
    fail(403, "Your account policy restricts monitoring to pre-approved sources");
  }
  const neededProviders = opts.platforms.map((p) => (p === "reddit" ? "kaix" : "twitterapis"));
  for (const prov of neededProviders) {
    if (!policy.allowedProviders.includes(prov)) {
      fail(403, `Provider ${prov} is not enabled for your plan`);
    }
  }
  if (opts.intervalHours < policy.minScheduleIntervalHours) {
    fail(422, `Schedule interval (${opts.intervalHours}h) is shorter than your plan minimum (${policy.minScheduleIntervalHours}h)`);
  }
  if (opts.enabling) {
    const { rows: [cnt] } = await client.query<{ active_count: number }>(
      `SELECT COUNT(*)::int AS active_count FROM intel_monitor
       WHERE owner_user_id=$1 AND enabled=TRUE AND ($2::uuid IS NULL OR id<>$2)`,
      [actor.userId, opts.excludeMonitorId ?? null],
    );
    if ((cnt?.active_count ?? 0) >= policy.maxScheduledTasks) {
      fail(403, `Scheduled monitor task limit reached (${policy.maxScheduledTasks})`);
    }
  }
}

export async function createMonitor(
  pool: Pool,
  actor: Actor,
  providers: ContentProvider[],
  input: Static<typeof MonitorCreateBody>,
  assertWritableProject?: AssertWritableProjectFn,
): Promise<IntelMonitorDto> {
  const id = randomUUID();
  const intervalHours = input.scheduleIntervalHours ?? 6;
  const dailyItemBudget = input.dailyItemBudget ?? 1000;
  const enabled = input.enabled ?? true;
  await transaction(pool, async (client) => {
    await lockMonitorLifecycle(client);
    await assertMonitorSchedulePolicy(client, actor, {
      platforms: input.config.platforms,
      intervalHours,
      enabling: enabled,
    });
    if (input.projectId && assertWritableProject) {
      await assertWritableProject(client, actor, input.projectId);
    }
    await client.query(
      `INSERT INTO intel_monitor(id, owner_user_id, project_id, kind, name, config, schedule_interval_hours, daily_item_budget, enabled, next_due_at, created_at, updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,CASE WHEN $9 THEN NOW() ELSE NULL END,NOW(),NOW())`,
      [id, actor.userId, input.projectId ?? null, input.kind, input.name.trim(), input.config, intervalHours, dailyItemBudget, enabled],
    );
    await reconcileMonitorSources(client, await provisionMonitorSources(client, providers, id, input.kind, input.config));
    if (actor.allowedSourceIds !== null) await selectMonitor(client, actor, id);
  });
  return (await loadMonitor(pool, actor, id)).monitor;
}

function resolveMonitorPatchState(
  row: {
    name: string;
    project_id: string | null;
    config: Static<typeof MonitorCreateBody>["config"];
    schedule_interval_hours: number;
    daily_item_budget: number;
    enabled: boolean;
  },
  patch: Static<typeof MonitorPatchBody>,
) {
  const nextInterval = patch.scheduleIntervalHours ?? row.schedule_interval_hours;
  const nextEnabled = patch.enabled ?? row.enabled;
  const scheduleChanged = patch.scheduleIntervalHours !== undefined && patch.scheduleIntervalHours !== row.schedule_interval_hours;
  const enabledChanged = patch.enabled !== undefined && patch.enabled !== row.enabled;
  const nextDueExpr = nextEnabled && !row.enabled ? "NOW()" : nextEnabled ? "COALESCE(next_due_at, NOW())" : "NULL";
  return {
    nextName: patch.name?.trim() ?? row.name,
    nextBudget: patch.dailyItemBudget ?? row.daily_item_budget,
    nextProjectId: patch.projectId === undefined ? row.project_id : patch.projectId,
    nextConfig: patch.config ?? row.config,
    nextInterval,
    nextEnabled,
    nextDueExpr,
    scheduleChanged,
    enabledChanged,
    needsPolicyCheck: Boolean(patch.config || scheduleChanged || (enabledChanged && nextEnabled)),
    enabling: Boolean(nextEnabled) && (!row.enabled || enabledChanged),
  };
}

export async function updateMonitor(
  pool: Pool,
  actor: Actor,
  providers: ContentProvider[],
  id: string,
  patch: Static<typeof MonitorPatchBody>,
  assertWritableProject?: AssertWritableProjectFn,
): Promise<IntelMonitorDto> {
  await transaction(pool, async (client) => {
    await lockMonitorLifecycle(client);
    const row = await selectMonitor(client, actor, id, true);
    if (row.revision !== patch.revision) fail(409, "Monitor changed; reload before saving");
    const next = resolveMonitorPatchState(row, patch);

    if (next.needsPolicyCheck) {
      await assertMonitorSchedulePolicy(client, actor, {
        platforms: (next.nextConfig as Static<typeof MonitorCreateBody>["config"]).platforms,
        intervalHours: next.nextInterval,
        enabling: next.enabling,
        excludeMonitorId: id,
      });
    }
    if (patch.projectId && assertWritableProject) {
      await assertWritableProject(client, actor, patch.projectId);
    }

    await client.query(
      `UPDATE intel_monitor
       SET name=$2, project_id=$3, config=$4, schedule_interval_hours=$5, daily_item_budget=$6, enabled=$7,
           paused_reason=CASE WHEN $7 THEN NULL ELSE paused_reason END,
           next_due_at=${next.nextDueExpr},
           revision=revision+1, updated_at=NOW()
       WHERE id=$1`,
      [id, next.nextName, next.nextProjectId, next.nextConfig, next.nextInterval, next.nextBudget, next.nextEnabled],
    );
    if (patch.config) {
      const affectedSourceIds = await provisionMonitorSources(client, providers, id, row.kind, next.nextConfig);
      if (actor.allowedSourceIds !== null) await selectMonitor(client, actor, id);
      await reconcileMonitorSources(client, affectedSourceIds);
    } else if (next.enabledChanged || next.scheduleChanged) {
      await reconcileMonitorSources(client, await monitorSourceIds(client, id));
    }
    if (!next.nextEnabled || patch.config || next.nextBudget < row.daily_item_budget) {
      await cancelUnstartedMonitorHydrations(client, id);
    }
  });
  return (await loadMonitor(pool, actor, id)).monitor;
}

export async function deleteMonitor(pool: Pool, actor: Actor, id: string, revision: number): Promise<{ deleted: true }> {
  return transaction(pool, async (client) => {
    await lockMonitorLifecycle(client);
    const row = await selectMonitor(client, actor, id, true);
    if (row.revision !== revision) fail(409, "Monitor changed; reload before deleting");
    const affectedSourceIds = await monitorSourceIds(client, id);
    await client.query("DELETE FROM intel_monitor WHERE id=$1", [id]);
    await reconcileMonitorSources(client, affectedSourceIds);
    await cancelUnstartedMonitorHydrations(client, id);
    return { deleted: true };
  });
}

async function readMonitorResourcesUsedToday(db: Pool | PoolClient, monitorId: string): Promise<number> {
  const { rows: [usage] } = await db.query<{ used: number }>(
    `SELECT COALESCE(resources_reserved, 0)::int AS used FROM intel_monitor_usage
     WHERE monitor_id=$1 AND day=(NOW() AT TIME ZONE 'UTC')::date`,
    [monitorId],
  );
  return usage?.used ?? 0;
}

async function recordMonitorUsage(
  client: PoolClient,
  monitorId: string,
  requests: number,
  resources: number,
) {
  if (requests <= 0 && resources <= 0) return;
  await client.query(
    `INSERT INTO intel_monitor_usage(monitor_id, day, requests, resources_reserved)
     VALUES($1, (NOW() AT TIME ZONE 'UTC')::date, $2, $3)
     ON CONFLICT (monitor_id, day) DO UPDATE SET
       requests=intel_monitor_usage.requests+$2,
       resources_reserved=intel_monitor_usage.resources_reserved+$3`,
    [monitorId, requests, resources],
  );
}

export async function estimateMonitorRun(
  pool: Pool,
  actor: Actor,
  id: string,
  body: Static<typeof MonitorCollectBody>,
) {
  const [{ monitor, sourceIds }, monitorUsedToday] = await Promise.all([
    loadMonitor(pool, actor, id),
    readMonitorResourcesUsedToday(pool, id),
  ]);
  return estimateMonitorCollection(pool, {
    sourceCount: sourceIds.length,
    dailyItemBudget: monitor.dailyItemBudget,
    monitorUsedToday,
    limitPerSource: body.limitPerSource ?? 50,
    includeComments: Boolean(body.includeComments),
    maxCommentsPerPost: body.maxCommentsPerPost ?? 15,
  });
}

export async function triggerMonitorCollect(
  pool: Pool,
  actor: Actor,
  providers: ContentProvider[],
  id: string,
  idempotencyKey: string,
  body: Static<typeof MonitorCollectBody>,
) {
  const [{ monitor, sourceIds }, initialUsedToday] = await Promise.all([
    loadMonitor(pool, actor, id),
    readMonitorResourcesUsedToday(pool, id),
  ]);
  if (!sourceIds.length) fail(422, "Monitor has no linked collection sources");
  const limit = body.limitPerSource ?? 50;
  const includeComments = Boolean(body.includeComments);
  const maxCommentsPerPost = body.maxCommentsPerPost ?? 15;
  const perSourceMultiplier = includeComments ? 1 + maxCommentsPerPost : 1;
  const estimate = await estimateMonitorCollection(pool, {
    sourceCount: sourceIds.length,
    dailyItemBudget: monitor.dailyItemBudget,
    monitorUsedToday: initialUsedToday,
    limitPerSource: limit,
    includeComments,
    maxCommentsPerPost,
  });
  // Fingerprint client intent, not the server's newly generated absolute window.
  const requestHash = createHash("sha256").update(canonical({
    monitorId: id, revision: monitor.revision, lookbackHours: body.lookbackHours ?? 168,
    limit, includeComments, maxCommentsPerPost,
  })).digest("hex");
  const to = new Date();
  const from = new Date(to.getTime() - (body.lookbackHours ?? 168) * 3_600_000);
  const outcome = await transaction(pool, async (client) => {
    const current = await selectMonitor(client, actor, id, true);
    if (current.revision !== monitor.revision) fail(409, "Monitor changed; reload before collecting");
    const lockedUsedToday = await readMonitorResourcesUsedToday(client, id);
    const rejectCreate = !current.enabled
      ? { statusCode: 409, message: "Monitor is disabled; enable it before collecting" }
      : undefined;
    const jobIds: string[] = [];
    let createdCount = 0;
    for (const sourceId of sourceIds) {
      const res = await enqueueCollectionForSource(client, actor, providers, {
        sourceId,
        from: from.toISOString(),
        to: to.toISOString(),
        limit,
        includeComments,
        maxCommentsPerPost,
        requestKey: `${idempotencyKey}:${sourceId}`,
        requestHash,
        rejectCreate,
      });
      jobIds.push(res.jobId);
      if (res.created) createdCount += 1;
    }
    const anyCreated = createdCount > 0;
    const newlyReserved = createdCount * limit * perSourceMultiplier;
    // Replays must remain retrievable after quotas change. New jobs and their
    // personal/monitor reservations roll back together if the budget rejects.
    const dailyBudget = Number(current.daily_item_budget);
    if (anyCreated && lockedUsedToday + newlyReserved > dailyBudget) {
      fail(
        422,
        `Estimated collection (${lockedUsedToday + newlyReserved} today with this run) exceeds monitor daily budget (${dailyBudget})`,
      );
    }
    if (anyCreated && estimate.exceedsSystemCeiling) {
      fail(429, `Estimated collection would exceed ${estimate.systemDailyCeiling}/day system social ceiling`);
    }
    if (anyCreated) {
      await recordMonitorUsage(client, id, createdCount, newlyReserved);
    }
    return { jobIds, anyCreated };
  });
  if (outcome.anyCreated) await notifyChannel(pool, "collection_jobs_ready");
  return { monitorId: id, jobIds: outcome.jobIds, estimatedMaxItems: estimate.estimatedMaxItems };
}

export async function listLegacyMonitorSources(pool: Pool, actor: Actor) {
  if (!isStaffBrowser(actor)) fail(403, "Administrator browser session required");
  const candidates = await listLegacySources(pool);
  if (!candidates.length) return { items: [] };
  const { rows: refs } = await pool.query<{
    collection_source_id: string;
    total_refs: number;
    enabled_refs: number;
    monitor_ids: string[];
  }>(
    `SELECT ms.collection_source_id,
       COUNT(*)::int AS total_refs,
       COUNT(*) FILTER (WHERE m.enabled)::int AS enabled_refs,
       ARRAY_AGG(m.id ORDER BY m.created_at) AS monitor_ids
     FROM intel_monitor_source ms
     JOIN intel_monitor m ON m.id = ms.monitor_id
     WHERE ms.collection_source_id = ANY($1::uuid[])
     GROUP BY ms.collection_source_id`,
    [candidates.map((c) => c.id)],
  );
  const refMap = new Map(refs.map((r) => [r.collection_source_id, r]));
  return {
    items: candidates.map((c) => {
      const ref = refMap.get(c.id);
      const totalRefs = ref?.total_refs ?? 0;
      const enabledRefs = ref?.enabled_refs ?? 0;
      const classification = totalRefs > 0
        ? "monitor_derived" as const
        : c.feedLane === "monitor_only"
          ? "unclassified" as const
          : "operator_owned" as const;
      return {
        ...c,
        classification,
        totalMonitorRefs: totalRefs,
        enabledMonitorRefs: enabledRefs,
        monitorIds: ref?.monitor_ids ?? [],
      };
    }),
  };
}

export async function reconcileLegacyMonitorSource(
  pool: Pool,
  actor: Actor,
  sourceId: string,
  body: { action: "pause_schedule" | "claim_monitor_managed"; revision: number },
) {
  if (!isStaffBrowser(actor)) fail(403, "Administrator browser session required");
  await transaction(pool, async (client) => {
    await lockMonitorLifecycle(client);
    await reconcileLegacySource(client, actor, sourceId, body.action, body.revision);
    if (body.action === "claim_monitor_managed") {
      await reconcileMonitorSources(client, [sourceId]);
    }
  });
  return { reconciled: true, sourceId, action: body.action };
}

async function isMonitorOwnerEntitled(
  client: PoolClient,
  ownerUserId: string | null,
  intervalHours: number,
  provider: string,
): Promise<{ ok: boolean; viewerPolicy?: Awaited<ReturnType<typeof loadEffectivePolicyForUser>> }> {
  if (!ownerUserId) return { ok: true };
  const user = await getUserRoleStatus(client, ownerUserId);
  if (!user || user.status !== "active") return { ok: false };
  if (user.role !== "viewer") return { ok: true };
  const policy = await loadEffectivePolicyForUser(client, ownerUserId, true);
  if (
    !policy.allowAutoSchedule ||
    policy.maxScheduledTasks <= 0 ||
    policy.allowedSourceIds !== null ||
    intervalHours < policy.minScheduleIntervalHours ||
    !policy.allowedProviders.includes(provider)
  ) {
    return { ok: false };
  }
  return { ok: true, viewerPolicy: policy };
}

export async function authorizeScheduledSourceDispatch(
  client: PoolClient,
  info: { sourceId: string; provider: string; resources: number },
): Promise<{ admitted: boolean; deferReason?: string; deferUntilIso?: string }> {
  const { rows: monitors } = await client.query<{
    id: string;
    owner_user_id: string | null;
    schedule_interval_hours: number;
    daily_item_budget: number;
    next_due_at: Date | null;
  }>(
    `SELECT m.id, m.owner_user_id, m.schedule_interval_hours, m.daily_item_budget, m.next_due_at
     FROM intel_monitor_source ms
     JOIN intel_monitor m ON m.id=ms.monitor_id
     WHERE ms.collection_source_id=$1 AND m.enabled=TRUE
     ORDER BY m.id FOR UPDATE OF m`,
    [info.sourceId],
  );
  if (!monitors.length) return { admitted: true };

  const pausedIds: string[] = [];
  const deferredIds: string[] = [];
  const duePaying: Array<{ id: string; ownerUserId: string | null; viewerPolicy?: Awaited<ReturnType<typeof loadEffectivePolicyForUser>> }> = [];

  for (const m of monitors) {
    const ent = await isMonitorOwnerEntitled(client, m.owner_user_id, m.schedule_interval_hours, info.provider);
    if (!ent.ok) {
      pausedIds.push(m.id);
      continue;
    }
    const isDue = !m.next_due_at || m.next_due_at.getTime() <= Date.now();
    if (!isDue) continue;
    const used = await readMonitorResourcesUsedToday(client, m.id);
    if (used + info.resources > m.daily_item_budget) {
      deferredIds.push(m.id);
      continue;
    }
    if (ent.viewerPolicy && m.owner_user_id) {
      const okQuota = await checkAndDebitViewerQuota(client, m.owner_user_id, info.provider, info.resources, ent.viewerPolicy);
      if (!okQuota) {
        deferredIds.push(m.id);
        continue;
      }
    }
    duePaying.push({ id: m.id, ownerUserId: m.owner_user_id, viewerPolicy: ent.viewerPolicy });
  }

  if (pausedIds.length > 0) {
    await client.query(
      `UPDATE intel_monitor SET enabled=FALSE, paused_reason='policy_revoked', revision=revision+1, updated_at=NOW()
       WHERE id=ANY($1::uuid[])`,
      [pausedIds],
    );
    await reconcileMonitorSources(client, [info.sourceId]);
  }

  if (duePaying.length > 0) {
    for (const m of duePaying) {
      await recordMonitorUsage(client, m.id, 1, info.resources);
      await client.query(
        `UPDATE intel_monitor SET last_dispatched_at=NOW(),
           next_due_at=NOW() + make_interval(hours => schedule_interval_hours)
         WHERE id=$1`,
        [m.id],
      );
    }
    return { admitted: true };
  }

  if (pausedIds.length === monitors.length) {
    return { admitted: false, deferReason: "Monitor auto-schedule entitlement revoked before dispatch" };
  }
  if (deferredIds.length > 0) {
    const { rows: [utcTomorrow] } = await client.query<{ iso: string }>(
      "SELECT ((date_trunc('day', now() AT TIME ZONE 'UTC') + interval '1 day') AT TIME ZONE 'UTC')::text AS iso",
    );
    return {
      admitted: false,
      deferReason: "Monitor daily budget or viewer quota reached; waiting for UTC day reset",
      deferUntilIso: new Date(utcTomorrow.iso).toISOString(),
    };
  }
  return { admitted: false, deferReason: "No monitor is currently due for this source" };
}
