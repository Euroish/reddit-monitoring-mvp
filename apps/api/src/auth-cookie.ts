export const DEFAULT_SESSION_COOKIE_NAME = "rm_session";

export function readCookieValue(cookieHeader: string | string[] | undefined, name: string): string | null {
  const raw = Array.isArray(cookieHeader) ? cookieHeader.join(";") : cookieHeader;
  if (!raw) {
    return null;
  }

  for (const item of raw.split(";")) {
    const [key, ...valueParts] = item.trim().split("=");
    if (key === name) {
      return decodeURIComponent(valueParts.join("="));
    }
  }
  return null;
}

export function buildSessionCookie(args: {
  name?: string;
  token: string;
  maxAgeSeconds: number;
  secure: boolean;
}): string {
  const parts = [
    `${args.name ?? DEFAULT_SESSION_COOKIE_NAME}=${encodeURIComponent(args.token)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${Math.max(0, Math.floor(args.maxAgeSeconds))}`,
  ];
  if (args.secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function buildClearSessionCookie(args: { name?: string; secure: boolean }): string {
  return buildSessionCookie({
    name: args.name,
    token: "",
    maxAgeSeconds: 0,
    secure: args.secure,
  });
}
