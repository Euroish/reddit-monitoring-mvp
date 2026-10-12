import type { PostSearchDocument } from "../entities/post-search-document";

export interface SummarizePostSearchInput {
  tokens: string[];
  negativeTokens?: string[];
  canonicalSubreddit?: string;
  createdAtFrom?: string;
  createdAtTo?: string;
  sampleLimit: number;
}

export interface PostSearchSummary {
  totalScopeDocs: number;
  candidateCount: number;
  supportCount: number;
  qualifiedCount: number;
  documents: PostSearchDocument[];
}

export interface PostSearchDocumentRepository {
  upsertMany(rows: PostSearchDocument[]): Promise<void>;
  seedFromContent(limit: number): Promise<number>;
  countByScope(args: { canonicalSubreddit?: string }): Promise<number>;
  /** Counts the entire matching stored scope; sampleLimit only limits returned documents. */
  summarizeSearch(args: SummarizePostSearchInput): Promise<PostSearchSummary>;
  search(args: {
    tokens: string[];
    canonicalSubreddit?: string;
    limit: number;
    createdAtFrom?: string;
    createdAtTo?: string;
  }): Promise<PostSearchDocument[]>;
}
