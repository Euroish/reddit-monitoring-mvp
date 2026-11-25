import type { Pool } from "pg";
import type { Actor } from "../../../packages/contracts/src/access";
import { fail } from "../../shared/errors";
import { transaction } from "../../storage/db";
import { cancelUnstartedMonitorHydrations, getGlobalSocialBudget, socialResourcesReservedToday } from "../collection/index";
import { reconcileMonitorSources } from "./provisioning";
import { refreshMonitorRollups } from "./rollups";

export async function getIntelligenceOpsSummary(pool: Pool) {
  const [monitorsRes, rollupRes, hydrateRes, globalBudget, socialUsedToday] = await Promise.all([
    pool.query<{
      id: string;
      name: string;
      kind: string;
      owner_user_id: string;
      owner_email: string | null;
      owner_role: string | null;
      project_id: string | null;
      enabled: boolean;
      paused_reason: string | null;
      schedule_interval_hours: number;
      daily_item_budget: number;
      last_dispatched_at: Date | null;
      next_due_at: Date | null;
      revision: number;
      requests_today: number;
      resources_today: number;
      source_count: number;
    }>(
      `SELECT m.id, m.name, m.kind, m.owner_user_id,
              u.email AS owner_email, u.role AS owner_role,
              m.project_id, m.enabled, m.paused_reason,
              m.schedule_interval_hours, m.daily_item_budget,
              m.last_dispatched_at, m.next_due_at, m.revision,
              COALESCE(mu.requests, 0)::int AS requests_today,
              COALESCE(mu.resources_reserved, 0)::int AS resources_today,
              (SELECT COUNT(*)::int FROM intel_monitor_source ms WHERE ms.monitor_id = m.id) AS source_count
       FROM intel_monitor m
       LEFT JOIN app_user u ON u.id = m.owner_user_id
       LEFT JOIN intel_monitor_usage mu ON mu.monitor_id = m.id AND mu.day = (NOW() AT TIME ZONE 'UTC')::date
       ORDER BY m.enabled DESC, m.updated_at DESC, m.id`,
    ),
    pool.query<{
      total_buckets: number;
      buckets_6h: number;
      buckets_1d: number;
      distinct_monitors: number;
      latest_updated_at: Date | null;
    }>(
      `SELECT COUNT(*)::int AS total_buckets,
              COUNT(*) FILTER (WHERE bucket_size = '6h')::int AS buckets_6h,
              COUNT(*) FILTER (WHERE bucket_size = '1d')::int AS buckets_1d,
              COUNT(DISTINCT scope_id) FILTER (WHERE scope_kind = 'monitor')::int AS distinct_monitors,
              MAX(updated_at) AS latest_updated_at
       FROM intel_rollup_bucket`,
    ),
    pool.query<{
      queued_or_running: number;
      succeeded_today: number;
      failed_today: number;
      scheduled_today: number;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE purpose = 'hydrate' AND status IN ('queued', 'running', 'retrying'))::int AS queued_or_running,
         COUNT(*) FILTER (WHERE purpose = 'hydrate' AND status = 'succeeded' AND created_at >= (NOW() AT TIME ZONE 'UTC')::date)::int AS succeeded_today,
         COUNT(*) FILTER (WHERE purpose = 'hydrate' AND status IN ('failed', 'cancelled') AND created_at >= (NOW() AT TIME ZONE 'UTC')::date)::int AS failed_today,
         COUNT(*) FILTER (WHERE purpose = 'scheduled' AND created_at >= (NOW() AT TIME ZONE 'UTC')::date)::int AS scheduled_today
       FROM source_collection_job`,
    ),
    getGlobalSocialBudget(pool),
    socialResourcesReservedToday(pool),
  ]);

  const rollup = rollupRes.rows[0];
  const hydrate = hydrateRes.rows[0];
  return {
    monitors: monitorsRes.rows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      ownerUserId: r.owner_user_id,
      ownerEmail: r.owner_email,
      ownerRole: r.owner_role,
      projectId: r.project_id,
      enabled: Boolean(r.enabled),
      pausedReason: r.paused_reason,
      scheduleIntervalHours: Number(r.schedule_interval_hours),
      dailyItemBudget: Number(r.daily_item_budget),
      lastDispatchedAt: r.last_dispatched_at?.toISOString() ?? null,
      nextDueAt: r.next_due_at?.toISOString() ?? null,
      revision: Number(r.revision),
      requestsToday: Number(r.requests_today),
      resourcesToday: Number(r.resources_today),
      sourceCount: Number(r.source_count),
    })),
    rollups: {
      totalBuckets: Number(rollup?.total_buckets ?? 0),
      buckets6h: Number(rollup?.buckets_6h ?? 0),
      buckets1d: Number(rollup?.buckets_1d ?? 0),
      distinctMonitors: Number(rollup?.distinct_monitors ?? 0),
      latestUpdatedAt: rollup?.latest_updated_at?.toISOString() ?? null,
    },
    automation: {
      dailySocialItemCeiling: globalBudget.dailySocialItemCeiling,
      autoHydrationEnabled: globalBudget.autoHydrationEnabled,
      socialResourcesReservedToday: socialUsedToday,
      hydrateQueuedOrRunning: Number(hydrate?.queued_or_running ?? 0),
      hydrateSucceededToday: Number(hydrate?.succeeded_today ?? 0),
      hydrateFailedToday: Number(hydrate?.failed_today ?? 0),
      scheduledJobsToday: Number(hydrate?.scheduled_today ?? 0),
    },
  };
}

export async function reconcileAdminMonitor(
  pool: Pool,
  actor: Actor,
  monitorId: string,
  body: { action: "pause" | "resume" | "refresh_rollups"; revision: number },
) {
  if (actor.clientKind !== "browser" || actor.role === "viewer") {
    fail(403, "Administrator browser session required");
  }
  if (body.action === "refresh_rollups") {
    const exists = await pool.query<{ revision: number }>(
      "SELECT revision FROM intel_monitor WHERE id=$1",
      [monitorId],
    );
    if (!exists.rows[0]) fail(404, "Monitor not found");
    const updatedBuckets = await refreshMonitorRollups(pool, monitorId, 30);
    return { updated: true, action: body.action, revision: Number(exists.rows[0].revision), updatedBuckets };
  }
  const enable = body.action === "resume";
  return transaction(pool, async (client) => {
    const res = await client.query<{ id: string; revision: number }>(
      `SELECT id, revision FROM intel_monitor WHERE id=$1 FOR UPDATE`,
      [monitorId],
    );
    const cur = res.rows[0];
    if (!cur) fail(404, "Monitor not found");
    if (Number(cur.revision) !== body.revision) fail(409, "Monitor changed; reload before reconciling");
    const updated = await client.query<{ revision: number }>(
      `UPDATE intel_monitor
       SET enabled=$2, paused_reason=$3, revision=revision+1, updated_at=NOW()
       WHERE id=$1
       RETURNING revision`,
      [monitorId, enable, enable ? null : "admin_paused"],
    );
    const sources = (
      await client.query<{ collection_source_id: string }>(
        "SELECT collection_source_id FROM intel_monitor_source WHERE monitor_id=$1",
        [monitorId],
      )
    ).rows.map((r) => r.collection_source_id);
    if (sources.length) {
      await reconcileMonitorSources(client, sources);
    }
    if (!enable) {
      await cancelUnstartedMonitorHydrations(client, monitorId);
    }
    return {
      updated: true,
      action: body.action,
      revision: Number(updated.rows[0].revision),
      updatedBuckets: 0,
    };
  });
}
