import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiFetch } from '../api/client';

export interface CurrentUser {
  id: string;
  full_name: string;
  role: 'superadmin_hr' | 'task_owner' | 'employee';
  department_id: string | null;
  company_email: string | null;
  company_email_active: boolean;
  joinee_id: string;
  status: string;
}

interface AuthState {
  user: CurrentUser | null;
  /** True while we're still asking /auth/me whether the browser is
   *  signed in (i.e. whether a valid access cookie is on file). Every
   *  authed route waits for this to be false before deciding whether
   *  to render or redirect — otherwise a refresh flashes the login
   *  page for one frame before the /auth/me response lands. */
  bootstrapping: boolean;
}

interface AuthContextValue extends AuthState {
  /** Called by Login after a successful login. The tokens themselves
   *  now live in HttpOnly cookies the server set — nothing to store
   *  here. This just tells the context who the browser is now signed
   *  in as, so protected pages start rendering. */
  setAuthenticatedUser: (user: CurrentUser) => void;
  /** Called by the layout's Sign out button and by the fetch layer
   *  when it detects a dead session. Calls POST /auth/logout (server
   *  clears cookies and revokes the row) and clears local state.
   *  Idempotent — a "logout during a dead session" still cleans up
   *  everything the client can. */
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, bootstrapping: true });

  // On mount, ask the server who we are. If the browser has a valid
  // access cookie the server responds with the user row; otherwise
  // /auth/me returns 401 and we stay signed out. Cookies are attached
  // automatically because api/client sets credentials: 'include'.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { user } = await apiFetch<{ user: CurrentUser }>('/auth/me');
        if (!cancelled) setState({ user, bootstrapping: false });
      } catch {
        if (!cancelled) setState({ user: null, bootstrapping: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setAuthenticatedUser = useCallback((user: CurrentUser) => {
    setState({ user, bootstrapping: false });
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch {
      // Server-side revoke is best-effort. If the session is already
      // dead the endpoint returns 401 and we still want to clean up
      // client state — swallowing the error here means the Sign out
      // button always feels responsive, even for a stale tab whose
      // session expired hours ago.
    }
    setState({ user: null, bootstrapping: false });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, setAuthenticatedUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
