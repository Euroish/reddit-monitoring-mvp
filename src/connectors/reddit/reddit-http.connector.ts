import { execFile } from "node:child_process";
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

export type RedditHttpTransport = "fetch" | "powershell" | "auto";

interface PowerShellRequestResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

type ProxyRequestResult = PowerShellRequestResult;

interface RedditHttpConnectorOptions {
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
  transport?: RedditHttpTransport;
  platform?: NodeJS.Platform;
  powershellExecutable?: string;
  powershellRunner?: (args: {
    url: string;
    headers: Record<string, string>;
    timeoutMs: number;
  }) => Promise<PowerShellRequestResult>;
  proxyUrl?: string;
  proxyFailoverCommand?: string;
  curlExecutable?: string;
  proxyFailoverRunner?: (args: {
    command: string;
    endpoint: string;
    reason: string;
  }) => Promise<void>;
  proxyRunner?: (args: {
    url: string;
    headers: Record<string, string>;
    timeoutMs: number;
    proxyUrl: string;
  }) => Promise<ProxyRequestResult>;
}

export class RedditHttpConnector implements RedditConnector {
  public readonly sourceCode = "reddit" as const;

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
  private readonly transport: RedditHttpTransport;
  private readonly platform: NodeJS.Platform;
  private readonly powershellExecutable: string;
  private readonly powershellRunner: (args: {
    url: string;
    headers: Record<string, string>;
    timeoutMs: number;
  }) => Promise<PowerShellRequestResult>;
  private readonly proxyUrl?: string;
  private readonly proxyFailoverCommand?: string;
  private readonly curlExecutable: string;
  private readonly proxyFailoverRunner: (args: {
    command: string;
    endpoint: string;
    reason: string;
  }) => Promise<void>;
  private readonly proxyRunner: (args: {
    url: string;
    headers: Record<string, string>;
    timeoutMs: number;
    proxyUrl: string;
  }) => Promise<ProxyRequestResult>;

  constructor(options: RedditHttpConnectorOptions = {}) {
    this.accessToken = options.accessToken;
    this.baseUrl = options.baseUrl ?? (this.accessToken ? "https://oauth.reddit.com" : "https://www.reddit.com");
    if (this.baseUrl.includes("oauth.reddit.com") && !this.accessToken) {
      throw new Error("OAuth base URL requires accessToken");
    }

    this.userAgent = options.userAgent ?? "reddit-monitoring-mvp/0.1";
    this.timeoutMs = options.timeoutMs ?? 12000;
    this.healthcheckSubreddit = options.healthcheckSubreddit ?? "news";
    this.maxRetries = options.maxRetries ?? 3;
    this.backoffBaseMs = options.backoffBaseMs ?? 500;
    this.backoffCapMs = options.backoffCapMs ?? 10000;
    this.jitterRatio = options.jitterRatio ?? 0.2;
    this.rateLimitRemainingFloor = options.rateLimitRemainingFloor ?? 1;
    this.transport = options.transport ?? "auto";
    this.platform = options.platform ?? process.platform;
    this.powershellExecutable = options.powershellExecutable ?? "powershell.exe";
    this.powershellRunner = options.powershellRunner ?? ((args) => this.runPowerShellRequest(args));
    this.proxyUrl = normalizeProxyUrl(options.proxyUrl);
    this.proxyFailoverCommand = normalizeProxyFailoverCommand(options.proxyFailoverCommand);
    this.curlExecutable = options.curlExecutable ?? "curl";
    this.proxyFailoverRunner = options.proxyFailoverRunner ?? ((args) => this.runProxyFailoverCommand(args));
    this.proxyRunner = options.proxyRunner ?? ((args) => this.runProxyRequest(args));
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
    const path = `/r/${encodeURIComponent(args.subreddit)}/about.json`;
    return this.requestJson<RedditAboutPayload>(path, {}, ctx);
  }

  public async collectSubredditPosts(
    args: RedditCollectSubredditPostsArgs,
    ctx: ConnectorRequestContext,
  ): Promise<ConnectorPage<RedditListingPayload<RedditPostData>>> {
    const path = `/r/${encodeURIComponent(args.subreddit)}/new.json`;
    const params: Record<string, string | number | boolean | undefined> = {
      limit: args.limit,
      after: args.after,
    };

    const page = await this.requestJson<RedditListingPayload<RedditPostData>>(path, params, ctx);
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
    path: string,
    params: Record<string, string | number | boolean | undefined>,
    ctx: ConnectorRequestContext,
  ): Promise<ConnectorPage<TPayload>> {
    const url = this.buildUrl(path, params);
    if (this.transport === "powershell") {
      return this.requestJsonViaPowerShell<TPayload>(url, path, params, ctx);
    }
    if (this.proxyUrl) {
      return this.requestJsonViaProxy<TPayload>(url, path, params, ctx);
    }

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetch(url.toString(), {
          method: "GET",
          headers: this.buildHeaders(ctx),
          signal: controller.signal,
        });

        const rateLimit = this.readRateLimit(response.headers);
        if (response.ok) {
          const payload = (await response.json()) as TPayload;
          const raw: RawEnvelope<TPayload> = {
            endpoint: path,
            requestParams: params,
            httpStatus: response.status,
            responseHeaders: this.headersToRecord(response.headers),
            payload,
            fetchedAt: new Date().toISOString(),
          };

          return {
            raw,
            rateLimit,
          };
        }

        const errorBody = await this.safeReadResponseBody(response);
        if (this.shouldRetryStatus(response.status) && attempt < this.maxRetries) {
          await this.sleep(this.computeDelayMs({
            attempt,
            retryAfterMs: this.readRetryAfterMs(response.headers),
            rateLimit,
          }));
          continue;
        }

        throw new Error(
          `Reddit request failed: status=${response.status}, endpoint=${path}, body=${errorBody}`,
        );
      } catch (error) {
        lastError = error;
        if (this.shouldFallbackToPowerShell(error)) {
          clearTimeout(timeout);
          return this.requestJsonViaPowerShell<TPayload>(url, path, params, ctx);
        }
        if (attempt < this.maxRetries && this.shouldRetryError(error)) {
          await this.sleep(this.computeDelayMs({ attempt }));
          continue;
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Reddit request failed unexpectedly");
  }

  private buildUrl(
    path: string,
    params: Record<string, string | number | boolean | undefined>,
  ): URL {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
    return url;
  }

  private async requestJsonViaPowerShell<TPayload>(
    url: URL,
    path: string,
    params: Record<string, string | number | boolean | undefined>,
    ctx: ConnectorRequestContext,
  ): Promise<ConnectorPage<TPayload>> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const result = await this.powershellRunner({
          url: url.toString(),
          headers: this.buildHeaders(ctx),
          timeoutMs: this.timeoutMs,
        });
        const headers = new Headers(this.normalizeHeaderRecord(result.headers));
        const rateLimit = this.readRateLimit(headers);
        if (result.status >= 200 && result.status < 300) {
          const payload = JSON.parse(result.body) as TPayload;
          const raw: RawEnvelope<TPayload> = {
            endpoint: path,
            requestParams: params,
            httpStatus: result.status,
            responseHeaders: this.headersToRecord(headers),
            payload,
            fetchedAt: new Date().toISOString(),
          };
          return {
            raw,
            rateLimit,
          };
        }

        if (this.shouldRetryStatus(result.status) && attempt < this.maxRetries) {
          await this.sleep(this.computeDelayMs({
            attempt,
            retryAfterMs: this.readRetryAfterMs(headers),
            rateLimit,
          }));
          continue;
        }

        throw new Error(
          `Reddit request failed: status=${result.status}, endpoint=${path}, body=${result.body.slice(0, 300)}`,
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

    throw lastError instanceof Error ? lastError : new Error("PowerShell Reddit request failed unexpectedly");
  }

  private async requestJsonViaProxy<TPayload>(
    url: URL,
    path: string,
    params: Record<string, string | number | boolean | undefined>,
    ctx: ConnectorRequestContext,
  ): Promise<ConnectorPage<TPayload>> {
    let lastError: unknown;
    let proxyFailoverAttempted = false;
    for (let attempt = 0; attempt <= this.maxRetries; ) {
      try {
        const result = await this.proxyRunner({
          url: url.toString(),
          headers: this.buildHeaders(ctx),
          timeoutMs: this.timeoutMs,
          proxyUrl: this.proxyUrl as string,
        });
        const headers = new Headers(this.normalizeHeaderRecord(result.headers));
        const rateLimit = this.readRateLimit(headers);
        if (result.status >= 200 && result.status < 300) {
          const payload = JSON.parse(result.body) as TPayload;
          const raw: RawEnvelope<TPayload> = {
            endpoint: path,
            requestParams: params,
            httpStatus: result.status,
            responseHeaders: this.headersToRecord(headers),
            payload,
            fetchedAt: new Date().toISOString(),
          };
          return {
            raw,
            rateLimit,
          };
        }

        if (
          this.shouldTriggerProxyFailoverForStatus(result.status) &&
          !proxyFailoverAttempted &&
          this.proxyFailoverCommand
        ) {
          proxyFailoverAttempted = true;
          await this.proxyFailoverRunner({
            command: this.proxyFailoverCommand,
            endpoint: path,
            reason: `status=${result.status}`,
          });
          continue;
        }

        if (this.shouldRetryStatus(result.status) && attempt < this.maxRetries) {
          await this.sleep(this.computeDelayMs({
            attempt,
            retryAfterMs: this.readRetryAfterMs(headers),
            rateLimit,
          }));
          attempt += 1;
          continue;
        }

        throw new Error(
          `Reddit request failed: status=${result.status}, endpoint=${path}, body=${result.body.slice(0, 300)}`,
        );
      } catch (error) {
        lastError = error;
        if (!proxyFailoverAttempted && this.proxyFailoverCommand) {
          proxyFailoverAttempted = true;
          await this.proxyFailoverRunner({
            command: this.proxyFailoverCommand,
            endpoint: path,
            reason: this.formatProxyFailoverReason(error),
          });
          continue;
        }
        if (attempt < this.maxRetries && this.shouldRetryError(error)) {
          await this.sleep(this.computeDelayMs({ attempt }));
          attempt += 1;
          continue;
        }
        throw error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Proxied Reddit request failed unexpectedly");
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

  private headersToRecord(headers: Headers): Record<string, string> {
    const output: Record<string, string> = {};
    headers.forEach((value, key) => {
      output[key] = value;
    });
    return output;
  }

  private normalizeHeaderRecord(headers: Record<string, string>): Record<string, string> {
    return Object.fromEntries(
      Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
    );
  }

  private readRateLimit(headers: Headers) {
    const remainingRaw = headers.get("x-ratelimit-remaining");
    const resetRaw = headers.get("x-ratelimit-reset");
    const usedRaw = headers.get("x-ratelimit-used");
    const remaining = remainingRaw ? Number(remainingRaw) : undefined;
    const resetSeconds = resetRaw ? Number(resetRaw) : undefined;
    const used = usedRaw ? Number(usedRaw) : undefined;
    const limit =
      Number.isFinite(remaining) && Number.isFinite(used) ? (remaining as number) + (used as number) : undefined;

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
    return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
  }

  private shouldRetryError(error: unknown): boolean {
    if (error instanceof DOMException && error.name === "AbortError") {
      return true;
    }
    return error instanceof TypeError;
  }

  private shouldTriggerProxyFailoverForStatus(status: number): boolean {
    return status === 403 || status === 407 || status === 429 || status === 502 || status === 503 || status === 504;
  }

  private formatProxyFailoverReason(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message.slice(0, 160);
    }
    return String(error).slice(0, 160);
  }

  private shouldFallbackToPowerShell(error: unknown): boolean {
    if (this.transport !== "auto" || this.platform !== "win32") {
      return false;
    }
    return this.extractErrorCode(error) === "ECONNRESET";
  }

  private extractErrorCode(error: unknown): string | null {
    if (!error || typeof error !== "object") {
      return null;
    }
    const candidate = error as {
      code?: unknown;
      cause?: {
        code?: unknown;
      };
    };
    if (typeof candidate.code === "string" && candidate.code.length > 0) {
      return candidate.code;
    }
    if (typeof candidate.cause?.code === "string" && candidate.cause.code.length > 0) {
      return candidate.cause.code;
    }
    return null;
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

  private async safeReadResponseBody(response: Response): Promise<string> {
    try {
      const text = await response.text();
      return text.slice(0, 300);
    } catch {
      return "<unreadable-response-body>";
    }
  }

  private async sleep(ms: number): Promise<void> {
    if (ms <= 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async runPowerShellRequest(args: {
    url: string;
    headers: Record<string, string>;
    timeoutMs: number;
  }): Promise<PowerShellRequestResult> {
    const timeoutSeconds = Math.max(1, Math.ceil(args.timeoutMs / 1000));
    const headersJson = JSON.stringify(args.headers);
    const script = `
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'
$uri = @'
${args.url}
'@
$headersObject = ConvertFrom-Json @'
${headersJson}
'@
$headers = @{}
$headersObject.PSObject.Properties | ForEach-Object { $headers[$_.Name] = [string]$_.Value }
try {
  $response = Invoke-WebRequest -UseBasicParsing -Uri $uri -Headers $headers -Method Get -TimeoutSec ${timeoutSeconds}
  $status = [int]$response.StatusCode
  $content = [string]$response.Content
  $headerMap = @{}
  foreach ($key in $response.Headers.AllKeys) { $headerMap[$key] = [string]$response.Headers[$key] }
} catch {
  $webResponse = $_.Exception.Response
  if (-not $webResponse) { throw }
  $status = [int]$webResponse.StatusCode
  $headerMap = @{}
  foreach ($key in $webResponse.Headers.AllKeys) { $headerMap[$key] = [string]$webResponse.Headers[$key] }
  $stream = $webResponse.GetResponseStream()
  try {
    $reader = New-Object System.IO.StreamReader($stream)
    try {
      $content = $reader.ReadToEnd()
    } finally {
      $reader.Dispose()
    }
  } finally {
    if ($stream) { $stream.Dispose() }
  }
}
[Console]::Out.WriteLine((@{ status = $status; headers = $headerMap; body = $content } | ConvertTo-Json -Compress -Depth 8))
`;
    const encodedCommand = Buffer.from(script, "utf16le").toString("base64");

    return new Promise((resolve, reject) => {
      execFile(
        this.powershellExecutable,
        ["-NoProfile", "-EncodedCommand", encodedCommand],
        {
          timeout: args.timeoutMs + 5000,
          maxBuffer: 5 * 1024 * 1024,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          if (error && !stdout.trim()) {
            reject(
              new Error(
                `PowerShell Reddit request failed: ${stderr.trim() || error.message}`,
              ),
            );
            return;
          }

          try {
            const parsed = JSON.parse(stdout.trim()) as PowerShellRequestResult;
            resolve(parsed);
          } catch (parseError) {
            reject(
              new Error(
                `PowerShell Reddit request returned invalid JSON: ${
                  parseError instanceof Error ? parseError.message : String(parseError)
                }`,
              ),
            );
          }
        },
      );
    });
  }

  private async runProxyRequest(args: {
    url: string;
    headers: Record<string, string>;
    timeoutMs: number;
    proxyUrl: string;
  }): Promise<ProxyRequestResult> {
    const timeoutSeconds = Math.max(1, Math.ceil(args.timeoutMs / 1000));
    const curlArgs = [
      "--silent",
      "--show-error",
      "--location",
      "--max-time",
      String(timeoutSeconds),
      "--proxy",
      args.proxyUrl,
      "--write-out",
      "\n__REDDIT_MONITORING_HTTP_STATUS__:%{http_code}",
      args.url,
    ];
    for (const [key, value] of Object.entries(args.headers)) {
      curlArgs.splice(curlArgs.length - 1, 0, "--header", `${key}: ${value}`);
    }

    return new Promise((resolve, reject) => {
      execFile(
        this.curlExecutable,
        curlArgs,
        {
          timeout: args.timeoutMs + 5000,
          maxBuffer: 5 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          const marker = "\n__REDDIT_MONITORING_HTTP_STATUS__:";
          const markerIndex = stdout.lastIndexOf(marker);
          if (markerIndex < 0) {
            reject(
              new Error(
                `Proxied Reddit request failed: ${stderr.trim() || error?.message || "missing curl status marker"}`,
              ),
            );
            return;
          }

          const body = stdout.slice(0, markerIndex);
          const status = Number(stdout.slice(markerIndex + marker.length).trim());
          if (!Number.isInteger(status) || status <= 0) {
            reject(new Error(`Proxied Reddit request returned invalid status: ${stdout.slice(markerIndex).trim()}`));
            return;
          }
          if (error && status === 0) {
            reject(new Error(`Proxied Reddit request failed: ${stderr.trim() || error.message}`));
            return;
          }
          resolve({
            status,
            headers: {},
            body,
          });
        },
      );
    });
  }

  private async runProxyFailoverCommand(args: {
    command: string;
    endpoint: string;
    reason: string;
  }): Promise<void> {
    const [file, ...baseArgs] = parseCommand(args.command);
    const commandArgs = [
      ...baseArgs,
      "--endpoint",
      args.endpoint,
      "--reason",
      args.reason,
    ];

    await new Promise<void>((resolve, reject) => {
      execFile(
        file,
        commandArgs,
        {
          timeout: 30_000,
          maxBuffer: 1024 * 1024,
        },
        (error, _stdout, stderr) => {
          if (error) {
            reject(
              new Error(
                `Reddit proxy failover command failed: ${stderr.trim() || error.message}`,
              ),
            );
            return;
          }
          resolve();
        },
      );
    });
  }
}

function normalizeProxyUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  const protocol = new URL(trimmed).protocol;
  if (!["http:", "https:", "socks4:", "socks4a:", "socks5:", "socks5h:"].includes(protocol)) {
    throw new Error(`Unsupported REDDIT_HTTP_PROXY protocol: ${protocol}`);
  }
  return trimmed;
}

function normalizeProxyFailoverCommand(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  const [file] = parseCommand(trimmed);
  if (!file.startsWith("/")) {
    throw new Error("REDDIT_HTTP_PROXY_FAILOVER_COMMAND must start with an absolute executable path");
  }
  return trimmed;
}

function parseCommand(value: string): string[] {
  const parts = value.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((part) => {
    if (
      (part.startsWith('"') && part.endsWith('"')) ||
      (part.startsWith("'") && part.endsWith("'"))
    ) {
      return part.slice(1, -1);
    }
    return part;
  });
  if (!parts || parts.length === 0) {
    throw new Error("Command must not be empty");
  }
  return parts;
}
