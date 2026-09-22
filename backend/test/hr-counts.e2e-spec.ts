import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';

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
 * The contract the HR home's headline numbers depend on.
 *
 * The bug this guards: HrDashboard read `data.length` from
 * /onboardings?limit=100 and called it the number of joinees. That is right
 * only while the org fits in one page, and then it freezes at 100 forever
 * with nothing to indicate it has. The fix reads `total`, so what actually
 * matters is that `total` counts the QUERY and `data` counts the PAGE — and
 * that they are allowed to differ. A test that asks for everything can never
 * show that, so this one deliberately asks for one row.
 *
 * Read-only: it creates an HR user and a session to authenticate with, and
 * nothing else. The onboardings it counts are whatever the database already
 * holds.
 */
describe('HR headline counts (e2e)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let hrToken: string;
  const createdUserIds: string[] = [];

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
    const tokens = moduleRef.get(TokenService);
    const sessions = moduleRef.get(SessionsService);

    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO users (full_name, phone_number, joinee_id, password_hash, role,
                          status, must_reset_password)
       VALUES ('Counts Test HR', $1, $2, 'not-a-real-hash', 'superadmin_hr', 'active', false)
       RETURNING id`,
      [`+1998${Date.now() % 100000}`, `CNT-${Date.now()}`],
    );
    createdUserIds.push(rows[0].id);
    const { sessionId } = await sessions.createSession(rows[0].id, 'counts-e2e');
    hrToken = tokens.signAccessToken(
      { id: rows[0].id, role: 'superadmin_hr', department_id: null } as any,
      sessionId,
    );
  });

  afterAll(async () => {
    await db.query(`DELETE FROM user_sessions WHERE user_id = ANY($1::uuid[])`, [
      createdUserIds,
    ]);
    await db.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [createdUserIds]);
    await app.close();
  });

  it('returns a total that counts the query, not the page', async () => {
    const full = await request(app.getHttpServer())
      .get('/onboardings?limit=100')
      .set('Authorization', `Bearer ${hrToken}`)
      .expect(200);

    const onePage = await request(app.getHttpServer())
      .get('/onboardings?limit=1')
      .set('Authorization', `Bearer ${hrToken}`)
      .expect(200);

    // The page shrank; the count did not. This is the entire distinction the
    // dashboard was missing.
    expect(onePage.body.data).toHaveLength(1);
    expect(onePage.body.total).toBe(full.body.total);
    expect(onePage.body.total).toBeGreaterThan(onePage.body.data.length);

    // And `total` is a number the UI can render directly, not a string from
    // pg that would concatenate instead of add.
    expect(typeof onePage.body.total).toBe('number');
  });

  it('agrees with the greeting summary about how many are running', async () => {
    const summary = await request(app.getHttpServer())
      .get('/onboardings/summary')
      .set('Authorization', `Bearer ${hrToken}`)
      .expect(200);
    const all = await request(app.getHttpServer())
      .get('/onboardings?limit=1')
      .set('Authorization', `Bearer ${hrToken}`)
      .expect(200);

    // The summary counts RUNNING onboardings, the list counts all of them, so
    // the summary can never be the larger of the two. Two numbers sit side by
    // side on that page; if they ever disagree in that direction, one of them
    // is counting the wrong thing.
    expect(summary.body.onboarding).toBeLessThanOrEqual(all.body.total);
    expect(summary.body.blocked).toBeLessThanOrEqual(summary.body.onboarding);
  });
});
