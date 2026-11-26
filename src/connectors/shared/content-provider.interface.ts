import type { CollectionSource, SourceCapability, SourceTarget } from "../../../packages/contracts/src/collection";
import type { ContentObservation, PublicContent } from "../../../packages/contracts/src/content";
import type { JsonValue, PublicContentKind } from "../../../packages/contracts/src/common";

export interface CollectedContent extends Omit<
  PublicContent,
  "firstFetchedAt" | "lastFetchedAt" | "observations" | "textState"
> {
  fetchedAt: string;
  observation: ContentObservation;
}
export interface CollectedPage {
  items: CollectedContent[];
  nextCheckpoint: JsonValue | null;
  /** The next page only enriches items already counted against the target limit. */
  continueAfterLimit?: boolean;
  exhausted: boolean;
  coverage: "unknown" | "partial";
  warning: string | null;
  pending?: boolean;
  creditsUsed?: number;
  notModified?: boolean;
  discoveredFeeds?: string[];
  httpEtag?: string | null;
  httpLastModified?: string | null;
  truncated?: boolean;
}
export interface CollectContentPageRequest {
  source: CollectionSource;
  from: string;
  to: string;
  limit: number;
  checkpoint: JsonValue | null;
  httpEtag?: string | null;
  httpLastModified?: string | null;
  execution?: {
    state: JsonValue;
    saveState: (state: JsonValue) => Promise<void>;
  };
  signal?: AbortSignal;
  preview?: boolean;
  /** Preserve the input of jobs admitted as single runs, including already-paid runs. */
  singleRun?: boolean;
  includeComments?: boolean;
  maxCommentsPerPost?: number;
  commentSort?: "top";
}
export interface ContentProvider {
  readonly capability: SourceCapability;
  normalizeTarget(target: SourceTarget, kind: PublicContentKind): SourceTarget;
  collectPage(request: CollectContentPageRequest): Promise<CollectedPage>;
  /** A bounded lookup of existing IDs, independent of time/search pagination. */
  refreshIds?(request: {
    source: CollectionSource;
    externalIds: string[];
    signal?: AbortSignal;
  }): Promise<CollectedPage>;
}
export class ContentProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly retryAfterSeconds = 30,
    public readonly httpStatus?: number,
    public readonly startOutcome?: {
      /** Only an explicit upstream capacity rejection permits a paid start retry. */
      confirmedPreStartRejection?: boolean;
      /** False only for an explicitly recognized rejection, not for HTTP status alone. */
      outcomeUnknown?: boolean;
    },
  ) {
    super(message);
  }
}
