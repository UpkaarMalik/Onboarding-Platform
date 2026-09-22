import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AccessPayload } from '../tokens/token.service';
import { SessionsService } from '../sessions/sessions.service';
import { ACCESS_COOKIE } from '../sessions/session-cookies.util';

export interface AuthenticatedUser {
  id: string;
  role: 'superadmin_hr' | 'task_owner' | 'employee';
  departmentId: string | null;
  /** The session row this token belongs to. Needed by /auth/logout so
   *  it can revoke the correct session without asking the client for
   *  the id (the cookie IS the id, transitively). */
  sessionId: string;
}

/**
 * Reads the access-token JWT from the HttpOnly `access_token` cookie
 * (falling back to the Authorization header, which is used by the
 * download/inline endpoints that stream files from a fetch() rather
 * than a full-page navigation — those still work either way).
 *
 * validate() then checks the token's `sid` maps to an un-revoked,
 * within-absolute-expiry `user_sessions` row, AND that the account
 * behind it is not disabled. That per-request DB read is the whole
 * reason "logout" can now actually terminate a live request-chain:
 * before this, the JWT signature was the only check and a JWT signed at
 * login stayed valid until natural expiry no matter what happened in
 * between.
 *
 * The status check is belt and braces next to the session revocation
 * EmployeeProfileService performs when HR blocks someone: revoking is
 * what ends the sessions that exist, and this is what stops a token
 * issued in the same instant — or a session created by some future code
 * path that forgets to check — from outliving the block.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt-access') {
  constructor(
    config: ConfigService,
    private readonly sessions: SessionsService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) => (req?.cookies?.[ACCESS_COOKIE] as string | undefined) ?? null,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: AccessPayload): Promise<AuthenticatedUser> {
    if (payload.type !== 'access') {
      throw new UnauthorizedException('Invalid token for this operation');
    }
    // Signature/exp already passed. Now confirm the session is still
    // alive on the server. A logged-out or password-reset session lands
    // here.
    const session = await this.sessions.findLiveSessionById(payload.sid);
    if (!session) {
      throw new UnauthorizedException('Session is no longer active');
    }
    if (session.user_status === 'disabled') {
      throw new UnauthorizedException('This account has been blocked');
    }
    return {
      id: payload.sub,
      role: payload.role as AuthenticatedUser['role'],
      departmentId: payload.departmentId,
      sessionId: session.id,
    };
  }
}
