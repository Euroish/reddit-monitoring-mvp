import type { PostgresClient } from "../storage/postgres/postgres-client";

export interface SourceRetentionPolicy {
  jobDays: number; observationDays: number; heartbeatDays: number; usageDays: number; auditDays: number;
}
export function validateSourceRetentionPolicy(value: unknown): SourceRetentionPolicy {
  if (!value || typeof value !== "object") throw new Error("Provide an explicit retention preview policy");
  const policy = value as SourceRetentionPolicy;
  for (const key of ["jobDays", "observationDays", "heartbeatDays", "usageDays", "auditDays"] as const)
    if (!Number.isInteger(policy[key]) || policy[key] < 1 || policy[key] > 3650) throw new Error(`Invalid ${key}; expected integer days 1–3650`);
  return { jobDays: policy.jobDays, observationDays: policy.observationDays, heartbeatDays: policy.heartbeatDays,
    usageDays: policy.usageDays, auditDays: policy.auditDays };
}

export function capacityProjection(density: { allocatedContentBytes: number; contentRows: number; allocatedObservationBytes: number; observationRows: number },
  traffic: { dailyContent: number; dailyObservations: number; days: number }) {
  for (const [key, value] of Object.entries(traffic))
    if (!Number.isSafeInteger(value) || value < (key === "days" ? 1 : 0) || value > (key === "days" ? 3650 : 10000000)) throw new Error(`Invalid ${key} capacity input`);
  const estimatedContentBytes = density.contentRows > 0
    ? Math.ceil(density.allocatedContentBytes / density.contentRows * traffic.dailyContent * traffic.days) : null;
  const estimatedObservationBytes = density.observationRows > 0
    ? Math.ceil(density.allocatedObservationBytes / density.observationRows * traffic.dailyObservations * traffic.days) : null;
  return { estimatedContentBytes, estimatedObservationBytes,
    estimatedTotalBytes: estimatedContentBytes === null || estimatedObservationBytes === null ? null : estimatedContentBytes + estimatedObservationBytes,
    method: "allocated_relation_bytes_per_stored_row", excludes: ["WAL", "backup", "free-space reuse", "future schema growth"] };
}

interface TablePlan { rows: number; allocatedBytes: number; candidates: number; protection: string }
const number = (value: unknown) => {
  const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("Unsafe storage count"); return parsed;
};

/** Read-only preview. No deletion command or automatic policy is installed. */
export async function sourceStoragePlan(db: PostgresClient, rawPolicy: SourceRetentionPolicy, now = new Date().toISOString()) {
  const policy = validateSourceRetentionPolicy(rawPolicy), timestamp = Date.parse(now);
  if (!Number.isFinite(timestamp)) throw new Error("Invalid retention clock");
  const cutoff = (days: number) => new Date(timestamp - days * 86400000).toISOString();
  return db.withTransaction(async client => {
    await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout='30s'");
    const relations = await client.query("SELECT tablename,pg_total_relation_size(format('public.%I',tablename)::regclass)::text AS bytes FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
    const tables: Record<string, TablePlan> = {};
    for (const row of relations.rows) {
      const name = String(row.tablename), quoted = '"' + name.replaceAll('"', '""') + '"';
      const total = await client.query(`SELECT count(*)::text AS count FROM public.${quoted}`);
      tables[name] = { rows: number(total.rows[0].count), allocatedBytes: number(row.bytes), candidates: 0,
        protection: "kept; no approved deletion policy in this preview" };
    }
    const candidate = async (name: string, sql: string, params: unknown[], protection: string) => {
      if (!tables[name]) return;
      const result = await client.query(sql, params); tables[name].candidates = number(result.rows[0].count); tables[name].protection = protection;
    };
    await candidate("source_collection_job", `SELECT count(*)::text AS count FROM source_collection_job j
      WHERE j.status IN ('succeeded','failed','cancelled') AND COALESCE(j.finished_at,j.created_at)<$1::timestamptz
      AND NOT (j.checkpoint IS NOT NULL AND NOT j.exhausted)
      AND NOT EXISTS(SELECT 1 FROM source_collection_job child WHERE child.parent_job_id=j.id)`, [cutoff(policy.jobDays)],
      "keep active/retry jobs, resumable checkpoints and every referenced parent");
    await candidate("content_observation", `WITH ranked AS (SELECT fetched_at,time_basis,row_number() OVER
      (PARTITION BY content_id,collection_source_id ORDER BY source_observed_at DESC NULLS LAST,fetched_at DESC,id DESC) AS position
      FROM content_observation) SELECT count(*)::text AS count FROM ranked WHERE position>1 AND time_basis<>'archive_initial' AND fetched_at<$1::timestamptz`,
      [cutoff(policy.observationDays)], "keep per-source latest evidence and archive_initial maturity evidence; analysis history policy still requires approval");
    await candidate("source_provider_usage", `SELECT count(*)::text AS count FROM source_provider_usage
      WHERE day<$1::timestamptz::date AND day<date_trunc('month',$2::timestamptz AT TIME ZONE 'UTC')::date`,
      [cutoff(policy.usageDays), now], "keep current UTC month and future reservations for quota accounting");
    await candidate("source_worker_heartbeat", `SELECT count(*)::text AS count FROM source_worker_heartbeat h
      WHERE last_heartbeat_at<$1::timestamptz AND NOT EXISTS(SELECT 1 FROM source_collection_job j WHERE j.id=h.last_job_id
      AND (j.status IN ('queued','running','retrying') OR (j.checkpoint IS NOT NULL AND NOT j.exhausted)))`,
      [cutoff(policy.heartbeatDays)], "keep fresh workers and workers associated with active/resumable jobs");
    if (tables.app_audit_log) {
      const hasOutcome = await client.query("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_audit_log' AND column_name='outcome'");
      await candidate("app_audit_log", `SELECT count(*)::text AS count FROM app_audit_log WHERE created_at<$1::timestamptz${hasOutcome.rowCount ? " AND outcome<>'attempted'" : ""}`,
        [cutoff(policy.auditDays)], "keep unresolved attempted audit intents; no automatic audit deletion");
    }
    const allocatedBytes = Object.values(tables).reduce((sum, table) => sum + table.allocatedBytes, 0);
    return { version: 1, mode: "dry-run", generatedAt: now, deletionExecuted: false, policyStatus: "operator_preview_not_approved_retention_policy",
      policy, tables, allocatedBytes, warning: "Candidate rows are a preview, not permission to delete. Removing rows does not immediately release files or erase backups." };
  });
}
