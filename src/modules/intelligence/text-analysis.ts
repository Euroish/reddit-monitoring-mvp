/**
 * Re-exports shared bilingual NLP & sentiment primitives for the intelligence domain.
 * Keeps intelligence facades & existing tests intact with zero logic duplication.
 */
export {
  buildStemCanonicalMap,
  cleanTextForAnalysis,
  computeDistinctiveTermsForGroups,
  computeTermCooccurrence,
  detectBucketAnomalies,
  extractNgrams,
  extractTfIdfKeywords,
  formatDisplayTerm,
  normalizeEnglishInflection,
  segmentCjkRun,
  solveSparseNmf,
  stemEnglishToken,
  tokenizeClauses,
  tokenizeText,
  type CleanTokenOptions,
  type TermFrequencyItem,
} from "../../shared/text/analysis";
export { decodeHtmlEntities, stripHtmlToPlainText } from "../../shared/text/html";
export { scoreBilingualSentiment, SENTIMENT_ALGO_VERSION, splitContrastiveClauses } from "../../shared/text/sentiment";
