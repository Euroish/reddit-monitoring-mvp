export interface KaixConfig { apiToken?: string; networkEnabled: boolean }

export function resolveKaixConfig(env: NodeJS.ProcessEnv = process.env): KaixConfig {
  const apiToken = env.APIFY_API_TOKEN?.trim() || undefined;
  if (apiToken && (apiToken.length > 512 || /[\u0000-\u0020\u007f]/.test(apiToken))) throw new Error("APIFY_API_TOKEN must be a bounded header value without whitespace");
  return { apiToken, networkEnabled: env.SOURCE_NETWORK_ENABLED === "true" };
}
