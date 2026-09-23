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
 * Manager and buddy are users picked from people who have completed their
 * own onboarding (docs/decisions/002-manager-buddy.md), and the picked
 * people own the joinee's "Meet your…" tasks.
 */
describe('Manager and buddy (e2e)', () => {
  const suiteStartedAt = new Date();
  const stamp = Date.now();
  let app: INestApplication;
  let db: DatabaseService;
  let hr: { token: string; csrf: string };
  const ids: Record<'hr' | 'graduate' | 'rookie' | 'joinee', string> = {} as any;
  const createdUserIds: string[] = [];
  const onboardingIds: string[] = [];

  const send = (method: 'post' | 'patch' | 'get', path: string) =>
    request(app.getHttpServer())
      [method](path)
      .set('Authorization', `Bearer ${hr.token}`)
      .set('Cookie', [`csrf_token=${hr.csrf}`])
      .set('X-CSRF-Token', hr.csrf);

  async function meetOwner(onboardingId: string, title: string) {
    const { rows } = await db.query<{ owner_user_id: string | null }>(
      `SELECT owner_user_id FROM onboarding_tasks WHERE onboarding_id = $1 AND title = $2`,
      [onboardingId, title],
    );
    return rows[0].owner_user_id;
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    db = moduleRef.get(DatabaseService);

    const { rows: dept } = await db.query<{ id: string }>(`SELECT id FROM departments WHERE name = 'Engineering'`);
    const people: Array<[keyof typeof ids, string]> = [
      ['hr', 'superadmin_hr'],
      ['graduate', 'employee'],
      ['rookie', 'employee'],
      ['joinee', 'employee'],
    ];
    for (const [key, role] of people) {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO users (full_name, phone_number, joinee_id, password_hash, role,
                            department_id, status, must_reset_password)
         VALUES ($1, $2, $3, 'not-a-real-hash', $4, $5, 'active', false) RETURNING id`,
        [`MB ${key} ${stamp}`, `+1991${createdUserIds.length}${stamp % 100000}`, `MB-${stamp}-${key}`, role,
         role === 'employee' ? dept[0].id : null],
      );
      ids[key] = rows[0].id;
      createdUserIds.push(rows[0].id);
    }
    const s = await moduleRef.get(SessionsService).createSession(ids.hr, 'mb-e2e');
    hr = {
      token: moduleRef.get(TokenService).signAccessToken({ id: ids.hr, role: 'superadmin_hr', department_id: null } as any, s.sessionId),
      csrf: s.csrfToken,
    };

    // The graduate finished onboarding; the rookie is still mid-way.
    const { rows: tpl } = await db.query<{ id: string; version: number }>(
      `SELECT id, version FROM onboarding_templates WHERE department_id = $1 AND is_active`,
      [dept[0].id],
    );
    for (const [key, status] of [['graduate', 'completed'], ['rookie', 'active']] as const) {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO onboardings (user_id, department_id, template_id, template_version, start_date, status)
         VALUES ($1, $2, $3, $4, CURRENT_DATE - 30, $5) RETURNING id`,
        [ids[key], dept[0].id, tpl[0].id, tpl[0].version, status],
      );
      onboardingIds.push(rows[0].id);
    }
  });

  afterAll(async () => {
    const tasks = `SELECT id FROM onboarding_tasks WHERE onboarding_id = ANY($1::uuid[])`;
    await db.query(
      `DELETE FROM notifications n WHERE n.user_id = ANY($1::uuid[])
          OR (n.created_at >= $2 AND n.title LIKE '%MB joinee ${stamp}%')`,
      [createdUserIds, suiteStartedAt],
    );
    await db.query(`DELETE FROM onboarding_subtasks WHERE onboarding_task_id IN (${tasks})`, [onboardingIds]);
    await db.query(`DELETE FROM onboarding_tasks WHERE onboarding_id = ANY($1::uuid[])`, [onboardingIds]);
    await db.query(`DELETE FROM onboardings WHERE id = ANY($1::uuid[])`, [onboardingIds]);
    await db.query(`DELETE FROM activity_logs WHERE actor_id = ANY($1::uuid[])`, [createdUserIds]);
    await db.query(`DELETE FROM user_sessions WHERE user_id = ANY($1::uuid[])`, [createdUserIds]);
    await db.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [createdUserIds]);
    await app.close();
  });

  it('offers only people who have completed their own onboarding', async () => {
    const res = await send('get', '/onboardings/eligible-people').expect(200);
    const offered = res.body.map((p: { id: string }) => p.id);
    expect(offered).toContain(ids.graduate);
    expect(offered).not.toContain(ids.rookie);
    expect(offered).not.toContain(ids.hr);
  });

  it('refuses a manager who has not finished onboarding', async () => {
    await send('post', '/onboardings')
      .send({ userId: ids.joinee, startDate: '2026-10-01', managerUserId: ids.rookie })
      .expect(400);
  });

  it('gives the picked manager their "Meet your reporting manager" task, and follows edits', async () => {
    const created = await send('post', '/onboardings')
      .send({ userId: ids.joinee, startDate: '2026-10-01', managerUserId: ids.graduate })
      .expect(201);
    const onboardingId = created.body.id;
    onboardingIds.push(onboardingId);

    expect(await meetOwner(onboardingId, 'Meet your reporting manager')).toBe(ids.graduate);
    expect(await meetOwner(onboardingId, 'Meet your onboarding buddy')).toBeNull();

    // From the profile: add the buddy, clear the manager.
    await send('patch', `/onboardings/${onboardingId}/assignments`)
      .send({ buddyUserId: ids.graduate, managerUserId: null })
      .expect(200);
    expect(await meetOwner(onboardingId, 'Meet your onboarding buddy')).toBe(ids.graduate);
    expect(await meetOwner(onboardingId, 'Meet your reporting manager')).toBeNull();

    const { rows } = await db.query(
      `SELECT manager_user_id, buddy_user_id, manager_name, buddy_name FROM onboardings WHERE id = $1`,
      [onboardingId],
    );
    expect(rows[0]).toEqual({
      manager_user_id: null,
      buddy_user_id: ids.graduate,
      manager_name: null,
      buddy_name: `MB graduate ${stamp}`,
    });
  });
});
