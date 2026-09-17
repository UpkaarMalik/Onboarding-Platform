import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UserRow } from '../../users/users.service';

/** purpose distinguishes a pre-auth token minted mid password-reset from
 *  one minted mid OTP-login — two entirely separate login methods now,
 *  each with its own pre-auth token that must never be replayable
 *  against the other's endpoints (checked in AuthController). */
export interface PreAuthPayload {
  sub: string;
  type: 'pre_auth';
  purpose: 'password_reset' | 'otp_login';
}

export interface AccessPayload {
  sub: string;
  role: string;
  departmentId: string | null;
  /** Session id (user_sessions.id). Lets JwtStrategy verify the
   *  backing session is still live on every authed request. */
  sid: string;
  type: 'access';
}


/**
 * Every token kind gets its own secret AND a `type` claim checked on
 * verify. Two layers on purpose: even if secrets were ever shared by
 * mistake, a token minted as one kind still can't be verified as
 * another, because the type check happens after signature verification
 * succeeds — a forged type claim can't survive re-signing without the
 * right secret in the first place.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  // ---- pre-auth (multi-step login carrier) ----

  signPreAuth(userId: string, purpose: PreAuthPayload['purpose']): string {
    const payload: PreAuthPayload = { sub: userId, type: 'pre_auth', purpose };
    return this.jwt.sign(payload, {
      secret: this.config.get<string>('JWT_PREAUTH_SECRET'),
      expiresIn: this.config.get<string>('JWT_PREAUTH_EXPIRES_IN'),
    });
  }

  verifyPreAuth(token: string): PreAuthPayload {
    const payload = this.safeVerify<PreAuthPayload>(
      token,
      this.config.get<string>('JWT_PREAUTH_SECRET')!,
    );
    if (payload.type !== 'pre_auth') {
      throw new UnauthorizedException('Invalid token for this operation');
    }
    return payload;
  }

  // ---- access (real bearer credential) ----

  signAccessToken(
    user: Pick<UserRow, 'id' | 'role' | 'department_id'>,
    sessionId: string,
  ): string {
    const payload: AccessPayload = {
      sub: user.id,
      role: user.role,
      departmentId: user.department_id,
      sid: sessionId,
      type: 'access',
    };
    return this.jwt.sign(payload, {
      secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.config.get<string>('JWT_ACCESS_EXPIRES_IN'),
    });
  }

  verifyAccessToken(token: string): AccessPayload {
    const payload = this.safeVerify<AccessPayload>(
      token,
      this.config.get<string>('JWT_ACCESS_SECRET')!,
    );
    if (payload.type !== 'access') {
      throw new UnauthorizedException('Invalid token for this operation');
    }
    return payload;
  }

  // ---- refresh ---------------------------------------------------
  // No JWT here anymore. The refresh credential is now an OPAQUE random
  // string carried in an HttpOnly cookie, whose sha256 hash is the
  // primary key lookup in `user_sessions`. Signing wouldn't add
  // anything (the DB row IS the source of truth) and the JWT form used
  // to invite the "old signature still verifies after logout" bug that
  // motivated moving to a DB-backed session store in the first place.
  // See SessionsService.

  private safeVerify<T extends object>(token: string, secret: string): T {
    try {
      return this.jwt.verify<T>(token, { secret });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
