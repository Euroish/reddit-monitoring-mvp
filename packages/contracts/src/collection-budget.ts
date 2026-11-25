export const providerBudgetBounds = {
  dailyRequests: { minimum: 0, maximum: 1_000_000 },
  monthlyRequests: { minimum: 0, maximum: 10_000_000 },
  dailyResources: { minimum: 0, maximum: 100_000_000 },
  monthlyResources: { minimum: 0, maximum: 1_000_000_000 },
  minimumIntervalMs: { minimum: 0, maximum: 3_600_000 },
} as const;

type CollectionOptions = { includeComments?: boolean; maxCommentsPerPost?: number };

export function requestedCommentLimit(provider: string, targetType: string, pageSize: number, request: CollectionOptions) {
  if (targetType === "post") {
    if (provider === "kaix") return Math.min(pageSize, request.maxCommentsPerPost ?? 50);
    if (provider === "red_crawler") return pageSize;
  }
  return request.includeComments ? request.maxCommentsPerPost ?? 15 : undefined;
}

export const KAIX_FANOUT_PAGE_SIZE = 250;
export const KAIX_FANOUT_COMMUNITIES = 5;
export const KAIX_COMMENT_POST_CAP = 50;
export const KAIX_COMMENT_BATCH_SIZE = 25;

export function kaixCollectionBudget(targetType: string, limit: number, request: CollectionOptions) {
  const fanoutPages = targetType === "search" && limit > KAIX_FANOUT_PAGE_SIZE ? KAIX_FANOUT_COMMUNITIES : 0;
  const hydratePosts = request.includeComments && (targetType === "search" || targetType === "community")
    ? Math.min(limit, KAIX_COMMENT_POST_CAP)
    : 0;
  const requests = 1 + fanoutPages + Math.ceil(hydratePosts / KAIX_COMMENT_BATCH_SIZE);
  const rows = limit + fanoutPages * KAIX_FANOUT_PAGE_SIZE + hydratePosts * (1 + (request.maxCommentsPerPost ?? 15));
  // Include sampled rows that local filters or deduplication may discard, and
  // charge the re-fetched roots even though hydration only commits comments.
  return { fanoutPages, hydratePosts, requests, personalResources: rows, systemResources: rows + requests };
}

export function viewerCollectionDemand(provider: string, targetType: string, limit: number, request: CollectionOptions, singleRun = false) {
  const staged = provider === "kaix" && !singleRun ? kaixCollectionBudget(targetType, limit, request) : undefined;
  const commentLimit = requestedCommentLimit(provider, targetType, limit, request);
  const resources = provider === "kaix" && commentLimit !== undefined
    ? (targetType === "post" ? commentLimit + 1 : limit * (commentLimit + 1))
    : limit;
  return { provider, limit, resources: staged && staged.requests > 1 ? staged.personalResources : resources,
    includeComments: commentLimit !== undefined, maxCommentsPerPost: commentLimit };
}

export function providerResourceReservation(input: CollectionOptions & {
  provider: string;
  targetType: string;
  pageSize: number;
  hydration?: boolean;
  refresh?: boolean;
  requestResourceUpperBound?: number;
}) {
  const { provider, targetType, pageSize } = input;
  if (input.refresh) return pageSize;
  if (provider === "kaix" && (input.hydration || targetType === "post")) {
    return 1 + Math.min(pageSize, input.maxCommentsPerPost ?? 50);
  }
  if (provider === "twitterapis" || provider === "scrapebadger") return input.requestResourceUpperBound ?? 20;
  return pageSize * (input.includeComments ? (input.maxCommentsPerPost ?? 15) + 1 : 1) + 1;
}
