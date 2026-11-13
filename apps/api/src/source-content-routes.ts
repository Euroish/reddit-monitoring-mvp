import type { CreateCollectionSourceRequest, StartSourceCollectionRequest, UpdateCollectionSourceRequest, SourceCollectionJob, SourceProviderBudgetRequest } from "../../../packages/contracts/src/http";
import { SourceContentError } from "../../../src/domain/source-content-error";
import { sourceContentErrorStatus } from "./source-content-error";
import type { SourceContentService } from "../../../src/application/services/source-content.service";
import { matchContentReadRoute, handleContentReadRoute } from "./content-read-routes";

/** Route, method and write permission stay together. Authentication is applied once in the composition root. */
const routes = [
  { method: "GET", path: /^\/v1\/sources$/, action: "sources", write: false },
  { method: "POST", path: /^\/v1\/sources$/, action: "create", write: true },
  { method: "PATCH", path: /^\/v1\/sources\/([^/]+)$/, action: "update", write: true },
  { method: "POST", path: /^\/v1\/sources\/([^/]+)\/pause$/, action: "pause", write: true },
  { method: "POST", path: /^\/v1\/sources\/([^/]+)\/resume$/, action: "resume", write: true },
  { method: "POST", path: /^\/v1\/sources\/([^/]+)\/archive$/, action: "archive", write: true },
  { method: "POST", path: /^\/v1\/sources\/([^/]+)\/collect$/, action: "collect", write: true },
  { method: "GET", path: /^\/v1\/source-jobs$/, action: "jobs", write: false },
  { method: "GET", path: /^\/v1\/source-jobs\/([^/]+)$/, action: "job", write: false },
  { method: "POST", path: /^\/v1\/source-jobs\/([^/]+)\/retry$/, action: "retry", write: true },
  { method: "POST", path: /^\/v1\/source-jobs\/([^/]+)\/continue$/, action: "continue", write: true },
  { method: "POST", path: /^\/v1\/source-jobs\/([^/]+)\/cancel$/, action: "cancel", write: true },
  { method: "GET", path: /^\/v1\/source-ops$/, action: "ops", write: false },
  { method: "PUT", path: /^\/v1\/source-provider-budgets\/([^/]+)$/, action: "budget", write: true },
] as const;
export function matchSourceContentRoute(method: string, path: string) { return routes.find(route => route.method === method && route.path.test(path)) ?? matchContentReadRoute(method, path); }
export async function handleSourceContentRoute(args: { method: string; url: URL; body?: unknown; requestId: string; service?: SourceContentService }): Promise<{ statusCode: number; body?: unknown; headers?:Record<string,string>;rawBody?:string }> {
  const route = matchSourceContentRoute(args.method, args.url.pathname), service = args.service, requestId = args.requestId;
  if (!route) return { statusCode: 404, body: { ok: false, requestId, error: "Route not found", errorCode: "route_not_found" } };
  if (!service) return { statusCode: 503, body: { ok: false, requestId, error: "Source content service is not configured", errorCode: "source_content_unavailable" } };
  const id = route.path.exec(args.url.pathname)?.[1] ?? "";
  try {
    if (route.action === "sources") return { statusCode: 200, body: { ok: true, requestId, sources: await service.repository.listSources(), capabilities: service.capabilities(),providers:(await service.ops()).providers } };
    if (route.action === "create") return { statusCode: 201, body: { ok: true, requestId, source: await service.createSource(args.body as CreateCollectionSourceRequest) } };
    if(route.action==="update")return {statusCode:200,body:{ok:true,requestId,source:await service.updateSource(id,args.body as UpdateCollectionSourceRequest)}};
    if(route.action === "pause" || route.action === "resume" || route.action === "archive"){
      const body=args.body??{};if(!body||typeof body!=="object"||Array.isArray(body)||Object.keys(body).some(key=>key!=="expectedRevision"))throw new SourceContentError("State changes accept only expectedRevision");
      return {statusCode:200,body:{ok:true,requestId,source:await service.setSourceState(id,route.action==="pause"?"paused":route.action==="archive"?"archived":"active",(body as {expectedRevision?:number}).expectedRevision)}};
    }
    if (route.action === "collect") return { statusCode: 202, body: { ok: true, requestId, job: await service.enqueue(id, (args.body ?? {}) as StartSourceCollectionRequest) } };
    if (route.action === "job") return { statusCode: 200, body: { ok: true, requestId, job: await service.getJob(id) } };
    if (route.action === "retry") return { statusCode: 202, body: { ok: true, requestId, job: await service.retryJob(id) } };
    if (route.action === "continue") return { statusCode: 202, body: { ok: true, requestId, job: await service.continueJob(id) } };
    if(route.action==="cancel")return {statusCode:200,body:{ok:true,requestId,job:await service.cancelJob(id)}};
    if(route.action==="ops")return {statusCode:200,body:{ok:true,requestId,ops:await service.ops()}};
    if(route.action==="budget")return {statusCode:200,body:{ok:true,requestId,budget:await service.setProviderBudget(id,args.body as SourceProviderBudgetRequest)}};
    const params = args.url.searchParams;
    if(route.action==="jobs")return {statusCode:200,body:{ok:true,requestId,jobs:await service.listJobs({sourceId:params.get("sourceId")??undefined,status:(params.get("status")??undefined) as SourceCollectionJob["status"]|undefined,limit:params.has("limit")?Number(params.get("limit")):undefined})}};
    return await handleContentReadRoute({ action: route.action, id, params, requestId, service });
  } catch (error) {
    if (error instanceof SourceContentError) {
      const statusCode = sourceContentErrorStatus(error);
      const errorCode = statusCode === 503 ? "public_search_unavailable"
        : statusCode === 404 ? "source_not_found"
        : statusCode === 409 ? "source_conflict" : "invalid_source_request";
      return { statusCode, body: { ok: false, requestId, error: error.message, errorCode } };
    }
    throw error;
  }
}
