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
  enqueueCollectionForSource,
  listLegacySources,
  listSourcesByIds,
  reconcileLegacySource,
} from "../collection/index";
import {
  estimateMonitorCollection,
  lockMonitorLifecycle,
  monitorSourceIds,
  provisionMonitorSources,
  reconcileMonitorSources,
} from "./provisioning";

export interface MonitorWithSources {
  monitor: IntelMonitorDto;
  sourceIds: string[];
  targets: Array<{ targetKind: string; targetValue: string; platform: string }>;
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
    return {
      id: r.id,
      kind: r.kind,
      name: r.name,
      config: r.config,
      scheduleIntervalHours: r.schedule_interval_hours,
      dailyItemBudget: r.daily_item_budget,
      enabled: Boolean(r.enabled),
      revision: r.revision,
      sourceCount: srcIds.length,
      targetCount: r.target_count ?? 0,
      lastSuccessAt: lastDates.length ? lastDates[lastDates.length - 1] : null,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    };
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
    monitor: {
      id: row.id,
      kind: row.kind,
      name: row.name,
      config: row.config,
      scheduleIntervalHours: row.schedule_interval_hours,
      dailyItemBudget: row.daily_item_budget,
      enabled: Boolean(row.enabled),
      revision: row.revision,
      sourceCount: sourceIds.length,
      targetCount: targets.length,
      lastSuccessAt: lastDates.length ? lastDates[lastDates.length - 1] : null,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    },
    sourceIds,
    targets,
  };
}

export async function createMonitor(
  pool: Pool,
  actor: Actor,
  providers: ContentProvider[],
  input: Static<typeof MonitorCreateBody>,
): Promise<IntelMonitorDto> {
  const id = randomUUID();
  const intervalHours = input.scheduleIntervalHours ?? 6;
  const dailyItemBudget = input.dailyItemBudget ?? 1000;
  const enabled = input.enabled ?? true;
  await transaction(pool, async (client) => {
    await lockMonitorLifecycle(client);
    await client.query(
      `INSERT INTO intel_monitor(id, owner_user_id, kind, name, config, schedule_interval_hours, daily_item_budget, enabled, created_at, updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())`,
      [id, actor.userId, input.kind, input.name.trim(), input.config, intervalHours, dailyItemBudget, enabled],
    );
    await reconcileMonitorSources(client, await provisionMonitorSources(client, providers, id, input.kind, input.config));
    if (actor.allowedSourceIds !== null) await selectMonitor(client, actor, id);
  });
  return (await loadMonitor(pool, actor, id)).monitor;
}

export async function updateMonitor(
  pool: Pool,
  actor: Actor,
  providers: ContentProvider[],
  id: string,
  patch: Static<typeof MonitorPatchBody>,
): Promise<IntelMonitorDto> {
  await transaction(pool, async (client) => {
    await lockMonitorLifecycle(client);
    const row = await selectMonitor(client, actor, id, true);
    if (row.revision !== patch.revision) fail(409, "Monitor changed; reload before saving");
    const scheduleChanged = patch.scheduleIntervalHours !== undefined && patch.scheduleIntervalHours !== row.schedule_interval_hours;
    const enabledChanged = patch.enabled !== undefined && patch.enabled !== row.enabled;
    if ((patch.config || scheduleChanged || (enabledChanged && patch.enabled)) && !isStaffBrowser(actor)) {
      fail(403, "An administrator browser session is required to configure or enable monitoring");
    }

    const nextName = patch.name?.trim() ?? row.name;
    const nextConfig = patch.config ?? row.config;
    const nextInterval = patch.scheduleIntervalHours ?? row.schedule_interval_hours;
    const nextBudget = patch.dailyItemBudget ?? row.daily_item_budget;
    const nextEnabled = patch.enabled ?? row.enabled;

    await client.query(
      `UPDATE intel_monitor
       SET name=$2, config=$3, schedule_interval_hours=$4, daily_item_budget=$5, enabled=$6, revision=revision+1, updated_at=NOW()
       WHERE id=$1`,
      [id, nextName, nextConfig, nextInterval, nextBudget, nextEnabled],
    );
    if (patch.config) {
      const affectedSourceIds = await provisionMonitorSources(client, providers, id, row.kind, nextConfig);
      if (actor.allowedSourceIds !== null) await selectMonitor(client, actor, id);
      await reconcileMonitorSources(client, affectedSourceIds);
    } else if (enabledChanged || scheduleChanged) {
      await reconcileMonitorSources(client, await monitorSourceIds(client, id));
    }
    if (!nextEnabled || patch.config || nextBudget < row.daily_item_budget) {
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

export async function estimateMonitorRun(
  pool: Pool,
  actor: Actor,
  id: string,
  body: Static<typeof MonitorCollectBody>,
) {
  const { monitor, sourceIds } = await loadMonitor(pool, actor, id);
  return estimateMonitorCollection(pool, {
    sourceCount: sourceIds.length,
    dailyItemBudget: monitor.dailyItemBudget,
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
  const { monitor, sourceIds } = await loadMonitor(pool, actor, id);
  if (!sourceIds.length) fail(422, "Monitor has no linked collection sources");
  const limit = body.limitPerSource ?? 50;
  const includeComments = Boolean(body.includeComments);
  const maxCommentsPerPost = body.maxCommentsPerPost ?? 15;
  const estimate = await estimateMonitorCollection(pool, {
    sourceCount: sourceIds.length,
    dailyItemBudget: monitor.dailyItemBudget,
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
    const rejectCreate = !current.enabled
      ? { statusCode: 409, message: "Monitor is disabled; enable it before collecting" }
      : undefined;
    const jobIds: string[] = [];
    let anyCreated = false;
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
      if (res.created) anyCreated = true;
    }
    // Replays must remain retrievable after quotas change. New jobs and their
    // personal reservations roll back together if the monitor budget rejects.
    if (anyCreated && estimate.exceedsMonitorBudget) {
      fail(422, `Estimated collection (${estimate.estimatedMaxItems}) exceeds monitor daily budget (${monitor.dailyItemBudget})`);
    }
    if (anyCreated && estimate.exceedsSystemCeiling) {
      fail(429, `Estimated collection would exceed ${estimate.systemDailyCeiling}/day system social ceiling`);
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
