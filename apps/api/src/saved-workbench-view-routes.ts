import { randomUUID } from "node:crypto";
import type {
  CreateSavedWorkbenchViewRequest, CreateSavedWorkbenchViewResponse,
  ListSavedWorkbenchViewsResponse, SavedWorkbenchViewResponseItem,
} from "../../../packages/contracts/src/http";
import type { SavedWorkbenchViewRepository } from "../../../src/domain/repositories/saved-workbench-view-repository";
import type { ApiActor } from "./auth-guard";
import { BadRequestError, normalizeSubredditName, parseOptionalIntegerParam, parseComparisonSeriesList } from "./api-validation";
import { isAllowedSavedViewRoute } from "./saved-view-route";

const routes = [
  { method: "GET", path: "/v1/workbench/saved-views", action: "list", write: false, personal: true },
  { method: "POST", path: "/v1/workbench/saved-views", action: "create", write: true, personal: true },
] as const;

export function matchSavedWorkbenchViewRoute(method: string, path: string) {
  return routes.find(route => route.method === method && route.path === path);
}

function normalizeCanonicalSubreddit(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestError(`${fieldName} is required`, "invalid_query_param");
  }
  return `r/${normalizeSubredditName(value.trim().replace(/^r\//i, ""))}`;
}

function parseSavedWorkbenchViewName(value: unknown): string {
  if (typeof value !== "string") {
    throw new BadRequestError("name is required", "invalid_request_body");
  }
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80) {
    throw new BadRequestError("name must be between 2 and 80 characters", "invalid_request_body");
  }
  return name;
}

function parseStringArray(value: unknown, fieldName: string, maxItems: number): string[] {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new BadRequestError(`${fieldName} must be an array`, "invalid_request_body");
  }
  const items = Array.from(
    new Set(
      value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => item.length > 0),
    ),
  );
  if (items.length > maxItems) {
    throw new BadRequestError(`${fieldName} supports at most ${maxItems} items`, "invalid_request_body");
  }
  return items;
}

function toSavedWorkbenchViewResponseItem(
  view: Awaited<ReturnType<SavedWorkbenchViewRepository["upsert"]>>,
): SavedWorkbenchViewResponseItem {
  return {
    id: view.id,
    name: view.name,
    viewKind: view.viewKind,
    primaryTarget: view.primaryTarget,
    compareTargets: view.compareTargets,
    keywords: view.keywords,
    seriesIds: view.seriesIds,
    routePath: view.routePath,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
  };
}

/** The composition root resolves the actor once and retains body limits, Origin checks and audit. */
export async function handleSavedWorkbenchViewRoute(input: {
  method: string;
  url: URL;
  requestId: string;
  actor: ApiActor | null;
  repository?: SavedWorkbenchViewRepository;
  now: () => string;
  readBody: () => Promise<unknown>;
}) {
  const { requestId, actor, repository } = input;
  const fail = (statusCode: number, error: string, errorCode: string) => ({
    statusCode, body: { ok: false, requestId, error, errorCode }, errorCode,
  });
  // Keep the existing missing-storage / personal-session checks ahead of method dispatch and body parsing.
  if (!repository) return fail(501, "saved workbench views are not configured", "feature_not_ready");
  if (!actor || actor.type !== "session") return fail(401, "unauthorized", "unauthorized");
  const route = matchSavedWorkbenchViewRoute(input.method, input.url.pathname);
  if (!route) return null;

  if (route.action === "list") {
    const limit = parseOptionalIntegerParam({
      value: input.url.searchParams.get("limit"), name: "limit", min: 1, max: 50,
    }) ?? 12;
    const views = await repository.listByUser({ userId: actor.userId, limit });
    const body: ListSavedWorkbenchViewsResponse = {
      ok: true, requestId, views: views.map(toSavedWorkbenchViewResponseItem),
    };
    return { statusCode: 200, body };
  }

  const body = await input.readBody() as CreateSavedWorkbenchViewRequest | null;
  if (!body) throw new BadRequestError("request body is required", "invalid_request_body");
  if (body.viewKind !== "target" && body.viewKind !== "comparison") {
    throw new BadRequestError("invalid viewKind", "invalid_request_body");
  }
  const compareTargets = parseStringArray(body.compareTargets, "compareTargets", 6)
    .map(target => normalizeCanonicalSubreddit(target, "compareTargets"));
  const keywords = parseStringArray(body.keywords, "keywords", 12).map(keyword => keyword.toLowerCase());
  const seriesIds = parseComparisonSeriesList(Array.isArray(body.seriesIds) ? body.seriesIds.join(",") : null);
  const routePath = typeof body.routePath === "string" ? body.routePath.trim() : "";
  if (!isAllowedSavedViewRoute(routePath, body.viewKind)) {
    throw new BadRequestError("invalid routePath", "invalid_request_body");
  }
  const nowIso = input.now();
  const view = await repository.upsert({
    id: randomUUID(), userId: actor.userId,
    name: parseSavedWorkbenchViewName(body.name),
    viewKind: body.viewKind,
    primaryTarget: normalizeCanonicalSubreddit(body.primaryTarget, "primaryTarget"),
    compareTargets, keywords, seriesIds, routePath, createdAt: nowIso, updatedAt: nowIso,
  });
  const result: CreateSavedWorkbenchViewResponse = {
    ok: true, requestId, view: toSavedWorkbenchViewResponseItem(view),
  };
  return { statusCode: 201, body: result };
}
