import { REDDIT_ARCHIVE_SOURCE_TAG } from '../../../../packages/contracts/src/source-content.js';
import type { CollectionSource, QuotasSummaryResponse, SourceCapability } from '../contracts/api.js';

export function isRedditArchiveSource(source: CollectionSource) {
  return source.platform === 'reddit' && source.deliveryMode === 'push' &&
    source.primaryProvider === 'external_ingest' && source.tags.includes(REDDIT_ARCHIVE_SOURCE_TAG);
}

export function isResearchSource(source: CollectionSource) {
  return source.platform !== 'web';
}

export function collectionLimits(
  source: CollectionSource | undefined,
  capability: SourceCapability | undefined,
  personal: QuotasSummaryResponse | undefined,
  isAdmin: boolean,
  withComments: boolean,
  requestedComments: number,
) {
  const policy = isAdmin ? undefined : personal?.effectivePolicy;
  const enabled = Boolean(source && capability?.enabled && capability.targetTypes.includes(source.target.type) &&
    capability.contentKinds.includes(source.contentKind) && (isAdmin ||
    (policy?.manualCollectEnabled && policy.allowedProviders.includes(capability.provider) &&
      (policy.allowedSourceIds === null || policy.allowedSourceIds.includes(source.id)))));
  const noRequests = policy?.dailyRequests != null && personal!.myUsage.requestsReserved >= policy.dailyRequests;
  const remaining = policy?.dailyResources == null ? Infinity :
    Math.max(0, policy.dailyResources - personal!.myUsage.resourcesReserved);
  const provider = capability?.provider;
  const isPost = source?.target.type === 'post';
  const maxComments = Math.min(50, policy?.maxCommentsPerPost ?? 50);
  const optionalComments = provider === 'kaix' && !isPost && maxComments > 0;
  const comments = optionalComments && withComments ? Math.min(requestedComments, maxComments) : undefined;
  const resourceFactor = comments === undefined ? 1 : 1 + comments;
  const providerLimit = provider === 'twitterapis' ? 20 : provider === 'kaix' ? 300 : 100;
  const commentLimit = isPost && (provider === 'kaix' || provider === 'red_crawler') ? maxComments : Infinity;
  const webLimit = source?.platform === 'web' ? source.fetchPolicy.maxItems ?? Infinity : Infinity;
  const resourceLimit = isPost && provider === 'kaix' ? Math.max(0, remaining - 1) : Math.floor(remaining / resourceFactor);
  return {
    maxLimit: enabled && !noRequests ? Math.min(
      providerLimit, policy?.maxBatchLimit ?? Infinity, commentLimit, webLimit, resourceLimit,
      provider === 'kaix' && !isPost ? Math.floor(2000 / resourceFactor) : Infinity,
    ) : 0,
    optionalComments,
    maxComments,
    comments,
  };
}
