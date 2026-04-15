import type { PostSearchDocument } from "../entities/post-search-document";

export interface PostSearchDocumentRepository {
  upsertMany(rows: PostSearchDocument[]): Promise<void>;
  seedFromContent(limit: number): Promise<number>;
  countByScope(args: { canonicalSubreddit?: string }): Promise<number>;
  search(args: {
    tokens: string[];
    canonicalSubreddit?: string;
    limit: number;
    createdAtFrom?: string;
    createdAtTo?: string;
  }): Promise<PostSearchDocument[]>;
}
