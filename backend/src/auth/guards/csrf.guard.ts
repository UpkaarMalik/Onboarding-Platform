import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ACCESS_COOKIE, CSRF_COOKIE } from '../sessions/session-cookies.util';
import { SessionsService } from '../sessions/sessions.service';
import { TokenService } from '../tokens/token.service';

export const SKIP_CSRF_KEY = 'skipCsrf';
/** Route-level opt-out for endpoints that legitimately can't attach a
 *  CSRF token — the two login endpoints (no session yet, no CSRF cookie
 *  yet) and refresh (which validates the refresh cookie itself, and
 *  that check is stricter than the double-submit). Apply with
 *  @UseGuards(...) + @SkipCsrf() on the handler. */
export function SkipCsrf(): MethodDecorator {
  return (_target, _key, descriptor: PropertyDescriptor) => {
    Reflect.defineMetadata(SKIP_CSRF_KEY, true, descriptor.value);
  };
}

/** `Authorization: Bearer <token>` -> `<token>`. */
function extractBearer(header: string | undefined): string | undefined {
  if (!header?.startsWith('Bearer ')) return undefined;
  return header.slice('Bearer '.length).trim() || undefined;
}

/**
 * Double-submit CSRF check for cookie-authenticated, state-changing
 * requests.
 *
 * Applied globally (see APP_GUARD in AuthModule); enforces on POST /
 * PUT / PATCH / DELETE only.
 *
 * TWO checks, and the second is the one that actually binds:
 *
 * 1. The `csrf_token` cookie equals the `X-CSRF-Token` header. This is
 *    the classic double-submit: an attacker's page can force the browser
 *    to send our cookie on a cross-site POST (SameSite=Lax only stops
 *    top-level navigations, not fetch), but same-origin policy stops
 *    that page READING the cookie to echo it in a header.
 *
 * 2. That value hashes to the `csrf_token_hash` on the caller's OWN live
 *    session row. Check 1 alone proves nothing on its own, because both
 *    halves come from the browser: anyone who can set a cookie on our
 *    domain — a subdomain takeover, a stale token from a session that
 *    ended months ago, or simply a client sending a matching pair it
 *    made up — satisfies it. Tying the value to the session means the
 *    token has to be one WE issued, for THIS session, still alive.
 *
 * Which is why an unsafe request with no readable session is refused
 * rather than waved through: there is nothing to bind it to. The
 * endpoints that legitimately have no session yet — the two logins and
 * refresh — opt out with @SkipCsrf().
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  private static readonly SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly sessions: SessionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    if (CsrfGuard.SAFE_METHODS.has(req.method)) return true;

    const handler = context.getHandler();
    if (handler && Reflect.getMetadata(SKIP_CSRF_KEY, handler)) return true;

    const cookieVal = (req.cookies?.[CSRF_COOKIE] as string | undefined) ?? '';
    const headerVal = (req.headers['x-csrf-token'] as string | undefined) ?? '';
    if (!cookieVal || !headerVal || cookieVal !== headerVal) {
      throw new ForbiddenException('CSRF check failed');
    }

    /* Same two places JwtStrategy looks, and in the same order: the
       HttpOnly cookie the browser sends, falling back to a bearer header
       (which the file-download endpoints and the e2e suites use). This
       guard runs BEFORE the route's JwtAuthGuard — global guards always
       do — so `req.user` is not populated yet and the token has to be
       read here rather than taken from the request. */
    const raw =
      (req.cookies?.[ACCESS_COOKIE] as string | undefined) ??
      extractBearer(req.headers.authorization);
    if (!raw) throw new ForbiddenException('CSRF check failed');

    let sessionId: string;
    try {
      sessionId = this.tokens.verifyAccessToken(raw).sid;
    } catch {
      // An unreadable token is a CSRF failure here, not a 401: letting it
      // through to the auth guard would mean an unsafe request had passed
      // CSRF on the strength of a pair it made up.
      throw new ForbiddenException('CSRF check failed');
    }

    const session = await this.sessions.findLiveSessionById(sessionId);
    if (!session || !this.sessions.csrfTokenMatchesSession(session, headerVal)) {
      throw new ForbiddenException('CSRF check failed');
    }
    return true;
  }
}
