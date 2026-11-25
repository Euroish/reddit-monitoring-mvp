import {
  KAIX_COMMENT_BATCH_SIZE,
  KAIX_FANOUT_COMMUNITIES,
  KAIX_FANOUT_PAGE_SIZE,
  kaixCollectionBudget,
  requestedCommentLimit,
} from "../../../packages/contracts/src/collection-budget";
import { ContentProviderError } from "../shared/content-provider.interface";

export const kaixCommunityName = /^[a-z0-9_]{2,21}$/;
const postId = /^t3_[a-z0-9]{2,32}$/;
type CommentCandidate = { id: string; count: number };
type Fanout = {
  phase: "fanout";
  subreddits: string[];
  subIndex: number;
  seenPostIds: string[];
  candidates: CommentCandidate[];
};
type Hydrate = { phase: "hydrate_comments"; postIds: string[]; missingComments: boolean };

function checkpointError(): never {
  throw new ContentProviderError("Invalid Kaix continuation checkpoint", false);
}

function uniqueStrings(value: unknown, pattern: RegExp, min: number, max: number): value is string[] {
  return Array.isArray(value) && value.length >= min && value.length <= max &&
    value.every((s) => typeof s === "string" && pattern.test(s)) && new Set(value).size === value.length;
}

function parseCheckpoint(value: unknown, fanoutPages: number, hydratePosts: number, limit: number): Fanout | Hydrate | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return checkpointError();
  const c = value as Record<string, unknown>;
  if (c.phase === "hydrate_comments" && Object.keys(c).length === 3 &&
      uniqueStrings(c.postIds, postId, 1, hydratePosts) && typeof c.missingComments === "boolean") {
    return { phase: c.phase, postIds: c.postIds, missingComments: c.missingComments };
  }
  if (c.phase === "fanout" && Object.keys(c).length === 5 &&
      uniqueStrings(c.subreddits, kaixCommunityName, 1, Math.min(fanoutPages, KAIX_FANOUT_COMMUNITIES)) &&
      typeof c.subIndex === "number" && Number.isInteger(c.subIndex) && c.subIndex >= 0 && c.subIndex < c.subreddits.length &&
      uniqueStrings(c.seenPostIds, postId, c.subreddits.length, limit - 1) &&
      Array.isArray(c.candidates) && c.candidates.length <= hydratePosts) {
    const seen = new Set(c.seenPostIds);
    const ids = new Set<string>();
    for (const candidate of c.candidates as CommentCandidate[]) {
      if (!candidate || typeof candidate !== "object" || Object.keys(candidate).length !== 2 ||
          !seen.has(candidate.id) || ids.has(candidate.id) || !Number.isInteger(candidate.count) || candidate.count <= 0) {
        return checkpointError();
      }
      ids.add(candidate.id);
    }
    return { phase: c.phase, subreddits: c.subreddits, subIndex: c.subIndex, seenPostIds: c.seenPostIds, candidates: c.candidates };
  }
  return checkpointError();
}

/** Resolve the same bounded paid input for both dispatch reservation and dataset reading. */
export function kaixPageScope(targetType: string, limit: number, request: {
  includeComments?: boolean; maxCommentsPerPost?: number; singleRun?: boolean;
}, checkpoint: unknown) {
  const { fanoutPages, hydratePosts } = request.singleRun
    ? { fanoutPages: 0, hydratePosts: 0 }
    : kaixCollectionBudget(targetType, limit, request);
  const stage = parseCheckpoint(checkpoint, fanoutPages, hydratePosts, limit);
  const thread = targetType === "post";
  const batchIds = stage?.phase === "hydrate_comments" ? stage.postIds.slice(0, KAIX_COMMENT_BATCH_SIZE) : [];
  const maxItems = stage?.phase === "fanout" ? Math.min(KAIX_FANOUT_PAGE_SIZE, limit - stage.seenPostIds.length) : limit;
  const comments = thread || batchIds.length > 0 || (Boolean(request.includeComments) && hydratePosts === 0);
  const commentLimit = requestedCommentLimit("kaix", targetType, limit, request) ?? request.maxCommentsPerPost ?? 15;
  if (!Number.isInteger(commentLimit) || commentLimit < 1 || commentLimit > 500) {
    throw new ContentProviderError("Kaix comments per post must be 1–500", false);
  }
  const maxRows = (thread ? 1 : batchIds.length || maxItems) * (comments ? 1 + commentLimit : 1);
  return { stage, batchIds, maxItems, comments, commentLimit, maxRows, fanoutPages, hydratePosts };
}
