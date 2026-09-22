import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import * as bcrypt from 'bcrypt';

import { AppModule } from '../src/app.module';
import { TokenService } from '../src/auth/tokens/token.service';
import { SessionsService } from '../src/auth/sessions/sessions.service';
import { DatabaseService } from '../src/database/database.service';

process.env.DATABASE_URL ??=
  'postgresql://postgres:postgres@localhost:5432/onboarding';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';
process.env.JWT_PREAUTH_SECRET ??= 'test-preauth-secret';
process.env.LOGIN_EMAIL_DOMAIN ??= 'id.onboarding.internal';
process.env.TOTP_ISSUER ??= 'Onboarding Platform';

/**
 * The three holes this suite exists to keep shut. Each one was a case where
 * the code looked right from the outside — a CSRF guard, a status column, an
 * error branch — and the thing that made it real was missing.
 *
 *  1. CSRF double-submit compared the cookie to the header and nothing else.
 *     Both come from the browser, so a client that invents a matching pair
 *     passes. The fix binds the value to the caller's own session row.
 *  2. Blocking a user wrote users.status and stopped there, leaving every
 *     token they already held good for up to its full 15 minute life.
 *  3. Login answered 403 "disabled" for a real account and 401 for an unknown
 *     one, which tells an attacker for free which Joinee IDs exist.
 *
 * All three are only observable end to end: each is about what a REQUEST is
 * allowed to do, not about what a function returns.
 */
describe('Auth hardening (e2e)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let tokens: TokenService;
  let sessions: SessionsService;

  const createdUserIds: string[] = [];
  const stamp = Date.now();
  const PASSWORD = 'Hardening-Test-Pass-1!';

  async function createUser(name: string, role: string, suffix: string, status = 'active') {
    const hash = await bcrypt.hash(PASSWORD, 4);
    const joineeId = `SEC-${stamp}-${suffix}`;
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO users (full_name, phone_number, joinee_id, password_hash, role,
                          status, must_reset_password)
       VALUES ($1, $2, $3, $4, $5, $6, false)
       RETURNING id`,
      [name, `+1997${suffix}`, joineeId, hash, role, status],
    );
    createdUserIds.push(rows[0].id);
    return { id: rows[0].id, joineeId };
  }

  async function signIn(userId: string, role: string) {
    const { sessionId, csrfToken } = await sessions.createSession(userId, 'hardening-e2e');
    return {
      token: tokens.signAccessToken(
        { id: userId, role, department_id: null } as any,
        sessionId,
      ),
      csrf: csrfToken,
      sessionId,
    };
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    db = moduleRef.get(DatabaseService);
    tokens = moduleRef.get(TokenService);
    sessions = moduleRef.get(SessionsService);
  });

  afterAll(async () => {
    await db.query(`DELETE FROM activity_logs WHERE actor_id = ANY($1::uuid[])`, [
      createdUserIds,
    ]);
    await db.query(`DELETE FROM user_sessions WHERE user_id = ANY($1::uuid[])`, [
      createdUserIds,
    ]);
    await db.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [createdUserIds]);
    await app.close();
  });

  // ------------------------------------------------------------------
  // 1. CSRF must be bound to the session, not just to itself
  // ------------------------------------------------------------------
  it('refuses a cookie/header pair the client made up', async () => {
    const hr = await createUser('Sec HR Csrf', 'superadmin_hr', '0001');
    const creds = await signIn(hr.id, 'superadmin_hr');
    const target = await createUser('Sec Target Csrf', 'employee', '0002');

    // A perfectly self-consistent pair — cookie equals header, exactly what
    // the old guard checked — but a value we invented rather than one the
    // server issued for this session.
    const forged = 'forged-but-internally-consistent';
    await request(app.getHttpServer())
      .patch(`/employee-profile/${target.id}/status`)
      .set('Authorization', `Bearer ${creds.token}`)
      .set('Cookie', [`csrf_token=${forged}`])
      .set('X-CSRF-Token', forged)
      .send({ enabled: false })
      .expect(403);

    // The genuine token, same request, goes through — so the 403 above is the
    // binding doing its job and not something else refusing the call.
    await request(app.getHttpServer())
      .patch(`/employee-profile/${target.id}/status`)
      .set('Authorization', `Bearer ${creds.token}`)
      .set('Cookie', [`csrf_token=${creds.csrf}`])
      .set('X-CSRF-Token', creds.csrf)
      .send({ enabled: false })
      .expect(200);
  });

  // ------------------------------------------------------------------
  // 2. Blocking ends the sessions that already exist
  // ------------------------------------------------------------------
  it('turns a blocked user away on their very next request', async () => {
    const hr = await createUser('Sec HR Block', 'superadmin_hr', '0003');
    const hrCreds = await signIn(hr.id, 'superadmin_hr');
    const victim = await createUser('Sec Victim', 'employee', '0004');
    const victimCreds = await signIn(victim.id, 'employee');

    // Working normally first, so the 401 below is a change of state and not
    // a request that was never going to succeed.
    await request(app.getHttpServer())
      .get('/onboardings/me')
      .set('Authorization', `Bearer ${victimCreds.token}`)
      .expect((res) => {
        if (res.status === 401) throw new Error('victim was not authenticated to begin with');
      });

    await request(app.getHttpServer())
      .patch(`/employee-profile/${victim.id}/status`)
      .set('Authorization', `Bearer ${hrCreds.token}`)
      .set('Cookie', [`csrf_token=${hrCreds.csrf}`])
      .set('X-CSRF-Token', hrCreds.csrf)
      .send({ enabled: false })
      .expect(200);

    // The same token, unexpired and cryptographically valid, is now refused.
    // This is the whole point: waiting out the 15 minute lifetime is not the
    // remedy, the next request is.
    await request(app.getHttpServer())
      .get('/onboardings/me')
      .set('Authorization', `Bearer ${victimCreds.token}`)
      .expect(401);

    // Belt and braces, checked separately because they fail independently:
    // the session row is revoked...
    const { rows: sessionRows } = await db.query<{ revoked_at: Date | null; revoke_reason: string }>(
      `SELECT revoked_at, revoke_reason FROM user_sessions WHERE id = $1`,
      [victimCreds.sessionId],
    );
    expect(sessionRows[0].revoked_at).not.toBeNull();
    expect(sessionRows[0].revoke_reason).toBe('account_disabled');

    // ...and a session created AFTER the block — the path revocation alone
    // would miss — is refused too, by JwtStrategy's status check.
    const smuggled = await signIn(victim.id, 'employee');
    await request(app.getHttpServer())
      .get('/onboardings/me')
      .set('Authorization', `Bearer ${smuggled.token}`)
      .expect(401);
  });

  it('makes /auth/me 401 for a blocked user, which is what the heartbeat watches', async () => {
    // The client polls /auth/me every 30s so a blocked user is bounced to the
    // login page without having to click anything first. That only works
    // while this endpoint reports the block — it is one of the paths apiFetch
    // exempts from its automatic redirect, so nothing else would notice if it
    // quietly started answering 200 again.
    const hr = await createUser('Sec HR Heartbeat', 'superadmin_hr', '0008');
    const hrCreds = await signIn(hr.id, 'superadmin_hr');
    const victim = await createUser('Sec Heartbeat Victim', 'employee', '0009');
    const victimCreds = await signIn(victim.id, 'employee');

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${victimCreds.token}`)
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/employee-profile/${victim.id}/status`)
      .set('Authorization', `Bearer ${hrCreds.token}`)
      .set('Cookie', [`csrf_token=${hrCreds.csrf}`])
      .set('X-CSRF-Token', hrCreds.csrf)
      .send({ enabled: false })
      .expect(200);

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${victimCreds.token}`)
      .expect(401);
  });

  it('will not refresh a blocked user back into a working session', async () => {
    // The link that decides whether "blocked" actually reaches the screen.
    // The client answers a 401 by refreshing once and retrying; if refresh
    // succeeded here the blocked user would be handed a new access cookie on
    // every request and would appear to carry on working.
    const hr = await createUser('Sec HR Refresh', 'superadmin_hr', '0006');
    const hrCreds = await signIn(hr.id, 'superadmin_hr');
    const victim = await createUser('Sec Refresh Victim', 'employee', '0007');
    const { refreshToken } = await sessions.createSession(victim.id, 'hardening-e2e');

    // Rotates fine while the account is live.
    expect(await sessions.rotateSession(refreshToken)).not.toBeNull();

    await request(app.getHttpServer())
      .patch(`/employee-profile/${victim.id}/status`)
      .set('Authorization', `Bearer ${hrCreds.token}`)
      .set('Cookie', [`csrf_token=${hrCreds.csrf}`])
      .set('X-CSRF-Token', hrCreds.csrf)
      .send({ enabled: false })
      .expect(200);

    // Revocation is what stops this one...
    const rotated = await sessions.rotateSession(refreshToken);
    expect(rotated).toBeNull();

    // ...and the status check is what stops a session opened after the block,
    // which revocation never saw. Without the users join in rotateSession
    // this rotation succeeds and the session renews indefinitely.
    const after = await sessions.createSession(victim.id, 'hardening-e2e');
    expect(await sessions.rotateSession(after.refreshToken)).toBeNull();
  });

  // ------------------------------------------------------------------
  // 3. Login must not say which Joinee IDs are real
  // ------------------------------------------------------------------
  it('answers identically for a disabled account and an unknown id', async () => {
    const disabled = await createUser('Sec Disabled', 'employee', '0005', 'disabled');

    const unknown = await request(app.getHttpServer())
      .post('/auth/login/password')
      .send({ joineeId: `SEC-${stamp}-does-not-exist`, password: PASSWORD });

    const real = await request(app.getHttpServer())
      .post('/auth/login/password')
      .send({ joineeId: disabled.joineeId, password: PASSWORD });

    // Same status AND same body. A difference in either is the oracle.
    expect(real.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(real.body.message).toBe(unknown.body.message);
    // And it must not name the reason it actually refused.
    expect(JSON.stringify(real.body).toLowerCase()).not.toContain('disabled');
  });
});
