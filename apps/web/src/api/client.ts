export class ApiError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'ApiError';
  }
}

export const UNAUTHORIZED_EVENT = 'api:unauthorized';
let authEpoch = 0;
const activeRequests = new Set<AbortController>();

export function getAuthEpoch() {
  return authEpoch;
}

// Invalidate requests before clearing caches: late responses must not cross identities.
export function advanceAuthEpoch() {
  authEpoch += 1;
  for (const controller of activeRequests) controller.abort();
  activeRequests.clear();
  return authEpoch;
}

export function resolveApiPath(path: string): string {
  return path.startsWith('/api/') ? path : `/api${path.startsWith('/') ? path : `/${path}`}`;
}

export async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  // Use /api/ prefix as configured in vite proxy, or directly if hosted on the same origin later
  const url = resolveApiPath(path);
  const requestEpoch = authEpoch;
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options?.signal?.aborted) controller.abort();
  options?.signal?.addEventListener('abort', abort, { once: true });
  activeRequests.add(controller);
  try {
    const headers = new Headers(options?.headers);
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await fetch(url, { ...options, headers, signal: controller.signal, credentials: 'include' });
    const data = await response.json().catch(() => null);
    if (requestEpoch !== authEpoch || controller.signal.aborted) {
      throw new DOMException('Authentication context changed', 'AbortError');
    }
    if (!response.ok) {
      if (response.status === 401 && typeof window !== 'undefined' && !['/api/auth/login', '/api/auth/register'].includes(url)) {
        window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT, { detail: { epoch: requestEpoch } }));
      }
      const message = typeof data?.error === 'string' && data.error.trim() ? data.error : response.statusText || `HTTP ${response.status}`;
      throw new ApiError(data?.errorCode || 'UNKNOWN_ERROR', message);
    }
    return data as T;
  } finally {
    activeRequests.delete(controller);
    options?.signal?.removeEventListener('abort', abort);
  }
}
