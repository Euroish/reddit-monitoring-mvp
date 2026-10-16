import type { CreateResearchExportRequest } from "../../../packages/contracts/src/research-export";
import type { ApiActor } from "./auth-guard";
import { ResearchExportService, researchExportCsv } from "../../../src/application/services/research-export.service";
import { ResearchExportError } from "../../../src/storage/research-export-query";
import { SourceContentError } from "../../../src/application/services/source-content.service";

const routes = [
  { method: "GET", path: /^\/v1\/research-exports$/, action: "list", write: false, personal: true },
  { method: "POST", path: /^\/v1\/research-exports$/, action: "create", write: true, personal: true },
  { method: "GET", path: /^\/v1\/research-exports\/([^/]+)$/, action: "get", write: false, personal: true },
  { method: "DELETE", path: /^\/v1\/research-exports\/([^/]+)$/, action: "delete", write: true, personal: true },
  { method: "GET", path: /^\/v1\/research-exports\/([^/]+)\/content$/, action: "content", write: false, personal: true },
  { method: "GET", path: /^\/v1\/research-exports\/([^/]+)\/export$/, action: "export", write: false, personal: true },
] as const;
export function matchResearchExportRoute(method: string, path: string) { return routes.find(route => route.method === method && route.path.test(path)); }
export async function handleResearchExportRoute(input: { method: string; url: URL; body?: unknown; actor: ApiActor | null; requestId: string; service?: ResearchExportService }): Promise<{ statusCode: number; body?: unknown; headers?: Record<string, string>; rawBody?: string }> {
  const { requestId, actor, service } = input, route = matchResearchExportRoute(input.method, input.url.pathname);
  const fail = (statusCode: number, errorCode: string, message: string) => ({ statusCode, body: { ok: false, requestId, error: { code: errorCode, message }, errorCode } });
  if (!route) return fail(404, "route_not_found", "Route not found");
  if (actor?.type !== "session") return fail(401, "unauthorized", "A user session is required for research exports");
  if (!service) return fail(503, "research_export_unavailable", "Research export storage is unavailable");
  try {
    const userId = actor.userId, id = decodeURIComponent(route.path.exec(input.url.pathname)?.[1] ?? ""), params = input.url.searchParams;
    const page = { limit: params.has("limit") ? Number(params.get("limit")) : undefined, cursor: params.get("cursor") ?? undefined };
    if (route.action === "list") return { statusCode: 200, body: { ok: true, requestId, ...await service.list(userId, page) } };
    if (route.action === "create") return { statusCode: 201, body: { ok: true, requestId, researchExport: await service.create(userId, input.body as CreateResearchExportRequest) } };
    if (route.action === "get") return { statusCode: 200, body: { ok: true, requestId, researchExport: await service.get(userId, id) } };
    if (route.action === "delete") return { statusCode: 200, body: { ok: true, requestId, ...await service.delete(userId, id) } };
    const format = route.action === "export" ? params.get("format") ?? "json" : "json";
    if (!["json", "csv"].includes(format)) throw new ResearchExportError("Export format must be json or csv");
    const result = await service.pageContent(userId, id, page);
    if (format === "json") return { statusCode: 200, headers: { "Cache-Control": "private, no-store" }, body: { ok: true, requestId, ...result } };
    return { statusCode: 200, headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="frozen-research-${id}.csv"`, "Cache-Control": "private, no-store", "X-Export-Total-Matching": String(result.total), "X-Export-Count": String(result.items.length), "X-Export-Next-Cursor": result.nextCursor ?? "", "X-Export-Scope": "frozen_members", "X-Request-Id": requestId }, rawBody: researchExportCsv(result) };
  } catch (error) {
    if (error instanceof ResearchExportError) return fail(error.status, error.code, error.message);
    if (error instanceof SourceContentError) return fail(error.status, error.status === 503 ? "research_export_unavailable" : "invalid_research_export_request", error.message);
    if (error instanceof URIError) return fail(400, "invalid_research_export_request", "Invalid research export ID");
    throw error;
  }
}
