import { randomUUID } from "node:crypto";
import type { CollectionSource, ContentQuery, MetricDefinition, PlatformDetails, PublicContent, SavedContentQuery } from "../../../packages/contracts/src/source-content";
import type { CreateResearchExportRequest, ResearchExportManifest, ResearchExportPageResponse } from "../../../packages/contracts/src/research-export";
import type { ResearchExportRepository, ResearchPageQuery, ResearchSnapshotContext } from "../../domain/repositories/research-export-repository";
import type { SourceContentService } from "./source-content.service";
import { requireSourceId, isContentMetricKey } from "../../domain/source-content-validation";
import { ResearchExportError } from "../../storage/research-export-query";

export const RESEARCH_EXPORT_MAX_ROWS = 20000;
export const RESEARCH_EXPORT_MAX_BYTES = 32 * 1024 * 1024;
const queryKeys = new Set(["platform", "provider", "sourceId", "kind", "query", "from", "to", "author", "language", "sourceGroup", "sort", "metricKey", "minMetric", "maxMetric", "searchMode", "searchScope", "exclusions"]);
const extensionKeys = new Set(["reddit.stickied", "reddit.locked", "reddit.post_hint", "twitterapi_io.adapter_version", "twitterapi_io.endpoint", "twitterapi_io.request_id", "twitterapi_io.rate_limit_remaining", "x.is_limited_reply", "web.identity_namespace", "web.raw_external_id", "web.identity_version"]);
function pick<T extends object>(input: T, keys: readonly string[]): Record<string, unknown> { return Object.fromEntries(keys.filter(key => Object.hasOwn(input, key)).map(key => [key, (input as Record<string, unknown>)[key]])); }
function details(input: PlatformDetails): PlatformDetails {
  const fields = input.platform === "reddit" ? ["platform", "community", "flair", "nsfw"] : input.platform === "x" ? ["platform", "conversationId", "isReply", "isRepost", "isQuote", "sensitive"] : input.platform === "instagram" ? ["platform", "mediaProduct", "caption", "carouselIds"] : input.platform === "bluesky" ? ["platform", "cid"] : ["platform", "publisher", "canonicalUrl", "feedUrl"];
  const extensions = Object.fromEntries(Object.entries(input.extensions ?? {}).filter(([key, value]) => {
    if (!extensionKeys.has(key)) return false;
    if (value === null) return true;
    if (["reddit.stickied", "reddit.locked", "x.is_limited_reply"].includes(key)) return typeof value === "boolean";
    if (key === "twitterapi_io.rate_limit_remaining") return typeof value === "number" && Number.isFinite(value);
    return typeof value === "string";
  }));
  return { ...pick(input, fields), ...(Object.keys(extensions).length ? { extensions } : {}) } as PlatformDetails;
}
/** Freeze only the public canonical contract; unknown/raw/provider credentials do not pass through. */
function canonicalContent(input: PublicContent): PublicContent {
  return structuredClone({
    ...pick(input, ["id", "platform", "kind", "externalId", "title", "text", "url", "language", "publishedAt", "firstFetchedAt", "lastFetchedAt", "availability"]),
    author: input.author ? pick(input.author, ["externalId", "handle", "displayName", "url"]) : null,
    references: input.references.map(reference => pick(reference, ["kind", "externalId", "relation"])),
    media: input.media.map(media => pick(media, ["type", "url", "previewUrl", "altText", "durationSeconds"])),
    platformDetails: details(input.platformDetails),
    observations: input.observations.map(observation => ({ ...pick(observation, ["provider", "sourceId", "sourceObservedAt", "fetchedAt", "timeBasis", "maturity", "evidenceKey"]), metrics: Object.fromEntries(Object.entries(observation.metrics).filter(([key, value]) => isContentMetricKey(key) && (value === null || typeof value === "number" && Number.isFinite(value)))) })),
  }) as unknown as PublicContent;
}
function canonicalSource(input: CollectionSource): CollectionSource {
  const target = input.target, targetKeys = target.type === "community" ? ["type", "community", "query"] : target.type === "account" ? ["type", "account", "query"] : target.type === "post" ? ["type", "postId", "query"] : target.type === "search" ? ["type", "query"] : ["type", "url"];
  return structuredClone({ ...pick(input, ["id", "platform", "provider", "label", "contentKind", "createdAt", "lastSuccessAt", "latestPublishedAt", "coverage", "state", "group", "updatedAt", "nextDueAt", "incrementalTo", "nextRecheckAt", "revision"]), target: pick(target, targetKeys), schedule: pick(input.schedule, ["enabled", "cadenceSeconds", "overlapSeconds", "initialLookbackHours", "maxCatchupHours", "pageSize", "maxPages", "recheckLookbackHours", "recheckCadenceSeconds"]), refresh: pick(input.refresh, ["enabled", "afterHours", "minIntervalHours", "maxAttempts", "batchSize"]) }) as unknown as CollectionSource;
}
function canonicalDefinition(input: MetricDefinition): MetricDefinition { return structuredClone(pick(input, ["key", "label", "unit", "cumulative", "signed", "contentKinds", "direction"])) as unknown as MetricDefinition; }

export class ResearchExportService {
  constructor(readonly repository: ResearchExportRepository, readonly content: SourceContentService, private readonly now = () => new Date().toISOString()) {}
  private page(input: { limit?: number; cursor?: string } = {}): ResearchPageQuery {
    const limit = input.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || input.cursor !== undefined && typeof input.cursor !== "string") throw new ResearchExportError("Page limit must be 1–100 and cursor must be a string");
    return { limit, cursor: input.cursor };
  }
  private query(input: unknown): SavedContentQuery {
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !queryKeys.has(key))) throw new ResearchExportError("Research queries accept only public filters, without cursor or limit");
    const { limit: _limit, cursor: _cursor, ...query } = this.content.normalizeQuery(input as ContentQuery);
    return JSON.parse(JSON.stringify(query));
  }
  async create(userId: string, input: CreateResearchExportRequest) {
    requireSourceId(userId);
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !["name", "query", "maxRows"].includes(key))) throw new ResearchExportError("Invalid research export fields");
    if (typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 100 || /[\u0000-\u001f]/.test(input.name)) throw new ResearchExportError("Export name must contain 1–100 characters");
    const maxRows = input.maxRows ?? RESEARCH_EXPORT_MAX_ROWS;
    if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > RESEARCH_EXPORT_MAX_ROWS) throw new ResearchExportError("maxRows must be 1–20000");
    const query = this.query(input.query), createdAt = this.now();
    return this.repository.freeze({ id: randomUUID(), userId, name: input.name.trim(), query, maxRows, createdAt }, context => this.capture(context, query, maxRows, createdAt));
  }
  private async capture(context: ResearchSnapshotContext, query: SavedContentQuery, maxRows: number, frozenAt: string) {
    const stats = await context.content.contentStats(query);
    if (stats.total > maxRows) throw new ResearchExportError(`The complete matching set exceeds ${maxRows} rows; narrow the query`, 413);
    const preflight = await context.content.researchPayloadPreflight(query);
    if (preflight.total !== stats.total || [preflight.contentBytes, preflight.sourceBytes, preflight.sourceCount].some(value => !Number.isSafeInteger(value) || value < 0)) throw new ResearchExportError("Invalid or inconsistent snapshot preflight", 409);
    if (preflight.contentBytes + preflight.sourceBytes > RESEARCH_EXPORT_MAX_BYTES) throw new ResearchExportError("The complete snapshot read payload exceeds 32 MiB; narrow the query", 413);
    const sources = await context.content.listSourcesForResearch(query), items: PublicContent[] = [], ids = new Set<string>(), identities = new Set<string>();
    let cursor: string | undefined, itemBytes = 2;
    do {
      const page = await context.content.listContent({ ...query, limit: 100, cursor });
      for (const input of page.items) {
        const item = canonicalContent(input), identity = JSON.stringify([item.platform, item.kind, item.externalId]);
        if (ids.has(item.id) || identities.has(identity)) throw new ResearchExportError("The source snapshot returned duplicate content identities", 409);
        ids.add(item.id); identities.add(identity); itemBytes += Buffer.byteLength(JSON.stringify(item), "utf8") + (items.length ? 1 : 0);
        if (items.length >= maxRows || itemBytes > RESEARCH_EXPORT_MAX_BYTES) throw new ResearchExportError("The complete frozen payload exceeds the row or 32 MiB limit; narrow the query", 413);
        items.push(item);
      }
      if (page.nextCursor === cursor || page.nextCursor && page.items.length === 0) throw new ResearchExportError("The source snapshot cursor did not advance", 409);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    if (items.length !== stats.total) throw new ResearchExportError("The snapshot member count does not match its fixed denominator", 409);
    const platform = query.platform ?? query.metricKey?.split(".")[0];
    const relevant = sources.filter(source => (!platform || source.platform === platform) && (!query.provider || source.provider === query.provider) && (!query.sourceId || source.id === query.sourceId) && (!query.kind || source.contentKind === query.kind) && (!query.sourceGroup || source.group === query.sourceGroup)).map(canonicalSource);
    const metricKeys = new Set(items.flatMap(item => item.observations.flatMap(observation => Object.keys(observation.metrics))));
    const definitions = [...new Map(this.content.capabilities().filter(capability => relevant.some(source => source.platform === capability.platform && source.provider === capability.provider)).flatMap(capability => capability.metrics).filter(metric => metricKeys.has(metric.key)).map(metric => [metric.key, canonicalDefinition(metric)])).values()];
    const indexed = await context.indexedContentCount([...ids]);
    if (indexed === null) throw new ResearchExportError("Search index coverage cannot be measured; no export was created", 503);
    if (!Number.isInteger(indexed) || indexed < 0 || indexed > items.length) throw new ResearchExportError("Invalid measured index coverage", 409);
    const textPresent = items.filter(item => typeof item.text === "string").length;
    const limitations = ["This freezes the complete matching stored sample, not complete platform coverage.", "Frozen source configuration describes streams linked to selected members in the saved source scope; streams without members are omitted.", "Body-text coverage distinguishes stored strings, including known empty text, from null/missing text; a title alone does not count as body text.", "Content, source labels and latest scoped observations are frozen together; no growth is inferred from a single observation."];
    if (indexed < items.length) limitations.push("The frozen member set includes contents without a current public search projection; index coverage is partial.");
    if ([...metricKeys].some(key => !definitions.some(metric => metric.key === key))) limitations.push("Some stored metric keys have no registered definition; their units must not be inferred.");
    const manifest: ResearchExportManifest = { formatVersion: 1, contentContractVersion: "public-content-v1", queryContractVersion: "content-query-v2", identityVersion: "platform-kind-external-v1", observationSelection: "latest_per_source_known_source_time_first", frozenAt, query, total: items.length, scope: "frozen_stored_sample", textScope: "stored_title_and_text", sources: relevant, metricDefinitions: definitions, coverage: { indexed, textPresent, textMissing: items.length - textPresent, scope: "stored_content" }, limitations };
    const payloadBytes = Buffer.byteLength(JSON.stringify({ manifest, items }), "utf8");
    if (payloadBytes > RESEARCH_EXPORT_MAX_BYTES) throw new ResearchExportError("The complete frozen payload exceeds 32 MiB; narrow the query", 413);
    return { manifest, items, payloadBytes };
  }
  async get(userId: string, id: string) { requireSourceId(userId); requireSourceId(id); const view = await this.repository.get(userId, id); if (!view) throw new ResearchExportError("Research export not found", 404); return view; }
  async list(userId: string, input: { limit?: number; cursor?: string } = {}) { requireSourceId(userId); return this.repository.list(userId, this.page(input)); }
  async pageContent(userId: string, id: string, input: { limit?: number; cursor?: string } = {}): Promise<Omit<ResearchExportPageResponse, "ok" | "requestId">> {
    requireSourceId(userId); requireSourceId(id); const page = await this.repository.page(userId, id, this.page(input));
    if (!page) throw new ResearchExportError("Research export not found", 404);
    return { exportId: id, total: page.researchExport.total, items: page.items, nextCursor: page.nextCursor, manifest: page.researchExport.manifest, scope: "frozen_members" };
  }
  async delete(userId: string, id: string) { requireSourceId(userId); requireSourceId(id); if (!await this.repository.delete(userId, id)) throw new ResearchExportError("Research export not found", 404); return { deleted: true as const }; }
}

function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "null" : typeof value === "string" ? value : JSON.stringify(value);
  if (/^\s*[=+\-@]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function researchExportCsv(page: Omit<ResearchExportPageResponse, "ok" | "requestId">): string {
  const columns = ["id", "platform", "kind", "externalId", "title", "text", "url", "language", "author", "publishedAt", "firstFetchedAt", "lastFetchedAt", "availability", "media", "references", "platformDetails", "observations"] as const;
  return "\uFEFF" + ["research_export_manifest", JSON.stringify({ ...page, items: undefined, csvNullRepresentation: "JSON literal null; payload_json preserves all original types" })].map(csvCell).join(",") + "\r\n" + [...columns, "payload_json"].map(csvCell).join(",") + "\r\n" + page.items.map(item => [...columns.map(key => csvCell(key === "externalId" && /^\d+$/.test(item[key]) ? `'${item[key]}` : item[key])), csvCell(item)].join(",")).join("\r\n") + "\r\n";
}
