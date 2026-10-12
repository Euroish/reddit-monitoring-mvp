import type { CollectionSource, ContentQuery, ContentStatsResponse, CreateCollectionSourceRequest, PublicContent, SourceCollectionJob, StartSourceCollectionRequest } from "../../../packages/contracts/src/source-content";
import type { CollectedPage } from "../../connectors/shared/content-provider.interface";

export interface ClaimedSourceJob { job: SourceCollectionJob; leaseToken: string }
export interface SourceContentRepository {
  listSources(): Promise<CollectionSource[]>;
  createSource(source: CreateCollectionSourceRequest & { id: string; label: string; createdAt: string }): Promise<CollectionSource>;
  getSource(id: string): Promise<CollectionSource | null>;
  enqueue(job: Required<StartSourceCollectionRequest> & { id: string; sourceId: string; now: string }): Promise<SourceCollectionJob>;
  getJob(id: string): Promise<SourceCollectionJob | null>;
  retryJob(id: string, now: string): Promise<SourceCollectionJob | null>;
  continueJob(id: string, newId: string, now: string): Promise<SourceCollectionJob | null>;
  claim(now: string): Promise<ClaimedSourceJob | null>;
  commitPage(claim: ClaimedSourceJob, page: CollectedPage, now: string): Promise<void>;
  failJob(claim: ClaimedSourceJob, error: string, retryAt: string | null, now: string): Promise<void>;
  listContent(query: ContentQuery): Promise<{ items: PublicContent[]; nextCursor: string | null }>;
  contentStats(query: ContentQuery): Promise<Omit<ContentStatsResponse, "ok" | "requestId">>;
}
