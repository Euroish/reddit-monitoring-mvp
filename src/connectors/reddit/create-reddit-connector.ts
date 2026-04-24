import { RedditApifyConnector } from "./reddit-apify.connector";
import {
  type RedditCircuitBreakerConnectorOptions,
  RedditCircuitBreakerConnector,
} from "./reddit-circuit-breaker.connector";
import type { RedditConnector } from "./reddit-connector.interface";
import { RedditHttpConnector, type RedditHttpTransport } from "./reddit-http.connector";
import { RedditMockConnector } from "./reddit-mock.connector";
import {
  RedditScraplingConnector,
  type RedditScraplingProfile,
} from "./reddit-scrapling.connector";

export type RedditRunMode = "mock" | "live";
export type RedditLiveProvider = "http" | "apify" | "scrapling";

export function resolveRedditHttpTransport(value: string | undefined): RedditHttpTransport {
  if (value === "fetch" || value === "powershell") {
    return value;
  }
  return "auto";
}

export function resolveRedditScraplingProfile(
  value: string | undefined,
): RedditScraplingProfile {
  if (value === "dynamic" || value === "stealth") {
    return value;
  }
  return "http";
}

export interface CreateRedditConnectorOptions {
  mode: RedditRunMode;
  liveProvider?: RedditLiveProvider;
  accessToken?: string;
  userAgent?: string;
  httpTransport?: RedditHttpTransport;
  httpTimeoutMs?: number;
  httpProxyUrl?: string;
  httpProxyFailoverCommand?: string;
  scraplingProfile?: RedditScraplingProfile;
  scraplingPythonExecutable?: string;
  scraplingBridgeScriptPath?: string;
  scraplingTimeoutMs?: number;
  scraplingMaxRetries?: number;
  apifyActorRunEndpoint?: string;
  apifyToken?: string;
  apifyFallbackToHttp?: boolean;
  apifyCompareWithHttp?: boolean;
  apifyRunWaitForFinishSeconds?: number;
  apifyRunPollAttempts?: number;
  circuitBreaker?: (Omit<RedditCircuitBreakerConnectorOptions, "fallbackConnector"> & {
    enabled?: boolean;
  });
}

export function resolveRedditLiveProvider(value: string | undefined): RedditLiveProvider {
  if (value === "apify") {
    return "apify";
  }
  if (value === "scrapling") {
    return "scrapling";
  }
  return "http";
}

export function createRedditConnector(options: CreateRedditConnectorOptions): RedditConnector {
  if (options.mode === "mock") {
    return new RedditMockConnector();
  }

  const provider = options.liveProvider ?? "http";
  const primaryConnector = createPrimaryLiveConnector(options, provider);
  const circuitBreakerEnabled = options.circuitBreaker?.enabled ?? false;
  if (!circuitBreakerEnabled) {
    return primaryConnector;
  }

  const fallbackConnector =
    provider === "apify"
      ? createHttpLiveConnector(options)
      : provider === "scrapling"
      ? createHttpLiveConnector(options)
      : undefined;

  return new RedditCircuitBreakerConnector(primaryConnector, {
    timeoutMs: options.circuitBreaker?.timeoutMs,
    errorThresholdPercentage: options.circuitBreaker?.errorThresholdPercentage,
    resetTimeoutMs: options.circuitBreaker?.resetTimeoutMs,
    volumeThreshold: options.circuitBreaker?.volumeThreshold,
    rollingCountTimeoutMs: options.circuitBreaker?.rollingCountTimeoutMs,
    rollingCountBuckets: options.circuitBreaker?.rollingCountBuckets,
    routeToFallbackOnError: options.circuitBreaker?.routeToFallbackOnError,
    name: options.circuitBreaker?.name ?? `reddit_live_${provider}`,
    onStateChange: options.circuitBreaker?.onStateChange,
    fallbackConnector,
  });
}

function createPrimaryLiveConnector(
  options: CreateRedditConnectorOptions,
  provider: RedditLiveProvider,
): RedditConnector {
  if (provider === "apify") {
    const circuitBreakerEnabled = options.circuitBreaker?.enabled ?? false;
    return new RedditApifyConnector({
      actorRunEndpoint: options.apifyActorRunEndpoint,
      token: options.apifyToken,
      fallbackAccessToken: options.accessToken,
      fallbackUserAgent: options.userAgent,
      fallbackOnError: circuitBreakerEnabled ? false : options.apifyFallbackToHttp,
      compareWithHttp: options.apifyCompareWithHttp,
      runWaitForFinishSeconds: options.apifyRunWaitForFinishSeconds,
      runPollAttempts: options.apifyRunPollAttempts,
    });
  }

  if (provider === "scrapling") {
    return createScraplingLiveConnector(options);
  }

  return createHttpLiveConnector(options);
}

function createHttpLiveConnector(options: CreateRedditConnectorOptions): RedditHttpConnector {
  return new RedditHttpConnector({
    accessToken: options.accessToken,
    userAgent: options.userAgent,
    transport: options.httpTransport,
    timeoutMs: options.httpTimeoutMs,
    proxyUrl: options.httpProxyUrl,
    proxyFailoverCommand: options.httpProxyFailoverCommand,
  });
}

function createScraplingLiveConnector(
  options: CreateRedditConnectorOptions,
): RedditScraplingConnector {
  return new RedditScraplingConnector({
    accessToken: options.accessToken,
    userAgent: options.userAgent,
    profile: options.scraplingProfile,
    pythonExecutable: options.scraplingPythonExecutable,
    bridgeScriptPath: options.scraplingBridgeScriptPath,
    timeoutMs: options.scraplingTimeoutMs ?? options.httpTimeoutMs,
    maxRetries: options.scraplingMaxRetries,
  });
}
