import { REDDIT_ARCHIVE_SOURCE_TAG } from '../../../../packages/contracts/src/source-content.js';
import type { CollectionSource, QuotasSummaryResponse, ResearchPlanPreviewRequest, ResearchPlanPreviewResponse, SourceCapability } from '../contracts/api.js';

export type ManualTarget = {
  platform: NonNullable<ResearchPlanPreviewRequest['platform']>;
  targetType: NonNullable<ResearchPlanPreviewRequest['targetType']>;
  targetValue: string;
};

const ON_DEMAND_PROVIDER: Record<string, string> = {
  reddit: 'kaix',
  x: 'twitterapis',
  bluesky: 'bluesky_appview',
};

export function parseManualTargets(draft: ManualTarget): { targets: ManualTarget[]; valid: boolean } {
  const raw = draft.targetValue.trim();
  if (!raw) return { targets: [], valid: false };
  if (draft.targetType === 'search') {
    const valid = raw.length > 0 && raw.length <= 512;
    return { targets: valid ? [{ ...draft, targetValue: raw }] : [], valid };
  }
  const tokens = raw.split(/[\n,，]+/).map(part => part.trim()).filter(Boolean);
  if (!tokens.length || tokens.length > 20) return { targets: [], valid: false };
  const matcher = draft.targetType === 'community' ? /^(?:r\/)?[a-z0-9_]{1,100}$/i : /^@?[^\s/@]{1,253}$/;
  const seen = new Set<string>();
  const targets: ManualTarget[] = [];
  for (const token of tokens) {
    if (!matcher.test(token)) return { targets: [], valid: false };
    const norm = draft.targetType === 'community' ? token.replace(/^r\//i, '').toLowerCase() : token.replace(/^@/, '').toLowerCase();
    if (seen.has(norm)) continue;
    seen.add(norm);
    targets.push({ ...draft, targetValue: token });
  }
  return { targets, valid: targets.length > 0 };
}

export function getRangeLimits(result: ResearchPlanPreviewResponse, fallbackProvider?: string) {
  const target = result.matchedSource?.target.type ?? result.resolvedTarget?.type;
  const provider =
    fallbackProvider ??
    result.matchedSource?.provider ??
    (result.resolvedTarget?.platform ? ON_DEMAND_PROVIDER[result.resolvedTarget.platform] : undefined);
  return {
    maxDays: result.fieldPolicy.maxLookbackDays,
    maxItems: Math.min(
      result.fieldPolicy.maxBatchLimit,
      provider === 'twitterapis' || provider === 'scrapebadger' || provider === 'kaix'
        ? 10000
        : provider === 'red_crawler' && target === 'post'
          ? 50
          : 100,
    ),
    maxComments: provider === 'kaix' && target !== 'post' ? result.fieldPolicy.maxCommentsPerPost : 0,
  };
}

export function isRedditArchiveSource(source: CollectionSource) {
  return source.platform === 'reddit' && source.deliveryMode === 'push' &&
    source.primaryProvider === 'external_ingest' && source.tags.includes(REDDIT_ARCHIVE_SOURCE_TAG);
}

export function isResearchSource(source: CollectionSource) {
  return source.usageDomain ? source.usageDomain === 'research' : source.platform !== 'web';
}

export function sourceNeedsAttention(source: CollectionSource) {
  return source.automaticCollectionBlocked || (source.health.consecutiveFailures ?? 0) > 0 || Boolean(source.health.lastError);
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
  const maxComments = Math.min(500, policy?.maxCommentsPerPost ?? 500);
  const optionalComments = provider === 'kaix' && !isPost && maxComments > 0;
  const comments = optionalComments && withComments ? Math.min(requestedComments, maxComments) : undefined;
  const resourceFactor = comments === undefined ? 1 : 1 + comments;
  const providerLimit = provider === 'twitterapis' || provider === 'scrapebadger' || provider === 'kaix' ? 10000 : 100;
  const commentLimit = isPost && (provider === 'kaix' || provider === 'red_crawler') ? maxComments : Infinity;
  const webLimit = source?.platform === 'web' ? source.fetchPolicy.maxItems ?? Infinity : Infinity;
  const resourceLimit = isPost && provider === 'kaix' ? Math.max(0, remaining - 1) : Math.floor(remaining / resourceFactor);
  return {
    maxLimit: enabled && !noRequests ? Math.min(
      providerLimit, policy?.maxBatchLimit ?? Infinity, commentLimit, webLimit, resourceLimit,
    ) : 0,
    optionalComments,
    maxComments,
    comments,
  };
}
