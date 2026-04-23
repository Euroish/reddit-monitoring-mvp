import { createRedditCapabilityProbeConnectorFromEnv } from "../src/runtime/reddit-phase1-runtime";
import {
  probeRedditProviderCapability,
  resolveRedditProviderCapabilityProbeConfigFromEnv,
} from "../src/runtime/reddit-provider-capability";

interface SmokeResult {
  event: string;
  platform: NodeJS.Platform;
  configOnly: boolean;
  transport: string;
  provider: string;
  subreddit?: string;
  checks: string[];
}

const args = new Set(process.argv.slice(2));
const configOnly = args.has("--config-only");

function normalize(raw: string | undefined, fallback: string): string {
  const value = raw?.trim().toLowerCase();
  return value && value.length > 0 ? value : fallback;
}

function assertAllowedProvider(provider: string): void {
  if (!["http", "apify", "scrapling"].includes(provider)) {
    throw new Error(`REDDIT_LIVE_PROVIDER must be http, apify, or scrapling; got ${provider}`);
  }
}

function assertTransport(transport: string): void {
  if (transport !== "fetch") {
    throw new Error(`REDDIT_HTTP_TRANSPORT must be fetch for Linux production; got ${transport}`);
  }
}

async function main(): Promise<void> {
  const transport = normalize(process.env.REDDIT_HTTP_TRANSPORT, "fetch");
  const providerCapability = resolveRedditProviderCapabilityProbeConfigFromEnv(process.env);
  const provider = providerCapability.provider;
  assertTransport(transport);
  assertAllowedProvider(provider);

  const checks = [
    "transport.fetch",
    `provider.${provider}`,
    configOnly ? "mode.config_only" : "mode.runtime",
  ];
  if (process.platform !== "linux") {
    checks.push("platform.non_linux_config_only");
  }
  if (!configOnly && process.platform !== "linux") {
    throw new Error("Linux provider smoke without --config-only must run on Linux");
  }

  if (!configOnly) {
    const probe = await probeRedditProviderCapability({
      connector: createRedditCapabilityProbeConnectorFromEnv({
        env: process.env,
        mode: "live",
        crawlMode: "live",
      }),
      provider,
      subreddit: providerCapability.subreddit,
      nowIso: new Date().toISOString(),
    });
    if (!probe.ok) {
      throw new Error(
        `provider capability probe failed for ${provider} on r/${providerCapability.subreddit}: ${probe.reason ?? "unknown error"}`,
      );
    }
    checks.push("provider_capability.runtime_ok");
  }

  const result: SmokeResult = {
    event: "linux_provider_smoke.passed",
    platform: process.platform,
    configOnly,
    transport,
    provider,
    subreddit: configOnly ? undefined : providerCapability.subreddit,
    checks,
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result));
}

void main();
