import { createHash } from "node:crypto";
import type { ContentQuery, PublicContentSearchCoverage } from "../../packages/contracts/src/source-content";

export const PUBLIC_SEARCH_FORMAT_VERSION = 1 as const;

export interface PublicSearchDocument {
  formatVersion: 1;
  normalizedTitle: string;
  normalizedText: string;
  textPresent: boolean;
  fingerprint: string;
  indexedAt: string;
}

/** Retain emoji and punctuation; normalize only Unicode compatibility, case and whitespace. */
export function normalizePublicSearchText(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

export function publicSearchDocument(title: string | null, text: string | null, indexedAt: string): PublicSearchDocument {
  return {
    formatVersion: 1,
    normalizedTitle: normalizePublicSearchText(title ?? ""),
    normalizedText: normalizePublicSearchText(text ?? ""),
    textPresent: text !== null,
    fingerprint: createHash("sha256").update(JSON.stringify([1, title, text])).digest("hex"),
    indexedAt,
  };
}

export function hasPublicSearch(query: ContentQuery) {
  return Boolean(query.query || query.exclusions?.length);
}

export function publicSearchTerms(query: ContentQuery) {
  const value = normalizePublicSearchText(query.query ?? "");
  return value ? (query.searchMode === "terms" ? value.split(" ") : [value]) : [];
}

export function matchesPublicSearch(document: PublicSearchDocument, query: ContentQuery) {
  const text = query.searchScope === "title" ? document.normalizedTitle
    : query.searchScope === "text" ? document.normalizedText
    : `${document.normalizedTitle} ${document.normalizedText}`;
  return publicSearchTerms(query).every(term => text.includes(term))
    && (query.exclusions ?? []).every(exclusion => !text.includes(normalizePublicSearchText(exclusion)));
}

export function searchCoverage(candidateCount: number, documents: PublicSearchDocument[]): PublicContentSearchCoverage {
  const indexed = documents.length;
  const textPresent = documents.filter(item => item.textPresent).length;
  return {
    formatVersion: 1,
    candidateCount,
    indexed,
    unindexed: candidateCount - indexed,
    textPresent,
    textMissing: indexed - textPresent,
    state: indexed === candidateCount ? "complete" : "partial",
    textBasis: "stored_title_text",
  };
}
