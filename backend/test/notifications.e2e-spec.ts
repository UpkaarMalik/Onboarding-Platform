import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';

import { AppModule } from '../src/app.module';
import { TokenService } from '../src/auth/tokens/token.service';
import { SessionsService } from '../src/auth/sessions/sessions.service';
import { DatabaseService } from '../src/database/database.service';
import { NotificationsService } from '../src/notifications/notifications.service';

process.env.DATABASE_URL ??=
  'postgresql://postgres:postgres@localhost:5432/onboarding';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';
process.env.JWT_PREAUTH_SECRET ??= 'test-preauth-secret';
process.env.LOGIN_EMAIL_DOMAIN ??= 'id.onboarding.internal';
process.env.TOTP_ISSUER ??= 'Onboarding Platform';

/** A notification is for one person. User B must not be able to list,
 *  count, or mark read one that belongs to user A. */
describe('Notifications (e2e)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  const userIds: string[] = [];
  const tokens: string[] = [];
  const csrfs: string[] = [];

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
    const tokenService = moduleRef.get(TokenService);
    const sessions = moduleRef.get(SessionsService);

    for (const label of ['A', 'B']) {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO users (full_name, phone_number, joinee_id, password_hash, role,
                            status, must_reset_password)
         VALUES ($1, $2, $3, 'not-a-real-hash', 'employee', 'active', false)
         RETURNING id`,
        [`Notif Test ${label}`, `+1997${label === 'A' ? 1 : 2}${Date.now() % 100000}`, `NTF-${label}-${Date.now()}`],
      );
      userIds.push(rows[0].id);
      const { sessionId, csrfToken } = await sessions.createSession(rows[0].id, 'notifications-e2e');
      csrfs.push(csrfToken);
      tokens.push(
        tokenService.signAccessToken(
          { id: rows[0].id, role: 'employee', department_id: null } as any,
          sessionId,
        ),
      );
    }

    await moduleRef
      .get(NotificationsService)
      .notify(userIds[0], 'document_approved', 'Your PAN Card was approved', null, '/start-here');
  });

  afterAll(async () => {
    await db.query(`DELETE FROM notifications WHERE user_id = ANY($1::uuid[])`, [userIds]);
    await db.query(`DELETE FROM user_sessions WHERE user_id = ANY($1::uuid[])`, [userIds]);
    await db.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [userIds]);
    await app.close();
  });

  const as = (i: number) => (req: request.Test) =>
    req
      .set('Authorization', `Bearer ${tokens[i]}`)
      .set('Cookie', [`csrf_token=${csrfs[i]}`])
      .set('X-CSRF-Token', csrfs[i]);

  it("user A sees their notification; user B sees nothing and cannot mark it read", async () => {
    const a = await as(0)(request(app.getHttpServer()).get('/notifications')).expect(200);
    expect(a.body.unreadCount).toBe(1);
    expect(a.body.data[0].title).toBe('Your PAN Card was approved');
    const id = a.body.data[0].id;

    const b = await as(1)(request(app.getHttpServer()).get('/notifications')).expect(200);
    expect(b.body).toEqual({ data: [], unreadCount: 0 });

    await as(1)(request(app.getHttpServer()).post(`/notifications/${id}/read`)).expect(404);

    await as(0)(request(app.getHttpServer()).post(`/notifications/${id}/read`)).expect(204);
    const after = await as(0)(
      request(app.getHttpServer()).get('/notifications?unread=true'),
    ).expect(200);
    expect(after.body).toEqual({ data: [], unreadCount: 0 });
  });
});
