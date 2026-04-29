import {
  matchesNormalizedQueryV2,
  type NormalizedQueryV2,
} from "./query-normalization-v2.service";
import type { PostSearchDocumentRepository } from "../../domain/repositories/post-search-document-repository";

export interface NormalizedTargetKeywordQuery extends NormalizedQueryV2 {
  raw: string;
}

export async function resolveDriverKeywordMatches(args: {
  postSearchDocumentRepository?: PostSearchDocumentRepository;
  normalizedQueries: NormalizedTargetKeywordQuery[];
  canonicalName: string;
  fromIso: string;
  toIso: string;
  limit: number;
}): Promise<Map<string, string[]>> {
  const matchesByContentId = new Map<string, Set<string>>();
  if (args.normalizedQueries.length === 0) {
    return new Map();
  }
  if (!args.postSearchDocumentRepository) {
    throw new Error("post search document repository is required for keyword-scoped drivers");
  }

  const searchLimit = Math.max(args.limit, 200);
  for (const query of args.normalizedQueries) {
    const documents = await args.postSearchDocumentRepository.search({
      tokens: query.searchTokens,
      canonicalSubreddit: args.canonicalName,
      limit: searchLimit,
      createdAtFrom: args.fromIso,
      createdAtTo: args.toIso,
    });
    for (const document of documents) {
      const haystack = `${document.title} ${document.bodySnippet ?? ""}`;
      if (!matchesNormalizedQueryV2(haystack, query)) {
        continue;
      }
      const current = matchesByContentId.get(document.contentId) ?? new Set<string>();
      current.add(query.normalizedQueryText);
      matchesByContentId.set(document.contentId, current);
    }
  }

  return new Map(
    Array.from(matchesByContentId.entries()).map(([contentId, queryTexts]) => [
      contentId,
      Array.from(queryTexts).sort((a, b) => a.localeCompare(b)),
    ]),
  );
}
