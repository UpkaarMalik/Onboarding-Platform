import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../database/database.service';
import {
  generateCsrfToken,
  generateRefreshToken,
  hashToken,
} from './session-crypto.util';

export interface UserSessionRow {
  id: string;
  user_id: string;
  refresh_token_hash: string;
  csrf_token_hash: string;
  user_agent: string | null;
  created_at: Date;
  last_used_at: Date;
  absolute_expires_at: Date;
  idle_expires_at: Date;
  revoked_at: Date | null;
  revoke_reason: string | null;
}

/** Raw + hashed halves of the credential the caller places in the
 *  browser's cookie jar. The raw halves NEVER get logged, stored, or
 *  returned again after the response goes out — a cookie leaves the
 *  server exactly once, on the response that mints or rotates it. */
export interface IssuedSession {
  sessionId: string;
  refreshToken: string;
  csrfToken: string;
  absoluteExpiresAt: Date;
  idleExpiresAt: Date;
}

const DEFAULT_IDLE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const DEFAULT_ABSOLUTE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7d

/** Truncated at 500 chars — plenty to identify a browser family and
 *  well short of any reasonable text column size. Anything longer is
 *  a client sending garbage and we don't want it in the DB. */
const USER_AGENT_MAX_LEN = 500;

/** A live session with the owning account's status alongside it. */
export type LiveSessionRow = UserSessionRow & { user_status: string };

/**
 * The DB source of truth for who is signed in. Every login writes a
 * row; every refresh rotates the row in place; logout marks the row
 * revoked. A refresh cookie that doesn't map to a live row (missing,
 * revoked, past idle_expires_at, past absolute_expires_at, or hash
 * mismatch) is rejected — that is what turns "stolen JWT still works"
 * into "session ends the moment we say it does".
 */
/**
 * Deliberately does NOT write to the activity log. Login, refresh and
 * logout are session plumbing, not changes to anyone's onboarding, and
 * at one row per refresh they drowned every real event on the audit
 * page — 98 of the first few hundred rows were sessions. Nothing is
 * lost by their absence: `user_sessions` already records every session
 * with its created_at, revoked_at and revoke_reason, so "when did they
 * sign in, and when was this session killed" is still answerable, just
 * from the table that owns it.
 *
 * The security-relevant events around sessions are logged by the
 * services that cause them — AuthService logs
 * `user.password_reset_completed` for the reset that calls
 * revokeAllForUser(), and EmployeeProfileService logs `user.disabled`.
 */
@Injectable()
export class SessionsService {
  private readonly idleTtlMs: number;
  private readonly absoluteTtlMs: number;

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
  ) {
    this.idleTtlMs =
      Number(this.config.get<string>('SESSION_IDLE_TTL_MS')) || DEFAULT_IDLE_TTL_MS;
    this.absoluteTtlMs =
      Number(this.config.get<string>('SESSION_ABSOLUTE_TTL_MS')) || DEFAULT_ABSOLUTE_TTL_MS;
  }

  /** Read the tunables so the controller can align cookie Max-Age with
   *  the row's absolute/idle limits — the two must agree or the cookie
   *  outlives the session (silently 401s the user) or vice versa. */
  getIdleTtlMs(): number {
    return this.idleTtlMs;
  }
  getAbsoluteTtlMs(): number {
    return this.absoluteTtlMs;
  }

  /** Called by AuthService right after any successful login (password
   *  or OTP). Returns everything the controller needs to build the
   *  three cookies; the raw refresh/CSRF strings exist ONLY in the
   *  returned value from here on. */
  async createSession(userId: string, userAgent: string | null | undefined): Promise<IssuedSession> {
    const refreshToken = generateRefreshToken();
    const csrfToken = generateCsrfToken();
    const now = new Date();
    const idleExpiresAt = new Date(now.getTime() + this.idleTtlMs);
    const absoluteExpiresAt = new Date(now.getTime() + this.absoluteTtlMs);

    const { rows } = await this.db.query<UserSessionRow>(
      `INSERT INTO user_sessions
         (user_id, refresh_token_hash, csrf_token_hash, user_agent,
          idle_expires_at, absolute_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        userId,
        hashToken(refreshToken),
        hashToken(csrfToken),
        truncateUa(userAgent),
        idleExpiresAt,
        absoluteExpiresAt,
      ],
    );
    const session = rows[0];

    return {
      sessionId: session.id,
      refreshToken,
      csrfToken,
      absoluteExpiresAt: session.absolute_expires_at,
      idleExpiresAt: session.idle_expires_at,
    };
  }

  /**
   * Refresh-token rotation, in a single UPDATE.
   *
   * The WHERE clause is what makes this safe: it checks the hash, the
   * revoked column, and both expiry windows in one atomic go, so two
   * concurrent refresh attempts can't both succeed and hand two live
   * tokens to two different requests. The row's hash is overwritten
   * with the new one — the old refresh token no longer verifies from
   * the very next request forward, whether or not the browser
   * receives the new cookie in time.
   *
   * A rejected rotation returns null; the caller turns that into 401
   * plus a cookie-clear so the browser stops sending the bad pair.
   */
  async rotateSession(presentedRefreshToken: string): Promise<IssuedSession | null> {
    const presentedHash = hashToken(presentedRefreshToken);
    const newRefreshToken = generateRefreshToken();
    const newCsrfToken = generateCsrfToken();
    const now = new Date();
    const nextIdle = new Date(now.getTime() + this.idleTtlMs);

    const { rows } = await this.db.query<UserSessionRow>(
      // The account check is not redundant with revokeAllForUser. Blocking
      // revokes the sessions that EXIST at that moment; this is what stops a
      // session created after the block — or one some future code path opens
      // without checking — from rotating itself alive forever. JwtStrategy
      // refuses the resulting access token either way, so nothing was
      // reachable, but a disabled account should not hold a renewing session
      // at all.
      `UPDATE user_sessions s
          SET refresh_token_hash = $2,
              csrf_token_hash    = $3,
              last_used_at       = now(),
              idle_expires_at    = $4
        FROM users u
        WHERE u.id = s.user_id
          AND u.deleted_at IS NULL
          AND u.status <> 'disabled'
          AND s.refresh_token_hash = $1
          AND s.revoked_at IS NULL
          AND s.idle_expires_at     > now()
          AND s.absolute_expires_at > now()
        RETURNING s.*`,
      [presentedHash, hashToken(newRefreshToken), hashToken(newCsrfToken), nextIdle],
    );
    const session = rows[0];
    if (!session) return null;

    return {
      sessionId: session.id,
      refreshToken: newRefreshToken,
      csrfToken: newCsrfToken,
      absoluteExpiresAt: session.absolute_expires_at,
      idleExpiresAt: session.idle_expires_at,
    };
  }

  /**
   * Called from JwtStrategy on every access-token verify, to check that
   * the session behind the token is still live. Access tokens are 15 min
   * so this is at most every 15 min per user on a busy session — cheap.
   * The alternative (JWT-only, no lookup) is what left the app unable to
   * log anyone out until natural expiry.
   *
   * Returns the session row plus the owning account's status.
   *
   * The join is what makes "HR blocked this person" take effect on their
   * very next request instead of whenever their access token happened to
   * expire. It is one query rather than a second round trip per request:
   * every authenticated request already reads this row, and reading one
   * more column off a join costs nothing next to a second statement.
   *
   * A soft-deleted user has no live session at all — the join drops the
   * row, so the caller sees the same "no session" it sees for a revoked
   * one, which is the right answer for an account that is gone.
   *
   * Both expiry windows are checked here, not just the absolute one.
   * Leaving idle_expires_at to rotateSession alone meant the idle
   * timeout was enforced only when a refresh happened to occur: an
   * access token minted just before a session went idle stayed good for
   * its full 15 minutes afterwards, and any session whose refresh
   * cookie was never presented again was accepted indefinitely up to
   * the 7 day absolute cap. It is one more predicate on a query every
   * authenticated request already runs.
   */
  async findLiveSessionById(sessionId: string): Promise<LiveSessionRow | null> {
    const { rows } = await this.db.query<LiveSessionRow>(
      `SELECT s.*, u.status AS user_status
         FROM user_sessions s
         JOIN users u ON u.id = s.user_id AND u.deleted_at IS NULL
        WHERE s.id = $1
          AND s.revoked_at IS NULL
          AND s.idle_expires_at     > now()
          AND s.absolute_expires_at > now()`,
      [sessionId],
    );
    return rows[0] ?? null;
  }

  /**
   * Double-submit CSRF check bound to the session. The header value
   * matching the cookie is only meaningful if the value is one WE
   * issued for THIS session — otherwise a token stolen from a
   * long-dead session could be replayed forever. Hashing before
   * compare so an attacker who somehow reads the DB still can't
   * forge a matching header.
   */
  csrfTokenMatchesSession(session: UserSessionRow, presentedCsrfToken: string): boolean {
    return hashToken(presentedCsrfToken) === session.csrf_token_hash;
  }

  async revokeSession(sessionId: string, reason: string, actorId?: string | null): Promise<void> {
    const { rows } = await this.db.query<UserSessionRow>(
      `UPDATE user_sessions
          SET revoked_at    = now(),
              revoke_reason = $2
        WHERE id = $1
          AND revoked_at IS NULL
        RETURNING *`,
      [sessionId, reason],
    );
    const session = rows[0];
    if (!session) return; // idempotent — a second logout on the same session is a no-op
  }

  async revokeAllForUser(
    userId: string,
    reason: string,
    actorId?: string | null,
  ): Promise<number> {
    // Used by password reset today. `logout-all` is deliberately not
    // exposed as a user endpoint per the current requirements — but the
    // method is here because security-driven revocation (password
    // change, admin disable) still needs to wipe every device.
    const { rowCount } = await this.db.query(
      `UPDATE user_sessions
          SET revoked_at    = now(),
              revoke_reason = $2
        WHERE user_id = $1
          AND revoked_at IS NULL`,
      [userId, reason],
    );
    return rowCount ?? 0;
  }
}

function truncateUa(ua: string | null | undefined): string | null {
  if (!ua) return null;
  return ua.length <= USER_AGENT_MAX_LEN ? ua : ua.slice(0, USER_AGENT_MAX_LEN);
}
