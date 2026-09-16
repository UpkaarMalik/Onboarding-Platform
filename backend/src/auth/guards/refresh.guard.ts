import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { REFRESH_COOKIE } from '../sessions/session-cookies.util';

/**
 * Pulls the opaque refresh token out of the HttpOnly `refresh_token`
 * cookie and stashes it on the request for the controller. Actual
 * validation (hash lookup, revocation check, idle/absolute expiry
 * check, atomic rotation) happens in SessionsService — this guard is
 * intentionally thin because a stateless "is this token shaped right"
 * check is what left the previous JWT-only design unable to revoke.
 */
@Injectable()
export class RefreshGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const token = (request.cookies?.[REFRESH_COOKIE] as string | undefined) ?? '';
    if (!token) {
      throw new UnauthorizedException('Missing refresh token');
    }
    (request as any).presentedRefreshToken = token;
    return true;
  }
}
