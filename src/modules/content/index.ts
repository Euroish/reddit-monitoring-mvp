/**
 * Public cross-module facade for the content domain.
 * Other modules MUST import shared content primitives through this file only
 * (enforced by `.dependency-cruiser.cjs` `modules-public-api-only`).
 */
export { canonical } from "./batch";
export { summarizeScopedContent } from "./facets";
export {
  countDiscoveriesBySourceSince,
  findHydratableRedditPosts,
  findRefreshablePostsForSource,
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
