import { Response } from 'express';
import { ConfigService } from '@nestjs/config';

/**
 * The three cookies a signed-in session rides on.
 *
 * access_token, refresh_token — HttpOnly, so no JavaScript in the tab
 * (including anything an XSS bug injects) can read them. Access is
 * short-lived (matches JWT `exp`); refresh is long-lived (matches the
 * session's absolute cap).
 *
 * csrf_token — deliberately NOT HttpOnly. The frontend has to be able
 * to read it and echo the value back in an `X-CSRF-Token` header on
 * every state-changing request. That's the double-submit pattern: the
 * cookie is same-origin-only from the browser's side, and header-based
 * cross-site sends are blocked by CORS, so an attacker's page can't
 * force both the cookie AND the matching header to arrive together.
 */
export const ACCESS_COOKIE = 'access_token';
export const REFRESH_COOKIE = 'refresh_token';
export const CSRF_COOKIE = 'csrf_token';

export interface CookiePolicy {
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  domain?: string;
}

/**
 * Resolve cookie flags from env once per request so a single deployment
 * config can differ from local dev without code changes. Secure defaults
 * to true whenever NODE_ENV is 'production' — a missed COOKIE_SECURE
 * flag in prod would silently ship auth cookies over HTTP, so the
 * default has to be the safe one.
 */
export function resolveCookiePolicy(config: ConfigService): CookiePolicy {
  const isProd = config.get<string>('NODE_ENV') === 'production';
  const secureRaw = config.get<string>('COOKIE_SECURE');
  const sameSiteRaw = (config.get<string>('COOKIE_SAMESITE') ?? 'lax').toLowerCase();
  const validSameSite = ['lax', 'strict', 'none'] as const;
  const sameSite = (validSameSite as readonly string[]).includes(sameSiteRaw)
    ? (sameSiteRaw as CookiePolicy['sameSite'])
    : 'lax';
  return {
    secure: secureRaw === undefined ? isProd : secureRaw === 'true',
    sameSite,
    domain: config.get<string>('COOKIE_DOMAIN') || undefined,
  };
}

interface SetTokensArgs {
  res: Response;
  policy: CookiePolicy;
  accessToken: string;
  accessMaxAgeMs: number;
  refreshToken: string;
  refreshMaxAgeMs: number;
  csrfToken: string;
}

export function setSessionCookies(args: SetTokensArgs): void {
  const { res, policy, accessToken, accessMaxAgeMs, refreshToken, refreshMaxAgeMs, csrfToken } =
    args;
  const base = {
    httpOnly: true,
    secure: policy.secure,
    sameSite: policy.sameSite,
    domain: policy.domain,
    path: '/',
  } as const;

  res.cookie(ACCESS_COOKIE, accessToken, { ...base, maxAge: accessMaxAgeMs });
  res.cookie(REFRESH_COOKIE, refreshToken, { ...base, maxAge: refreshMaxAgeMs });
  // Same lifetime as the refresh cookie — they're the two halves of
  // one session, and a browser that has the refresh cookie but not the
  // CSRF cookie can't do anything useful with it anyway.
  res.cookie(CSRF_COOKIE, csrfToken, {
    ...base,
    httpOnly: false,
    maxAge: refreshMaxAgeMs,
  });
}

/** Same flags MUST match what setSessionCookies used, otherwise the
 *  browser treats it as a different cookie and the clear is a no-op.
 *  That's the source of most "why did logout not sign me out?" bugs
 *  with cookie auth, so all three are cleared together and with the
 *  same policy. */
export function clearSessionCookies(res: Response, policy: CookiePolicy): void {
  const base = {
    httpOnly: true,
    secure: policy.secure,
    sameSite: policy.sameSite,
    domain: policy.domain,
    path: '/',
  } as const;
  res.clearCookie(ACCESS_COOKIE, base);
  res.clearCookie(REFRESH_COOKIE, base);
  res.clearCookie(CSRF_COOKIE, { ...base, httpOnly: false });
}
