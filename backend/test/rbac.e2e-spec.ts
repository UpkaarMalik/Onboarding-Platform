import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { TokenService } from '../src/auth/tokens/token.service';
import { SessionsService } from '../src/auth/sessions/sessions.service';
import { DatabaseService } from '../src/database/database.service';

// Same env vars main.ts/ConfigModule expect from .env. Set only if not
// already present, so a real .env (or CI-provided env) always wins —
// this just lets the suite boot standalone otherwise.
//
// The database IS reached now, which it was not when this suite was
// written: JwtStrategy re-reads the user_sessions row on every request
// (migration 0029), so getting as far as RolesGuard needs a real user
// and a real session rather than a token signed over an invented id.
process.env.DATABASE_URL ??=
  'postgresql://postgres:postgres@localhost:5432/onboarding_test';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';
process.env.JWT_PREAUTH_SECRET ??= 'test-preauth-secret';
process.env.LOGIN_EMAIL_DOMAIN ??= 'id.onboarding.internal';
process.env.TOTP_ISSUER ??= 'Onboarding Platform';

/**
 * RolesGuard, over real HTTP.
 *
 * The point of the suite is that authorisation is enforced server-side
 * rather than by hiding a button, so every case here is a real request
 * carrying a real credential.
 *
 * WHY A GET CARRIES THE 401-vs-403 CASE. CsrfGuard is global and runs
 * BEFORE the route's auth guard, so a POST with no credentials is
 * refused as 403 "CSRF check failed" and never reaches the question this
 * suite is asking. On a GET — which CsrfGuard treats as safe and waves
 * through — the distinction the test is about survives: no credential is
 * 401, a valid credential for the wrong role is 403.
 */
describe('RolesGuard (e2e)', () => {
  let app: INestApplication;
  let tokens: TokenService;
  let sessions: SessionsService;
  let db: DatabaseService;

  const stamp = Date.now();
  const createdUserIds: string[] = [];
  let employee: { token: string; csrf: string };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    // Without this req.cookies is undefined, CsrfGuard reads an empty
    // cookie, and the write test below gets its 403 from CSRF rather than
    // from RolesGuard — passing while proving nothing about roles.
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    tokens = moduleRef.get(TokenService);
    sessions = moduleRef.get(SessionsService);
    db = moduleRef.get(DatabaseService);

    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO users (
         full_name, phone_number, joinee_id, password_hash, role, status,
         must_reset_password
       ) VALUES ($1, $2, $3, 'not-a-real-hash', 'employee', 'active', false)
       RETURNING id`,
      ['RBAC Probe', `+1998${stamp % 100000}`, `RBAC-${stamp}`],
    );
    createdUserIds.push(rows[0].id);

    const { sessionId, csrfToken } = await sessions.createSession(rows[0].id, 'rbac-e2e');
    employee = {
      token: tokens.signAccessToken(
        { id: rows[0].id, role: 'employee', department_id: null } as any,
        sessionId,
      ),
      csrf: csrfToken,
    };
  });

  afterAll(async () => {
    await db.query(`DELETE FROM user_sessions WHERE user_id = ANY($1::uuid[])`, [
      createdUserIds,
    ]);
    await db.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [createdUserIds]);
    await app.close();
  });

  // POST /templates is @Roles('superadmin_hr'). The CSRF pair is real —
  // issued with the session above — precisely so that it is NOT what does
  // the rejecting: without it this would be a 403 from CsrfGuard and the
  // test would pass while proving nothing about roles.
  it('rejects a low-privilege role on a superadmin-only write with 403', async () => {
    const res = await request(app.getHttpServer())
      .post('/templates')
      .set('Authorization', `Bearer ${employee.token}`)
      .set('Cookie', [`csrf_token=${employee.csrf}`])
      .set('X-CSRF-Token', employee.csrf)
      .send({});

    expect(res.status).toBe(403);
  });

  // The same guard on a read, where there is no CSRF step at all — so a
  // 403 here can only have come from the role check.
  it('rejects a low-privilege role on a superadmin-only read with 403', async () => {
    const res = await request(app.getHttpServer())
      .get('/activity-logs')
      .set('Authorization', `Bearer ${employee.token}`);

    expect(res.status).toBe(403);
  });

  // Sanity check that the guard is doing the job, not JwtAuthGuard alone:
  // no credential at all must fail DIFFERENTLY (401, unauthenticated) from
  // a valid credential for the wrong role (403, forbidden).
  it('rejects the same read with no token at all as 401, not 403', async () => {
    const res = await request(app.getHttpServer()).get('/activity-logs');
    expect(res.status).toBe(401);
  });
});
