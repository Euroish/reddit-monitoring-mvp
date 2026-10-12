const allowedQueryKeys = new Set(["range", "timeframe", "targets", "series", "hiddenOverlays", "keywords", "compare", "from", "to"]);

/** A saved view is an internal UI route, never a redirect or arbitrary URL. */
export function isAllowedSavedViewRoute(value: string, kind: "target" | "comparison"): boolean {
  if (!value.startsWith("/") || value.startsWith("//") || value.length > 2048 || /[\\\u0000-\u001f]/.test(value)) return false;
  try {
    const url = new URL(value, "https://saved-view.invalid");
    if (url.origin !== "https://saved-view.invalid" || url.hash) return false;
    const target = /^\/target\/[a-z0-9_][a-z0-9_-]{1,39}$/i.test(url.pathname);
    if (!target && !(kind === "comparison" && url.pathname === "/compare")) return false;
    const seen = new Set<string>();
    for (const [key, item] of url.searchParams) {
      if (!allowedQueryKeys.has(key) || seen.has(key) || item.length > 1000 || /[\u0000-\u001f]/.test(item)) return false;
      seen.add(key);
      if (key === "range" && !["7d", "30d", "90d"].includes(item)) return false;
      if (key === "timeframe" && item !== "1d") return false;
      if ((key === "from" || key === "to") && !Number.isFinite(Date.parse(item))) return false;
    }
    return true;
  } catch { return false; }
}
