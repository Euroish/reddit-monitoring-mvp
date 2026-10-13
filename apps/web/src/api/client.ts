export class ApiError extends Error {
  code: string;
  status?: number;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
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

async function requestApi<T>(path: string, options: RequestInit | undefined, readSuccess: (response: Response) => Promise<T>): Promise<T> {
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
    const data = response.ok ? await readSuccess(response) : await response.json().catch(() => null);
    if (requestEpoch !== authEpoch || controller.signal.aborted) {
      throw new DOMException('Authentication context changed', 'AbortError');
    }
    if (!response.ok) {
      if (response.status === 401 && typeof window !== 'undefined' && !['/api/auth/login', '/api/auth/register'].includes(url)) {
        window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT, { detail: { epoch: requestEpoch } }));
      }
      let message = typeof data?.error === 'string' && data.error.trim() ? data.error : typeof data?.error?.message === 'string' && data.error.message.trim() ? data.error.message : response.statusText || `HTTP ${response.status}`;
      if (data?.errorCode === 'audit_result_unknown') {
        let zh = false;
        try { zh = typeof window !== 'undefined' && window.localStorage?.getItem('reddit-monitoring.language') === 'zh-CN'; } catch { /* unavailable preferences must not hide the operation outcome */ }
        message += zh ? ' 操作可能已生效，结果尚未确认；请先刷新并核对实际状态，再决定是否重试。' : ' The operation may have taken effect. Refresh and verify the actual resource state before deciding to retry.';
      }
      throw new ApiError(data?.errorCode || 'UNKNOWN_ERROR', message, response.status);
    }
    return data as T;
  } finally {
    activeRequests.delete(controller);
    options?.signal?.removeEventListener('abort', abort);
  }
}

export function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  return requestApi(path, options, response => response.json().catch(() => null));
}

/** Binary downloads share the same abort/epoch/401 fence as JSON, including while the body is read. */
export function fetchApiBlob(path: string, options?: RequestInit): Promise<{ blob: Blob; headers: Headers }> {
  return requestApi(path, options, async response => ({ blob: await response.blob(), headers: response.headers }));
}
