import { useCallback } from 'react';
import { useAuth } from '../auth/AuthContext';
import { apiFetch } from './client';

/** Every authenticated page uses this instead of apiFetch directly, so
 *  the current access token is always attached without repeating
 *  `token: accessToken` at every call site. */
export function useAuthedFetch() {
  const { accessToken } = useAuth();
  return useCallback(
    <T,>(path: string, options: { method?: string; body?: unknown } = {}) =>
      apiFetch<T>(path, { ...options, token: accessToken }),
    [accessToken],
  );
}
