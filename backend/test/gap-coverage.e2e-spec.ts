
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';

import { AppModule } from '../src/app.module';
import { TokenService } from '../src/auth/tokens/token.service';
import { SessionsService } from '../src/auth/sessions/sessions.service';
import { DatabaseService } from '../src/database/database.service';

// This suite performs real writes.
// Always point DATABASE_URL at a disposable/dev database.
process.env.DATABASE_URL ??=
  'postgresql://postgres:postgres@localhost:5432/onboarding';

process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';
process.env.JWT_PREAUTH_SECRET ??= 'test-preauth-secret';
process.env.LOGIN_EMAIL_DOMAIN ??= 'id.onboarding.internal';
process.env.TOTP_ISSUER ??= 'Onboarding Platform';

describe('Step 37 gap coverage (e2e)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let tokens: TokenService;

  let sessions: SessionsService;

  /** A credential: the bearer token and the CSRF value bound to the same
   *  session row. Writes need both — CsrfGuard is global and runs before
   *  the route's auth guard. */
  interface Creds {
    token: string;
    csrf: string;
  }

  let superadmin: Creds;
  let engineeringDeptId: string;

  const stamp = Date.now();
  const createdUserIds: string[] = [];
  const createdOnboardingIds: string[] = [];
  /** Sessions opened on accounts this suite did NOT create (the real
   *  superadmin), removed by id so nobody is signed out of their browser. */
  const createdSessionIds: string[] = [];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    // main.ts registers this; createNestApplication() does not. Without it
    // req.cookies is undefined and CsrfGuard 403s every write.
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

    /*
     * A REAL superadmin, not a syntactically-valid invention.
     *
     * This used to be a made-up UUID on the grounds that the token only
     * needed to be signable. That stopped being true at migration 0029:
     * JwtStrategy re-reads the user_sessions row on every request, and a
     * session cannot be opened for a user that does not exist.
     */
    const { rows: adminRows } = await db.query<{ id: string }>(
      `SELECT id FROM users
        WHERE role = 'superadmin_hr' AND deleted_at IS NULL AND status <> 'disabled'
        ORDER BY created_at
        LIMIT 1`,
    );
    if (!adminRows[0]) {
      throw new Error(
        'No active superadmin_hr user found — seed one before running this suite.',
      );
    }
    superadmin = await signIn(adminRows[0].id, 'superadmin_hr');

    const { rows } = await db.query<{ id: string }>(
      `SELECT id
       FROM departments
       WHERE name = 'Engineering'`,
    );

    if (!rows[0]) {
      throw new Error(
        'Engineering department not found — run migrations against this DATABASE_URL first.',
      );
    }

    engineeringDeptId = rows[0].id;
  });

  afterAll(async () => {
    /*
     * Delete onboarding tasks before onboardings because of FK constraints.
     */
    if (createdOnboardingIds.length) {
      /*
       * Subtasks before tasks: templates seed checklist items as of
       * migration 0034 and onboarding_subtasks has no cascade.
       */
      await db.query(
        `DELETE FROM onboarding_subtasks
          WHERE onboarding_task_id IN (
            SELECT id FROM onboarding_tasks
             WHERE onboarding_id = ANY($1::uuid[]))`,
        [createdOnboardingIds],
      );

      await db.query(
        `DELETE FROM onboarding_tasks
         WHERE onboarding_id = ANY($1::uuid[])`,
        [createdOnboardingIds],
      );

      await db.query(
        `DELETE FROM onboardings
         WHERE id = ANY($1::uuid[])`,
        [createdOnboardingIds],
      );
    }

    if (createdSessionIds.length) {
      await db.query(`DELETE FROM user_sessions WHERE id = ANY($1::uuid[])`, [
        createdSessionIds,
      ]);
    }

    /*
     * Activity logs reference users through actor_id.
     * Therefore activity logs must be deleted BEFORE users.
     */
    if (createdUserIds.length) {
      await db.query(
        `DELETE FROM activity_logs
         WHERE actor_id = ANY($1::uuid[])`,
        [createdUserIds],
      );

      await db.query(
        `DELETE FROM user_sessions
         WHERE user_id = ANY($1::uuid[])`,
        [createdUserIds],
      );

      await db.query(
        `DELETE FROM users
         WHERE id = ANY($1::uuid[])`,
        [createdUserIds],
      );
    }

    await app.close();
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * A real session, because a signed token alone is no longer a credential:
   * JwtStrategy re-reads the user_sessions row on EVERY request, so a
   * fabricated `sid` comes back as "Session is no longer active".
   *
   * The CSRF value is issued by the same call because CsrfGuard binds the
   * header to that session's stored hash — a made-up pair does not pass.
   */
  async function signIn(userId: string, role: string): Promise<Creds> {
    const { sessionId, csrfToken } = await sessions.createSession(
      userId,
      'gap-coverage-e2e',
    );
    createdSessionIds.push(sessionId);
    return {
      token: tokens.signAccessToken(
        { id: userId, role, department_id: null } as any,
        sessionId,
      ),
      csrf: csrfToken,
    };
  }

  /**
   * Turns one of an onboarding's task_owner tasks into something a
   * task_owner can actually claim, by giving it an owner side.
   *
   * See the long note at the call site for why this cannot be done
   * through the API.
   */
  async function makeClaimable(
    tasks: Array<Record<string, any>>,
  ): Promise<Record<string, any>> {
    const target = tasks.find(
      (task) => task.owner_role === 'task_owner' && !task.is_checkpoint,
    );
    expect(target).toBeDefined();
    await db.query(
      `UPDATE onboarding_tasks SET completion_mode = 'dual' WHERE id = $1`,
      [target!.id],
    );
    return target!;
  }

  /** Authenticated write. Everything CsrfGuard and JwtStrategy need, once. */
  function authedPost(path: string, who: Creds) {
    return request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${who.token}`)
      .set('Cookie', [`csrf_token=${who.csrf}`])
      .set('X-CSRF-Token', who.csrf);
  }

  async function createUser(
    fullName: string,
    role: 'employee' | 'task_owner',
    departmentId?: string,
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/users')
      .set('Authorization', `Bearer ${superadmin.token}`)
      .set('Cookie', [`csrf_token=${superadmin.csrf}`])
      .set('X-CSRF-Token', superadmin.csrf)
      .send({
        fullName,
        /* Stamped. These were a fixed +1000000100N series, so any run
           whose teardown did not finish left rows that made every later
           run fail on the phone_number unique constraint — a stale row
           reported as a broken test. */
        phoneNumber: `+1${String(stamp).slice(-6)}${String(
          1000 + createdUserIds.length,
        ).padStart(4, '0')}`,
        role,
        ...(departmentId ? { departmentId } : {}),
      });

    expect(res.status).toBe(201);

    const userId = res.body.user.id as string;

    createdUserIds.push(userId);

    return userId;
  }

  async function createOnboarding(
    userId: string,
    startDate: string,
  ): Promise<{
    onboardingId: string;
    tasks: Array<Record<string, any>>;
  }> {
    const res = await request(app.getHttpServer())
      .post('/onboardings')
      .set('Authorization', `Bearer ${superadmin.token}`)
      .set('Cookie', [`csrf_token=${superadmin.csrf}`])
      .set('X-CSRF-Token', superadmin.csrf)
      .send({
        userId,
        startDate,
      });

    expect(res.status).toBe(201);

    const onboardingId = res.body.id as string;

    createdOnboardingIds.push(onboardingId);

    return {
      onboardingId,
      tasks: res.body.tasks as Array<Record<string, any>>,
    };
  }

  // Some list endpoints in the current implementation return a plain
  // array, while paginated endpoints return { data, total, limit, offset }.
  // This helper lets the test assert the actual contract without assuming
  // every list endpoint is paginated.
  function responseItems(body: any): any[] {
    if (Array.isArray(body)) {
      return body;
    }

    if (Array.isArray(body?.data)) {
      return body.data;
    }

    return [];
  }

  // ---------------------------------------------------------------------------
  // Employee isolation
  // ---------------------------------------------------------------------------

  describe('employee isolation', () => {
    it(
      'an employee only ever sees their own onboarding via /onboardings/me, ' +
        'and cannot reach HR-only endpoints',
      async () => {
        const employeeAId = await createUser(
          'Isolation Employee A',
          'employee',
          engineeringDeptId,
        );

        const employeeBId = await createUser(
          'Isolation Employee B',
          'employee',
          engineeringDeptId,
        );

        const { onboardingId: onboardingAId } =
          await createOnboarding(employeeAId, '2026-09-08');

        await createOnboarding(employeeBId, '2026-09-08');

        const tokenA = await signIn(employeeAId, 'employee');

        const meRes = await request(app.getHttpServer())
          .get('/onboardings/me')
          .set('Authorization', `Bearer ${tokenA.token}`);

        expect(meRes.status).toBe(200);

        /*
         * Current dashboard response contains the onboarding.
         */
        expect(meRes.body.onboarding.id).toBe(onboardingAId);

        const listAllRes = await request(app.getHttpServer())
          .get('/onboardings')
          .set('Authorization', `Bearer ${tokenA.token}`);

        expect(listAllRes.status).toBe(403);

        const stuckRes = await request(app.getHttpServer())
          .get('/onboardings/stuck')
          .set('Authorization', `Bearer ${tokenA.token}`);

        expect(stuckRes.status).toBe(403);

        const auditRes = await request(app.getHttpServer())
          .get('/activity-logs')
          .set('Authorization', `Bearer ${tokenA.token}`);

        expect(auditRes.status).toBe(403);
      },
    );

    it(
      'a task_owner cannot call the employee-only /onboardings/me',
      async () => {
        const taskOwnerId = await createUser(
          'Isolation Task Owner',
          'task_owner',
        );

        const ownerToken = await signIn(taskOwnerId, 'task_owner');

        const res = await request(app.getHttpServer())
          .get('/onboardings/me')
          .set('Authorization', `Bearer ${ownerToken.token}`);

        expect(res.status).toBe(403);
      },
    );
  });

  // ---------------------------------------------------------------------------
  // Task-owner isolation
  // ---------------------------------------------------------------------------

  describe('task owner isolation', () => {
    it(
      "a task_owner's /onboarding-tasks/mine never includes another " +
        "task_owner's claimed tasks",
      async () => {
        const employeeXId = await createUser(
          'Isolation Employee X',
          'employee',
          engineeringDeptId,
        );

        const employeeYId = await createUser(
          'Isolation Employee Y',
          'employee',
          engineeringDeptId,
        );

        const { tasks: tasksX } = await createOnboarding(
          employeeXId,
          '2026-09-08',
        );

        const { tasks: tasksY } = await createOnboarding(
          employeeYId,
          '2026-09-08',
        );

        /*
         * The claimable task has to be MADE, because nothing can create
         * one any more.
         *
         * This used to grab the onboarding's checkpoint. Migration 0031
         * moved that to HR (owner_role superadmin_hr), so a task_owner
         * claiming it is now a 403 — correctly. Nor is there another
         * candidate: migration 0028 pinned completionMode to
         * @IsIn(['employee']) in BOTH the template DTO and the ad-hoc
         * task DTO, and claimTask's first guard rejects exactly that
         * ("this task has no owner side to claim"). Between them, no
         * current code path produces a claimable task at all.
         *
         * Promoting two rows directly keeps the rule this test exists for
         * — one owner's claim never shows up in another's
         * /onboarding-tasks/mine — exercised against the real endpoints.
         * That logic still runs for every pre-0028 row, of which this
         * database has plenty, so deleting the coverage would be worse
         * than hand-making the fixture.
         */
        const checkpointX = await makeClaimable(tasksX);
        const checkpointY = await makeClaimable(tasksY);

        const ownerXId = await createUser(
          'Isolation Owner X',
          'task_owner',
        );

        const ownerYId = await createUser(
          'Isolation Owner Y',
          'task_owner',
        );

        const ownerXToken = await signIn(ownerXId, 'task_owner');

        const ownerYToken = await signIn(ownerYId, 'task_owner');

        const claimXRes = await authedPost(
          `/onboarding-tasks/${checkpointX!.id}/claim`,
          ownerXToken,
        ).send();

        expect(claimXRes.status).toBe(201);

        const claimYRes = await authedPost(
          `/onboarding-tasks/${checkpointY!.id}/claim`,
          ownerYToken,
        ).send();

        expect(claimYRes.status).toBe(201);

        const mineXRes = await request(app.getHttpServer())
          .get('/onboarding-tasks/mine')
          .set('Authorization', `Bearer ${ownerXToken.token}`);

        expect(mineXRes.status).toBe(200);

        /*
         * IMPORTANT:
         * listMyTasks currently returns the list directly, not necessarily
         * { data: [...] }. Therefore do not blindly use body.data.
         */
        const mineX = responseItems(mineXRes.body);

        const mineXIds = mineX.map((task: any) => task.id);

        expect(mineXIds).toContain(checkpointX!.id);
        expect(mineXIds).not.toContain(checkpointY!.id);
      },
    );
  });

  // ---------------------------------------------------------------------------
  // Notes isolation — REMOVED
  //
  // This section tested GET/POST /notes for cross-employee isolation. There is
  // no notes module in src/ any more: the feature was taken out, so every
  // request here 404s and the isolation it once guarded does not exist to be
  // broken. Deleted rather than skipped, because a skipped test for a deleted
  // feature reads as coverage somebody still owes.
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Filtering / sorting / pagination
  // ---------------------------------------------------------------------------

  describe('filtering, sorting, and pagination (Step 32/33)', () => {
    it('rejects an unrecognized filter key with 400', async () => {
      const res = await request(app.getHttpServer())
        .get('/onboardings')
        .query({
          bogus: 'x',
        })
        .set('Authorization', `Bearer ${superadmin.token}`);

      expect(res.status).toBe(400);
    });

    it('rejects an unrecognized sort field with 400', async () => {
      const res = await request(app.getHttpServer())
        .get('/onboardings')
        .query({
          sort: 'bogus',
        })
        .set('Authorization', `Bearer ${superadmin.token}`);

      expect(res.status).toBe(400);
    });

    it('rejects an out-of-range limit with 400', async () => {
      const tooBig = await request(app.getHttpServer())
        .get('/onboardings')
        .query({
          limit: '1000',
        })
        .set('Authorization', `Bearer ${superadmin.token}`);

      expect(tooBig.status).toBe(400);

      const zero = await request(app.getHttpServer())
        .get('/onboardings')
        .query({
          limit: '0',
        })
        .set('Authorization', `Bearer ${superadmin.token}`);

      expect(zero.status).toBe(400);
    });

    it('actually sorts by startDate, ascending and descending', async () => {
      const employeeEarlyId = await createUser(
        'Sort Early',
        'employee',
        engineeringDeptId,
      );

      const employeeLateId = await createUser(
        'Sort Late',
        'employee',
        engineeringDeptId,
      );

      const { onboardingId: earlyId } = await createOnboarding(
        employeeEarlyId,
        '2026-09-01',
      );

      const { onboardingId: lateId } = await createOnboarding(
        employeeLateId,
        '2026-09-20',
      );

      /*
       * Do not send the department UUID here.
       *
       * The purpose of this assertion is sorting, so keep it independent
       * of department filtering.
       */
      const ascRes = await request(app.getHttpServer())
        .get('/onboardings')
        .query({
          sort: 'startDate',
          limit: '100',
        })
        .set('Authorization', `Bearer ${superadmin.token}`);

      expect(ascRes.status).toBe(200);

      const ascItems = responseItems(ascRes.body);

      const ascOurs = ascItems.filter((onboarding: any) =>
        [earlyId, lateId].includes(onboarding.id),
      );

      expect(ascOurs.map((onboarding: any) => onboarding.id)).toEqual([
        earlyId,
        lateId,
      ]);

      const descRes = await request(app.getHttpServer())
        .get('/onboardings')
        .query({
          sort: '-startDate',
          limit: '100',
        })
        .set('Authorization', `Bearer ${superadmin.token}`);

      expect(descRes.status).toBe(200);

      const descItems = responseItems(descRes.body);

      const descOurs = descItems.filter((onboarding: any) =>
        [earlyId, lateId].includes(onboarding.id),
      );

      expect(descOurs.map((onboarding: any) => onboarding.id)).toEqual([
        lateId,
        earlyId,
      ]);
    });

    it(
      'limit/offset actually page through onboardings, ' +
        'with an accurate total',
      async () => {
        /*
         * Test pagination on /onboardings because this is the Step 33
         * pagination endpoint.
         */

        const employeeAId = await createUser(
          'Pagination Employee A',
          'employee',
          engineeringDeptId,
        );

        const employeeBId = await createUser(
          'Pagination Employee B',
          'employee',
          engineeringDeptId,
        );

        const employeeCId = await createUser(
          'Pagination Employee C',
          'employee',
          engineeringDeptId,
        );

        const { onboardingId: onboardingAId } =
          await createOnboarding(employeeAId, '2026-10-01');

        const { onboardingId: onboardingBId } =
          await createOnboarding(employeeBId, '2026-10-02');

        const { onboardingId: onboardingCId } =
          await createOnboarding(employeeCId, '2026-10-03');

        /*
         * Use date filtering to isolate the three rows created by this
         * test rather than relying on the database being empty.
         */
        const page1 = await request(app.getHttpServer())
          .get('/onboardings')
          .query({
            dateFrom: '2026-10-01',
            dateTo: '2026-10-03',
            sort: 'startDate',
            limit: '2',
            offset: '0',
          })
          .set('Authorization', `Bearer ${superadmin.token}`);

        expect(page1.status).toBe(200);

        expect(Array.isArray(page1.body.data)).toBe(true);
        expect(page1.body.data).toHaveLength(2);
        expect(page1.body.total).toBe(3);
        expect(page1.body.limit).toBe(2);
        expect(page1.body.offset).toBe(0);

        const page2 = await request(app.getHttpServer())
          .get('/onboardings')
          .query({
            dateFrom: '2026-10-01',
            dateTo: '2026-10-03',
            sort: 'startDate',
            limit: '2',
            offset: '2',
          })
          .set('Authorization', `Bearer ${superadmin.token}`);

        expect(page2.status).toBe(200);
        expect(Array.isArray(page2.body.data)).toBe(true);
        expect(page2.body.data).toHaveLength(1);
        expect(page2.body.total).toBe(3);
        expect(page2.body.limit).toBe(2);
        expect(page2.body.offset).toBe(2);

        const page1Ids = page1.body.data.map(
          (onboarding: any) => onboarding.id,
        );

        const page2Ids = page2.body.data.map(
          (onboarding: any) => onboarding.id,
        );

        const allIds = [...page1Ids, ...page2Ids];

        expect(new Set(allIds).size).toBe(3);

        expect(allIds).toEqual([
          onboardingAId,
          onboardingBId,
          onboardingCId,
        ]);
      },
    );
  });
});
