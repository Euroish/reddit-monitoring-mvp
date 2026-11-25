/**
 * Re-exports shared bilingual NLP primitives for the intelligence domain.
 * Keeps intelligence facades & existing tests intact with zero logic duplication.
 */
export {
  cleanTextForAnalysis,
  computeDistinctiveTermsForGroups,
  computeTermCooccurrence,
  detectBucketAnomalies,
  extractNgrams,
  extractTfIdfKeywords,
  formatDisplayTerm,
  segmentCjkRun,
  solveSparseNmf,
  tokenizeClauses,
  tokenizeText,
  type CleanTokenOptions,
  type TermFrequencyItem,
} from "../../shared/text/analysis";
