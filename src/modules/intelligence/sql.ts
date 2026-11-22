import { randomUUID } from "node:crypto";
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
import {
  enqueueCollectionForSource,
  listSourcesByIds,
} from "../collection/index";
import {
  DAILY_SOCIAL_ITEM_CEILING,
  estimateMonitorCollection,
  provisionMonitorSources,
} from "./provisioning";

export interface MonitorWithSources {
  monitor: IntelMonitorDto;
  sourceIds: string[];
  targets: Array<{ targetKind: string; targetValue: string; platform: string }>;
}

function assertActorAllowed(actor: Actor, sourceIds: readonly string[]) {
  if (actor.allowedSourceIds === null) return;
  if (!sourceIds.every((id) => actor.allowedSourceIds!.includes(id))) {
    fail(404, "Monitor not found");
  }
}

export async function listMonitors(pool: Pool, actor: Actor, kind?: string): Promise<IntelMonitorDto[]> {
  const { rows } = await pool.query(
    `SELECT m.*,
       COALESCE(ARRAY(SELECT ms.collection_source_id FROM intel_monitor_source ms WHERE ms.monitor_id=m.id ORDER BY ms.collection_source_id), '{}') AS source_ids,
       (SELECT COUNT(*)::int FROM intel_monitor_target mt WHERE mt.monitor_id=m.id) AS target_count
     FROM intel_monitor m
     WHERE ($1::text IS NULL OR m.kind=$1)
     ORDER BY m.updated_at DESC, m.id DESC`,
    [kind ?? null],
  );
  const filtered = rows.filter((r) => {
    if (actor.allowedSourceIds === null) return true;
    return (r.source_ids as string[]).every((id) => actor.allowedSourceIds!.includes(id));
  });
  const allSrcIds = [...new Set(filtered.flatMap((r) => r.source_ids as string[]))];
  const sources = await listSourcesByIds(pool, allSrcIds);
  const srcMap = new Map(sources.map((s) => [s.id, s]));

  return filtered.map((r) => {
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
  const row = (await db.query("SELECT * FROM intel_monitor WHERE id=$1", [id])).rows[0];
  if (!row) fail(404, "Monitor not found");
  const [srcRes, tgtRes] = await Promise.all([
    db.query<{ collection_source_id: string }>(
      "SELECT collection_source_id FROM intel_monitor_source WHERE monitor_id=$1 ORDER BY collection_source_id",
      [id],
    ),
    db.query<{ target_kind: string; target_value: string; platform: string }>(
      "SELECT target_kind, target_value, platform FROM intel_monitor_target WHERE monitor_id=$1 ORDER BY target_kind, platform, target_value",
      [id],
    ),
  ]);
  const sourceIds = srcRes.rows.map((r) => r.collection_source_id);
  assertActorAllowed(actor, sourceIds);
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
      targetCount: tgtRes.rows.length,
      lastSuccessAt: lastDates.length ? lastDates[lastDates.length - 1] : null,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    },
    sourceIds,
    targets: tgtRes.rows.map((t) => ({ targetKind: t.target_kind, targetValue: t.target_value, platform: t.platform })),
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
    await client.query(
      `INSERT INTO intel_monitor(id, owner_user_id, kind, name, config, schedule_interval_hours, daily_item_budget, enabled, created_at, updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())`,
      [id, actor.userId, input.kind, input.name.trim(), input.config, intervalHours, dailyItemBudget, enabled],
    );
    await provisionMonitorSources(client, providers, id, input.kind, input.config, intervalHours);
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
    const row = (await client.query("SELECT * FROM intel_monitor WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (!row) fail(404, "Monitor not found");
    const existingSources = (
      await client.query<{ collection_source_id: string }>("SELECT collection_source_id FROM intel_monitor_source WHERE monitor_id=$1", [id])
    ).rows.map((r) => r.collection_source_id);
    assertActorAllowed(actor, existingSources);
    if (row.revision !== patch.revision) fail(409, "Monitor changed; reload before saving");

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
    if (patch.config || patch.scheduleIntervalHours !== undefined) {
      await provisionMonitorSources(client, providers, id, row.kind, nextConfig, nextInterval);
    }
  });
  return (await loadMonitor(pool, actor, id)).monitor;
}

export async function deleteMonitor(pool: Pool, actor: Actor, id: string, revision: number): Promise<{ deleted: true }> {
  return transaction(pool, async (client) => {
    const row = (await client.query("SELECT id, revision FROM intel_monitor WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (!row) fail(404, "Monitor not found");
    const srcs = (
      await client.query<{ collection_source_id: string }>("SELECT collection_source_id FROM intel_monitor_source WHERE monitor_id=$1", [id])
    ).rows.map((r) => r.collection_source_id);
    assertActorAllowed(actor, srcs);
    if (row.revision !== revision) fail(409, "Monitor changed; reload before deleting");
    await client.query("DELETE FROM intel_monitor WHERE id=$1", [id]);
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
  if (estimate.exceedsMonitorBudget) {
    fail(422, `Estimated collection (${estimate.estimatedMaxItems}) exceeds monitor daily budget (${monitor.dailyItemBudget})`);
  }
  if (estimate.exceedsSystemCeiling) {
    fail(429, `Estimated collection would exceed ${DAILY_SOCIAL_ITEM_CEILING}/day system social ceiling`);
  }

  const to = new Date();
  const from = new Date(to.getTime() - (body.lookbackHours ?? 168) * 3_600_000);
  const outcome = await transaction(pool, async (client) => {
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
      });
      jobIds.push(res.jobId);
      if (res.created) anyCreated = true;
    }
    return { jobIds, anyCreated };
  });
  if (outcome.anyCreated) await notifyChannel(pool, "collection_jobs_ready");
  return { monitorId: id, jobIds: outcome.jobIds, estimatedMaxItems: estimate.estimatedMaxItems };
}
