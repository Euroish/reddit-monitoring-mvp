import { spawn } from "node:child_process";
import path from "node:path";
import type {
  ConnectorPage,
  ConnectorRequestContext,
  RawEnvelope,
} from "../shared/connector.interface";
import type { RedditConnector } from "./reddit-connector.interface";
import type {
  RedditAboutPayload,
  RedditCollectSubredditAboutArgs,
  RedditCollectSubredditPostsArgs,
  RedditListingPayload,
  RedditPostData,
} from "./reddit.types";

export type RedditScraplingProfile = "http" | "dynamic" | "stealth";

interface RedditScraplingBridgeRequest {
  requestId: string;
  url: string;
  profile: RedditScraplingProfile;
  sessionKey?: string;
  timeoutMs: number;
  headers: Record<string, string>;
}

interface RedditScraplingBridgeResult {
  ok: boolean;
  status?: number;
  headers?: Record<string, string>;
  bodyText?: string;
  json?: unknown;
  fetchedAt?: string;
  errorCode?: string;
  errorMessage?: string;
}

interface RedditScraplingConnectorOptions {
  baseUrl?: string;
  userAgent?: string;
  accessToken?: string;
  timeoutMs?: number;
  healthcheckSubreddit?: string;
  maxRetries?: number;
  backoffBaseMs?: number;
  backoffCapMs?: number;
  jitterRatio?: number;
  rateLimitRemainingFloor?: number;
  profile?: RedditScraplingProfile;
  pythonExecutable?: string;
  bridgeScriptPath?: string;
  bridgeRunner?: (
    args: RedditScraplingBridgeRequest,
  ) => Promise<RedditScraplingBridgeResult>;
}

export class RedditScraplingConnector implements RedditConnector {
  public readonly sourceCode = "reddit" as const;
  private static readonly seenSessionKeys = new Set<string>();

  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly accessToken?: string;
  private readonly timeoutMs: number;
  private readonly healthcheckSubreddit: string;
  private readonly maxRetries: number;
  private readonly backoffBaseMs: number;
  private readonly backoffCapMs: number;
  private readonly jitterRatio: number;
  private readonly rateLimitRemainingFloor: number;
  private readonly profile: RedditScraplingProfile;
  private readonly pythonExecutable: string;
  private readonly bridgeScriptPath: string;
  private readonly bridgeRunner: (
    args: RedditScraplingBridgeRequest,
  ) => Promise<RedditScraplingBridgeResult>;

  constructor(options: RedditScraplingConnectorOptions = {}) {
    this.accessToken = options.accessToken;
    this.baseUrl = options.baseUrl ?? (this.accessToken ? "https://oauth.reddit.com" : "https://www.reddit.com");
    if (this.baseUrl.includes("oauth.reddit.com") && !this.accessToken) {
      throw new Error("OAuth base URL requires accessToken");
    }

    this.userAgent = options.userAgent ?? "reddit-monitoring-mvp/0.1";
    this.timeoutMs = options.timeoutMs ?? 12000;
    this.healthcheckSubreddit = options.healthcheckSubreddit ?? "news";
    this.maxRetries = options.maxRetries ?? 2;
    this.backoffBaseMs = options.backoffBaseMs ?? 500;
    this.backoffCapMs = options.backoffCapMs ?? 10000;
    this.jitterRatio = options.jitterRatio ?? 0.2;
    this.rateLimitRemainingFloor = options.rateLimitRemainingFloor ?? 1;
    this.profile = options.profile ?? "http";
    this.pythonExecutable = options.pythonExecutable ?? "python";
    this.bridgeScriptPath = options.bridgeScriptPath
      ? path.resolve(options.bridgeScriptPath)
      : path.resolve(process.cwd(), "scripts", "scrapling_reddit_bridge.py");
    this.bridgeRunner =
      options.bridgeRunner ??
      ((args) =>
        this.runBridgeRequest({
          ...args,
          timeoutMs: this.timeoutMs,
        }));
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
    const pathValue = `/r/${encodeURIComponent(args.subreddit)}/about.json`;
    return this.requestJson<RedditAboutPayload>(pathValue, {}, ctx);
  }

  public async collectSubredditPosts(
    args: RedditCollectSubredditPostsArgs,
    ctx: ConnectorRequestContext,
  ): Promise<ConnectorPage<RedditListingPayload<RedditPostData>>> {
    const pathValue = `/r/${encodeURIComponent(args.subreddit)}/new.json`;
    const params: Record<string, string | number | boolean | undefined> = {
      limit: args.limit,
      after: args.after,
    };

    const page = await this.requestJson<RedditListingPayload<RedditPostData>>(
      pathValue,
      params,
      ctx,
    );
    return {
      ...page,
      nextCursor: page.raw.payload.data.after,
    };
  }

  public async healthCheck(ctx: ConnectorRequestContext): Promise<boolean> {
    try {
      const result = await this.collectSubredditAbout(
        { subreddit: this.healthcheckSubreddit },
        ctx,
      );
      return result.raw.httpStatus >= 200 && result.raw.httpStatus < 300;
    } catch {
      return false;
    }
  }

  private async requestJson<TPayload>(
    pathValue: string,
    params: Record<string, string | number | boolean | undefined>,
    ctx: ConnectorRequestContext,
  ): Promise<ConnectorPage<TPayload>> {
    const url = this.buildUrl(pathValue, params);
    const sessionKey = this.buildSessionKey(pathValue);
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const bridgeResult = await this.bridgeRunner({
          requestId: ctx.requestId,
          url: url.toString(),
          profile: this.profile,
          sessionKey,
          timeoutMs: this.timeoutMs,
          headers: this.buildHeaders(ctx),
        });
        const headers = new Headers(
          this.normalizeHeaderRecord(bridgeResult.headers ?? {}),
        );
        if (!headers.has("x-provider")) {
          headers.set("x-provider", "scrapling");
        }
        this.annotateScraplingSessionHeaders(headers, sessionKey);
        const status = bridgeResult.status;
        if (typeof status === "number" && status >= 200 && status < 300) {
          const payload = this.extractPayload<TPayload>(bridgeResult);
          const raw: RawEnvelope<TPayload> = {
            endpoint: pathValue,
            requestParams: params,
            httpStatus: status,
            responseHeaders: this.headersToRecord(headers),
            payload,
            fetchedAt: bridgeResult.fetchedAt ?? new Date().toISOString(),
          };
          return {
            raw,
            rateLimit: this.readRateLimit(headers),
          };
        }

        if (
          typeof status === "number" &&
          this.shouldRetryStatus(status) &&
          attempt < this.maxRetries
        ) {
          await this.sleep(
            this.computeDelayMs({
              attempt,
              retryAfterMs: this.readRetryAfterMs(headers),
              rateLimit: this.readRateLimit(headers),
            }),
          );
          continue;
        }

        const errorCode = bridgeResult.errorCode ?? "scrapling_bridge_error";
        throw new Error(
          `Scrapling request failed: code=${errorCode}, status=${
            status ?? "n/a"
          }, endpoint=${pathValue}, message=${bridgeResult.errorMessage ?? "unknown"}`,
        );
      } catch (error) {
        lastError = error;
        if (attempt < this.maxRetries && this.shouldRetryError(error)) {
          await this.sleep(this.computeDelayMs({ attempt }));
          continue;
        }
        throw error;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Scrapling Reddit request failed unexpectedly");
  }

  private extractPayload<TPayload>(result: RedditScraplingBridgeResult): TPayload {
    if (result.json && typeof result.json === "object") {
      return result.json as TPayload;
    }
    if (typeof result.bodyText === "string" && result.bodyText.length > 0) {
      return JSON.parse(result.bodyText) as TPayload;
    }
    throw new Error("Scrapling response payload is missing");
  }

  private buildUrl(
    pathValue: string,
    params: Record<string, string | number | boolean | undefined>,
  ): URL {
    const url = new URL(pathValue, this.baseUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
    return url;
  }

  private buildHeaders(ctx: ConnectorRequestContext): Record<string, string> {
    const headers: Record<string, string> = {
      "User-Agent": this.userAgent,
      Accept: "application/json",
      "X-Request-Id": ctx.requestId,
    };

    if (this.accessToken) {
      headers.Authorization = `Bearer ${this.accessToken}`;
    }

    return headers;
  }

  private buildSessionKey(pathValue: string): string {
    const normalizedPath = pathValue.trim().toLowerCase();
    return `reddit:${this.profile}:${normalizedPath}`;
  }

  private annotateScraplingSessionHeaders(headers: Headers, sessionKey: string): void {
    if (!headers.has("x-scrapling-profile")) {
      headers.set("x-scrapling-profile", this.profile);
    }
    if (!headers.has("x-scrapling-session-key")) {
      headers.set("x-scrapling-session-key", sessionKey);
    }
    const normalizedSessionKey = headers.get("x-scrapling-session-key") ?? sessionKey;
    const reused = RedditScraplingConnector.seenSessionKeys.has(normalizedSessionKey);
    headers.set("x-scrapling-session-key-reused", reused ? "1" : "0");
    RedditScraplingConnector.seenSessionKeys.add(normalizedSessionKey);
  }

  private headersToRecord(headers: Headers): Record<string, string> {
    const output: Record<string, string> = {};
    headers.forEach((value, key) => {
      output[key] = value;
    });
    return output;
  }

  private normalizeHeaderRecord(
    headers: Record<string, string>,
  ): Record<string, string> {
    const output: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      const normalizedKey = key.toLowerCase();
      // set-cookie often carries multiline values from the bridge and is not
      // needed for provider-health telemetry.
      if (normalizedKey === "set-cookie") {
        continue;
      }
      const sanitizedValue = this.sanitizeHeaderValue(value);
      if (sanitizedValue == null) {
        continue;
      }
      output[normalizedKey] = sanitizedValue;
    }
    return output;
  }

  private sanitizeHeaderValue(value: string): string | null {
    if (typeof value !== "string") {
      return null;
    }
    if (value.includes("\r") || value.includes("\n")) {
      return null;
    }
    return value;
  }

  private readRateLimit(headers: Headers) {
    const remainingRaw = headers.get("x-ratelimit-remaining");
    const resetRaw = headers.get("x-ratelimit-reset");
    const usedRaw = headers.get("x-ratelimit-used");
    const remaining = remainingRaw ? Number(remainingRaw) : undefined;
    const resetSeconds = resetRaw ? Number(resetRaw) : undefined;
    const used = usedRaw ? Number(usedRaw) : undefined;
    const limit =
      Number.isFinite(remaining) && Number.isFinite(used)
        ? (remaining as number) + (used as number)
        : undefined;

    return {
      limit: Number.isFinite(limit) ? limit : undefined,
      remaining: Number.isFinite(remaining) ? remaining : undefined,
      resetAt:
        Number.isFinite(resetSeconds) && resetSeconds !== undefined
          ? new Date(Date.now() + resetSeconds * 1000).toISOString()
          : undefined,
    };
  }

  private shouldRetryStatus(status: number): boolean {
    return (
      status === 408 ||
      status === 429 ||
      status === 500 ||
      status === 502 ||
      status === 503 ||
      status === 504
    );
  }

  private shouldRetryError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }
    const message = error.message.toLowerCase();
    return (
      message.includes("timed out") ||
      message.includes("timeout") ||
      message.includes("econnreset") ||
      message.includes("etimedout") ||
      message.includes("temporary")
    );
  }

  private readRetryAfterMs(headers: Headers): number | undefined {
    const raw = headers.get("retry-after");
    if (!raw) {
      return undefined;
    }

    const seconds = Number(raw);
    if (Number.isFinite(seconds)) {
      return Math.max(0, Math.floor(seconds * 1000));
    }

    const at = Date.parse(raw);
    if (Number.isNaN(at)) {
      return undefined;
    }
    return Math.max(0, at - Date.now());
  }

  private computeDelayMs(args: {
    attempt: number;
    retryAfterMs?: number;
    rateLimit?: { remaining?: number; resetAt?: string };
  }): number {
    let delayMs: number;

    if (typeof args.retryAfterMs === "number") {
      delayMs = args.retryAfterMs;
    } else if (
      typeof args.rateLimit?.remaining === "number" &&
      args.rateLimit.remaining <= this.rateLimitRemainingFloor &&
      args.rateLimit.resetAt
    ) {
      delayMs = Math.max(0, Date.parse(args.rateLimit.resetAt) - Date.now());
    } else {
      delayMs = Math.min(this.backoffCapMs, this.backoffBaseMs * 2 ** args.attempt);
    }

    const jitter = delayMs * this.jitterRatio;
    const randomized = delayMs + (Math.random() * 2 - 1) * jitter;
    return Math.max(0, Math.round(randomized));
  }

  private async sleep(ms: number): Promise<void> {
    if (ms <= 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async runBridgeRequest(
    args: RedditScraplingBridgeRequest,
  ): Promise<RedditScraplingBridgeResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.pythonExecutable, [this.bridgeScriptPath], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });

      let stdout = "";
      let stderr = "";
      let settled = false;

      const finishResolve = (value: RedditScraplingBridgeResult) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve(value);
      };

      const finishReject = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        reject(error);
      };

      const timeout = setTimeout(() => {
        child.kill();
        finishReject(
          new Error(
            `Scrapling bridge timed out after ${args.timeoutMs}ms`,
          ),
        );
      }, args.timeoutMs + 1000);

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("error", (error) => {
        finishReject(
          new Error(`Failed to execute Scrapling bridge: ${error.message}`),
        );
      });
      child.on("close", (code) => {
        if (settled) {
          return;
        }
        if (stdout.trim().length === 0) {
          finishReject(
            new Error(
              `Scrapling bridge exited with no output (code=${code ?? "n/a"}): ${stderr.trim()}`,
            ),
          );
          return;
        }

        try {
          const parsed = JSON.parse(stdout.trim()) as RedditScraplingBridgeResult;
          finishResolve(parsed);
        } catch (error) {
          finishReject(
            new Error(
              `Scrapling bridge returned invalid JSON: ${
                error instanceof Error ? error.message : String(error)
              }`,
            ),
          );
        }
      });

      child.stdin.write(JSON.stringify(args));
      child.stdin.end();
    });
  }
}
