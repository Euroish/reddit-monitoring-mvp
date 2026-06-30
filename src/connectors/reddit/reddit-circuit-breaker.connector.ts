import CircuitBreaker from "opossum";
import type { ConnectorPage, ConnectorRequestContext } from "../shared/connector.interface";
import type { RedditConnector } from "./reddit-connector.interface";
import type {
  RedditAboutPayload,
  RedditCollectPostCommentsArgs,
  RedditCollectSubredditAboutArgs,
  RedditCollectSubredditPostsArgs,
  RedditListingPayload,
  RedditPostCommentsPayload,
  RedditPostData,
} from "./reddit.types";

type BreakerOperation =
  | {
      type: "collect_subreddit_about";
      args: RedditCollectSubredditAboutArgs;
      ctx: ConnectorRequestContext;
    }
  | {
      type: "collect_subreddit_posts";
      args: RedditCollectSubredditPostsArgs;
      ctx: ConnectorRequestContext;
    }
  | {
      type: "collect_post_comments";
      args: RedditCollectPostCommentsArgs;
      ctx: ConnectorRequestContext;
    }
  | {
      type: "health_check";
      ctx: ConnectorRequestContext;
    };

type BreakerOperationResult =
  | ConnectorPage<RedditAboutPayload>
  | ConnectorPage<RedditListingPayload<RedditPostData>>
  | ConnectorPage<RedditPostCommentsPayload>
  | boolean;

export type ProviderCircuitState = "open" | "half_open" | "closed";

export interface RedditCircuitBreakerConnectorOptions {
  timeoutMs?: number;
  errorThresholdPercentage?: number;
  resetTimeoutMs?: number;
  volumeThreshold?: number;
  rollingCountTimeoutMs?: number;
  rollingCountBuckets?: number;
  routeToFallbackOnError?: boolean;
  fallbackConnector?: RedditConnector;
  name?: string;
  onStateChange?: (event: { state: ProviderCircuitState; atIso: string }) => void;
}

export class RedditCircuitBreakerConnector implements RedditConnector {
  public readonly sourceCode = "reddit" as const;

  private readonly breaker: CircuitBreaker<[BreakerOperation], BreakerOperationResult>;
  private readonly routeToFallbackOnError: boolean;
  private readonly fallbackConnector?: RedditConnector;
  private readonly onStateChange?: (event: { state: ProviderCircuitState; atIso: string }) => void;

  constructor(
    private readonly primaryConnector: RedditConnector,
    options: RedditCircuitBreakerConnectorOptions = {},
  ) {
    this.routeToFallbackOnError = options.routeToFallbackOnError ?? true;
    this.fallbackConnector = options.fallbackConnector;
    this.onStateChange = options.onStateChange;

    this.breaker = new CircuitBreaker<[BreakerOperation], BreakerOperationResult>(
      async (operation) => {
        switch (operation.type) {
          case "collect_subreddit_about":
            return this.primaryConnector.collectSubredditAbout(operation.args, operation.ctx);
          case "collect_subreddit_posts":
            return this.primaryConnector.collectSubredditPosts(operation.args, operation.ctx);
          case "collect_post_comments": {
            const collectPostComments = this.primaryConnector.collectPostComments;
            if (!collectPostComments) {
              throw new Error("Primary Reddit connector does not support comment collection");
            }
            return collectPostComments.call(
              this.primaryConnector,
              operation.args,
              operation.ctx,
            );
          }
          case "health_check":
            return this.primaryConnector.healthCheck(operation.ctx);
          default:
            throw new Error("unsupported breaker operation");
        }
      },
      {
        name: options.name ?? "reddit_live_provider",
        timeout: options.timeoutMs ?? 12_000,
        errorThresholdPercentage: options.errorThresholdPercentage ?? 50,
        resetTimeout: options.resetTimeoutMs ?? 15_000,
        volumeThreshold: options.volumeThreshold ?? 5,
        rollingCountTimeout: options.rollingCountTimeoutMs ?? 10_000,
        rollingCountBuckets: options.rollingCountBuckets ?? 10,
      },
    );

    this.breaker.on("open", () => {
      this.emitState("open");
    });
    this.breaker.on("halfOpen", () => {
      this.emitState("half_open");
    });
    this.breaker.on("close", () => {
      this.emitState("closed");
    });
  }

  public async collect(
    args: RedditCollectSubredditPostsArgs,
    ctx: ConnectorRequestContext,
  ): Promise<ConnectorPage<RedditListingPayload<RedditPostData>>> {
    return this.collectSubredditPosts(args, ctx);
  }

  public async collectSubredditAbout(
    args: RedditCollectSubredditAboutArgs,
    ctx: ConnectorRequestContext,
  ): Promise<ConnectorPage<RedditAboutPayload>> {
    return this.executeWithBreaker(
      {
        type: "collect_subreddit_about",
        args,
        ctx,
      },
      () =>
        this.fallbackConnector
          ? this.fallbackConnector.collectSubredditAbout(args, ctx)
          : Promise.resolve(undefined),
    );
  }

  public async collectSubredditPosts(
    args: RedditCollectSubredditPostsArgs,
    ctx: ConnectorRequestContext,
  ): Promise<ConnectorPage<RedditListingPayload<RedditPostData>>> {
    return this.executeWithBreaker(
      {
        type: "collect_subreddit_posts",
        args,
        ctx,
      },
      () =>
        this.fallbackConnector
          ? this.fallbackConnector.collectSubredditPosts(args, ctx)
          : Promise.resolve(undefined),
    );
  }

  public async collectPostComments(
    args: RedditCollectPostCommentsArgs,
    ctx: ConnectorRequestContext,
  ): Promise<ConnectorPage<RedditPostCommentsPayload>> {
    return this.executeWithBreaker(
      {
        type: "collect_post_comments",
        args,
        ctx,
      },
      () =>
        this.fallbackConnector?.collectPostComments
          ? this.fallbackConnector.collectPostComments(args, ctx)
          : Promise.resolve(undefined),
    );
  }

  public async healthCheck(ctx: ConnectorRequestContext): Promise<boolean> {
    if (this.breaker.opened && this.fallbackConnector) {
      return this.fallbackConnector.healthCheck(ctx);
    }

    try {
      const result = await this.executeWithBreaker(
        {
          type: "health_check",
          ctx,
        },
        () =>
          this.fallbackConnector
            ? this.fallbackConnector.healthCheck(ctx)
            : Promise.resolve(undefined),
      );
      return Boolean(result);
    } catch {
      return false;
    }
  }

  public getCircuitState(): ProviderCircuitState {
    if (this.breaker.opened) {
      return "open";
    }
    if (this.breaker.halfOpen) {
      return "half_open";
    }
    return "closed";
  }

  private async executeWithBreaker<T extends BreakerOperationResult>(
    operation: BreakerOperation,
    runFallback: () => Promise<T | undefined>,
  ): Promise<T> {
    try {
      return (await this.breaker.fire(operation)) as T;
    } catch (error) {
      if (this.fallbackConnector && this.routeToFallbackOnError) {
        const fallbackResult = await runFallback();
        if (fallbackResult !== undefined) {
          return this.annotateFallbackResult(fallbackResult, error);
        }
      }

      throw this.toCircuitError(error);
    }
  }

  private annotateFallbackResult<T extends BreakerOperationResult>(result: T, error: unknown): T {
    if (!this.isConnectorPage(result)) {
      return result;
    }
    const reason = this.isCircuitOpenLikeError(error) ? "circuit_open" : "provider_error";
    result.raw.responseHeaders["x-provider-fallback"] = "circuit_breaker";
    result.raw.responseHeaders["x-provider-fallback-reason"] = reason;
    return result;
  }

  private isConnectorPage(value: unknown): value is ConnectorPage {
    if (!value || typeof value !== "object") {
      return false;
    }
    const record = value as Record<string, unknown>;
    if (!record.raw || typeof record.raw !== "object") {
      return false;
    }
    const raw = record.raw as Record<string, unknown>;
    return typeof raw.endpoint === "string" && typeof raw.httpStatus === "number";
  }

  private isCircuitOpenLikeError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }
    const message = error.message.toLowerCase();
    return message.includes("breaker is open") || message.includes("open state");
  }

  private toCircuitError(error: unknown): Error {
    if (this.isCircuitOpenLikeError(error)) {
      return new Error("[provider.circuit_open] live provider circuit is open");
    }
    if (error instanceof Error) {
      return error;
    }
    return new Error("live provider request failed");
  }

  private emitState(state: ProviderCircuitState): void {
    if (!this.onStateChange) {
      return;
    }
    this.onStateChange({
      state,
      atIso: new Date().toISOString(),
    });
  }
}
