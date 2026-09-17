import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { CSRF_COOKIE } from '../sessions/session-cookies.util';

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

/**
 * Double-submit CSRF check for cookie-authenticated, state-changing
 * requests.
 *
 * Applied globally (see APP_GUARD in AuthModule); enforces on POST /
 * PUT / PATCH / DELETE only. Reads the `csrf_token` cookie the login
 * response set, compares its raw value against the `X-CSRF-Token`
 * header, and rejects a mismatch with 403.
 *
 * The reason a plain cookie is safe here: an attacker's page can force
 * the browser to send the cookie on a cross-site POST (SameSite=Lax
 * only stops top-level navigations, not fetch), but same-origin policy
 * stops that page from READING the cookie to put its value in the
 * header. Only a page served from OUR origin can produce a matching
 * pair, so a matching pair means the request came from our own UI.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  private static readonly SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (CsrfGuard.SAFE_METHODS.has(req.method)) return true;

    const handler = context.getHandler();
    if (handler && Reflect.getMetadata(SKIP_CSRF_KEY, handler)) return true;

    const cookieVal = (req.cookies?.[CSRF_COOKIE] as string | undefined) ?? '';
    const headerVal = (req.headers['x-csrf-token'] as string | undefined) ?? '';
    if (!cookieVal || !headerVal || cookieVal !== headerVal) {
      throw new ForbiddenException('CSRF check failed');
    }
    return true;
  }
}
