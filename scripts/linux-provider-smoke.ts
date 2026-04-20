interface SmokeResult {
  event: string;
  platform: NodeJS.Platform;
  configOnly: boolean;
  transport: string;
  provider: string;
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

function main(): void {
  const transport = normalize(process.env.REDDIT_HTTP_TRANSPORT, "fetch");
  const provider = normalize(process.env.REDDIT_LIVE_PROVIDER, "http");
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

  const result: SmokeResult = {
    event: "linux_provider_smoke.passed",
    platform: process.platform,
    configOnly,
    transport,
    provider,
    checks,
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result));
}

main();
