/**
 * Public cross-module facade for the content domain.
 * Other modules MUST import shared content primitives through this file only
 * (enforced by `.dependency-cruiser.cjs` `modules-public-api-only`).
 */
export { canonical } from "./batch";
export {
  heuristicV1Enricher,
  upgradeContentEnrichment,
  type ContentEnricher,
  type ContentEnrichmentUpgrade,
  type EnrichedContentFields,
} from "./enrich";
export { summarizeScopedContent } from "./facets";
export {
  loadContentDimensionsByIds,
  loadPlatformEngagementBaselines,
  loadFeedObservationHistory,
  loadTopCommentsForPosts,
  queryFeedCandidates,
  type ContentDimensionSummary,
  type FeedCandidateRow,
  type PlatformEngagementBaseline,
  type TopCommentPreview,
} from "./feed-queries";
export {
  queryAuthorDirectory,
  queryCommunityBreakdowns,
  queryCommunityMatrix,
  queryMonitorPosts,
  queryScopedBucketStats,
  queryScopedTextSamples,
  type AuthorDirectoryRow,
  type CommunityMatrixRow,
  type MonitorPostRow,
  type RawBucketStats,
} from "./intel-queries";
export {
  countDiscoveriesBySourceSince,
  findHydratableRedditPosts,
  findCommunityHydrationCandidates,
  findRefreshablePostsForSource,
  hasSourceDiscoveries,
  isContentVisibleToActor,
  listAiFirsthandArticles,
  listAiOfficialFeedUpdates,
  loadAnnotatedContentByIds,
  searchAiOfficialArticlesByTerm,
  type AiFirsthandArticleRow,
} from "./queries";
export { contentRoutes, contentRoutes as registerContentModule } from "./routes";
export {
  compileContentFilter,
  matchedAnchors,
  matchingNodes,
  type ContentScope,
  type ContentScopeResolver,
} from "./search";
export { commitContentBatch, prepareContentBatch } from "./sql";
