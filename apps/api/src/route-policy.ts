import { accountPublicPosts, isPrivilegedWrite, mfaLoginPath } from "../../../src/modules/access/index";
import type { DeclarativeRouteAuth, RouteAccessLevel, Scope } from "../../../src/platform/route-auth";

export type { DeclarativeRouteAuth, RouteAccessLevel, Scope };

export const DOC_READ_ROUTES = [
  "/v1/docs",
  "/v1/docs/:slug",
  "/v1/docs/:slug/file",
];

export const PUBLIC_READ_ROUTES = new Set([
  "/v1/public/sources",
  "/v1/content/stories",
  "/v1/content",
  "/v1/content/feed",
  "/v1/content/facets",
  "/v1/content/:id",
  "/v1/content/:id/thread",
  "/v1/feed/stream",
  "/v1/feed/hot",
  ...DOC_READ_ROUTES,
  "/v1/ai/vendors",
  "/v1/ai/models",
  "/v1/ai/models/:id",
  "/v1/ai/events",
  "/v1/ai/events/:id",
  "/v1/ai/updates",
  "/v1/ai/rankings",
  "/v1/ai/rankings/:id",
]);

const VIEWER_ALLOWED_POSTS = new Set([
  "/v1/auth/logout-all",
  "/v1/auth/email/verify/start",
  "/v1/auth/password/change",
  "/v1/auth/mfa/step-up",
  "/v1/auth/mfa/recovery-codes",
  "/v1/sources/:id/collect",
  "/v1/sources/:id/refresh",
  "/v1/research/collection-plans/preview",
  "/v1/research/collection-plans/collect",
  "/v1/projects",
  "/v1/projects/:id/fork",
  "/v1/projects/:id/hydrate",
  "/v1/projects/:id/batches",
  "/v1/projects/:id/batches/:batchId/move",
  "/v1/intelligence/monitors",
  "/v1/source-jobs/:id/cancel",
  "/v1/source-jobs/:id/retry",
  "/v1/source-jobs/:id/continue",
]);

const VIEWER_ALLOWED_PATCHES = new Set([
  "/v1/projects/:id",
  "/v1/projects/:id/batches/:batchId",
]);

const VIEWER_ALLOWED_DELETES = new Set([
  "/v1/auth/sessions/:id",
  "/v1/projects/:id",
  "/v1/batches/:id",
]);

export interface ResolvedRoutePolicy {
  publicRoute: boolean;
  publicReadRoute: boolean;
  credentialSubmission: boolean;
  browserOnlyAuthRoute: boolean;
  viewerAllowed: boolean;
  requiresRecentMfa: boolean;
  machineAllowed: boolean;
  machineScope: Scope | null;
  summaryClass: RouteAccessLevel;
}

export function resolveMachineScope(method: string, route: string): Scope | null {
  const isRead = method === "GET" || method === "HEAD";
  if (route === "/v1/content/export") return "export";
  if (route.endsWith("/ingest")) return "ingest";
  if (route.endsWith("/collect") || route.endsWith("/hydrate") || route === "/v1/sources/:id/refresh") {
    return "collect";
  }
  if (route.startsWith("/v1/source-jobs")) return isRead ? "read" : "collect";
  if (route.startsWith("/v1/batches")) return isRead ? "read" : null;
  if (route.endsWith("/unblock")) return "collect";
  if (route.startsWith("/v1/content") || DOC_READ_ROUTES.includes(route)) return isRead ? "read" : null;
  if (route === "/v1/public/sources") return isRead ? "read" : null;
  if (route.startsWith("/v1/sources")) return isRead ? "read" : "sources:write";
  if (route.startsWith("/v1/projects")) return isRead ? "read" : "projects:write";
  return null;
}

function isMachineBlockedPrefix(route: string): boolean {
  return (
    route.startsWith("/v1/auth/") ||
    route.startsWith("/v1/access/") ||
    route.startsWith("/v1/admin/") ||
    route.startsWith("/v1/workspace/") ||
    route.startsWith("/v1/sources/credentials") ||
    route.startsWith("/v1/quotas")
  );
}

function resolveDeclarativePolicy(
  isRead: boolean,
  route: string,
  publicRead: boolean,
  decl: DeclarativeRouteAuth,
): ResolvedRoutePolicy {
  const publicRoute = decl.access === "public";
  const publicReadRoute = publicRead && isRead && decl.access === "public_read";
  const viewerAllowed = decl.access !== "admin" && decl.access !== "admin_mfa";
  const machineBlocked = Boolean(decl.browserOnly) || isMachineBlockedPrefix(route);
  const machineScope = machineBlocked ? null : (decl.machineScope ?? null);
  return {
    publicRoute,
    publicReadRoute,
    credentialSubmission: Boolean(decl.credentialSubmission),
    browserOnlyAuthRoute: Boolean(decl.browserOnly),
    viewerAllowed,
    requiresRecentMfa: decl.access === "admin_mfa",
    machineAllowed: !machineBlocked && (Boolean(decl.machineOpen) || machineScope !== null),
    machineScope,
    summaryClass: decl.access,
  };
}

function classifySummary(
  publicRoute: boolean,
  isRead: boolean,
  route: string,
  requiresRecentMfa: boolean,
  viewerAllowed: boolean,
): RouteAccessLevel {
  if (publicRoute) return "public";
  if (isRead && PUBLIC_READ_ROUTES.has(route)) return "public_read";
  if (requiresRecentMfa) return "admin_mfa";
  if (!viewerAllowed) return "admin";
  return isRead ? "authenticated" : "viewer_write";
}

function isLegacyPublicRoute(upper: string, isRead: boolean, route: string, accountPublicPost: boolean) {
  if (accountPublicPost) return true;
  if (isRead && (route === "/healthz" || route === "/readyz" || route === "/v1/auth/session")) return true;
  return upper === "POST" && (route === "/v1/auth/login" || route === "/v1/auth/register" || route === "/v1/auth/logout");
}

function resolveLegacyPolicy(
  upper: string,
  isRead: boolean,
  route: string,
  options: { publicRead?: boolean; accountEmailEnabled?: boolean; mfaEnabled?: boolean },
): ResolvedRoutePolicy {
  const accountPublicPost =
    upper === "POST" &&
    ((Boolean(options.accountEmailEnabled) && accountPublicPosts.has(route)) ||
      (Boolean(options.mfaEnabled) && route === mfaLoginPath));
  const publicRoute = isLegacyPublicRoute(upper, isRead, route, accountPublicPost);
  const publicReadRoute = Boolean(options.publicRead) && isRead && PUBLIC_READ_ROUTES.has(route);
  const credentialSubmission =
    accountPublicPost || (upper === "POST" && (route === "/v1/auth/login" || route === "/v1/auth/register"));
  const viewerAllowedWrite =
    (upper === "DELETE" && VIEWER_ALLOWED_DELETES.has(route)) ||
    (upper === "PATCH" && VIEWER_ALLOWED_PATCHES.has(route)) ||
    (upper === "POST" && VIEWER_ALLOWED_POSTS.has(route));
  const viewerAllowed = publicRoute || isRead || route.startsWith("/v1/workspace/") || viewerAllowedWrite;
  const requiresRecentMfa = isPrivilegedWrite(upper, route);
  const machineBlocked = isMachineBlockedPrefix(route);
  const machineOpen = route === "/v1/capabilities" || route === "/v1/openapi.json";
  const machineScope = machineBlocked ? null : resolveMachineScope(upper, route);

  return {
    publicRoute,
    publicReadRoute,
    credentialSubmission,
    browserOnlyAuthRoute: route.startsWith("/v1/auth/"),
    viewerAllowed,
    requiresRecentMfa,
    machineAllowed: !machineBlocked && (machineOpen || machineScope !== null),
    machineScope,
    summaryClass: classifySummary(publicRoute, isRead, route, requiresRecentMfa, viewerAllowed),
  };
}

export function resolveRoutePolicy(
  method: string,
  route: string,
  options: {
    publicRead?: boolean;
    accountEmailEnabled?: boolean;
    mfaEnabled?: boolean;
    declarative?: DeclarativeRouteAuth;
  } = {},
): ResolvedRoutePolicy {
  const upper = method.toUpperCase();
  const isRead = upper === "GET" || upper === "HEAD";
  if (options.declarative) {
    return resolveDeclarativePolicy(isRead, route, Boolean(options.publicRead), options.declarative);
  }
  return resolveLegacyPolicy(upper, isRead, route, options);
}
