/** Exported so multipart uploads can build their own fetch — apiFetch always
 *  JSON-encodes the body and sets a JSON Content-Type, which breaks FormData. */
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

/**
 * Matches the backend's Step 34 AllExceptionsFilter shape exactly:
 * {statusCode, code, message}. Every failed request throws one of
 * these — callers can rely on `.message` always being a clean,
 * user-facing string (never a raw stack trace), and `.statusCode` for
 * status-specific handling (e.g. treating 409 as "already done" rather
 * than a real error).
 */
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Bearer token to send in the Authorization header. Used ONLY by
   *  the pre-auth login flow (`/auth/login/otp/verify`,
   *  `/auth/login/otp/resend`, `/auth/login/password/complete-reset`)
   *  where the caller isn't yet fully signed in and therefore doesn't
   *  yet have an access cookie. Real session tokens ride on cookies. */
  bearerToken?: string;
  /** Escape hatch used by the fetch interceptor itself to avoid an
   *  infinite loop when /auth/refresh is what returned 401. Do not
   *  pass this from application code. */
  _isRetryAfterRefresh?: boolean;
}

const CSRF_COOKIE = 'csrf_token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Reads the `csrf_token` cookie the server set at login. Non-HttpOnly
 *  on purpose — the whole point of the double-submit pattern is that
 *  our own JS can echo it back in a header that a cross-site attacker
 *  can neither set (CORS blocks it) nor read from OUR cookie jar
 *  (same-origin policy). */
function readCsrfCookie(): string {
  const raw = document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${CSRF_COOKIE}=`));
  return raw ? decodeURIComponent(raw.slice(CSRF_COOKIE.length + 1)) : '';
}

/**
 * Session-timeout handler.
 *
 * When the fetch layer detects the session is dead — either
 * /auth/refresh itself returned 401, or a protected endpoint returned
 * 401 and a retry after refresh still returned 401 — this runs. It
 * clears any cached user state the AuthProvider might still hold, then
 * navigates the browser to the login page. React Router doesn't reach
 * here (this is called from a plain module), so we use a full
 * `location.href` change which also drops any stale in-memory state
 * from the previous session.
 *
 * Debounced with a module-level flag so a burst of parallel authed
 * requests all failing at once triggers ONE redirect, not one per
 * request.
 */
let redirecting = false;
function redirectToLoginOnce(): void {
  if (redirecting) return;
  redirecting = true;
  // A tiny defer so the current call stack unwinds and the caller sees
  // the ApiError first; without this the redirect can race React's
  // error boundaries and produce a "state update after unmount" warn.
  setTimeout(() => {
    // Preserve where the user was so we can send them back after login.
    const returnTo = window.location.pathname + window.location.search;
    const target =
      returnTo && returnTo !== '/login'
        ? `/login?returnTo=${encodeURIComponent(returnTo)}`
        : '/login';
    window.location.assign(target);
  }, 0);
}

/** Single in-flight refresh promise. If ten calls all get 401 at once
 *  they all await the SAME refresh POST, and the retry that follows
 *  runs against fresh cookies. Without this the burst produces ten
 *  parallel refreshes, of which nine race the rotation and lose. */
let inflightRefresh: Promise<boolean> | null = null;
async function tryRefreshOnce(): Promise<boolean> {
  if (!inflightRefresh) {
    inflightRefresh = (async () => {
      try {
        await apiFetch('/auth/refresh', {
          method: 'POST',
          _isRetryAfterRefresh: true,
        });
        return true;
      } catch {
        return false;
      } finally {
        // Whether the refresh succeeded or failed, subsequent 401s
        // should be free to try again from scratch — a token that just
        // rotated might rotate again in 15 min.
        inflightRefresh = null;
      }
    })();
  }
  return inflightRefresh;
}

async function rawFetch(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = {};
  const method = options.method ?? 'GET';
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.bearerToken) {
    headers.Authorization = `Bearer ${options.bearerToken}`;
  }
  // CSRF header on every state-changing request (except the refresh
  // retry, which is exempt on the server for the same reason it's
  // safe: presenting the refresh cookie is a stronger proof than
  // presenting the CSRF cookie).
  if (!SAFE_METHODS.has(method)) {
    const csrf = readCsrfCookie();
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }

  return fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    // Cookies come and go on every request. This is REQUIRED for the
    // access/refresh/CSRF cookies to reach the server at all — the
    // default is 'same-origin' which excludes cross-origin requests
    // like localhost:5173 → localhost:3000.
    credentials: 'include',
  });
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let res = await rawFetch(path, options);

  // Access-cookie expired mid-request: try a refresh once, then retry
  // the original request with the fresh cookie. Refresh endpoint calls
  // are already exempt via _isRetryAfterRefresh to prevent recursion.
  if (
    res.status === 401 &&
    !options._isRetryAfterRefresh &&
    path !== '/auth/refresh' &&
    path !== '/auth/logout' &&
    path !== '/auth/me'
  ) {
    const refreshed = await tryRefreshOnce();
    if (refreshed) {
      res = await rawFetch(path, options);
    }
  }

  // 204 No Content
  if (res.status === 204) {
    return undefined as T;
  }

  const contentType = res.headers.get('content-type') ?? '';
  const data = contentType.includes('application/json') ? await res.json() : await res.text();

  if (!res.ok) {
    const rawMessage =
      typeof data === 'object' && data !== null && 'message' in data
        ? (data as { message: string | string[] }).message
        : String(data);
    const message = Array.isArray(rawMessage) ? rawMessage.join(', ') : rawMessage;
    const code = typeof data === 'object' && data !== null && 'code' in data ? (data as any).code : 'UNKNOWN_ERROR';
    // The session is genuinely dead — refresh already tried and lost.
    // Redirect from ONE place, here, so every caller doesn't need to
    // check `err.statusCode === 401` and reproduce the same logic.
    // Exceptions: /auth/me (used to test whether we're signed in) and
    // /auth/logout (already logging out) — a 401 there means "not
    // signed in", which is a normal state, not a session timeout.
    if (
      res.status === 401 &&
      path !== '/auth/me' &&
      path !== '/auth/logout' &&
      !options._isRetryAfterRefresh
    ) {
      redirectToLoginOnce();
    }
    throw new ApiError(res.status, code, message || 'Something went wrong');
  }

  return data as T;
}

/** File download with the same cookie-carried auth as apiFetch. No
 *  token parameter anymore — the browser attaches the access cookie
 *  automatically. */
export async function downloadFile(path: string, suggestedName: string) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
  });
  if (!res.ok) {
    if (res.status === 401) redirectToLoginOnce();
    throw new ApiError(res.status, 'DOWNLOAD_FAILED', 'Could not download this file');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** "Read online" companion to downloadFile — hands the blob to a new
 *  tab. Same cookie-based auth. */
export async function openFileInline(path: string) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
  });
  if (!res.ok) {
    if (res.status === 401) redirectToLoginOnce();
    throw new ApiError(res.status, 'OPEN_FAILED', 'Could not open this file');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
