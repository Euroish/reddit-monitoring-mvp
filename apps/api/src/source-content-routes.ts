import type { ContentPlatform, ContentQuery, CreateCollectionSourceRequest, PublicContentKind, StartSourceCollectionRequest, UpdateCollectionSourceRequest, SourceCollectionJob, SourceProviderBudgetRequest } from "../../../packages/contracts/src/http";
import { SourceContentError, type SourceContentService } from "../../../src/application/services/source-content.service";
import { contentWorkbench, contentExport, contentExportCsv } from "../../../src/application/services/content-workbench.service";

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
  { method: "GET", path: /^\/v1\/content$/, action: "content", write: false },
  { method: "GET", path: /^\/v1\/content\/stats$/, action: "stats", write: false },
  { method: "GET", path: /^\/v1\/content\/workbench$/, action: "workbench", write: false },
  { method: "GET", path: /^\/v1\/content\/export$/, action: "export", write: false },
  { method:"GET",path:/^\/v1\/content\/([^/]+)$/,action:"detail",write:false },
] as const;
export function matchSourceContentRoute(method: string, path: string) { return routes.find(route => route.method === method && route.path.test(path)); }
export async function handleSourceContentRoute(args: { method: string; url: URL; body?: unknown; requestId: string; service?: SourceContentService }): Promise<{ statusCode: number; body?: unknown; headers?:Record<string,string>;rawBody?:string }> {
  const route = matchSourceContentRoute(args.method, args.url.pathname), service = args.service, requestId = args.requestId;
  if (!route) return { statusCode: 404, body: { ok: false, requestId, error: "Route not found", errorCode: "route_not_found" } };
  if (!service) return { statusCode: 503, body: { ok: false, requestId, error: "Source content service is not configured", errorCode: "source_content_unavailable" } };
  const id = route.path.exec(args.url.pathname)?.[1] ?? "";
  try {
    if (route.action === "sources") return { statusCode: 200, body: { ok: true, requestId, sources: await service.repository.listSources(), capabilities: service.capabilities(),providers:(await service.ops()).providers } };
    if (route.action === "create") return { statusCode: 201, body: { ok: true, requestId, source: await service.createSource(args.body as CreateCollectionSourceRequest) } };
    if(route.action==="update")return {statusCode:200,body:{ok:true,requestId,source:await service.updateSource(id,args.body as UpdateCollectionSourceRequest)}};
    if(["pause","resume","archive"].includes(route.action)){
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
    if(route.action==="detail")return {statusCode:200,body:{ok:true,requestId,...await service.contentDetail(id)}};
    const params = args.url.searchParams;
    if(route.action==="jobs")return {statusCode:200,body:{ok:true,requestId,jobs:await service.listJobs({sourceId:params.get("sourceId")??undefined,status:(params.get("status")??undefined) as SourceCollectionJob["status"]|undefined,limit:params.has("limit")?Number(params.get("limit")):undefined})}};
    const query: ContentQuery = service.normalizeQuery({ platform: (params.get("platform") ?? undefined) as ContentPlatform | undefined, provider: params.get("provider") ?? undefined, sourceId: params.get("sourceId") ?? undefined, kind: (params.get("kind") ?? undefined) as PublicContentKind | undefined, query: params.get("query") ?? undefined, from: params.get("from") ?? undefined, to: params.get("to") ?? undefined, limit: params.has("limit") ? Number(params.get("limit")) : undefined, cursor: params.get("cursor") ?? undefined,author:params.get("author")??undefined,language:params.get("language")??undefined,sourceGroup:params.get("sourceGroup")??undefined,sort:(params.get("sort")??undefined) as ContentQuery["sort"],metricKey:params.get("metricKey")??undefined,minMetric:params.has("minMetric")?Number(params.get("minMetric")):undefined,maxMetric:params.has("maxMetric")?Number(params.get("maxMetric")):undefined,searchMode:(params.get("searchMode")??undefined) as ContentQuery["searchMode"],searchScope:(params.get("searchScope")??undefined) as ContentQuery["searchScope"],exclusions:params.has("exclusions")?params.getAll("exclusions"):undefined });
    if (route.action === "stats") return { statusCode: 200, body: { ok: true, requestId, ...await service.repository.contentStats(query) } };
    if(route.action==="workbench")return {statusCode:200,body:{ok:true,requestId,...await contentWorkbench(service,query)}};
    if(route.action==="export") {
      const format=params.get("format")??"json";if(!["json","csv"].includes(format))throw new SourceContentError("Export format must be json or csv");
      const result=await contentExport(service,query,params.has("maxItems")?Number(params.get("maxItems")):2000);
      if(format==="json")return {statusCode:200,body:{ok:true,requestId,...result}};
      return {statusCode:200,headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="collected-content-${result.exportedAt.slice(0,10)}.csv"`,"Cache-Control":"private, no-store","X-Export-Scope":result.scope,"X-Export-Coverage":result.coverage,"X-Export-Total-Matching":String(result.totalMatching),"X-Export-Count":String(result.exportedCount),"X-Export-Truncated":String(result.truncated),"X-Export-Next-Cursor":result.nextCursor??"","X-Request-Id":requestId},rawBody:contentExportCsv(result)};
    }
    return { statusCode: 200, body: { ok: true, requestId, ...await service.repository.listContent(query), coverage: "stored_sample", queryScope: "collected_content" } };
  } catch (error) {
    if (error instanceof SourceContentError) return { statusCode: error.status, body: { ok: false, requestId, error: error.message, errorCode:error.status===503?"public_search_unavailable":error.status === 404 ? "source_not_found" : error.status === 409 ? "source_conflict" : "invalid_source_request" } };
    throw error;
  }
}
