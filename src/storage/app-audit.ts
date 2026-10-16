import type { AppAuditRecord } from "../domain/entities/app-audit";
import type { AppAuditQuery } from "../domain/repositories/app-audit-repository";

const keys = new Set([
  "before", "after", "label", "group", "state", "role", "status", "provider", "platform", "targetType", "contentKind",
  "schedule", "refresh", "enabled", "cadenceSeconds", "cadenceHours", "favorite", "initialLookbackHours", "overlapMinutes", "overlapSeconds", "maxCatchupHours", "recheckLookbackHours", "recheckCadenceSeconds",
  "maturityHours", "maxAgeDays", "maxAttempts", "intervalHours", "afterHours", "minIntervalHours", "batchSize", "pageSize", "maxPages",
  "defaultCadenceHours", "postLimitBase", "postLimitBoost", "adaptiveLimitEnabled", "backfillPostLimit", "backfillTargetDays", "backfillMaxIterationsPerTarget", "providerPreference",
  "dailyRequests", "monthlyRequests", "dailyResources", "monthlyResources", "minimumIntervalMs", "usedCount", "maxUses", "expiresAt",
  "from", "to", "purpose", "sourceId", "jobId", "userId", "inviteId", "count", "revoked", "current", "errorCode", "reason", "requestedRole", "requestedStatus",
]);
/** Fixed metadata allowlist. Request bodies, credentials, headers and content payloads never pass through. */
export function auditChanges(input: Record<string, unknown> = {}, depth = 0): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (!input || typeof input !== "object" || Array.isArray(input) || depth > 3) return result;
  for (const [key,value] of Object.entries(input).slice(0,64)) {
    if (!keys.has(key)) continue;
    if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) result[key] = value;
    else if (typeof value === "string") result[key] = value.replace(/[\u0000-\u001f\u007f]/g," ").slice(0,200);
    else if (value && typeof value === "object" && !Array.isArray(value)) result[key] = auditChanges(value as Record<string, unknown>,depth+1);
  }
  return result;
}
export function auditCursor(record: AppAuditRecord): string { return Buffer.from(JSON.stringify([record.createdAt,record.id])).toString("base64url"); }
export function auditQuery(query: AppAuditQuery = {}) {
  const limit = query.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Audit limit must be an integer between 1 and 100");
  let after: { createdAt: string; id: string } | null = null;
  if (query.cursor) {
    try {
      if (!/^[A-Za-z0-9_-]{1,512}$/.test(query.cursor)) throw new Error();
      const value = JSON.parse(Buffer.from(query.cursor,"base64url").toString("utf8"));
      if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== "string" || !Number.isFinite(Date.parse(value[0])) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value[1])) throw new Error();
      after = { createdAt: new Date(value[0]).toISOString(), id: value[1] };
    } catch { throw new Error("Invalid audit cursor"); }
  }
  if (query.actorId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query.actorId)) throw new Error("Invalid audit actor ID");
  if (query.action && !/^[a-z][a-z0-9_.:-]{0,79}$/.test(query.action)) throw new Error("Invalid audit action");
  if (query.outcome && !["attempted","succeeded","failed"].includes(query.outcome)) throw new Error("Invalid audit outcome");
  return { ...query, limit, after };
}
