import { randomUUID } from "node:crypto";
import type { CollectionSource, ContentPlatform, ContentQuery, CreateCollectionSourceRequest, PublicContentKind, SourceCollectionJob, StartSourceCollectionRequest } from "../../../packages/contracts/src/source-content";
import { ContentProviderError, type ContentProvider } from "../../connectors/shared/content-provider.interface";
import type { SourceContentRepository } from "../../domain/repositories/source-content-repository";

export class SourceContentError extends Error {
  constructor(message: string, public readonly status: 400 | 404 | 409 = 400) { super(message); }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function requireSourceId(value: string): string { if (!uuid.test(value)) throw new SourceContentError("Invalid source/job identifier"); return value; }
function date(value: unknown, fallback: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new SourceContentError("Invalid date; use an ISO timestamp");
  return new Date(value).toISOString();
}
function integer(value: unknown, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > max) throw new SourceContentError(`Expected integer from 1 to ${max}`);
  return value;
}
const kinds: PublicContentKind[] = ["post", "comment", "article", "image", "video"];
const platforms: ContentPlatform[] = ["reddit", "x", "instagram", "web"];

export class SourceContentService {
  private readonly providers: readonly ContentProvider[];
  constructor(readonly repository: SourceContentRepository, providers: ContentProvider | readonly ContentProvider[], private readonly now = () => new Date().toISOString()) {
    this.providers = Array.isArray(providers) ? providers : [providers as ContentProvider];
    if (new Set(this.providers.map(item => `${item.capability.platform}:${item.capability.provider}`)).size !== this.providers.length) throw new Error("Duplicate platform/provider registration");
  }
  capabilities() { return this.providers.map(provider => provider.capability); }
  private providerFor(platform: string, provider: string) { return this.providers.find(item => item.capability.platform===platform && item.capability.provider===provider && item.capability.enabled); }

  async createSource(input: CreateCollectionSourceRequest): Promise<CollectionSource> {
    if (!input || typeof input !== "object") throw new SourceContentError("Invalid source configuration");
    const provider = this.providerFor(input.platform,input.provider);
    if (!provider) throw new SourceContentError("This platform/provider is not enabled");
    if (!provider.capability.contentKinds.includes(input.contentKind)) throw new SourceContentError("Content kind is not supported by this provider");
    let normalizedTarget: CollectionSource["target"];
    try { normalizedTarget = provider.normalizeTarget(input.target,input.contentKind); }
    catch (error) { if (error instanceof ContentProviderError) throw new SourceContentError(error.message); throw error; }
    if (input.label !== undefined && (typeof input.label !== "string" || input.label.trim().length > 100)) throw new SourceContentError("Label must be at most 100 characters");
    const name = Object.values(normalizedTarget).filter(value => typeof value === "string").slice(1,2).join("");
    const scopedQuery = "query" in normalizedTarget && normalizedTarget.type !== "search" ? normalizedTarget.query : undefined;
    const label = input.label?.trim() || `${name} · ${input.contentKind}${scopedQuery ? ` · ${scopedQuery}` : ""}`.slice(0,100);
    return this.repository.createSource({ id: randomUUID(), platform: input.platform, provider: input.provider, contentKind: input.contentKind, label, target: normalizedTarget, createdAt: this.now() });
  }

  async enqueue(sourceId: string, input: StartSourceCollectionRequest = {}): Promise<SourceCollectionJob> {
    requireSourceId(sourceId);
    if (!input || typeof input !== "object") throw new SourceContentError("Invalid collection request");
    const source = await this.repository.getSource(sourceId);
    if (!source) throw new SourceContentError("Source not found", 404);
    if (!this.providerFor(source.platform,source.provider)) throw new SourceContentError("This platform/provider is not enabled for collection");
    const now = this.now(), to = date(input.to, now), from = date(input.from, new Date(Date.parse(to) - 86400000).toISOString());
    if (Date.parse(from) >= Date.parse(to) || Date.parse(to) > Date.parse(now) + 60_000) throw new SourceContentError("Collection window must be ordered and must not be in the future");
    const pageSize = integer(input.pageSize,25,100), maxPages = integer(input.maxPages,5,20);
    const queued = await this.repository.enqueue({ id: randomUUID(), sourceId, now, from, to, pageSize, maxPages });
    if (queued.from !== from || queued.to !== to || queued.pageSize !== pageSize || queued.maxPages !== maxPages) throw new SourceContentError("Source is already collecting a different window or page budget; wait for that job to finish",409);
    return queued;
  }
  normalizeQuery(input: ContentQuery): ContentQuery {
    if (input.platform && !platforms.includes(input.platform)) throw new SourceContentError("Invalid platform filter");
    if (input.kind && !kinds.includes(input.kind)) throw new SourceContentError("Invalid kind filter");
    if (input.sourceId) requireSourceId(input.sourceId);
    if (input.provider && !/^[a-z0-9_]{1,60}$/.test(input.provider)) throw new SourceContentError("Invalid provider filter");
    if (input.query !== undefined && (typeof input.query !== "string" || input.query.length > 200)) throw new SourceContentError("Search text must be at most 200 characters");
    const query = { ...input, query: input.query?.trim() || undefined, limit: integer(input.limit, 25, 100), from: input.from === undefined ? undefined : date(input.from, ""), to: input.to === undefined ? undefined : date(input.to, "") };
    if (query.from && query.to && query.from >= query.to) throw new SourceContentError("Invalid query window");
    return query;
  }
  async getJob(id: string) { const job = await this.repository.getJob(requireSourceId(id)); if (!job) throw new SourceContentError("Job not found", 404); return job; }
  async retryJob(id: string) { const job = await this.repository.retryJob(requireSourceId(id), this.now()); if (!job) throw new SourceContentError("Only failed jobs with no active job on the same source can be retried", 409); return job; }
  async continueJob(id: string) { const job = await this.repository.continueJob(requireSourceId(id), randomUUID(), this.now()); if (!job) throw new SourceContentError("Only bounded completed jobs with a saved checkpoint can continue", 409); return job; }

  /** One bounded page per tick. A lease prevents concurrent workers committing the same job. */
  async workOnce(signal?: AbortSignal): Promise<boolean> {
    const claimed = await this.repository.claim(this.now());
    if (!claimed) return false;
    try {
      const source = await this.repository.getSource(claimed.job.sourceId);
      if (!source) throw new ContentProviderError("Source no longer exists", false);
      const provider = this.providerFor(source.platform,source.provider);
      if (!provider) throw new ContentProviderError("Source provider is not enabled", false);
      const page = await provider.collectPage({ source, from: claimed.job.from, to: claimed.job.to, limit: claimed.job.pageSize, checkpoint: claimed.job.checkpoint, signal });
      await this.repository.commitPage(claimed, page, this.now());
    } catch (error) {
      const retryable = signal?.aborted || error instanceof ContentProviderError && error.retryable && claimed.job.attempts < 3;
      const wait = error instanceof ContentProviderError ? error.retryAfterSeconds : 30;
      const retryAt = retryable ? new Date(Date.parse(this.now()) + (signal?.aborted ? 0 : Math.max(5, wait) * 1000)).toISOString() : null;
      await this.repository.failJob(claimed, error instanceof Error ? error.message.slice(0, 400) : "Collection failed", retryAt, this.now());
    }
    return true;
  }
}
