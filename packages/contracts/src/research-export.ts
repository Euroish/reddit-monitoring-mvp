import type { CollectionSource, MetricDefinition, PublicContent, SavedContentQuery } from "./source-content";

export interface CreateResearchExportRequest { name: string; query: SavedContentQuery; maxRows?: number }
export interface ResearchExportManifest {
  formatVersion: 1; contentContractVersion: "public-content-v1"; queryContractVersion: "content-query-v2";
  identityVersion: "platform-kind-external-v1";
  observationSelection: "latest_per_source_known_source_time_first";
  frozenAt: string; query: SavedContentQuery; total: number;
  scope: "frozen_stored_sample"; textScope: "stored_title_and_text";
  sources: CollectionSource[]; metricDefinitions: MetricDefinition[];
  coverage: { indexed: number; textPresent: number; textMissing: number; scope: "stored_content" };
  limitations: string[];
}
export interface ResearchExportView {
  id: string; name: string; total: number; createdAt: string; manifest: ResearchExportManifest;
}
export interface ResearchExportListResponse { ok: true; requestId: string; exports: ResearchExportView[]; nextCursor: string | null }
export interface ResearchExportResponse { ok: true; requestId: string; researchExport: ResearchExportView }
export interface ResearchExportPageResponse {
  ok: true; requestId: string; exportId: string; total: number; items: PublicContent[]; nextCursor: string | null;
  manifest: ResearchExportManifest; scope: "frozen_members";
}
