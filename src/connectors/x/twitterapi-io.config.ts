export interface TwitterApiIoConfig { apiKey?: string; networkEnabled: boolean; timeoutMs: number }

export function resolveTwitterApiIoConfig(env: NodeJS.ProcessEnv = process.env): TwitterApiIoConfig {
  const raw = env.TWITTERAPI_IO_TIMEOUT_MS ?? "20000";
  if (!/^\d+$/.test(raw) || Number(raw) < 100 || Number(raw) > 120_000) throw new Error("TWITTERAPI_IO_TIMEOUT_MS must be an integer between 100 and 120000");
  const apiKey = env.TWITTERAPI_IO_API_KEY?.trim() || undefined;
  if (apiKey && (apiKey.length > 512 || /[\u0000-\u0020\u007f]/.test(apiKey))) throw new Error("TWITTERAPI_IO_API_KEY must be a bounded header value without whitespace");
  return { apiKey, networkEnabled: env.SOURCE_NETWORK_ENABLED === "true", timeoutMs: Number(raw) };
}
