import type {
  CollectionSource,
  ContentObservation,
  JsonValue,
  PublicContent,
  PublicContentKind,
  SourceCapability,
  SourceTarget,
} from "../../../packages/contracts/src/source-content";

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
  exhausted: boolean;
  coverage: "unknown" | "partial";
  warning: string | null;
  pending?: boolean;
  creditsUsed?: number;
  notModified?: boolean;
}
export interface CollectContentPageRequest {
  source: CollectionSource;
  from: string;
  to: string;
  limit: number;
  checkpoint: JsonValue | null;
  execution?: {
    state: JsonValue;
    saveState: (state: JsonValue) => Promise<void>;
  };
  signal?: AbortSignal;
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
  ) {
    super(message);
  }
}
