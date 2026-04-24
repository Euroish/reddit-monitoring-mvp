export interface ProductionLaunchConfig {
  nodeEnv?: string;
  corsAllowOrigins: string[];
  sessionCookieSecure: boolean;
  allowInsecureSessionCookieInProduction?: boolean;
}

function normalizeOrigin(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("API_CORS_ALLOW_ORIGINS must not include empty origins");
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`API_CORS_ALLOW_ORIGINS contains an invalid origin: ${trimmed}`);
  }
  if (url.origin !== trimmed) {
    throw new Error(
      `API_CORS_ALLOW_ORIGINS entries must be exact origins without paths, search params, or hashes: ${trimmed}`,
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`API_CORS_ALLOW_ORIGINS must use http or https origins: ${trimmed}`);
  }
  return trimmed;
}

export function assertProductionLaunchConfig(args: ProductionLaunchConfig): void {
  if (args.nodeEnv !== "production") {
    return;
  }

  if (!args.sessionCookieSecure && !args.allowInsecureSessionCookieInProduction) {
    throw new Error("API_SESSION_COOKIE_SECURE must be true in production");
  }

  if (args.corsAllowOrigins.length === 0) {
    return;
  }

  const normalizedOrigins = args.corsAllowOrigins.map((origin) => normalizeOrigin(origin));
  if (normalizedOrigins.includes("*")) {
    throw new Error("API_CORS_ALLOW_ORIGINS cannot include * in production");
  }
}
