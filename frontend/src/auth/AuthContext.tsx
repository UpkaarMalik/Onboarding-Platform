import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

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
  accessToken: string | null;
  refreshToken: string | null;
  user: CurrentUser | null;
}

interface AuthContextValue extends AuthState {
  setAuthenticated: (accessToken: string, refreshToken: string, user: CurrentUser) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// Tokens live in localStorage, matching the backend's contract of
// issuing them in a JSON body (not a Set-Cookie header) — there's
// nowhere else to put them without the backend also changing how it
// issues tokens. This is a reasonable simplification for this project,
// not a claim that it's the most XSS-resistant approach available.
const STORAGE_KEY = 'onboarding_auth';

function loadStoredAuth(): AuthState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { accessToken: null, refreshToken: null, user: null };
    return JSON.parse(raw);
  } catch {
    return { accessToken: null, refreshToken: null, user: null };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(loadStoredAuth);

  const setAuthenticated = useCallback(
    (accessToken: string, refreshToken: string, user: CurrentUser) => {
      const next = { accessToken, refreshToken, user };
      setState(next);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    },
    [],
  );

  const logout = useCallback(() => {
    setState({ accessToken: null, refreshToken: null, user: null });
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, setAuthenticated, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
