import type { AppUser } from "../../../src/domain/entities/app-user";
import type { AppUserRepository } from "../../../src/domain/repositories/app-user-repository";
import type { AppSessionRepository } from "../../../src/domain/repositories/app-session-repository";
import type { AppAuditRepository, AppAuditQuery } from "../../../src/domain/repositories/app-audit-repository";
import { AccountSecurityService, AccountSecurityError } from "../../../src/application/services/account-security.service";
import { auditQuery } from "../../../src/storage/app-audit";
import type { ApiActor } from "./auth-guard";
import { buildClearSessionCookie } from "./auth-cookie";
import type { AuthPasswordChangeResponse, AuthSessionsResponse, AuthSessionRevokeResponse, ListAppAuditResponse, UpdateAppUserRoleResponse, UpdateAppUserStatusResponse } from "../../../packages/contracts/src/http";

export function matchAuthAccountRoute(method: string, pathname: string): boolean {
  return (method === "POST" && (pathname === "/auth/password" || pathname === "/auth/sessions/revoke-all" || /^\/auth\/users\/[^/]+\/(role|status|activate)$/.test(pathname))) ||
    (method === "GET" && (pathname === "/auth/sessions" || pathname === "/v1/ops/audit")) ||
    (method === "DELETE" && /^\/auth\/sessions\/[^/]+$/.test(pathname));
}

export function isPersonalAccountPath(pathname: string): boolean {
  return pathname === "/auth/password" || pathname === "/auth/sessions" || pathname.startsWith("/auth/sessions/");
}

export async function handleAuthAccountRoute(input: {
  method: string; url: URL; requestId: string; actor: ApiActor | null; currentSessionId?: string;
  body?: unknown; now: () => string; cookieName: string; cookieSecure: boolean;
  appUserRepository?: AppUserRepository; appSessionRepository?: AppSessionRepository; appAuditRepository?: AppAuditRepository;
}): Promise<{ statusCode: number; body: unknown; headers?: Record<string, string>; errorCode?: string }> {
  const { actor, requestId, url } = input;
  const fail = (statusCode: number, errorCode: string, message: string) => ({ statusCode, errorCode, body: { ok: false, requestId, error: { code: errorCode, message }, errorCode } });
  const userView = (user: AppUser) => ({ id: user.id, email: user.email, displayName: user.displayName, role: user.role, status: user.status });
  if (url.pathname === "/v1/ops/audit") {
    if (actor?.type !== "session" || (actor.role !== "owner" && actor.role !== "admin")) return fail(403, "forbidden", "Audit access requires an owner or admin session");
    if (!input.appAuditRepository) return fail(503, "audit_unavailable", "Audit storage is unavailable");
    try {
      const query: AppAuditQuery = { limit: url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined, cursor: url.searchParams.get("cursor"), actorId: url.searchParams.get("actorId") ?? undefined, action: url.searchParams.get("action") ?? undefined, outcome: (url.searchParams.get("outcome") ?? undefined) as AppAuditQuery["outcome"] };
      auditQuery(query);
      const page = await input.appAuditRepository.list(query);
      const body: ListAppAuditResponse = { ok: true, requestId, entries: page.items, nextCursor: page.nextCursor };
      return { statusCode: 200, body };
    } catch (error) {
      if (error instanceof Error && /^(Audit limit|Invalid audit)/.test(error.message)) return fail(400, "invalid_query_param", error.message);
      return fail(503, "audit_unavailable", "Audit storage is unavailable");
    }
  }
  if (isPersonalAccountPath(url.pathname) && actor?.type !== "session") return fail(401, "unauthorized", "A user session is required");
  if (!actor) return fail(401, "unauthorized", "Authentication is required");
  if (!input.appUserRepository || !input.appSessionRepository) return fail(503, "auth_unavailable", "Auth storage is unavailable");
  const service = new AccountSecurityService({ appUserRepository: input.appUserRepository, appSessionRepository: input.appSessionRepository }, undefined, input.now);
  const body = input.body && typeof input.body === "object" && !Array.isArray(input.body) ? input.body as Record<string, unknown> : {};
  const clearCookie = { "Set-Cookie": buildClearSessionCookie({ name: input.cookieName, secure: input.cookieSecure }) };
  try {
    if (actor.type === "session" && url.pathname === "/auth/password") {
      await service.changePassword(actor.userId, { currentPassword: body.currentPassword as string, newPassword: body.newPassword as string });
      const payload: AuthPasswordChangeResponse = { ok: true, requestId, reauthenticate: true };
      return { statusCode: 200, body: payload, headers: clearCookie };
    }
    if (actor.type === "session" && input.method === "GET" && url.pathname === "/auth/sessions") {
      const payload: AuthSessionsResponse = { ok: true, requestId, sessions: await service.listSessions(actor.userId, input.currentSessionId) };
      return { statusCode: 200, body: payload };
    }
    if (actor.type === "session" && url.pathname === "/auth/sessions/revoke-all") {
      await service.revokeAllSessions(actor.userId);
      const payload: AuthSessionRevokeResponse = { ok: true, requestId, currentSessionRevoked: true };
      return { statusCode: 200, body: payload, headers: clearCookie };
    }
    if (actor.type === "session" && input.method === "DELETE") {
      const id = decodeURIComponent(url.pathname.slice("/auth/sessions/".length));
      if (!await service.revokeSession(actor.userId, id)) return fail(404, "session_not_found", "Session not found");
      const currentSessionRevoked = id === input.currentSessionId;
      const payload: AuthSessionRevokeResponse = { ok: true, requestId, currentSessionRevoked };
      return { statusCode: 200, body: payload, headers: currentSessionRevoked ? clearCookie : undefined };
    }
    const match = /^\/auth\/users\/([^/]+)\/(role|status|activate)$/.exec(url.pathname);
    if (match) {
      const userId = decodeURIComponent(match[1]);
      const accessActor = actor.type === "machine" ? { role: "machine" as const } : { userId: actor.userId, role: actor.role };
      const user = match[2] === "role" ? await service.changeRole(accessActor, userId, body.role as AppUser["role"]) : await service.changeStatus(accessActor, userId, match[2] === "activate" ? "active" : body.status as AppUser["status"]);
      const payload: UpdateAppUserRoleResponse | UpdateAppUserStatusResponse = { ok: true, requestId, user: userView(user) };
      return { statusCode: 200, body: payload };
    }
    return fail(404, "route_not_found", "Route not found");
  } catch (error) {
    if (error instanceof AccountSecurityError) return fail(error.status, error.code, error.message);
    if (error instanceof URIError) return fail(400, "invalid_request", "Invalid user or session ID");
    throw error;
  }
}
