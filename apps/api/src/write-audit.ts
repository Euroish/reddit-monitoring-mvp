import type { BeginAppAudit } from "../../../src/domain/repositories/app-audit-repository";
import { auditChanges } from "../../../src/storage/app-audit";

export function writeAuditRoute(method: string, pathname: string): Pick<BeginAppAudit, "action" | "resourceType" | "resourceId"> | null {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return null;
  if (pathname === "/auth/password") return { action: "account.password.change", resourceType: "user" };
  if (pathname === "/auth/logout") return { action: "account.session.logout", resourceType: "session" };
  if (pathname === "/auth/sessions/revoke-all") return { action: "account.sessions.revoke_all", resourceType: "user" };
  const session = /^\/auth\/sessions\/([^/]+)$/.exec(pathname);
  if (session) return { action: "account.session.revoke", resourceType: "session", resourceId: session[1] };
  const user = /^\/auth\/users\/([^/]+)\/(role|status|activate)$/.exec(pathname);
  if (user) return { action: `account.user.${user[2]}`, resourceType: "user", resourceId: user[1] };
  if (pathname === "/auth/invites") return { action: "account.invite.create", resourceType: "invite" };
  if (pathname === "/v1/sources") return { action: "source.create", resourceType: "source" };
  const source = /^\/v1\/sources\/([^/]+)(?:\/(.*))?$/.exec(pathname);
  if (source) return { action: `source.${source[2] ? source[2].replaceAll("/", ".") : "update"}`, resourceType: "source", resourceId: source[1] };
  const job = /^\/v1\/source-jobs\/([^/]+)\/(cancel|retry|continue)$/.exec(pathname);
  if (job) return { action: `source.job.${job[2]}`, resourceType: "job", resourceId: job[1] };
  const budget = /^\/v1\/source-provider-budgets\/([^/]+)$/.exec(pathname);
  if (budget) return { action: "source.budget.update", resourceType: "provider", resourceId: budget[1] };
  if (pathname === "/v1/targets/subreddit") return { action: "target.create", resourceType: "target" };
  if (pathname === "/v1/targets/subreddit/bulk-update") return { action: "target.bulk_update", resourceType: "target" };
  if (pathname.startsWith("/v1/targets/subreddit/")) return { action: "target.update", resourceType: "target", resourceId: pathname.slice("/v1/targets/subreddit/".length) };
  if (["/v1/ops/collection/settings", "/v1/ops/collection/run-now", "/v1/ops/maintenance/prune/raw-events", "/v1/ops/maintenance/prune/metrics-snapshots", "/v1/ops/maintenance/prune/post-engagement-windows"].includes(pathname)) return { action: `ops.${pathname.slice(8).replaceAll("/", ".")}`, resourceType: "operations" };
  if (pathname === "/v1/runs/reddit-phase1") return { action: "collection.run", resourceType: "job" };
  if (pathname === "/v1/workbench/saved-views") return { action: "workbench.saved_view.create", resourceType: "saved_view" };
  if (pathname === "/v1/keyword-queries") return { action: "content.keyword_query.create", resourceType: "query" };
  return null;
}

/** Each operation chooses its metadata explicitly; credentials and arbitrary request fields never enter the audit. */
export function writeAuditMetadata(pathname: string, input: unknown, output: unknown): { resourceId?: string; changes: Record<string, unknown> } {
  const body = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const result = output && typeof output === "object" ? output as Record<string, unknown> : {};
  let allowed: string[] = [];
  if (pathname === "/auth/invites") allowed = ["roleOnAccept", "maxUses", "expiresAt"];
  else if (/^\/auth\/users\//.test(pathname)) allowed = ["role", "status"];
  else if (pathname.startsWith("/v1/sources")) allowed = ["platform", "provider", "contentKind", "kind", "label", "group", "state", "schedule", "refresh", "from", "to", "pageSize", "maxPages"];
  else if (pathname.includes("provider-budgets")) allowed = ["enabled", "dailyRequests", "monthlyRequests", "dailyResources", "monthlyResources", "minimumIntervalMs"];
  else if (pathname.startsWith("/v1/targets/")) allowed = ["status", "favorite", "cadenceHours"];
  else if (pathname === "/v1/ops/collection/settings") allowed = ["defaultCadenceHours", "postLimitBase", "postLimitBoost", "adaptiveLimitEnabled", "backfillPostLimit", "backfillTargetDays", "backfillMaxIterationsPerTarget", "providerPreference"];
  const selected: Record<string, unknown> = {};
  if (pathname.endsWith("/pause")) selected.state = "paused";
  if (pathname.endsWith("/resume")) selected.state = "active";
  if (pathname.endsWith("/archive")) selected.state = "archived";
  for (const key of allowed) if (body[key] !== undefined) selected[key === "roleOnAccept" ? "role" : key === "kind" ? "contentKind" : key] = body[key];
  if (pathname.endsWith("/bulk-update") && body.patch && typeof body.patch === "object") {
    const patch = body.patch as Record<string, unknown>;
    for (const key of allowed) if (patch[key] !== undefined) selected[key] = patch[key];
    selected.count = Array.isArray(body.canonicalNames) ? body.canonicalNames.length : 0;
  }
  if (typeof result.currentSessionRevoked === "boolean") selected.current = result.currentSessionRevoked;
  if (typeof result.errorCode === "string") selected.errorCode = result.errorCode;
  const resource = [result.source, result.job, result.invite, result.user, result.view].find(value => value && typeof value === "object") as Record<string, unknown> | undefined;
  const resourceId = typeof resource?.id === "string" ? resource.id : typeof result.targetId === "string" ? result.targetId : undefined;
  return { resourceId, changes: auditChanges({ after: selected }) };
}
