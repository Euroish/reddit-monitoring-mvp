import type { CollectionSource, ContentQuery, ContentStatsResponse, CreateCollectionSourceRequest, PublicContent, SourceCollectionJob, StartSourceCollectionRequest, UpdateCollectionSourceRequest, SourceJobQuery, SourceOps, SourceProviderBudget, SourceProviderUsage, SourceWorkerHeartbeat } from "../../../packages/contracts/src/source-content";
import type { CollectedPage } from "../../connectors/shared/content-provider.interface";

export interface ClaimedSourceJob { job: SourceCollectionJob; leaseToken: string }
/** Raised only when a caller opts into optimistic configuration updates. */
export class SourceConfigurationConflictError extends Error { constructor(){super("Configuration changed; reload it before retrying");} }
export interface SourceJobInput extends Required<StartSourceCollectionRequest> { id: string; sourceId: string; now: string; purpose?: SourceCollectionJob["purpose"]; parentJobId?: string | null; refreshIds?: string[] }
export interface SourceContentRepository {
  listSources(): Promise<CollectionSource[]>;
  createSource(source: CreateCollectionSourceRequest & { id: string; label: string; createdAt: string }): Promise<CollectionSource>;
  getSource(id: string): Promise<CollectionSource | null>;
  updateSource(id: string, changes: UpdateCollectionSourceRequest, now: string): Promise<CollectionSource | null>;
  setSourceState(id: string, state: CollectionSource["state"], now: string,expectedRevision?:number): Promise<CollectionSource | null>;
  enqueue(job: SourceJobInput): Promise<SourceCollectionJob>;
  getJob(id: string): Promise<SourceCollectionJob | null>;
  retryJob(id: string, now: string): Promise<SourceCollectionJob | null>;
  continueJob(id: string, newId: string, now: string): Promise<SourceCollectionJob | null>;
  listJobs(query: SourceJobQuery): Promise<SourceCollectionJob[]>;
  cancelJob(id: string, now: string): Promise<SourceCollectionJob | null>;
  scheduleDue(now: string, refreshProviders: readonly string[], limit: number, enabledProviders?: readonly string[]): Promise<number>;
  providerUsage(now: string): Promise<SourceProviderUsage[]>;
  setProviderBudget(budget: SourceProviderBudget, now?: string,expectedRevision?:number): Promise<SourceProviderBudget>;
  reserveUsage(provider: string, resources: number, now: string): Promise<{ allowed: boolean; retryAt: string;reason?:"budget"|"interval" }>;
  heartbeat(value: SourceWorkerHeartbeat): Promise<void>;
  sourceOps(now: string): Promise<SourceOps>;
  claim(now: string): Promise<ClaimedSourceJob | null>;
  commitPage(claim: ClaimedSourceJob, page: CollectedPage, now: string): Promise<void>;
  failJob(claim: ClaimedSourceJob, error: string, retryAt: string | null, now: string, resetAttempts?: boolean): Promise<void>;
  recordRequestAttempt(claim: ClaimedSourceJob, durationMs: number): Promise<void>;
  listContent(query: ContentQuery): Promise<{ items: PublicContent[]; nextCursor: string | null }>;
  contentStats(query: ContentQuery): Promise<Omit<ContentStatsResponse, "ok" | "requestId">>;
}
