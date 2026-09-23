import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthService, AuthenticatedResult } from './auth.service';
import { CreateUserDto } from './dto/create-user.dto';
import {
  PasswordLoginDto,
  // OTP-LOGIN-DISABLED
  // RequestOtpDto,
  // OtpCodeDto,
  CompletePasswordResetDto,
} from './dto/login.dto';
import { PreAuthGuard } from './guards/pre-auth.guard';
import { RefreshGuard } from './guards/refresh.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { AuthenticatedUser } from './strategies/jwt.strategy';
import { PreAuthUser, PreAuthContext } from './decorators/pre-auth-user.decorator';
import { RefreshTokenValue } from './decorators/refresh-user.decorator';
import { SessionsService } from './sessions/sessions.service';
import {
  clearSessionCookies,
  resolveCookiePolicy,
  setSessionCookies,
} from './sessions/session-cookies.util';
import { SkipCsrf } from './guards/csrf.guard';
import { UsersService } from '../users/users.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
    private readonly sessions: SessionsService,
    private readonly config: ConfigService,
  ) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin_hr')
  @Post('users')
  createUser(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateUserDto) {
    return this.authService.createUser(dto, actor.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin_hr')
  @Post('users/:id/regenerate-credentials')
  regenerateCredentials(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.authService.regenerateCredentials(id, actor.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin_hr')
  @Get('users/:id/credentials')
  getCredentials(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.authService.getCredentialsSummary(id, actor.id);
  }

  /**
   * Does this Joinee ID exist? Unauthenticated, because the sign-in
   * field it marks up is shown before anyone has signed in. See
   * AuthService.joineeIdExists for the enumeration trade-off and the
   * rate limit that bounds it.
   */
  @Get('joinee-id/:joineeId/exists')
  checkJoineeId(@Param('joineeId') joineeId: string, @Req() req: Request) {
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    return this.authService.joineeIdExists(joineeId, ip);
  }

  // ============================================================
  // Method 1 — Joinee ID + password.
  // ============================================================
  //
  // Login endpoints are @SkipCsrf: there IS no CSRF cookie yet on the
  // request that starts a session (that cookie is one of the things
  // this response creates). The bootstrapping problem is safe because
  // login itself requires unforgeable credentials — a CSRF attack that
  // makes someone log in as an attacker's account is not a meaningful
  // threat.

  /**
   * Ten attempts per 30 seconds against any one Joinee ID, then 429
   * until the window rolls.
   *
   * A wrong password here is answered with the same generic 401 as an
   * unknown Joinee ID, on purpose — which leaves guessing as the only
   * way in, and makes the rate at which someone may guess the control
   * that actually bounds it.
   *
   * Counted per account rather than per address (see trackByJoineeId in
   * app.module.ts) so that one person mistyping their password cannot
   * lock out everyone sharing the office wifi.
   *
   * ThrottlerGuard is mounted per-route rather than globally, and
   * listed FIRST so the count happens before any authentication work:
   * a limit that only sees requests which got as far as bcrypt is one
   * an attacker can outrun.
   */
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 30_000 } })
  @Post('login/password')
  @SkipCsrf()
  async loginWithPassword(
    @Body() dto: PasswordLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ua = (req.headers['user-agent'] as string | undefined) ?? null;
    const result = await this.authService.loginWithPassword(dto.joineeId, dto.password, ua);
    return this.finalizeLoginResult(res, result);
  }

  // Same limit, same reason. The pre-auth token narrows who may call
  // this, but the new password is still chosen here, and the throttler
  // is listed before PreAuthGuard so a flood is refused before the
  // token is verified. This body carries no Joinee ID, so the tracker
  // falls back to the pre-auth token — which names one user just as
  // precisely.
  @UseGuards(ThrottlerGuard, PreAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 30_000 } })
  @Post('login/password/complete-reset')
  @SkipCsrf()
  completePasswordReset(
    @PreAuthUser() ctx: PreAuthContext,
    @Body() dto: CompletePasswordResetDto,
  ) {
    this.assertPurpose(ctx, 'password_reset');
    return this.authService.completePasswordReset(ctx.userId, dto.newPassword);
  }

  // ============================================================
  // OTP-LOGIN-DISABLED — mobile OTP. These three routes are no longer
  // registered, so /auth/login/otp/* now 404s. Uncomment together with
  // AuthService.requestMobileOtp / verifyMobileOtp / resendMobileOtp,
  // the two DTOs, and the frontend tab in Login.tsx.
  // ============================================================
  //
  // @Post('login/otp/request')
  // @SkipCsrf()
  // requestOtp(@Body() dto: RequestOtpDto) {
  //   return this.authService.requestMobileOtp(dto.phoneNumber);
  // }
  //
  // @UseGuards(PreAuthGuard)
  // @Post('login/otp/verify')
  // @SkipCsrf()
  // async verifyOtp(
  //   @PreAuthUser() ctx: PreAuthContext,
  //   @Body() dto: OtpCodeDto,
  //   @Req() req: Request,
  //   @Res({ passthrough: true }) res: Response,
  // ) {
  //   this.assertPurpose(ctx, 'otp_login');
  //   const ua = (req.headers['user-agent'] as string | undefined) ?? null;
  //   const result = await this.authService.verifyMobileOtp(ctx.userId, dto.code, ua);
  //   return this.finalizeLoginResult(res, result);
  // }
  //
  // @UseGuards(PreAuthGuard)
  // @Post('login/otp/resend')
  // @SkipCsrf()
  // resendOtp(@PreAuthUser() ctx: PreAuthContext) {
  //   this.assertPurpose(ctx, 'otp_login');
  //   return this.authService.resendMobileOtp(ctx.userId);
  // }

  private assertPurpose(ctx: PreAuthContext, purpose: PreAuthContext['purpose']) {
    if (ctx.purpose !== purpose) {
      throw new UnauthorizedException('Invalid token for this operation');
    }
  }

  // ============================================================
  // Session lifecycle
  // ============================================================

  /**
   * Refresh the access + refresh + CSRF cookies from the current
   * refresh cookie. Rotates the underlying session row atomically —
   * a token that was current on the way in is superseded on the way
   * out and cannot refresh again.
   *
   * @SkipCsrf here because the refresh cookie's presence + hash match
   * is a stronger check than the double-submit — a foreign page can
   * neither read the cookie nor produce a body that would rotate a
   * session it doesn't own.
   */
  @UseGuards(RefreshGuard)
  @Post('refresh')
  @SkipCsrf()
  @HttpCode(200)
  async refresh(
    @RefreshTokenValue() presented: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.refreshAccessToken(presented);
    if (!result) {
      // The cookies the client sent are either revoked or past
      // idle/absolute expiry. Clear them so subsequent requests stop
      // sending stale credentials, then let the frontend redirect.
      clearSessionCookies(res, resolveCookiePolicy(this.config));
      throw new UnauthorizedException('Session expired');
    }
    return this.finalizeLoginResult(res, result);
  }

  /**
   * Terminate the CURRENT session only. logout-all is intentionally
   * not implemented per the current requirements — this endpoint kills
   * one row and only the caller's own row.
   *
   * Idempotent: a repeat call on a session that has already been
   * revoked (or expired away) still returns 204 and still clears the
   * browser cookies. The auth guard sits in front of it, so a caller
   * with no valid access cookie doesn't reach the handler at all —
   * they get 401 and the frontend interceptor clears state.
   */
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(204)
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.sessions.revokeSession(user.sessionId, 'user_logout', user.id);
    clearSessionCookies(res, resolveCookiePolicy(this.config));
  }

  /**
   * Who am I? Called by the frontend on boot (and after a full page
   * reload) to rehydrate its user state from the cookie the browser
   * still holds. Costs one users row read + one sessions row read
   * (via JwtAuthGuard). Returns the same public-user shape the login
   * endpoints do.
   */
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser) {
    const row = await this.usersService.findById(user.id);
    if (!row) throw new UnauthorizedException('User not found');
    return { user: this.usersService.toPublicUser(row) };
  }

  /**
   * Extract the raw cookie values from the AuthenticatedResult, set
   * them on the response with the right Max-Age, and return the body
   * shape the frontend consumes. The tokens themselves are
   * DELIBERATELY NOT in the returned body — that's the whole point of
   * cookie-carried auth: JavaScript in the tab must not be able to
   * read the access or refresh tokens.
   */
  private finalizeLoginResult(
    res: Response,
    result: AuthenticatedResult | { status: 'password_reset_required'; preAuthToken: string },
  ) {
    if (result.status !== 'authenticated') {
      return result;
    }
    const policy = resolveCookiePolicy(this.config);
    const nowMs = Date.now();
    const refreshMaxAgeMs = result.absoluteExpiresAt.getTime() - nowMs;
    const accessTtl = this.config.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m';
    setSessionCookies({
      res,
      policy,
      accessToken: result.accessToken,
      accessMaxAgeMs: parseDurationMs(accessTtl),
      refreshToken: result.refreshToken,
      refreshMaxAgeMs,
      csrfToken: result.csrfToken,
    });
    return {
      status: 'authenticated',
      user: result.user,
      absoluteExpiresAt: result.absoluteExpiresAt.toISOString(),
      idleExpiresAt: result.idleExpiresAt.toISOString(),
    };
  }
}

/**
 * Very small parser for the strings `@nestjs/jwt` already accepts
 * (`15m`, `7d`, `3600s`, or bare milliseconds). Kept local because it
 * is only used to convert the same value the JWT library uses into the
 * milliseconds `res.cookie` wants — a full dependency for this would
 * be overkill.
 */
function parseDurationMs(input: string): number {
  const match = /^(\d+)(ms|s|m|h|d)?$/.exec(input.trim());
  if (!match) return 15 * 60 * 1000;
  const value = Number(match[1]);
  const unit = match[2] ?? 'ms';
  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return value * multipliers[unit];
}
