import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UsersService, UserRow, type Queryable } from '../users/users.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { CreateUserDto } from './dto/create-user.dto';
import { generateTempPassword } from './utils/credential-generator';
// OTP-LOGIN-DISABLED — mobile + OTP login is retired; Joinee ID +
// password is the only method. The utils in ./utils/otp are left on
// disk untouched, just unreferenced. Grep `OTP-LOGIN-DISABLED` across
// backend and frontend to find every piece and uncomment to restore.
// import {
//   generateOtpCode,
//   hashOtp,
//   verifyOtpHash,
//   sendOtpSms,
//   OTP_TTL_MS,
//   OTP_MAX_ATTEMPTS,
// } from './utils/otp';
import { TokenService } from './tokens/token.service';
import { SessionsService, IssuedSession } from './sessions/sessions.service';

const BCRYPT_ROUNDS = 12;

/** Shape of a generated Joinee ID — `JN-<year>-<3+ digits>`, per the
 *  generate_joinee_id() function in migration 0015. Anything else can
 *  be rejected without touching the database. */
const JOINEE_ID_PATTERN = /^JN-\d{4}-\d{3,}$/;

/** The lookup behind the sign-in field's tick is unauthenticated, so it
 *  is also an account-enumeration oracle. These caps keep it useful for
 *  a person typing one ID and useless for a script walking the range. */
const LOOKUP_WINDOW_MS = 60_000;
const LOOKUP_MAX_PER_WINDOW = 20;

/* A real bcrypt hash of a value nothing can present, compared against
   when the Joinee ID does not exist so that path costs the same as one
   that does. Generated once at module load rather than hardcoded, so it
   always matches the cost factor above. */
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS);

/**
 * The return shape from a successful login. The three raw cookie
 * values (`accessToken`, `refreshToken`, `csrfToken`) never reach the
 * response body — the controller writes them straight into Set-Cookie
 * headers and hands the caller `user` plus the session's expiry
 * timestamps for UI purposes.
 */
export type AuthenticatedResult = {
  status: 'authenticated';
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
  absoluteExpiresAt: Date;
  idleExpiresAt: Date;
  user: ReturnType<UsersService['toPublicUser']>;
};

/** Joinee ID + password can end in one of two shapes: fully
 *  authenticated, or "here's a password-reset pre-auth token" if the
 *  password on file is still the HR-issued temp one. */
type PasswordLoginResult =
  | AuthenticatedResult
  | { status: 'password_reset_required'; preAuthToken: string };

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly tokens: TokenService,
    private readonly activityLog: ActivityLogService,
    private readonly sessions: SessionsService,
  ) {}

  /** Per-caller sliding window for joineeIdExists(). In memory, so it
   *  resets on deploy and is per-instance — enough to blunt a casual
   *  scrape, not a substitute for a gateway rate limit. */
  private readonly lookupHits = new Map<string, number[]>();

  /**
   * Does this Joinee ID exist? Drives the tick / caution marker on the
   * sign-in field.
   *
   * This deliberately answers a question about an account nobody has
   * authenticated for, which is user enumeration by design. It is
   * narrowed as far as it can be while still doing its job: the ID
   * shape is validated before any query runs, the answer is a bare
   * boolean, and callers are rate limited.
   */
  async joineeIdExists(joineeId: string, clientKey: string): Promise<{ exists: boolean }> {
    const id = joineeId.trim().toUpperCase();
    if (!JOINEE_ID_PATTERN.test(id)) {
      // Malformed input is answered without a query, so a scraper can't
      // use junk to burn through the database rather than the window.
      return { exists: false };
    }

    const now = Date.now();
    const hits = (this.lookupHits.get(clientKey) ?? []).filter(
      (t) => now - t < LOOKUP_WINDOW_MS,
    );
    if (hits.length >= LOOKUP_MAX_PER_WINDOW) {
      throw new HttpException(
        'Too many lookups. Wait a moment and try again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    hits.push(now);
    this.lookupHits.set(clientKey, hits);
    // Bounded: without this the map grows one entry per distinct IP for
    // the life of the process.
    if (this.lookupHits.size > 5000) {
      for (const [key, times] of this.lookupHits) {
        if (times.every((t) => now - t >= LOOKUP_WINDOW_MS)) this.lookupHits.delete(key);
      }
    }

    return { exists: await this.usersService.existsByJoineeId(id) };
  }

  /**
   * `queryable` lets the whole thing — the user row AND its `user.created`
   * log entry — join a caller's transaction. That is what makes
   * POST /onboardings/joinee all or nothing: if the onboarding step fails
   * afterwards (a department with no active template answers 404), the
   * account rolls back with it instead of stranding a person nobody can
   * sign in as, holding a one-time password that was already discarded.
   *
   * Omitted, this commits on its own exactly as before, which is what
   * POST /auth/users still does.
   */
  async createUser(dto: CreateUserDto, actorId: string, queryable?: Queryable) {
    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);

    // joinee_id is generated by the DB trigger (migration 0015), not
    // here — no collision-retry loop needed, unlike the old random
    // synthetic temp email.
    const user = await this.usersService.insertUser(
      {
        fullName: dto.fullName,
        phoneNumber: dto.phoneNumber,
        personalEmail: dto.personalEmail ?? null,
        passwordHash,
        role: dto.role,
        departmentId: dto.departmentId ?? null,
      },
      queryable,
    );

    // Role/department are fine to log — never the temp password or
    // its hash, which never leave this method except in the one-time
    // credentials payload below.
    await this.activityLog.log(
      {
        actorId,
        action: 'user.created',
        entityType: 'user',
        entityId: user.id,
        metadata: { role: dto.role, departmentId: dto.departmentId ?? null },
      },
      queryable,
    );

    return {
      user: this.usersService.toPublicUser(user),
      credentials: {
        joineeId: user.joinee_id,
        temporaryPassword: tempPassword,
        note: 'Shown once. Deliver to the employee directly — this will not be shown again.',
      },
    };
  }

  /**
   * What HR sees when they reopen the credentials popup after closing it.
   *
   * The Joinee ID comes back; the temporary password cannot. It is
   * bcrypt-hashed into password_hash the moment it's generated, and
   * bcrypt is one-way — the only way to show the same string twice would
   * be to also store it readably, which would make this the single
   * plaintext credential in the schema. `canRegenerate` is what replaces
   * that: if HR lost the password before passing it on, they issue a new
   * one, which is operationally identical because the old one was never
   * used yet.
   *
   * `hasLoggedIn` tells HR whether the credentials are still needed at
   * all — an active account past its forced reset has its own password
   * and regenerating would lock the user out of it.
   */
  // Deliberately not logged. This is a read, not a change, and it is
  // not even a deliberate one: HrOverview and HrDashboard both fetch it
  // as part of loading a joinee's profile, so every glance at a joinee
  // wrote a 'user.credentials_viewed' row. That was 400-odd of the
  // first 675 log rows and it buried every real event. Issuing
  // credentials IS logged — 'user.created' for the first temporary
  // password and 'user.credentials_regenerated' for a replacement.
  // Restoring this would mean putting the log() call back AND moving
  // the fetch behind an explicit "reveal credentials" click, so that a
  // row means someone chose to look.
  async getCredentialsSummary(userId: string, actorId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    return {
      joineeId: user.joinee_id,
      fullName: user.full_name,
      phoneNumber: user.phone_number,
      personalEmail: user.personal_email,
      awaitingFirstReset: user.must_reset_password,
      hasLoggedIn: user.status !== 'invited',
      temporaryPassword: null,
      note: 'The temporary password is stored only as a one-way hash and cannot be shown again. Regenerate to issue a new one.',
      canRegenerate: true,
    };
  }

  async regenerateCredentials(userId: string, actorId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);
    await this.usersService.setPasswordHash(userId, passwordHash); // forceReset defaults true

    await this.activityLog.log({
      actorId,
      action: 'user.credentials_regenerated',
      entityType: 'user',
      entityId: userId,
    });

    return {
      credentials: {
        loginId: user.joinee_id,
        temporaryPassword: tempPassword,
        note: 'Shown once. Deliver to the employee directly — this will not be shown again.',
      },
    };
  }

  /** Shared by every path that ends in a real session: activates a
   *  still-'invited' account on its very first successful login (by
   *  either method), opens a `user_sessions` row, and mints the access
   *  JWT bound to that row's id. The controller lifts the three token
   *  strings into Set-Cookie and drops them before responding. */
  private async issueTokens(user: UserRow, userAgent: string | null): Promise<AuthenticatedResult> {
    if (user.status === 'invited') {
      await this.usersService.activateUser(user.id);
      user.status = 'active';
    }
    const session: IssuedSession = await this.sessions.createSession(user.id, userAgent);
    return {
      status: 'authenticated',
      accessToken: this.tokens.signAccessToken(user, session.sessionId),
      refreshToken: session.refreshToken,
      csrfToken: session.csrfToken,
      absoluteExpiresAt: session.absoluteExpiresAt,
      idleExpiresAt: session.idleExpiresAt,
      user: this.usersService.toPublicUser(user),
    };
  }

  // OTP-LOGIN-DISABLED
  //
  // private async issueLoginOtp(user: UserRow): Promise<void> {
  //   const code = generateOtpCode();
  //
  //   console.log('========================');
  //   console.log('OTP GENERATED:', code);
  //   console.log('PHONE:', user.phone_number);
  //   console.log('========================');
  //
  //   const otpHash = await hashOtp(code);
  //   const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  //
  //   await this.usersService.setLoginOtp(
  //     user.id,
  //     otpHash,
  //     expiresAt,
  //   );
  //
  //   console.log('OTP SAVED TO DATABASE');
  //
  //   await sendOtpSms(user.phone_number, code);
  //
  //   console.log('SMS FUNCTION FINISHED');
  // }

  // ============================================================
  // Joinee ID + password — the only login method.
  // ============================================================

  async loginWithPassword(
    joineeId: string,
    password: string,
    userAgent: string | null,
  ): Promise<PasswordLoginResult> {
    const user = await this.usersService.findByJoineeId(joineeId);

    /* One answer for every way a login can fail — unknown Joinee ID,
       disabled account, wrong password — because any difference between
       them is an oracle. The 403 "This account has been disabled" that
       used to be here told an attacker, for free, that the ID they had
       guessed was a real one. The real reason goes to the server log,
       where the people entitled to it can read it.

       The timing is levelled too: without the dummy compare below, an
       unknown ID returns in microseconds while a real one pays for
       bcrypt, and that difference is the same oracle measured with a
       stopwatch instead of read off the screen. */
    if (!user) {
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      this.logger.warn(`Login rejected: no account with Joinee ID ${joineeId}`);
      throw new UnauthorizedException('Invalid credentials');
    }
    if (user.status === 'disabled') {
      await bcrypt.compare(password, user.password_hash);
      this.logger.warn(`Login rejected: account ${user.id} is disabled`);
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordOk = await bcrypt.compare(password, user.password_hash);
    if (!passwordOk) {
      this.logger.warn(`Login rejected: wrong password for account ${user.id}`);
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.must_reset_password) {
      return {
        status: 'password_reset_required',
        preAuthToken: this.tokens.signPreAuth(user.id, 'password_reset'),
      };
    }
    return this.issueTokens(user, userAgent);
  }

  /**
   * Sets the real password and deliberately does NOT issue a session:
   * the user is sent back to the login page to sign in with their Joinee
   * ID and the password they just chose. That extra round trip is the
   * point — it proves the new password actually works before the user
   * relies on it, and it means a pre-auth token can never be traded
   * straight for a full session.
   */
  async completePasswordReset(
    userId: string,
    newPassword: string,
  ): Promise<{ status: 'password_reset_complete'; joineeId: string }> {
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.usersService.setPasswordHash(userId, passwordHash, false);

    // Password change is a security event: every live session for this
    // user is killed before the response goes out, so any credential
    // stolen before the reset stops working immediately. The user is
    // sent back to the login page and re-authenticates with the new
    // password (see the comment above about why this method
    // deliberately doesn't return tokens).
    await this.sessions.revokeAllForUser(userId, 'password_reset', userId);

    await this.activityLog.log({
      actorId: userId,
      action: 'user.password_reset_completed',
      entityType: 'user',
      entityId: userId,
    });

    // Returned so the login screen can prefill the identifier the user
    // is about to type back in.
    return { status: 'password_reset_complete', joineeId: user.joinee_id };
  }

  // ============================================================
  // OTP-LOGIN-DISABLED — mobile number + OTP. Was a second, entirely
  // independent login method with no password involved at all.
  // ============================================================
  //
  // async requestMobileOtp(phoneNumber: string): Promise<{ preAuthToken: string }> {
  //   const user = await this.usersService.findByPhoneNumber(phoneNumber);
  //   // Same generic message either way — doesn't confirm/deny whether a
  //   // number is registered.
  //   if (!user) throw new UnauthorizedException('Invalid credentials');
  //   if (user.status === 'disabled') {
  //     throw new ForbiddenException('This account has been disabled');
  //     // ^ if this block is ever restored, re-import ForbiddenException —
  //     //   and reconsider the message, which is the same oracle the
  //     //   password path was just fixed to stop leaking.
  //   }
  //
  //   await this.issueLoginOtp(user);
  //   return { preAuthToken: this.tokens.signPreAuth(user.id, 'otp_login') };
  // }
  //
  // async verifyMobileOtp(
  //   userId: string,
  //   code: string,
  //   userAgent: string | null,
  // ): Promise<PasswordLoginResult> {
  //   const user = await this.usersService.findById(userId);
  //   if (!user) throw new NotFoundException('User not found');
  //
  //   if (!user.login_otp_hash || !user.login_otp_expires_at) {
  //     throw new UnauthorizedException('No verification code pending — request a new one');
  //   }
  //   if (user.login_otp_expires_at.getTime() < Date.now()) {
  //     await this.usersService.clearLoginOtp(userId);
  //     throw new UnauthorizedException('Verification code expired — request a new one');
  //   }
  //   if (user.login_otp_attempts >= OTP_MAX_ATTEMPTS) {
  //     await this.usersService.clearLoginOtp(userId);
  //     throw new UnauthorizedException('Too many attempts — request a new code');
  //   }
  //
  //   const codeOk = await verifyOtpHash(code, user.login_otp_hash);
  //   if (!codeOk) {
  //     await this.usersService.incrementOtpAttempts(userId);
  //     throw new UnauthorizedException('Invalid code');
  //   }
  //
  //   await this.usersService.clearLoginOtp(userId);
  //
  //   // A first-time login must set a real password before it gets a
  //   // session, whichever method got the user here. Proving identity by
  //   // OTP is what authorizes the reset — the user has never seen the
  //   // HR-issued temp password and doesn't need to. The token is minted
  //   // with the 'password_reset' purpose, so the OTP pre-auth token this
  //   // call consumed can't be replayed against the reset endpoint.
  //   if (user.must_reset_password) {
  //     return {
  //       status: 'password_reset_required',
  //       preAuthToken: this.tokens.signPreAuth(user.id, 'password_reset'),
  //     };
  //   }
  //
  //   return this.issueTokens(user, userAgent);
  // }
  //
  // async resendMobileOtp(userId: string): Promise<{ sent: true }> {
  //   const user = await this.usersService.findById(userId);
  //   if (!user) throw new NotFoundException('User not found');
  //   await this.issueLoginOtp(user);
  //   return { sent: true };
  // }

  // ============================================================
  // Token refresh — DB-backed, with rotation.
  // ============================================================

  /**
   * Accepts the raw refresh cookie value the browser sent, atomically
   * rotates the underlying session row (SessionsService does the
   * hash+expiry checks in a single UPDATE), and mints a new access JWT
   * bound to the same session id. Returns null when the cookie is
   * stale/revoked/expired — the controller turns that into 401 plus a
   * cookie-clear, and the frontend interceptor redirects to the login
   * page. That is the "session timeout → redirect" path end-to-end.
   */
  async refreshAccessToken(
    presentedRefreshToken: string,
  ): Promise<AuthenticatedResult | null> {
    const rotated = await this.sessions.rotateSession(presentedRefreshToken);
    if (!rotated) return null;
    const user = await this.usersService.findById(await this.userIdForSession(rotated.sessionId));
    if (!user || user.status !== 'active') {
      // Rare race: the session existed a moment ago but the user has
      // just been disabled. Kill the freshly-rotated session so the
      // caller can't use its new cookies.
      await this.sessions.revokeSession(rotated.sessionId, 'admin_disabled');
      return null;
    }
    return {
      status: 'authenticated',
      accessToken: this.tokens.signAccessToken(user, rotated.sessionId),
      refreshToken: rotated.refreshToken,
      csrfToken: rotated.csrfToken,
      absoluteExpiresAt: rotated.absoluteExpiresAt,
      idleExpiresAt: rotated.idleExpiresAt,
      user: this.usersService.toPublicUser(user),
    };
  }

  /** Small helper — SessionsService.rotateSession already loaded the
   *  row, but its return type doesn't include user_id (nothing else
   *  needs it). Read the row a second time by id — cheap, keyed on
   *  primary key. */
  private async userIdForSession(sessionId: string): Promise<string> {
    const session = await this.sessions.findLiveSessionById(sessionId);
    if (!session) throw new UnauthorizedException('Session vanished mid-refresh');
    return session.user_id;
  }
}