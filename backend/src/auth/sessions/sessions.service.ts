import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../database/database.service';
import { ActivityLogService } from '../../activity-log/activity-log.service';
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

/**
 * The DB source of truth for who is signed in. Every login writes a
 * row; every refresh rotates the row in place; logout marks the row
 * revoked. A refresh cookie that doesn't map to a live row (missing,
 * revoked, past idle_expires_at, past absolute_expires_at, or hash
 * mismatch) is rejected — that is what turns "stolen JWT still works"
 * into "session ends the moment we say it does".
 */
@Injectable()
export class SessionsService {
  private readonly idleTtlMs: number;
  private readonly absoluteTtlMs: number;

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly activityLog: ActivityLogService,
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

    await this.activityLog.log({
      actorId: userId,
      action: 'session.created',
      entityType: 'user_session',
      entityId: session.id,
      metadata: { userAgent: session.user_agent },
    });

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
      `UPDATE user_sessions
          SET refresh_token_hash = $2,
              csrf_token_hash    = $3,
              last_used_at       = now(),
              idle_expires_at    = $4
        WHERE refresh_token_hash = $1
          AND revoked_at IS NULL
          AND idle_expires_at     > now()
          AND absolute_expires_at > now()
        RETURNING *`,
      [presentedHash, hashToken(newRefreshToken), hashToken(newCsrfToken), nextIdle],
    );
    const session = rows[0];
    if (!session) return null;

    await this.activityLog.log({
      actorId: session.user_id,
      action: 'session.refreshed',
      entityType: 'user_session',
      entityId: session.id,
    });

    return {
      sessionId: session.id,
      refreshToken: newRefreshToken,
      csrfToken: newCsrfToken,
      absoluteExpiresAt: session.absolute_expires_at,
      idleExpiresAt: session.idle_expires_at,
    };
  }

  /**
   * Called from JwtStrategy on every access-token verify, to check
   * that the session behind the token is still live. Access tokens
   * are 15 min so this is at most every 15 min per user on a busy
   * session — cheap. The alternative (JWT-only, no lookup) is what
   * left the app unable to log anyone out until natural expiry.
   */
  async findLiveSessionById(sessionId: string): Promise<UserSessionRow | null> {
    const { rows } = await this.db.query<UserSessionRow>(
      `SELECT * FROM user_sessions
        WHERE id = $1
          AND revoked_at IS NULL
          AND absolute_expires_at > now()`,
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
    await this.activityLog.log({
      actorId: actorId ?? session.user_id,
      action: 'session.revoked',
      entityType: 'user_session',
      entityId: session.id,
      metadata: { reason },
    });
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
    if (rowCount && rowCount > 0) {
      await this.activityLog.log({
        actorId: actorId ?? userId,
        action: 'session.revoked_all',
        entityType: 'user',
        entityId: userId,
        metadata: { reason, count: rowCount },
      });
    }
    return rowCount ?? 0;
  }
}

function truncateUa(ua: string | null | undefined): string | null {
  if (!ua) return null;
  return ua.length <= USER_AGENT_MAX_LEN ? ua : ua.slice(0, USER_AGENT_MAX_LEN);
}
