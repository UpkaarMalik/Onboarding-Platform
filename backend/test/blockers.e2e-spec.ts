import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
// Namespace import for the same reason main.ts uses one: esModuleInterop
// is off and cookie-parser is a bare-function CommonJS module.
import * as cookieParser from 'cookie-parser';

import { AppModule } from '../src/app.module';
import { TokenService } from '../src/auth/tokens/token.service';
import { SessionsService } from '../src/auth/sessions/sessions.service';
import { DatabaseService } from '../src/database/database.service';

// Same fallback env pattern as the other e2e suites.
// This test performs real writes — use a disposable/dev database,
// never production data.
process.env.DATABASE_URL ??=
  'postgresql://postgres:postgres@localhost:5432/onboarding';

process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';
process.env.JWT_PREAUTH_SECRET ??= 'test-preauth-secret';
process.env.LOGIN_EMAIL_DOMAIN ??= 'id.onboarding.internal';
process.env.TOTP_ISSUER ??= 'Onboarding Platform';

/**
 * OP-36 blockers, end to end.
 *
 * The acceptance path, exactly as written on the ticket: block a task,
 * read the onboarding back and see it blocked with the reason, resolve
 * it, read it back open again.
 *
 * On the two states the ticket names — the ticket says the resolved
 * task reads back as `available`. That word belongs to OP-18's
 * resolveTaskState, which is Track A and is not written yet; nothing in
 * this codebase emits it. Until it lands the equivalent assertion is
 * 'pending', which is what BlockersService restores and what every
 * reader in the app currently understands as "open, nobody has said it
 * is stuck". When OP-18 ships, this file's two `'pending'` assertions
 * are the ones to change.
 *
 * Fixtures are inserted directly rather than driven through
 * POST /onboardings: this suite is about the blocker, and instantiating
 * a real template would make a failure here ambiguous between the two.
 */
describe('Blockers (e2e)', () => {
  const suiteStartedAt = new Date();
  let app: INestApplication;
  let db: DatabaseService;
  let tokens: TokenService;
  let sessions: SessionsService;

  /** A bearer token plus the CSRF pair that every unsafe method needs. */
  interface Creds {
    token: string;
    csrf: string;
  }

  let hrId: string;
  let hr: Creds;
  let employeeId: string;
  let employee: Creds;
  let outsiderId: string;
  let outsider: Creds;

  let onboardingId: string;
  let taskId: string;
  let lockedTaskId: string;
  /** Used only by the permission tests, so they can't leave an open
   *  blocker on the task the main flow needs clean. */
  let permTaskId: string;

  const createdUserIds: string[] = [];
  const createdOnboardingIds: string[] = [];
  const stamp = Date.now();

  /**
   * A real session, because a signed token alone is no longer a
   * credential: JwtStrategy re-reads the user_sessions row on EVERY
   * request, so a fabricated `sid` is rejected as "Session is no longer
   * active".
   *
   * The csrf token comes back from the same call because CsrfGuard is
   * registered globally (APP_GUARD in AuthModule) and rejects every
   * POST/PUT/PATCH/DELETE whose `csrf_token` cookie does not match its
   * `X-CSRF-Token` header — Authorization header or not. Without the
   * pair, every write in this suite returns 403 before reaching the
   * permission check it is meant to be testing.
   */
  async function signIn(userId: string, role: string): Promise<Creds> {
    const { sessionId, csrfToken } = await sessions.createSession(
      userId,
      'blockers-e2e',
    );
    return {
      token: tokens.signAccessToken(
        { id: userId, role, department_id: null } as any,
        sessionId,
      ),
      csrf: csrfToken,
    };
  }

  /** Authenticated POST. Everything a write needs, in one place. */
  function post(path: string, who: Creds) {
    return request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${who.token}`)
      .set('Cookie', [`csrf_token=${who.csrf}`])
      .set('X-CSRF-Token', who.csrf);
  }

  async function createUser(
    fullName: string,
    role: string,
    phoneSuffix: string,
  ): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO users (
         full_name, phone_number, joinee_id, password_hash, role, status,
         must_reset_password
       ) VALUES ($1, $2, $3, 'not-a-real-hash', $4, 'active', false)
       RETURNING id`,
      [fullName, `+1999${phoneSuffix}`, `BLK-${stamp}-${phoneSuffix}`, role],
    );
    createdUserIds.push(rows[0].id);
    return rows[0].id;
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    // main.ts registers this; createNestApplication() does not. Without
    // it req.cookies is undefined, the global CsrfGuard reads an empty
    // cookie and every write in this suite 403s before it reaches the
    // handler — which also makes a permission test pass for the wrong
    // reason.
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    db = moduleRef.get(DatabaseService);
    tokens = moduleRef.get(TokenService);
    sessions = moduleRef.get(SessionsService);

    hrId = await createUser('Blocker Test HR', 'superadmin_hr', '0001');
    employeeId = await createUser('Blocker Test Joinee', 'employee', '0002');
    // A task owner who owns nothing here — the negative case for the
    // "HR or THIS task's owner" rule.
    outsiderId = await createUser('Blocker Test Outsider', 'task_owner', '0003');

    hr = await signIn(hrId, 'superadmin_hr');
    employee = await signIn(employeeId, 'employee');
    outsider = await signIn(outsiderId, 'task_owner');

    const { rows: deptRows } = await db.query<{ id: string }>(
      `SELECT id FROM departments ORDER BY name LIMIT 1`,
    );
    const { rows: tplRows } = await db.query<{ id: string; version: number }>(
      `SELECT id, version FROM onboarding_templates ORDER BY created_at LIMIT 1`,
    );

    const { rows: onboardingRows } = await db.query<{ id: string }>(
      `INSERT INTO onboardings (
         user_id, department_id, template_id, template_version, start_date, status
       ) VALUES ($1, $2, $3, $4, CURRENT_DATE, 'active')
       RETURNING id`,
      [employeeId, deptRows[0].id, tplRows[0].id, tplRows[0].version],
    );
    onboardingId = onboardingRows[0].id;
    createdOnboardingIds.push(onboardingId);

    const { rows: taskRows } = await db.query<{ id: string }>(
      `INSERT INTO onboarding_tasks (
         onboarding_id, title, owner_role, due_date, priority,
         is_required, completion_mode, status
       ) VALUES
         ($1, 'Laptop handover', 'task_owner', CURRENT_DATE, 'high', true, 'owner', 'pending'),
         ($1, 'Install GitHub',  'employee',   CURRENT_DATE, 'normal', true, 'employee', 'locked'),
         ($1, 'Desk allocation', 'task_owner', CURRENT_DATE, 'normal', true, 'owner', 'pending')
       RETURNING id`,
      [onboardingId],
    );
    taskId = taskRows[0].id;
    lockedTaskId = taskRows[1].id;
    permTaskId = taskRows[2].id;
  });

  afterAll(async () => {
    // Children first — blockers and activity_logs both reference rows
    // below, and activity_logs has no DELETE grant for app_runtime but
    // the migrating role this suite connects as can still clear it.
    await db.query(
      `DELETE FROM blockers WHERE onboarding_task_id IN (
         SELECT id FROM onboarding_tasks WHERE onboarding_id = ANY($1::uuid[]))`,
      [createdOnboardingIds],
    );
    await db.query(
      `DELETE FROM activity_logs WHERE actor_id = ANY($1::uuid[])`,
      [createdUserIds],
    );
    await db.query(
      `DELETE FROM onboarding_tasks WHERE onboarding_id = ANY($1::uuid[])`,
      [createdOnboardingIds],
    );
    await db.query(`DELETE FROM onboardings WHERE id = ANY($1::uuid[])`, [
      createdOnboardingIds,
    ]);
    // Notifications for the test users, and the HR fan-out that names them
    // (notifyRole reaches every HR account, real ones included).
    await db.query(
      `DELETE FROM notifications n
        WHERE n.user_id = ANY($1::uuid[])
           OR (n.created_at >= $2 AND EXISTS (
                 SELECT 1 FROM users u
                  WHERE u.id = ANY($1::uuid[]) AND n.title LIKE '%' || u.full_name || '%'))`,
      [createdUserIds, suiteStartedAt],
    );
    await db.query(`DELETE FROM user_sessions WHERE user_id = ANY($1::uuid[])`, [
      createdUserIds,
    ]);
    await db.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [createdUserIds]);
    await app.close();
  });

  /**
   * The employee's own view.
   *
   * /onboardings/me has no `tasks` array — it returns today/upcoming/
   * overdue (raw stored status) AND `steps` (the same rows with
   * applySequenceGate's display rewrite on top). We read the bucket,
   * because that is the stored state this feature actually changes;
   * `steps` is asserted separately below, since the gate can rewrite a
   * status and the two arrays can therefore disagree in one response.
   */
  async function readTaskFromMe() {
    const res = await request(app.getHttpServer())
      .get('/onboardings/me')
      .set('Authorization', `Bearer ${employee.token}`)
      .expect(200);
    const buckets = [...res.body.today, ...res.body.upcoming, ...res.body.overdue];
    return buckets.find((t: any) => t.id === taskId);
  }

  /** The same task as the trail draws it. */
  async function readStepFromMe() {
    const res = await request(app.getHttpServer())
      .get('/onboardings/me')
      .set('Authorization', `Bearer ${employee.token}`)
      .expect(200);
    return res.body.steps.find((t: any) => t.id === taskId);
  }

  /** HR's view of the same task. */
  async function readTaskFromHr() {
    const res = await request(app.getHttpServer())
      .get(`/onboardings/${onboardingId}/tasks`)
      .set('Authorization', `Bearer ${hr.token}`)
      .expect(200);
    return res.body.find((t: any) => t.id === taskId);
  }

  it('reports blocker: null before anything is blocked', async () => {
    expect((await readTaskFromMe()).blocker).toBeNull();
    expect((await readTaskFromHr()).blocker).toBeNull();
  });

  it('rejects a write with no CSRF pair, even with a valid bearer token', async () => {
    // CsrfGuard is registered globally (APP_GUARD in AuthModule) and
    // enforces on every non-GET/HEAD/OPTIONS request regardless of how
    // the caller authenticated. Pinned as a test because it is the
    // failure that makes a permission test pass for the wrong reason:
    // 403 with no CSRF looks identical to 403 from a denied role.
    await request(app.getHttpServer())
      .post(`/onboarding-tasks/${permTaskId}/block`)
      .set('Authorization', `Bearer ${hr.token}`)
      .send({ reason: 'No CSRF header' })
      .expect(403);

    // Same request, same token, cookie and header added: reaches the
    // handler. Resolved immediately so the permission tests below start
    // from a clean task.
    const res = await post(`/onboarding-tasks/${permTaskId}/block`, hr)
      .send({ reason: 'With CSRF header' })
      .expect(201);
    await post(`/blockers/${res.body.id}/resolve`, hr).expect(201);
  });

  it('refuses the employee, who owns nothing and administers nothing', async () => {
    // The joinee the onboarding belongs to. They can see a blocker;
    // they cannot declare their own work stuck.
    await post(`/onboarding-tasks/${permTaskId}/block`, employee)
      .send({ reason: 'I would rather not' })
      .expect(403);
  });

  it('lets a task owner block an unclaimed task of their own role', async () => {
    // The other half of "HR or the task's owner". owner_user_id is
    // NULL here, so the rule is role-based — the same condition
    // completeAsOwner applies to an unclaimed task, deliberately, so a
    // person who could close it can also say it is stuck.
    const res = await post(`/onboarding-tasks/${permTaskId}/block`, outsider)
      .send({ reason: 'No spare desks' })
      .expect(201);
    // Resolved straight away: the main flow below needs a clean slate,
    // and this also exercises an owner resolving their own blocker.
    await post(`/blockers/${res.body.id}/resolve`, outsider).expect(201);
  });

  it('refuses to block a task that has not started', async () => {
    // 'locked' means the sequence has not reached it; nobody can
    // honestly call that stuck, and resolving it would silently unlock
    // work the employee should not see yet.
    await post(`/onboarding-tasks/${lockedTaskId}/block`, hr)
      .send({ reason: 'Too early' })
      .expect(400);
  });

  it('requires a reason', async () => {
    await post(`/onboarding-tasks/${taskId}/block`, hr).send({}).expect(400);
  });

  it('blocks, reads back blocked with the reason, resolves, reads back open', async () => {
    const blockRes = await post(`/onboarding-tasks/${taskId}/block`, hr)
      .send({ reason: 'Out of stock', expectedAt: '2026-09-25', ownerRole: 'task_owner' })
      .expect(201);

    const blockerId = blockRes.body.id;
    expect(blockerId).toBeDefined();

    // --- the employee's trail ---
    const mineBlocked = await readTaskFromMe();
    expect(mineBlocked.status).toBe('blocked');
    expect(mineBlocked.blocker).toMatchObject({
      reason: 'Out of stock',
      owner_role: 'task_owner',
      expected_at: '2026-09-25',
    });
    // Five facts, not a badge: since when is the one HR is asked on Slack.
    expect(mineBlocked.blocker.waiting_since).toBeTruthy();

    // --- and the trail agrees ---
    // applySequenceGate passes a blocked task through untouched when it
    // is the open step ("'blocked' is a real state of the task itself
    // and outranks the gate"), so the reason reaches the roadmap too.
    const stepBlocked = await readStepFromMe();
    expect(stepBlocked.status).toBe('blocked');
    expect(stepBlocked.blocker.reason).toBe('Out of stock');

    // --- HR's list of the same onboarding ---
    const hrBlocked = await readTaskFromHr();
    expect(hrBlocked.status).toBe('blocked');
    expect(hrBlocked.blocker.reason).toBe('Out of stock');
    // The denormalised mirror the five pre-existing HR queries read.
    expect(hrBlocked.blocked_reason).toBe('Out of stock');

    // --- one open blocker per task, enforced by the partial index ---
    await post(`/onboarding-tasks/${taskId}/block`, hr)
      .send({ reason: 'Still out of stock' })
      .expect(409);

    // --- an employee cannot clear their own blocker ---
    await request(app.getHttpServer())
      .post(`/blockers/${blockerId}/resolve`)
      .set('Authorization', `Bearer ${employee.token}`)
      .expect(403);

    // --- resolve ---
    await post(`/blockers/${blockerId}/resolve`, hr).expect(201);

    // OP-18 will make this 'available'; 'pending' is today's equivalent.
    const mineOpen = await readTaskFromMe();
    expect(mineOpen.status).toBe('pending');
    expect(mineOpen.blocker).toBeNull();

    const hrOpen = await readTaskFromHr();
    expect(hrOpen.status).toBe('pending');
    expect(hrOpen.blocker).toBeNull();
    expect(hrOpen.blocked_reason).toBeNull();

    // --- resolving twice is a conflict, not a second write ---
    await post(`/blockers/${blockerId}/resolve`, hr).expect(409);
  });

  /* The HR home's greeting line. It is counted here rather than reduced in
     the browser because "blocked" is a join the roster rows do not carry, and
     because the lists it used to be derived from are capped at limit=100 and
     limit=50. Asserted as a DELTA: this suite runs against a dev database
     that already has other onboardings in it, so the absolute number is not
     the suite's to know. */
  async function readSummary() {
    const res = await request(app.getHttpServer())
      .get('/onboardings/summary')
      .set('Authorization', `Bearer ${hr.token}`)
      .expect(200);
    return res.body as { onboarding: number; blocked: number };
  }

  it('counts a blocked joinee in the summary, and stops when it resolves', async () => {
    const before = await readSummary();
    // This suite's own onboarding is 'active', so it is already counted.
    expect(before.onboarding).toBeGreaterThan(0);

    const res = await post(`/onboarding-tasks/${permTaskId}/block`, hr)
      .send({ reason: 'Counted' })
      .expect(201);

    const during = await readSummary();
    expect(during.blocked).toBe(before.blocked + 1);
    // Blocked is a SUBSET of onboarding — the joinee did not become a new one.
    expect(during.onboarding).toBe(before.onboarding);
    expect(during.blocked).toBeLessThanOrEqual(during.onboarding);

    // A second blocker on the SAME onboarding must not count the joinee
    // twice: the line says how many people are stuck, not how many tasks.
    await post(`/onboarding-tasks/${taskId}/block`, hr)
      .send({ reason: 'Also counted' })
      .expect(201);
    const two = await readSummary();
    expect(two.blocked).toBe(before.blocked + 1);

    await post(`/blockers/${res.body.id}/resolve`, hr).expect(201);
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM blockers WHERE onboarding_task_id = $1 AND resolved_at IS NULL`,
      [taskId],
    );
    await post(`/blockers/${rows[0].id}/resolve`, hr).expect(201);

    const after = await readSummary();
    expect(after).toEqual(before);
  });

  it('records the resolution note in the activity log, not on the blocker', async () => {
    // The note is audit information — written once, never edited, only read
    // back as history — so it lives in the append-only log rather than as a
    // nullable column that would be a second, weaker home for the same fact.
    const res = await post(`/onboarding-tasks/${permTaskId}/block`, hr)
      .send({ reason: 'Waiting on IT', expectedAt: '2026-09-25' })
      .expect(201);
    expect(res.body.expected_at).toBe('2026-09-25');

    await post(`/blockers/${res.body.id}/resolve`, hr)
      .send({ note: 'Laptop arrived and was handed over' })
      .expect(201);

    const { rows } = await db.query<{ metadata: any }>(
      `SELECT metadata FROM activity_logs
        WHERE action = 'blocker.resolved' AND entity_id = $1
        ORDER BY created_at DESC LIMIT 1`,
      [permTaskId],
    );
    expect(rows[0].metadata.note).toBe('Laptop arrived and was handed over');

    // And resolving without one is still fine — the note is optional.
    const second = await post(`/onboarding-tasks/${permTaskId}/block`, hr)
      .send({ reason: 'Again' })
      .expect(201);
    await post(`/blockers/${second.body.id}/resolve`, hr).send({}).expect(201);
  });

  it('keeps the summary to HR', async () => {
    await request(app.getHttpServer())
      .get('/onboardings/summary')
      .set('Authorization', `Bearer ${employee.token}`)
      .expect(403);
  });

  it('writes an activity log entry for both the block and the resolve', async () => {
    const { rows } = await db.query<{ action: string }>(
      `SELECT action FROM activity_logs
        WHERE entity_type = 'onboarding_task' AND entity_id = $1
          AND action IN ('onboarding_task.blocked', 'blocker.resolved')
        ORDER BY created_at`,
      [taskId],
    );
    // Not an exact two-element array: this task is blocked and resolved more
    // than once across the suite, and pinning the length would just make the
    // test brittle to adding another case. The invariant that matters is that
    // the two always come in that order and neither ever goes unlogged.
    const actions = rows.map((r) => r.action);
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.length % 2).toBe(0);
    actions.forEach((action, i) => {
      expect(action).toBe(i % 2 === 0 ? 'onboarding_task.blocked' : 'blocker.resolved');
    });
  });
});
