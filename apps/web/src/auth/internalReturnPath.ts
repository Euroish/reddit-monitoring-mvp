/** Preserve only known internal routes and their query. Never navigate to caller-supplied origins. */
const unsafeCharacters = (value: string) => [...value].some(character => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127 || character === '\\');
export function safeInternalReturnPath(value: unknown, fallback = '/content'): string {
  if (typeof value !== 'string' || value.length > 8192 || !value.startsWith('/') || value.startsWith('//') || unsafeCharacters(value)) return fallback;
  try {
    const url = new URL(value, 'https://local.invalid');
    if (url.origin !== 'https://local.invalid') return fallback;
    let path: string;
    try { path = decodeURIComponent(url.pathname); } catch { return fallback; }
    if (unsafeCharacters(path) || path.startsWith('//')) return fallback;
    if (!/^\/(?:content(?:\/[A-Za-z0-9:_-]+)?|markets(?:\/board)?|dashboard|compare|queries|saved|account|run|target\/[A-Za-z0-9:_-]+|ops(?:\/(?:storage|users|audit|invites|targets|collection|maintenance))?)\/?$/u.test(path)) return fallback;
    return `${url.pathname}${url.search}`;
  } catch { return fallback; }
}

export function loginReturnPath(state: unknown, params: URLSearchParams): string {
  if (state && typeof state === 'object' && 'from' in state) {
    const from = (state as { from?: unknown }).from;
    if (from && typeof from === 'object' && 'pathname' in from && typeof from.pathname === 'string') {
      const search = 'search' in from && typeof from.search === 'string' ? from.search : '';
      return safeInternalReturnPath(`${from.pathname}${search}`);
    }
  }
  return safeInternalReturnPath(params.get('returnTo'));
}
