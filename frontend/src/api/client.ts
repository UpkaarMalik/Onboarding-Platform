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
import { reloadAfterAction } from '../lib/reloadAfterAction';

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    /**
     * Seconds until the caller may retry, from the response's
     * Retry-After header. Only a 429 carries one, and only because
     * main.ts lists that header in the CORS `exposedHeaders` — without
     * it the browser hides the header from JavaScript and this is
     * undefined even though the server sent it.
     *
     * The rate limiter's window slides, so this is the real remaining
     * time rather than the full window: after five attempts spread
     * across a minute, the next slot frees up in seconds, not in 60.
     */
    public retryAfter?: number,
  ) {
    super(message);
  }
}

/**
 * An unknown thrown value as one user-facing line.
 *
 * `err instanceof ApiError ? err.message : 'Something went wrong'` appears
 * around fifty times across this app, which is fifty chances for one of them
 * to say something different about the same failure. It lives here because
 * this is where ApiError is defined and where the guarantee it relies on is
 * documented: a thrown ApiError's message is always clean and user-facing.
 *
 * A network failure never reaches here as an ApiError — fetch rejects with a
 * TypeError before there is a response to parse — which is exactly the case
 * the fallback covers, and exactly what a stopped backend looks like.
 */
export function describeError(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong';
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
  /** Cancels the request. Used by as-you-type lookups, where every
   *  keystroke supersedes the request before it. */
  signal?: AbortSignal;
}

const CSRF_COOKIE = 'csrf_token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Fired after any successful state-changing request, so views showing
 * derived data can re-read immediately instead of waiting for a poll or a
 * push.
 *
 * Here, rather than at each call site, because this is the one place every
 * write in the app already goes through — a new endpoint gets this for
 * free and nobody has to remember to announce it. The event carries
 * nothing; a listener re-reads whatever it owns.
 *
 * This is what makes the actor's OWN action land instantly: the person who
 * pressed the button is usually the person looking at the feed, and for
 * them the round trip is already over by the time this fires. The server's
 * event stream is for everyone ELSE'S actions, and the poll is for when
 * that stream is unavailable — three layers, cheapest and most certain
 * first.
 */
export const DATA_CHANGED_EVENT = 'app:data-changed';

/**
 * Endpoints where a 401 is an answer about the credentials just
 * presented, NOT a verdict on an existing session.
 *
 * Signing in with the wrong password is a normal thing to do, and the
 * server says so with a 401. Without this set the fetch layer read that
 * as "your session died": it fired a pointless /auth/refresh (there is
 * no session to refresh — the user is trying to create one) and then
 * hard-redirected to /login via location.assign. That navigation
 * remounted the whole app, which wiped the error message the login form
 * had just set — so a wrong password looked like the page reloading and
 * silently clearing itself, with nothing explaining why.
 *
 * These paths must therefore throw ApiError and let the form render the
 * message, which is what every caller already expects.
 */
const AUTH_ENTRY_POINTS = new Set([
  '/auth/login/password',
  '/auth/login/password/complete-reset',
  // OTP-LOGIN-DISABLED
  // '/auth/login/otp/request',
  // '/auth/login/otp/verify',
  // '/auth/login/otp/resend',
]);

/** A 401 here means "not signed in", which is either a normal state
 *  (/auth/me on a fresh visit, /auth/logout when already logged out) or
 *  a credential rejection — never a session that timed out under us.
 *
 *  This governs the automatic REDIRECT only. Whether to attempt a
 *  refresh first is a different question with a different answer — see
 *  isRefreshExempt. */
function isAuthEntryPoint(path: string): boolean {
  return path === '/auth/me' || path === '/auth/logout' || AUTH_ENTRY_POINTS.has(path);
}

/**
 * Paths where a 401 cannot be cured by refreshing, so we must not try:
 * the login pair (there is no session yet — that request is how one
 * gets created) and the refresh call itself (recursion).
 *
 * Everything else gets the silent refresh-and-retry, INCLUDING
 * /auth/me. That inclusion is the fix for a bug that logged people out
 * mid-work: /auth/me used to be refresh-exempt because it is also a
 * redirect-exempt path, and AuthContext's 30 second heartbeat is its
 * only repeat caller. So every 15 minutes, when the access cookie hit
 * its max-age, the heartbeat was the request that met the 401 — and
 * with no refresh attempted it read a routine cookie rollover as a dead
 * session and sent the user to the login page.
 *
 * HR appeared unaffected only because HrDashboard's activity feed polls
 * every 15s and sometimes won the race to refresh first. That was luck,
 * not protection: it is mounted on one page, and a refresh it starts
 * does not cancel a redirect the heartbeat has already scheduled.
 *
 * The heartbeat still redirects — but now only when the refresh itself
 * fails, which is what it was always meant to detect: a revoked
 * session, a blocked account, or one genuinely past its idle/absolute
 * expiry. Those three fail rotateSession; an expired access cookie does
 * not.
 */
function isRefreshExempt(path: string): boolean {
  return path === '/auth/refresh' || path.startsWith('/auth/login/');
}

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
/** Exported for AuthContext's session heartbeat, which detects a dead session
 *  from a path (/auth/me) this module deliberately exempts from the automatic
 *  redirect — see isAuthEntryPoint. Sharing the function rather than writing a
 *  second one keeps the debounce and the returnTo behaviour in one place. */
export function redirectToLoginOnce(): void {
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
    signal: options.signal,
  });
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let res = await rawFetch(path, options);

  // Access-cookie expired mid-request: try a refresh once, then retry
  // the original request with the fresh cookie. Refresh endpoint calls
  // are already exempt via _isRetryAfterRefresh to prevent recursion.
  if (res.status === 401 && !options._isRetryAfterRefresh && !isRefreshExempt(path)) {
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
    // The auth entry points are exempt: a 401 from them is a statement
    // about credentials, and redirecting would destroy the very form
    // that needs to show why (see AUTH_ENTRY_POINTS).
    if (res.status === 401 && !isAuthEntryPoint(path) && !options._isRetryAfterRefresh) {
      redirectToLoginOnce();
    }
    const retryAfter = Number(res.headers.get('Retry-After'));
    throw new ApiError(
      res.status,
      code,
      message || 'Something went wrong',
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
    );
  }

  /* Announced only on success, and only for methods that can change
     something — a GET that merely read the data must not make every
     listener re-read it, which would be an endless loop the moment a
     listener's re-read was itself an apiFetch. */
  if (!SAFE_METHODS.has(options.method ?? 'GET')) {
    window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT, { detail: { path } }));
    /* …and then reload the whole page, so every screen — the activity
       log included — comes back from the server rather than from
       whichever listeners someone remembered to wire up. The event
       above is kept: listeners still fire, they just do not get long
       to finish. reloadAfterAction skips the handful of paths where a
       reload would destroy something (see NO_RELOAD). */
    reloadAfterAction(path);
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
