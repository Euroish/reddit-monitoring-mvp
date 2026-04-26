export function floorToWindow(isoTime: string, windowMinutes: number): string {
  const date = new Date(isoTime);
  const windowMs = Math.max(1, windowMinutes) * 60 * 1000;
  const flooredMs = Math.floor(date.getTime() / windowMs) * windowMs;
  return new Date(flooredMs).toISOString();
}

export function buildDedupeKey(
  jobType: string,
  targetId: string,
  windowStartIso: string,
  scope?: string,
): string {
  const normalizedScope = scope?.trim();
  return normalizedScope && normalizedScope.length > 0
    ? `${jobType}:${targetId}:${normalizedScope}:${windowStartIso}`
    : `${jobType}:${targetId}:${windowStartIso}`;
}
