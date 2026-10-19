import type { CollectionSource, ContentQuery, ContentStatsResponse, CreateCollectionSourceRequest, PublicContent, SourceCollectionJob, StartSourceCollectionRequest, UpdateCollectionSourceRequest, SourceJobQuery, SourceOps, SourceProviderBudget, SourceProviderUsage, SourceWorkerHeartbeat,PublicContentSearchCoverage } from "../../../packages/contracts/src/source-content";
import type { CollectedPage } from "../../connectors/shared/content-provider.interface";

export interface ClaimedSourceJob {
  job: SourceCollectionJob; leaseToken: string;
  /** Conservative request starts since the last committed page, retained across lease and budget deferrals. */
  pageRequestAttempts?: number;
}
/** Raised only when a caller opts into optimistic configuration updates. */
export class SourceConfigurationConflictError extends Error { constructor(){super("Configuration changed; reload it before retrying");} }
export interface SourceJobInput extends Required<StartSourceCollectionRequest> { id: string; sourceId: string; now: string; purpose?: SourceCollectionJob["purpose"]; parentJobId?: string | null; refreshIds?: string[] }
/** UTF-8 bytes of the selected transport rows, measured before fetching payloads. */
export interface ResearchPayloadPreflight { total:number;contentBytes:number;sourceCount:number;sourceBytes:number }
export interface SourceContentRepository {
  /** Omit ids to list all sources; supplied ids select only those sources in the existing order. */
  listSources(ids?: readonly string[]): Promise<CollectionSource[]>;
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
  /** Called after budget admission. Fence/count a request start and the first start of a refresh round; null means fenced or terminal attempt exhaustion. */
  beginRequestAttempt(claim: ClaimedSourceJob, now: string): Promise<number | null>;
  commitPage(claim: ClaimedSourceJob, page: CollectedPage, now: string): Promise<void>;
  failJob(claim: ClaimedSourceJob, error: string, retryAt: string | null, now: string, resetAttempts?: boolean, failureKind?: SourceCollectionJob["failureKind"]): Promise<void>;
  recordRequestAttempt(claim: ClaimedSourceJob, durationMs: number): Promise<void>;
  listContent(query: ContentQuery): Promise<{ items: PublicContent[]; nextCursor: string | null;searchCoverage?:PublicContentSearchCoverage }>;
  searchCoverage(contentIds:readonly string[]):Promise<PublicContentSearchCoverage>;
  researchPayloadPreflight(query:ContentQuery):Promise<ResearchPayloadPreflight>;
  listSourcesForResearch(query:ContentQuery):Promise<CollectionSource[]>;
  getContent(id:string):Promise<PublicContent|null>;
  /** Unordered unique matches; missing identities are omitted. */
  findContentsByIdentity(platform: PublicContent["platform"], identities: readonly Pick<PublicContent, "kind" | "externalId">[]): Promise<PublicContent[]>;
  relatedChildren(content:PublicContent,limit:number):Promise<PublicContent[]>;
  contentStats(query: ContentQuery): Promise<Omit<ContentStatsResponse, "ok" | "requestId">>;
}
