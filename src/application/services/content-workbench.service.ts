import type { ContentQuery, ContentStatsResponse, ContentPlatform, ContentWorkbenchResponse, ContentExportResponse } from "../../../packages/contracts/src/source-content";
import { SourceContentError, type SourceContentService } from "./source-content.service";

/** Shared counts use content identities; engagement metrics retain their platform units. */
export async function contentWorkbench(service: SourceContentService, query: ContentQuery): Promise<Omit<ContentWorkbenchResponse, "ok" | "requestId">> {
  const sources = await service.repository.listSources();
  const stats = await service.repository.contentStats(query);
  const platforms: ContentPlatform[] = query.platform ? [query.platform] : ["reddit", "x", "instagram", "web"];
  const byPlatform = await Promise.all(platforms.map(async platform => ({ platform, count: (await service.repository.contentStats({ ...query, platform })).total })));
  const providers = query.provider ? [query.provider] : [...new Set(sources.filter(source => !query.platform || source.platform === query.platform).map(source => source.provider))];
  const byProvider = await Promise.all(providers.map(async provider => ({ provider, count: (await service.repository.contentStats({ ...query, provider })).total })));
  const relevant = sources.filter(source => (!query.platform || source.platform === query.platform) && (!query.provider || source.provider === query.provider) && (!query.sourceId || source.id === query.sourceId) && (!query.kind || source.contentKind === query.kind)&&(!query.sourceGroup||source.group===query.sourceGroup));
  return { generatedAt: new Date().toISOString(), stats, byPlatform: byPlatform.filter(row => row.count > 0), byProvider: byProvider.filter(row => row.count > 0), sources: relevant, capabilities: service.capabilities(), scope: "collected_content", providerCountsMayOverlap: true, metricComparison: "platform_units_only" };
}

/** Bounded export of the requested scope, with a resumable content cursor.
 * Each page/denominator is read from saved content; concurrent updates are not a frozen SQL snapshot.
 */
export async function contentExport(service: SourceContentService, query: ContentQuery, maxItems = 2000): Promise<Omit<ContentExportResponse, "ok" | "requestId">> {
  if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 2000) throw new SourceContentError("Export maxItems must be 1–2000");
  const items: ContentExportResponse["items"] = [];
  let cursor = query.cursor, nextCursor: string | null = null;
  do {
    const page = await service.repository.listContent({ ...query, limit: Math.min(100, maxItems - items.length), cursor });
    items.push(...page.items); nextCursor = page.nextCursor;
    cursor = nextCursor ?? undefined;
  } while (nextCursor && items.length < maxItems);
  const stats: Omit<ContentStatsResponse, "ok" | "requestId"> = await service.repository.contentStats(query);
  return { exportedAt: new Date().toISOString(), scope: "collected_content", coverage: "stored_sample", filters: { ...query, cursor: undefined, limit: undefined }, totalMatching: stats.total, exportedCount: items.length, maxItems, truncated: nextCursor !== null, nextCursor, items,searchCoverage:stats.searchCoverage };
}

function csvCell(value: unknown): string {
  let text = value == null ? "" : typeof value === "string" ? value : JSON.stringify(value);
  // Protect spreadsheets from source-controlled formula cells, including leading whitespace.
  if (/^\s*[=+\-@]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function contentExportCsv(result: Omit<ContentExportResponse, "ok" | "requestId">): string {
  const columns = ["platform", "kind", "externalId", "title", "text", "url", "publishedAt", "firstFetchedAt", "lastFetchedAt", "author", "media", "references", "platformDetails", "observations"] as const;
  // Every file preserves its denominator, limit and continuation evidence.
  const metadata = ["export_metadata", JSON.stringify({ ...result, items: undefined })];
  return '\uFEFF' + metadata.map(csvCell).join(',') + '\r\n' + columns.map(csvCell).join(',') + '\r\n' + result.items.map(item => columns.map(key => csvCell(key==="externalId"&&/^\d+$/.test(item[key])?`'${item[key]}`:item[key])).join(',')).join('\r\n') + '\r\n';
}
