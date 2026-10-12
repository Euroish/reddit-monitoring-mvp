import type { ContentPlatform, ContentQuery, CreateCollectionSourceRequest, PublicContentKind, StartSourceCollectionRequest } from "../../../packages/contracts/src/http";
import { SourceContentError, type SourceContentService } from "../../../src/application/services/source-content.service";

/** Route, method and write permission stay together. Authentication is applied once in the composition root. */
const routes = [
  { method: "GET", path: /^\/v1\/sources$/, action: "sources", write: false },
  { method: "POST", path: /^\/v1\/sources$/, action: "create", write: true },
  { method: "POST", path: /^\/v1\/sources\/([^/]+)\/collect$/, action: "collect", write: true },
  { method: "GET", path: /^\/v1\/source-jobs\/([^/]+)$/, action: "job", write: false },
  { method: "POST", path: /^\/v1\/source-jobs\/([^/]+)\/retry$/, action: "retry", write: true },
  { method: "POST", path: /^\/v1\/source-jobs\/([^/]+)\/continue$/, action: "continue", write: true },
  { method: "GET", path: /^\/v1\/content$/, action: "content", write: false },
  { method: "GET", path: /^\/v1\/content\/stats$/, action: "stats", write: false },
] as const;
export function matchSourceContentRoute(method: string, path: string) { return routes.find(route => route.method === method && route.path.test(path)); }
export async function handleSourceContentRoute(args: { method: string; url: URL; body?: unknown; requestId: string; service?: SourceContentService }): Promise<{ statusCode: number; body: unknown }> {
  const route = matchSourceContentRoute(args.method, args.url.pathname), service = args.service, requestId = args.requestId;
  if (!route) return { statusCode: 404, body: { ok: false, requestId, error: "Route not found", errorCode: "route_not_found" } };
  if (!service) return { statusCode: 503, body: { ok: false, requestId, error: "Source content service is not configured", errorCode: "source_content_unavailable" } };
  const id = route.path.exec(args.url.pathname)?.[1] ?? "";
  try {
    if (route.action === "sources") return { statusCode: 200, body: { ok: true, requestId, sources: await service.repository.listSources(), capabilities: service.capabilities() } };
    if (route.action === "create") return { statusCode: 201, body: { ok: true, requestId, source: await service.createSource(args.body as CreateCollectionSourceRequest) } };
    if (route.action === "collect") return { statusCode: 202, body: { ok: true, requestId, job: await service.enqueue(id, (args.body ?? {}) as StartSourceCollectionRequest) } };
    if (route.action === "job") return { statusCode: 200, body: { ok: true, requestId, job: await service.getJob(id) } };
    if (route.action === "retry") return { statusCode: 202, body: { ok: true, requestId, job: await service.retryJob(id) } };
    if (route.action === "continue") return { statusCode: 202, body: { ok: true, requestId, job: await service.continueJob(id) } };
    const params = args.url.searchParams;
    const query: ContentQuery = service.normalizeQuery({ platform: (params.get("platform") ?? undefined) as ContentPlatform | undefined, provider: params.get("provider") ?? undefined, sourceId: params.get("sourceId") ?? undefined, kind: (params.get("kind") ?? undefined) as PublicContentKind | undefined, query: params.get("query") ?? undefined, from: params.get("from") ?? undefined, to: params.get("to") ?? undefined, limit: params.has("limit") ? Number(params.get("limit")) : undefined, cursor: params.get("cursor") ?? undefined });
    if (route.action === "stats") return { statusCode: 200, body: { ok: true, requestId, ...await service.repository.contentStats(query) } };
    return { statusCode: 200, body: { ok: true, requestId, ...await service.repository.listContent(query), coverage: "stored_sample", queryScope: "collected_content" } };
  } catch (error) {
    if (error instanceof SourceContentError) return { statusCode: error.status, body: { ok: false, requestId, error: error.message, errorCode: error.status === 404 ? "source_not_found" : error.status === 409 ? "source_conflict" : "invalid_source_request" } };
    throw error;
  }
}
