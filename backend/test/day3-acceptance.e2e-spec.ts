import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
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
 * Day 3's three closing acceptance tests:
 *
 * 1. Dual confirmation:
 *    A 'dual' task needs both the owner and the employee to confirm
 *    before it completes. No template produces one since migration 0028
 *    made every task single-sided, so the test builds the row itself —
 *    applyDualConfirmation still runs for every pre-0028 row.
 *
 * 2. Notes: REMOVED — there is no notes module any more.
 *
 * 3. Entitlements:
 *    Two concurrent claims against the final entitlement unit result
 *    in exactly one success (201) and one conflict (409).
 *
 * Everything created by this suite is cleaned up in afterAll.
 */
describe('Day 3 acceptance tests (e2e)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let tokens: TokenService;

  // IMPORTANT:
  // The SuperAdmin must be a REAL user in the database.
  //
  // activity_logs.actor_id REFERENCES users(id), so a fabricated
  // UUID inside a JWT can cause a foreign-key violation.
  let testSuperadminId: string;
  let sessions: SessionsService;

  /** Bearer token plus the CSRF value bound to the same session row.
   *  Writes need both: CsrfGuard is global and runs before auth. */
  interface Creds {
    token: string;
    csrf: string;
  }

  let superadmin: Creds;

  /* The suite's own superadmin used a fixed '+10000000001', so a run whose
     teardown did not finish left a row that failed every later run on the
     phone_number unique constraint. */
  const stamp = Date.now();
  /** Bounds the notification sweep in afterAll to this run. */
  const suiteStartedAt = new Date();

  let engineeringDeptId: string;

  const createdUserIds: string[] = [];
  const createdOnboardingIds: string[] = [];
  const createdEntitlementIds: string[] = [];

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

    // ------------------------------------------------------------
    // Create a REAL SuperAdmin specifically for this test suite.
    //
    // We cannot use a fabricated JWT ID because:
    //
    // activity_logs.actor_id -> users.id
    //
    // The /auth/users endpoint creates activity logs using the
    // authenticated user's ID.
    // ------------------------------------------------------------

    const passwordHash = await bcrypt.hash(
      'Day3-Test-Password-123!',
      4,
    );

    const { rows: adminRows } = await db.query<{ id: string }>(
      `INSERT INTO users (
        full_name,
        phone_number,
        company_email,
        company_email_active,
        must_reset_password,
        password_hash,
        role,
        department_id,
        status
      )
      VALUES (
        'Day 3 Test SuperAdmin',
        $2,
        NULL,
        false,
        false,
        $1,
        'superadmin_hr',
        NULL,
        'active'
      )
      RETURNING id`,
      [passwordHash, `+1${String(stamp).slice(-10)}`],
    );

    if (!adminRows[0]) {
      throw new Error(
        'Failed to create Day 3 test SuperAdmin',
      );
    }

    testSuperadminId = adminRows[0].id;

    // A real session, not just a signed token: JwtStrategy re-reads the
    // user_sessions row on every request (migration 0029).
    superadmin = await signIn(testSuperadminId, 'superadmin_hr');

    // ------------------------------------------------------------
    // Find Engineering department.
    // ------------------------------------------------------------

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
    // ------------------------------------------------------------
    // IMPORTANT CLEANUP ORDER
    //
    // activity_logs.actor_id -> users.id
    //
    // Therefore activity logs must be deleted BEFORE their actor
    // users are deleted.
    // ------------------------------------------------------------

    if (createdUserIds.length) {
      await db.query(
        `DELETE FROM activity_logs
         WHERE actor_id = ANY($1::uuid[])`,
        [createdUserIds],
      );
    }

    if (testSuperadminId) {
      await db.query(
        `DELETE FROM activity_logs
         WHERE actor_id = $1`,
        [testSuperadminId],
      );
    }

    // ------------------------------------------------------------
    // Delete onboarding tasks first because they reference
    // onboardings.
    // ------------------------------------------------------------

    if (createdOnboardingIds.length) {
      // Subtasks before tasks: templates seed checklist items as of
      // migration 0034 and onboarding_subtasks has no cascade.
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

    // ------------------------------------------------------------
    // Delete entitlement assignments before entitlements.
    // ------------------------------------------------------------

    if (createdEntitlementIds.length) {
      await db.query(
        `DELETE FROM entitlement_assignments
         WHERE entitlement_id = ANY($1::uuid[])`,
        [createdEntitlementIds],
      );

      await db.query(
        `DELETE FROM entitlements
         WHERE id = ANY($1::uuid[])`,
        [createdEntitlementIds],
      );
    }

    // ------------------------------------------------------------
    // Delete users created by the tests.
    // ------------------------------------------------------------

    const allUserIds = [...createdUserIds, testSuperadminId].filter(Boolean);

    // Notifications reference users (migration 0032, newer than this
    // suite). They are fanned out to HR as well as to the joinee, so the
    // second clause catches the ones addressed to real HR accounts that
    // merely NAME a user this suite created.
    await db.query(
      `DELETE FROM notifications
        WHERE user_id = ANY($1::uuid[])
           OR (created_at >= $2 AND EXISTS (
                 SELECT 1 FROM users u
                  WHERE u.id = ANY($1::uuid[])
                    AND notifications.title LIKE '%' || u.full_name || '%'))`,
      [allUserIds, suiteStartedAt],
    );

    await db.query(
      `DELETE FROM user_sessions WHERE user_id = ANY($1::uuid[])`,
      [allUserIds],
    );

    if (createdUserIds.length) {
      await db.query(
        `DELETE FROM users
         WHERE id = ANY($1::uuid[])`,
        [createdUserIds],
      );
    }

    // ------------------------------------------------------------
    // Delete the temporary SuperAdmin created by this test suite.
    // ------------------------------------------------------------

    if (testSuperadminId) {
      await db.query(
        `DELETE FROM users
         WHERE id = $1`,
        [testSuperadminId],
      );
    }

    await app.close();
  });

  // ============================================================
  // Helpers
  // ============================================================

  /**
   * A real session, because a signed token alone is no longer a
   * credential: JwtStrategy re-reads the user_sessions row on EVERY
   * request, so a fabricated `sid` is rejected outright. The CSRF value
   * comes from the same call because CsrfGuard binds the header to that
   * session's stored hash.
   */
  async function signIn(userId: string, role: string): Promise<Creds> {
    const { sessionId, csrfToken } = await sessions.createSession(
      userId,
      'day3-acceptance-e2e',
    );
    return {
      token: tokens.signAccessToken(
        { id: userId, role, department_id: null } as any,
        sessionId,
      ),
      csrf: csrfToken,
    };
  }

  /** Authenticated write — token and CSRF pair in one place. */
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
  ) {
    const res = await authedPost('/auth/users', superadmin)
      .send({
        fullName,
        /* Was a single fixed '+10000000002' for every user this suite
           creates, so the second call in any run collided on the
           phone_number unique constraint. Never noticed because the
           suite has not compiled since the session change. */
        phoneNumber: `+1${String(stamp).slice(-6)}${String(
          2000 + createdUserIds.length,
        ).padStart(4, '0')}`,
        role,
        ...(departmentId ? { departmentId } : {}),
      });

    expect(res.status).toBe(201);

    const userId = res.body.user.id as string;

    createdUserIds.push(userId);

    return userId;
  }

  const createEmployee = (
    fullName: string,
    departmentId?: string,
  ) =>
    createUser(
      fullName,
      'employee',
      departmentId,
    );

  // ============================================================
  // TEST 1
  // Both sides must confirm a checkpoint.
  // ============================================================

  it(
    'the checkpoint cannot close from one account — both sides must confirm',
    async () => {
      const employeeId = await createEmployee(
        'Checkpoint Test Employee',
        engineeringDeptId,
      );

      const onboardingRes = await authedPost('/onboardings', superadmin)
        .send({
          userId: employeeId,
          startDate: '2026-09-07',
        });

      expect(onboardingRes.status).toBe(201);

      const onboardingId =
        onboardingRes.body.id as string;

      createdOnboardingIds.push(onboardingId);

      const checkpointTask = (
        onboardingRes.body.tasks as Array<
          Record<string, any>
        >
      ).find((t) => t.is_checkpoint);

      expect(checkpointTask).toBeDefined();

      const taskOwnerId = await createUser(
        'Checkpoint Test Owner',
        'task_owner',
      );

      /*
       * The dual-confirm shape has to be MADE, because no template
       * produces it any more.
       *
       * Migration 0028 (single_sided_task_completion) pinned
       * completionMode to @IsIn(['employee']) in every DTO, and 0031
       * handed the checkpoint to HR as a single-sided 'owner' task. So
       * this onboarding's checkpoint is superadmin_hr/owner: a
       * task_owner calling complete-as-owner on it is a 403, and even HR
       * calling it would close the task outright rather than wait for a
       * second confirmation.
       *
       * applyDualConfirmation is still live code and still runs for every
       * pre-0028 row, of which this database has many, so the rule is
       * worth keeping under test — the fixture is just no longer
       * something the API will build for us.
       */
      await db.query(
        `UPDATE onboarding_tasks
            SET completion_mode = 'dual', owner_role = 'task_owner',
                owner_user_id = NULL
          WHERE id = $1`,
        [checkpointTask!.id],
      );

      const ownerToken = await signIn(taskOwnerId, 'task_owner');

      const empToken = await signIn(employeeId, 'employee');

      // ----------------------------------------------------------
      // Owner confirms alone.
      //
      // This must NOT complete the checkpoint.
      // ----------------------------------------------------------

      const ownerRes = await authedPost(
        `/onboarding-tasks/${checkpointTask!.id}/complete-as-owner`,
        ownerToken,
      ).send();

      expect(ownerRes.status).toBe(201);
      expect(ownerRes.body.status).not.toBe(
        'completed',
      );

      const { rows: afterOwnerOnly } =
        await db.query(
          `SELECT status
           FROM onboarding_tasks
           WHERE id = $1`,
          [checkpointTask!.id],
        );

      expect(
        afterOwnerOnly[0].status,
      ).not.toBe('completed');

      // ----------------------------------------------------------
      // Employee confirms.
      //
      // NOW both sides have confirmed, so it should complete.
      // ----------------------------------------------------------

      const empRes = await authedPost(
        `/onboarding-tasks/${checkpointTask!.id}/complete-as-employee`,
        empToken,
      ).send();

      expect(empRes.status).toBe(201);
      expect(empRes.body.status).toBe(
        'completed',
      );

      const { rows: onboardingAfter } =
        await db.query(
          `SELECT status
           FROM onboardings
           WHERE id = $1`,
          [onboardingId],
        );

      expect(
        onboardingAfter[0].status,
      ).toBe('active');

      const { rows: lockedAfter } =
        await db.query(
          `SELECT COUNT(*)::int AS count
           FROM onboarding_tasks
           WHERE onboarding_id = $1
             AND status = 'locked'`,
          [onboardingId],
        );

      expect(lockedAfter[0].count).toBe(0);
    },
  );

  // ============================================================
  // TEST 2 — REMOVED
  //
  // This asserted that a SuperAdmin reading another user's private note
  // gets 403 rather than the content. There is no notes module in src/ any
  // more — the feature was removed — so every request here 404s and the
  // privacy boundary it guarded no longer exists. Deleted rather than
  // skipped: a skipped test for a deleted feature reads as coverage
  // somebody still owes.
  // ============================================================
  // ============================================================
  // TEST 3
  // Two concurrent claims against one remaining entitlement.
  // ============================================================

  it(
    'two concurrent claims on the last entitlement unit — only one succeeds',
    async () => {
      const createRes =
        await authedPost('/entitlements', superadmin)
          .send({
            name: 'Last Sports Kit',
            // Required since migration 0029 added categories to
            // entitlements; the DTO is @IsIn(['device','insurance','perks'])
            // and omitting it is a 400.
            category: 'perks',
            scope: 'company_wide',
            totalQuantity: 1,
          });

      expect(createRes.status).toBe(201);

      const entitlementId =
        createRes.body.id as string;

      createdEntitlementIds.push(
        entitlementId,
      );

      const userXId =
        await createEmployee(
          'Entitlement Racer X',
        );

      const userYId =
        await createEmployee(
          'Entitlement Racer Y',
        );

      const tokenX =
        await signIn(userXId, 'employee');

      const tokenY =
        await signIn(userYId, 'employee');

      const [resX, resY] =
        await Promise.all([
          authedPost(
            `/entitlements/${entitlementId}/claim`,
            tokenX,
          ).send(),

          authedPost(
            `/entitlements/${entitlementId}/claim`,
            tokenY,
          ).send(),
        ]);

      const statuses = [
        resX.status,
        resY.status,
      ].sort((a, b) => a - b);

      expect(statuses).toEqual([
        201,
        409,
      ]);

      // ----------------------------------------------------------
      // Exactly zero units should remain.
      // ----------------------------------------------------------

      const {
        rows: entitlementAfter,
      } = await db.query(
        `SELECT available_quantity
         FROM entitlements
         WHERE id = $1`,
        [entitlementId],
      );

      expect(
        entitlementAfter[0]
          .available_quantity,
      ).toBe(0);

      // ----------------------------------------------------------
      // Exactly one assignment should exist.
      // ----------------------------------------------------------

      const {
        rows: assignmentsAfter,
      } = await db.query(
        `SELECT COUNT(*)::int AS count
         FROM entitlement_assignments
         WHERE entitlement_id = $1`,
        [entitlementId],
      );

      expect(
        assignmentsAfter[0].count,
      ).toBe(1);
    },
  );
});