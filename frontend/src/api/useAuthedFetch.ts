import { useCallback } from 'react';
import { apiFetch } from './client';

/**
 * Every authenticated page used to pull `accessToken` from AuthContext
 * and hand it to apiFetch. That indirection no longer exists — the
 * access token lives in an HttpOnly cookie the browser attaches on
 * its own — so this hook is now a thin passthrough. Kept as a stable
 * import surface so callers don't have to churn: any page that used
 * to call `useAuthedFetch()` still does, but the returned function
 * now closes over nothing.
 */
export function useAuthedFetch() {
  return useCallback(
    <T,>(path: string, options: { method?: string; body?: unknown } = {}) =>
      apiFetch<T>(path, options),
    [],
  );
}
