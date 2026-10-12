import { createContext, Fragment, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { advanceAuthEpoch, ApiError, fetchApi, getAuthEpoch, UNAUTHORIZED_EVENT } from '../api/client';
import type { AuthMeResponse, AuthUserView, AuthLoginRequest, AuthLoginResponse, AuthLogoutResponse } from '../../../../packages/contracts/src/http';

interface AuthContextValue {
  user: AuthUserView | null;
  isLoading: boolean;
  login: (credentials: AuthLoginRequest) => Promise<void>;
  logout: () => Promise<void>;
  clearSession: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [epoch, setEpoch] = useState(getAuthEpoch);
  const authOperation = useRef(false);

  const { data, isLoading } = useQuery({
    queryKey: ['auth', 'me', epoch],
    queryFn: ({ signal }) => fetchApi<AuthMeResponse>('/auth/me', { signal }),
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
  });

  const replaceIdentity = useCallback((response: AuthMeResponse | null) => {
    const nextEpoch = advanceAuthEpoch();
    void queryClient.cancelQueries();
    queryClient.clear();
    queryClient.setQueryData(['auth', 'me', nextEpoch], response);
    setEpoch(nextEpoch);
  }, [queryClient]);
  const clearSession = useCallback(() => replaceIdentity(null), [replaceIdentity]);

  const login = async (credentials: AuthLoginRequest) => {
    if (authOperation.current) throw new ApiError('AUTH_PENDING', 'An authentication request is already in progress.');
    authOperation.current = true;
    const requestEpoch = advanceAuthEpoch();
    await queryClient.cancelQueries();
    try {
      const response = await fetchApi<AuthLoginResponse>('/auth/login', { method: 'POST', body: JSON.stringify(credentials) });
      if (requestEpoch !== getAuthEpoch()) throw new DOMException('Authentication context changed', 'AbortError');
      replaceIdentity(response);
    } finally {
      authOperation.current = false;
    }
  };

  const logout = async () => {
    if (authOperation.current) throw new ApiError('AUTH_PENDING', 'An authentication request is already in progress.');
    authOperation.current = true;
    advanceAuthEpoch();
    await queryClient.cancelQueries();
    try {
      await fetchApi<AuthLogoutResponse>('/auth/logout', { method: 'POST' });
      clearSession();
    } finally {
      authOperation.current = false;
    }
  };

  useEffect(() => {
    const handleUnauthorized = (event: Event) => {
      const requestEpoch = (event as CustomEvent<{ epoch: number }>).detail?.epoch;
      if (requestEpoch === getAuthEpoch()) clearSession();
    };

    window.addEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
  }, [clearSession]);

  const value = {
    user: data?.user ?? null,
    isLoading,
    login,
    logout,
    clearSession,
  };

  return <AuthContext.Provider value={value}><Fragment key={epoch}>{children}</Fragment></AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
