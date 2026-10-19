import type { ContentPlatform, ContentQuery, PublicContentKind } from "../../../packages/contracts/src/http";
import type { SourceContentService } from "../../../src/application/services/source-content.service";
import { contentWorkbench, contentExport, contentExportCsv } from "../../../src/application/services/content-workbench.service";
import { SourceContentError } from "../../../src/domain/source-content-error";

const routes = [
  { method: "GET", path: /^\/v1\/content$/, action: "content", write: false },
  { method: "GET", path: /^\/v1\/content\/stats$/, action: "stats", write: false },
  { method: "GET", path: /^\/v1\/content\/workbench$/, action: "workbench", write: false },
  { method: "GET", path: /^\/v1\/content\/export$/, action: "export", write: false },
  { method: "GET", path: /^\/v1\/content\/([^/]+)$/, action: "detail", write: false },
] as const;

type ContentReadAction = typeof routes[number]["action"];

export function matchContentReadRoute(method: string, path: string) {
  return routes.find(route => route.method === method && route.path.test(path));
}

/** Reads only stored content. Authentication and error translation remain in the common dispatcher. */
export async function handleContentReadRoute(args: {
  action: ContentReadAction;
  id: string;
  params: URLSearchParams;
  requestId: string;
  service: SourceContentService;
}) {
  const { action, id, params, requestId, service } = args;
  if (action === "detail") {
    return { statusCode: 200, body: { ok: true, requestId, ...await service.contentDetail(id) } };
  }
  const query: ContentQuery = service.normalizeQuery({
    platform: (params.get("platform") ?? undefined) as ContentPlatform | undefined,
    provider: params.get("provider") ?? undefined,
    sourceId: params.get("sourceId") ?? undefined,
    kind: (params.get("kind") ?? undefined) as PublicContentKind | undefined,
    query: params.get("query") ?? undefined,
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    limit: params.has("limit") ? Number(params.get("limit")) : undefined,
    cursor: params.get("cursor") ?? undefined,
    author: params.get("author") ?? undefined,
    language: params.get("language") ?? undefined,
    sourceGroup: params.get("sourceGroup") ?? undefined,
    sort: (params.get("sort") ?? undefined) as ContentQuery["sort"],
    metricKey: params.get("metricKey") ?? undefined,
    minMetric: params.has("minMetric") ? Number(params.get("minMetric")) : undefined,
    maxMetric: params.has("maxMetric") ? Number(params.get("maxMetric")) : undefined,
    searchMode: (params.get("searchMode") ?? undefined) as ContentQuery["searchMode"],
    searchScope: (params.get("searchScope") ?? undefined) as ContentQuery["searchScope"],
    exclusions: params.has("exclusions") ? params.getAll("exclusions") : undefined,
  });
  if (action === "stats") {
    return { statusCode: 200, body: { ok: true, requestId, ...await service.repository.contentStats(query) } };
  }
  if (action === "workbench") {
    return { statusCode: 200, body: { ok: true, requestId, ...await contentWorkbench(service, query) } };
  }
  if (action === "export") {
    const format = params.get("format") ?? "json";
    if (!["json", "csv"].includes(format)) throw new SourceContentError("Export format must be json or csv");
    const result = await contentExport(service, query, params.has("maxItems") ? Number(params.get("maxItems")) : 2000);
    if (format === "json") return { statusCode: 200, body: { ok: true, requestId, ...result } };
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="collected-content-${result.exportedAt.slice(0, 10)}.csv"`,
        "Cache-Control": "private, no-store",
        "X-Export-Scope": result.scope,
        "X-Export-Coverage": result.coverage,
        "X-Export-Total-Matching": String(result.totalMatching),
        "X-Export-Count": String(result.exportedCount),
        "X-Export-Truncated": String(result.truncated),
        "X-Export-Next-Cursor": result.nextCursor ?? "",
        "X-Request-Id": requestId,
      },
      rawBody: contentExportCsv(result),
    };
  }
  return {
    statusCode: 200,
    body: { ok: true, requestId, ...await service.repository.listContent(query), coverage: "stored_sample", queryScope: "collected_content" },
  };
}
