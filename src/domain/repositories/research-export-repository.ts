import type { PublicContent, SavedContentQuery } from "../../../packages/contracts/src/source-content";
import type { ResearchExportManifest, ResearchExportView } from "../../../packages/contracts/src/research-export";
import type { SourceContentRepository } from "./source-content-repository";

export type ResearchContentReader = Pick<SourceContentRepository, "listContent" | "contentStats" | "researchPayloadPreflight" | "listSourcesForResearch" | "searchCoverage">;
export interface ResearchSnapshotContext {
  content: ResearchContentReader;
  /** null means coverage could not be measured; no snapshot may be committed. */
  indexedContentCount(ids: string[]): Promise<number | null>;
}
export interface ResearchSnapshot { manifest: ResearchExportManifest; items: PublicContent[]; payloadBytes: number }
export interface ResearchFreezeInput { id: string; userId: string; name: string; query: SavedContentQuery; maxRows: number; createdAt: string }
export interface ResearchPageQuery { limit: number; cursor?: string }
export interface ResearchExportRepository {
  freeze(input: ResearchFreezeInput, capture: (context: ResearchSnapshotContext) => Promise<ResearchSnapshot>): Promise<ResearchExportView>;
  get(userId: string, id: string): Promise<ResearchExportView | null>;
  list(userId: string, query: ResearchPageQuery): Promise<{ exports: ResearchExportView[]; nextCursor: string | null }>;
  page(userId: string, id: string, query: ResearchPageQuery): Promise<{ researchExport: ResearchExportView; items: PublicContent[]; nextCursor: string | null } | null>;
  delete(userId: string, id: string): Promise<boolean>;
}
