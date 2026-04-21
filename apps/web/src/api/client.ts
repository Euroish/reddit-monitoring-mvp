export class ApiError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'ApiError';
  }
}

export const UNAUTHORIZED_EVENT = 'api:unauthorized';

export async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  // Use /api/ prefix as configured in vite proxy, or directly if hosted on the same origin later
  const url = path.startsWith('/api/') ? path : `/api${path.startsWith('/') ? path : `/${path}`}`;
  
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    // Crucial for session cookies to be sent along with the cross-origin or same-origin requests
    credentials: 'include',
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    if (response.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    }
    throw new ApiError(data?.errorCode || 'UNKNOWN_ERROR', data?.error || response.statusText);
  }

  return data as T;
}
