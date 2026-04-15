import type {
  ConnectorPage,
  ConnectorRequestContext,
} from "../shared/connector.interface";
import { RedditHttpConnector } from "./reddit-http.connector";
import type { RedditConnector } from "./reddit-connector.interface";
import type {
  RedditAboutPayload,
  RedditCollectSubredditAboutArgs,
  RedditCollectSubredditPostsArgs,
  RedditListingPayload,
  RedditPostData,
} from "./reddit.types";

export interface RedditApifyConnectorOptions {
  actorRunEndpoint?: string;
  token?: string;
  fallbackBaseUrl?: string;
  fallbackUserAgent?: string;
  fallbackAccessToken?: string;
  fallbackOnError?: boolean;
  compareWithHttp?: boolean;
  runWaitForFinishSeconds?: number;
  runPollAttempts?: number;
}

type ApifyFailureCode =
  | "auth_config_error"
  | "actor_invocation_error"
  | "dataset_empty"
  | "malformed_payload"
  | "provider_timeout"
  | "rate_limit";

interface ApifyRunRecord {
  id: string;
  status?: string;
  defaultDatasetId?: string;
  actId?: string;
}

interface ApifyApiErrorBody {
  error?: {
    type?: string;
    message?: string;
  };
  message?: string;
}

class ApifyConnectorError extends Error {
  constructor(
    public readonly code: ApifyFailureCode,
    message: string,
  ) {
    super(`[apify.${code}] ${message}`);
    this.name = "ApifyConnectorError";
  }
}

export class RedditApifyConnector implements RedditConnector {
  public readonly sourceCode = "reddit" as const;
  private readonly fallbackHttpConnector: RedditHttpConnector;
  private readonly fallbackOnError: boolean;
  private readonly compareWithHttp: boolean;
  private readonly runWaitForFinishSeconds: number;
  private readonly runPollAttempts: number;
  private readonly actorRunEndpoint?: string;
  private readonly token?: string;

  constructor(private readonly options: RedditApifyConnectorOptions = {}) {
    this.actorRunEndpoint = options.actorRunEndpoint;
    this.token = options.token;
    this.fallbackHttpConnector = new RedditHttpConnector({
      baseUrl: options.fallbackBaseUrl,
      userAgent: options.fallbackUserAgent,
      accessToken: options.fallbackAccessToken,
    });
    this.fallbackOnError = options.fallbackOnError ?? true;
    this.compareWithHttp = options.compareWithHttp ?? false;
    this.runWaitForFinishSeconds = Math.max(5, options.runWaitForFinishSeconds ?? 60);
    this.runPollAttempts = Math.max(1, options.runPollAttempts ?? 3);
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
    try {
      return await this.collectSubredditAboutViaApify(args, ctx);
    } catch (error) {
      if (this.fallbackOnError) {
        return this.fallbackHttpConnector.collectSubredditAbout(args, ctx);
      }
      throw this.toApifyError(error, "actor_invocation_error");
    }
  }

  public async collectSubredditPosts(
    args: RedditCollectSubredditPostsArgs,
    ctx: ConnectorRequestContext,
  ): Promise<ConnectorPage<RedditListingPayload<RedditPostData>>> {
    if (!this.compareWithHttp) {
      try {
        return await this.collectSubredditPostsViaApify(args, ctx);
      } catch (error) {
        if (this.fallbackOnError) {
          return this.fallbackHttpConnector.collectSubredditPosts(args, ctx);
        }
        throw this.toApifyError(error, "actor_invocation_error");
      }
    }

    const [apifyResult, httpResult] = await Promise.allSettled([
      this.collectSubredditPostsViaApify(args, ctx),
      this.fallbackHttpConnector.collectSubredditPosts(args, ctx),
    ]);

    if (apifyResult.status === "fulfilled") {
      const page = apifyResult.value;
      if (httpResult.status === "fulfilled") {
        const apifyCount = page.raw.payload.data.children.length;
        const httpCount = httpResult.value.raw.payload.data.children.length;
        page.raw.responseHeaders["x-compare-http-post-count"] = String(httpCount);
        page.raw.responseHeaders["x-compare-post-count-diff"] = String(apifyCount - httpCount);
      } else {
        page.raw.responseHeaders["x-compare-http-error"] = "true";
      }
      return page;
    }

    if (this.fallbackOnError && httpResult.status === "fulfilled") {
      httpResult.value.raw.responseHeaders["x-provider-fallback"] = "apify_to_http";
      return httpResult.value;
    }

    throw this.toApifyError(apifyResult.reason, "actor_invocation_error");
  }

  public async healthCheck(ctx: ConnectorRequestContext): Promise<boolean> {
    if (this.actorRunEndpoint) {
      return true;
    }
    return this.fallbackHttpConnector.healthCheck(ctx);
  }

  private async collectSubredditAboutViaApify(
    args: RedditCollectSubredditAboutArgs,
    _ctx: ConnectorRequestContext,
  ): Promise<ConnectorPage<RedditAboutPayload>> {
    const items = await this.runActorAndFetchItems({
      input: this.buildAboutInput(args),
      itemLimit: 10,
    });
    const payload = this.mapItemsToAboutPayload(args, items.rawItems);

    return {
      raw: {
        endpoint: `/apify/actor-runs/${items.run.id}/dataset/items`,
        requestParams: {
          provider: "apify",
          kind: "subreddit_about",
          subreddit: args.subreddit,
          actorRunId: items.run.id,
        },
        httpStatus: 200,
        responseHeaders: {
          "x-provider": "apify",
          "x-apify-run-id": items.run.id,
          "x-apify-run-status": items.run.status ?? "UNKNOWN",
          "x-apify-dataset-id": items.run.defaultDatasetId ?? "",
          "x-apify-item-count": String(items.rawItems.length),
        },
        payload,
        fetchedAt: new Date().toISOString(),
      },
    };
  }

  private async collectSubredditPostsViaApify(
    args: RedditCollectSubredditPostsArgs,
    _ctx: ConnectorRequestContext,
  ): Promise<ConnectorPage<RedditListingPayload<RedditPostData>>> {
    const items = await this.runActorAndFetchItems({
      input: this.buildPostsInput(args),
      itemLimit: args.limit,
    });
    const mapped = this.mapItemsToListingPayload(args, items.rawItems);
    if (mapped.children.length === 0) {
      throw new ApifyConnectorError(
        "malformed_payload",
        "Apify dataset did not contain mappable Reddit posts",
      );
    }

    return {
      raw: {
        endpoint: `/apify/actor-runs/${items.run.id}/dataset/items`,
        requestParams: {
          provider: "apify",
          kind: "subreddit_posts",
          subreddit: args.subreddit,
          limit: args.limit,
          actorRunId: items.run.id,
        },
        httpStatus: 200,
        responseHeaders: {
          "x-provider": "apify",
          "x-apify-run-id": items.run.id,
          "x-apify-run-status": items.run.status ?? "UNKNOWN",
          "x-apify-dataset-id": items.run.defaultDatasetId ?? "",
          "x-apify-item-count": String(items.rawItems.length),
          "x-apify-mapped-post-count": String(mapped.children.length),
          "x-apify-dropped-item-count": String(items.rawItems.length - mapped.children.length),
        },
        payload: {
          data: {
            after: undefined,
            children: mapped.children.map((post) => ({
              kind: "t3",
              data: post,
            })),
          },
        },
        fetchedAt: new Date().toISOString(),
      },
      nextCursor: undefined,
    };
  }

  private buildPostsInput(args: RedditCollectSubredditPostsArgs): Record<string, unknown> {
    return {
      startUrls: [{ url: `https://www.reddit.com/r/${args.subreddit}/` }],
      sortBy: "new",
      maxPosts: args.limit,
      maxComments: 0,
      scrapePosts: true,
      scrapeComments: false,
      scrapeUsers: false,
    };
  }

  private buildAboutInput(args: RedditCollectSubredditAboutArgs): Record<string, unknown> {
    return {
      startUrls: [{ url: `https://www.reddit.com/r/${args.subreddit}/` }],
      sortBy: "new",
      maxPosts: 1,
      maxComments: 0,
      scrapePosts: true,
      scrapeComments: false,
      scrapeUsers: false,
    };
  }

  private mapItemsToAboutPayload(
    args: RedditCollectSubredditAboutArgs,
    items: unknown[],
  ): RedditAboutPayload {
    const candidate = items.find((item) => {
      const subreddit = this.extractSubredditName(item);
      if (!subreddit) {
        return false;
      }
      return subreddit.toLowerCase() === args.subreddit.toLowerCase();
    });

    const subscribers = this.readNumberField(candidate, [
      "subscribers",
      "communitySubscribers",
      "members",
    ]);
    const activeUsers = this.readNumberField(candidate, [
      "accounts_active",
      "accountsActive",
      "activeUsers",
      "onlineUsers",
      "online",
    ]);

    return {
      data: {
        display_name: this.extractSubredditName(candidate) ?? args.subreddit,
        subscribers,
        accounts_active: activeUsers,
      },
    };
  }

  private mapItemsToListingPayload(
    args: RedditCollectSubredditPostsArgs,
    items: unknown[],
  ): { children: RedditPostData[] } {
    const children: RedditPostData[] = [];
    const fallbackCreatedUtc = Math.floor(Date.now() / 1000);

    for (const item of items) {
      const id = this.extractPostId(item);
      const permalink = this.extractPermalink(item);
      const title = this.readStringField(item, ["title", "postTitle", "headline"]);
      if (!id || !permalink || !title) {
        continue;
      }

      const name = `t3_${id}`;
      const createdUtc = this.readCreatedUtc(item) ?? fallbackCreatedUtc;
      const subreddit = this.extractSubredditName(item) ?? args.subreddit;
      const author = this.readStringField(item, ["author", "authorName", "username"]) ?? "[unknown]";

      children.push({
        name,
        id,
        subreddit,
        author,
        title,
        selftext: this.readStringField(item, ["selftext", "selfText", "body", "text"]),
        url: this.readStringField(item, ["url", "postUrl", "link"]),
        permalink,
        created_utc: createdUtc,
        score: this.readNumberField(item, ["score", "upvotes", "upVotes", "ups"]),
        num_comments: this.readNumberField(item, [
          "num_comments",
          "numComments",
          "commentsCount",
          "numberOfComments",
        ]),
        upvote_ratio: this.readNumberField(item, ["upvote_ratio", "upvoteRatio"]),
      });
    }

    return { children };
  }

  private async runActorAndFetchItems(args: {
    input: Record<string, unknown>;
    itemLimit: number;
  }): Promise<{ run: ApifyRunRecord; rawItems: unknown[] }> {
    const run = await this.startActorRun(args.input);
    const finishedRun = await this.waitForRunToFinish(run.id);
    const rawItems = await this.fetchDatasetItems(finishedRun.id, args.itemLimit);

    if (rawItems.length === 0) {
      throw new ApifyConnectorError("dataset_empty", "Apify dataset returned no items");
    }

    return {
      run: finishedRun,
      rawItems,
    };
  }

  private async startActorRun(input: Record<string, unknown>): Promise<ApifyRunRecord> {
    const endpoint = this.actorRunEndpoint?.trim();
    if (!endpoint) {
      throw new ApifyConnectorError(
        "auth_config_error",
        "APIFY_REDDIT_ACTOR_RUN_ENDPOINT is missing",
      );
    }

    const response = await this.requestApifyJson<{
      data?: ApifyRunRecord;
    }>(endpoint, {
      method: "POST",
      body: JSON.stringify(input),
    });

    if (!response.data?.id) {
      throw new ApifyConnectorError("malformed_payload", "Apify run response is missing run id");
    }
    return response.data;
  }

  private async waitForRunToFinish(runId: string): Promise<ApifyRunRecord> {
    const apiBase = this.resolveApiBaseUrl();
    const runUrl = new URL(`${apiBase}/actor-runs/${encodeURIComponent(runId)}`);
    runUrl.searchParams.set("waitForFinish", String(this.runWaitForFinishSeconds));

    for (let attempt = 0; attempt < this.runPollAttempts; attempt += 1) {
      const response = await this.requestApifyJson<{
        data?: ApifyRunRecord;
      }>(runUrl.toString(), {
        method: "GET",
      });

      const run = response.data;
      if (!run?.id) {
        throw new ApifyConnectorError("malformed_payload", "Apify run poll response is missing run id");
      }
      const status = run.status?.toUpperCase();
      if (status === "SUCCEEDED") {
        return run;
      }
      if (status === "FAILED" || status === "ABORTED" || status === "TIMED-OUT") {
        throw new ApifyConnectorError(
          "actor_invocation_error",
          `Apify actor run finished with status=${status}`,
        );
      }
    }

    throw new ApifyConnectorError(
      "provider_timeout",
      `Apify actor run did not finish after ${this.runPollAttempts} poll attempts`,
    );
  }

  private async fetchDatasetItems(runId: string, limit: number): Promise<unknown[]> {
    const apiBase = this.resolveApiBaseUrl();
    const datasetUrl = new URL(
      `${apiBase}/actor-runs/${encodeURIComponent(runId)}/dataset/items`,
    );
    datasetUrl.searchParams.set("format", "json");
    datasetUrl.searchParams.set("clean", "true");
    datasetUrl.searchParams.set("limit", String(limit));

    const response = await this.requestApifyJson<unknown>(datasetUrl.toString(), {
      method: "GET",
    });
    if (!Array.isArray(response)) {
      throw new ApifyConnectorError("malformed_payload", "Apify dataset items response is not an array");
    }
    return response;
  }

  private resolveApiBaseUrl(): string {
    const endpoint = this.actorRunEndpoint?.trim();
    if (!endpoint) {
      throw new ApifyConnectorError(
        "auth_config_error",
        "APIFY_REDDIT_ACTOR_RUN_ENDPOINT is missing",
      );
    }

    let parsed: URL;
    try {
      parsed = new URL(endpoint);
    } catch {
      throw new ApifyConnectorError(
        "auth_config_error",
        "APIFY_REDDIT_ACTOR_RUN_ENDPOINT is not a valid URL",
      );
    }
    return `${parsed.origin}/v2`;
  }

  private async requestApifyJson<T>(
    url: string,
    init: {
      method: "GET" | "POST";
      body?: string;
    },
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: init.method,
        headers: this.buildApifyHeaders(init.body !== undefined),
        body: init.body,
      });
    } catch (error) {
      throw this.toApifyError(error, "provider_timeout");
    }

    if (!response.ok) {
      const errorPayload = await this.safeReadJson<ApifyApiErrorBody>(response);
      throw this.classifyApifyHttpError(response.status, errorPayload);
    }

    const payload = await this.safeReadJson<T>(response);
    if (payload === undefined) {
      throw new ApifyConnectorError("malformed_payload", "Apify API returned empty response body");
    }
    return payload;
  }

  private buildApifyHeaders(withJsonBody: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (withJsonBody) {
      headers["Content-Type"] = "application/json";
    }
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    return headers;
  }

  private async safeReadJson<T>(response: Response): Promise<T | undefined> {
    const text = await response.text();
    if (!text.trim()) {
      return undefined;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ApifyConnectorError("malformed_payload", "Apify API returned invalid JSON");
    }
  }

  private classifyApifyHttpError(status: number, payload: ApifyApiErrorBody | undefined): ApifyConnectorError {
    const type = payload?.error?.type?.toLowerCase();
    const rawMessage = payload?.error?.message || payload?.message || `status=${status}`;
    const message = rawMessage.trim();

    if (status === 401 || status === 403 || type === "token-not-valid" || type === "permission-denied") {
      return new ApifyConnectorError("auth_config_error", message);
    }
    if (status === 429 || type === "rate-limit-exceeded") {
      return new ApifyConnectorError("rate_limit", message);
    }
    if (status === 408 || status === 504 || type === "run-timeout-exceeded") {
      return new ApifyConnectorError("provider_timeout", message);
    }
    return new ApifyConnectorError("actor_invocation_error", message);
  }

  private toApifyError(error: unknown, fallbackCode: ApifyFailureCode): ApifyConnectorError {
    if (error instanceof ApifyConnectorError) {
      return error;
    }
    if (error instanceof Error) {
      return new ApifyConnectorError(fallbackCode, error.message);
    }
    return new ApifyConnectorError(fallbackCode, "unknown Apify connector error");
  }

  private readStringField(
    value: unknown,
    keys: string[],
  ): string | undefined {
    const record = this.asRecord(value);
    if (!record) {
      return undefined;
    }
    for (const key of keys) {
      const raw = record[key];
      if (typeof raw === "string" && raw.trim().length > 0) {
        return raw.trim();
      }
    }
    return undefined;
  }

  private readNumberField(value: unknown, keys: string[]): number | undefined {
    const record = this.asRecord(value);
    if (!record) {
      return undefined;
    }
    for (const key of keys) {
      const raw = record[key];
      if (typeof raw === "number" && Number.isFinite(raw)) {
        return raw;
      }
      if (typeof raw === "string" && raw.trim()) {
        const parsed = Number(raw);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }
    return undefined;
  }

  private readCreatedUtc(value: unknown): number | undefined {
    const asNumber = this.readNumberField(value, ["created_utc", "createdUtc", "createdAtTs"]);
    if (typeof asNumber === "number") {
      return asNumber > 10_000_000_000 ? Math.floor(asNumber / 1000) : Math.floor(asNumber);
    }

    const createdAt = this.readStringField(value, ["createdAt", "created", "date"]);
    if (!createdAt) {
      return undefined;
    }
    const ts = Date.parse(createdAt);
    if (Number.isNaN(ts)) {
      return undefined;
    }
    return Math.floor(ts / 1000);
  }

  private extractPostId(value: unknown): string | undefined {
    const direct = this.readStringField(value, [
      "id",
      "postId",
      "post_id",
      "redditId",
      "name",
      "thingId",
    ]);
    if (direct) {
      return direct.replace(/^t3_/, "");
    }

    const permalink = this.extractPermalink(value);
    const fromPermalink = this.extractPostIdFromPath(permalink);
    if (fromPermalink) {
      return fromPermalink;
    }

    const url = this.readStringField(value, ["url", "postUrl", "link"]);
    if (!url) {
      return undefined;
    }
    try {
      const parsed = new URL(url);
      return this.extractPostIdFromPath(parsed.pathname);
    } catch {
      return undefined;
    }
  }

  private extractPermalink(value: unknown): string | undefined {
    const direct = this.readStringField(value, ["permalink"]);
    if (direct) {
      return direct;
    }
    const fullUrl = this.readStringField(value, ["url", "postUrl", "link"]);
    if (!fullUrl) {
      return undefined;
    }
    try {
      const parsed = new URL(fullUrl);
      return parsed.pathname;
    } catch {
      return undefined;
    }
  }

  private extractPostIdFromPath(path: string | undefined): string | undefined {
    if (!path) {
      return undefined;
    }
    const match = path.match(/\/comments\/([a-z0-9]+)\//i);
    return match?.[1];
  }

  private extractSubredditName(value: unknown): string | undefined {
    const raw = this.readStringField(value, ["subreddit", "communityName", "subredditName", "name"]);
    if (!raw) {
      return undefined;
    }
    return raw.replace(/^r\//i, "");
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object") {
      return null;
    }
    return value as Record<string, unknown>;
  }
}
