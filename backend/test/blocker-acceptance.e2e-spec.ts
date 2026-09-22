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
 * The acceptance criterion, word for word:
 *
 *   HR blocks "Company email & laptop handover" with the reason "Device
 *   allocation pending" and Friday as the expected date. The HR profile and
 *   the employee's trail both update.
 *
 * Two readers, one write. The point is not that blocking works — that is
 * tested next door — it is that the two people looking at this onboarding
 * from opposite ends see the same thing without anyone telling the other.
 *
 * What this canNOT cover is the phrase "without a page refresh", which is a
 * browser behaviour: both pages poll (AuthContext, StartHere, HrDashboard) so
 * neither needs reloading, but only a browser can demonstrate that. This
 * covers everything underneath it — that a refetch a few seconds later
 * returns the new state to both.
 */
describe('Blocker acceptance (e2e)', () => {
  let app: INestApplication;
  let db: DatabaseService;

  let hr: { token: string; csrf: string };
  let employeeToken: string;
  let employeeId: string;
  let onboardingId: string;
  let handoverTaskId: string;

  const createdUserIds: string[] = [];
  const createdOnboardingIds: string[] = [];
  const stamp = Date.now();

  /** The next Friday, as a real date — the criterion says "Friday". */
  function nextFriday(): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + ((5 - d.getUTCDay() + 7) % 7 || 7));
    return d.toISOString().slice(0, 10);
  }
  const FRIDAY = nextFriday();
  const REASON = 'Device allocation pending';

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

    const mkUser = async (name: string, role: string, suffix: string) => {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO users (full_name, phone_number, joinee_id, password_hash, role,
                            status, must_reset_password)
         VALUES ($1, $2, $3, 'not-a-real-hash', $4, 'active', false) RETURNING id`,
        [name, `+1996${suffix}`, `ACC-${stamp}-${suffix}`, role],
      );
      createdUserIds.push(rows[0].id);
      return rows[0].id;
    };
    const signIn = async (userId: string, role: string) => {
      const { sessionId, csrfToken } = await sessions.createSession(userId, 'acceptance-e2e');
      return {
        token: tokens.signAccessToken(
          { id: userId, role, department_id: null } as any,
          sessionId,
        ),
        csrf: csrfToken,
      };
    };

    const hrId = await mkUser('Acceptance HR', 'superadmin_hr', '0001');
    employeeId = await mkUser('Acceptance Joinee', 'employee', '0002');
    hr = await signIn(hrId, 'superadmin_hr');
    employeeToken = (await signIn(employeeId, 'employee')).token;

    const { rows: dept } = await db.query<{ id: string }>(
      `SELECT id FROM departments ORDER BY name LIMIT 1`,
    );
    const { rows: tpl } = await db.query<{ id: string; version: number }>(
      `SELECT id, version FROM onboarding_templates ORDER BY created_at LIMIT 1`,
    );
    const { rows: onboarding } = await db.query<{ id: string }>(
      `INSERT INTO onboardings (user_id, department_id, template_id, template_version,
                                start_date, status)
       VALUES ($1, $2, $3, $4, CURRENT_DATE, 'active') RETURNING id`,
      [employeeId, dept[0].id, tpl[0].id, tpl[0].version],
    );
    onboardingId = onboarding[0].id;
    createdOnboardingIds.push(onboardingId);

    // The real task, with the real title — the stage gate matches on it.
    const { rows: task } = await db.query<{ id: string }>(
      `INSERT INTO onboarding_tasks (onboarding_id, title, owner_role, due_date, priority,
                                     is_required, completion_mode, is_checkpoint, status)
       VALUES ($1, 'Company email & laptop handover', 'superadmin_hr', CURRENT_DATE,
               'high', true, 'owner', true, 'pending')
       RETURNING id`,
      [onboardingId],
    );
    handoverTaskId = task[0].id;
  });

  afterAll(async () => {
    await db.query(
      `DELETE FROM blockers WHERE onboarding_task_id IN (
         SELECT id FROM onboarding_tasks WHERE onboarding_id = ANY($1::uuid[]))`,
      [createdOnboardingIds],
    );
    await db.query(`DELETE FROM activity_logs WHERE actor_id = ANY($1::uuid[])`, [createdUserIds]);
    await db.query(`DELETE FROM onboarding_tasks WHERE onboarding_id = ANY($1::uuid[])`, [
      createdOnboardingIds,
    ]);
    await db.query(`DELETE FROM onboardings WHERE id = ANY($1::uuid[])`, [createdOnboardingIds]);
    await db.query(`DELETE FROM user_sessions WHERE user_id = ANY($1::uuid[])`, [createdUserIds]);
    await db.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [createdUserIds]);
    await app.close();
  });

  /** What HR sees when they open this joinee's profile. */
  async function hrProfileTask() {
    const res = await request(app.getHttpServer())
      .get(`/employee-profile/${employeeId}`)
      .set('Authorization', `Bearer ${hr.token}`)
      .expect(200);
    return [...res.body.tasks.pending, ...res.body.tasks.completed].find(
      (t: any) => t.id === handoverTaskId,
    );
  }

  /** What the joinee sees on their own trail. */
  async function employeeTrailStep() {
    const res = await request(app.getHttpServer())
      .get('/onboardings/me')
      .set('Authorization', `Bearer ${employeeToken}`)
      .expect(200);
    return res.body.steps.find((s: any) => s.id === handoverTaskId);
  }

  it('shows no blocker to either side before HR acts', async () => {
    expect((await hrProfileTask()).blocker).toBeNull();
    expect((await employeeTrailStep()).blocker).toBeNull();
  });

  it('reaches BOTH the HR profile and the employee trail after HR blocks it', async () => {
    const blocked = await request(app.getHttpServer())
      .post(`/onboarding-tasks/${handoverTaskId}/block`)
      .set('Authorization', `Bearer ${hr.token}`)
      .set('Cookie', [`csrf_token=${hr.csrf}`])
      .set('X-CSRF-Token', hr.csrf)
      .send({ reason: REASON, expectedAt: FRIDAY })
      .expect(201);

    // The date comes back as the day HR picked, not the day before — this is
    // the pg date / JS Date trap, and it is a Friday that matters here.
    expect(blocked.body.expected_at).toBe(FRIDAY);

    // --- HR's profile ---
    const hrTask = await hrProfileTask();
    expect(hrTask.status).toBe('blocked');
    expect(hrTask.blocker).toMatchObject({
      reason: REASON,
      expected_at: FRIDAY,
      owner_role: 'superadmin_hr',
    });

    // --- the employee's trail ---
    // Same facts, same shape, from a completely different endpoint. The
    // joinee learns WHY their onboarding has stopped and WHEN to expect it
    // back, which is the whole point of the feature.
    const step = await employeeTrailStep();
    expect(step.status).toBe('blocked');
    expect(step.blocker).toMatchObject({ reason: REASON, expected_at: FRIDAY });

    // And it still holds its stage: nothing behind it has opened.
    const res = await request(app.getHttpServer())
      .get('/onboardings/me')
      .set('Authorization', `Bearer ${employeeToken}`)
      .expect(200);
    const openAfterIt = res.body.steps.filter(
      (s: any) => s.status !== 'locked' && s.status !== 'completed' && s.id !== handoverTaskId,
    );
    expect(openAfterIt.every((s: any) => !/install/i.test(s.title))).toBe(true);
  });

  it('clears from both sides when HR resolves it', async () => {
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM blockers WHERE onboarding_task_id = $1 AND resolved_at IS NULL`,
      [handoverTaskId],
    );
    await request(app.getHttpServer())
      .post(`/blockers/${rows[0].id}/resolve`)
      .set('Authorization', `Bearer ${hr.token}`)
      .set('Cookie', [`csrf_token=${hr.csrf}`])
      .set('X-CSRF-Token', hr.csrf)
      .send({ note: 'Laptop arrived' })
      .expect(201);

    const hrTask = await hrProfileTask();
    expect(hrTask.blocker).toBeNull();
    expect(hrTask.status).toBe('pending');

    const step = await employeeTrailStep();
    expect(step.blocker).toBeNull();
    expect(step.status).not.toBe('blocked');
  });
});
