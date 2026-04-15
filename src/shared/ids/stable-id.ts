import { createHash } from "node:crypto";

const ALLOWED_STABLE_ID_PREFIXES = [
  "reddit:target:",
  "reddit:account:",
  "reddit:content:",
  "job:",
  "api-rate-limit:",
] as const;

export function isAllowedStableIdInput(value: string): boolean {
  return ALLOWED_STABLE_ID_PREFIXES.some((prefix) => value.startsWith(prefix));
}

export function stableUuidFromString(value: string): string {
  if (!isAllowedStableIdInput(value)) {
    throw new Error(
      `stableUuidFromString input is out of allowed scope: ${value}. Allowed prefixes: ${ALLOWED_STABLE_ID_PREFIXES.join(", ")}`,
    );
  }

  const hash = createHash("sha1").update(value).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}
