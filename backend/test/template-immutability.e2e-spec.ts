import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { TokenService } from '../src/auth/tokens/token.service';
import { SessionsService } from '../src/auth/sessions/sessions.service';
import { DatabaseService } from '../src/database/database.service';

// Same fallback env pattern as rbac.e2e-spec.ts.
// This suite performs real writes, so use a disposable/dev database.
process.env.DATABASE_URL ??=
  'postgresql://postgres:postgres@localhost:5432/onboarding';

process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';
process.env.JWT_PREAUTH_SECRET ??= 'test-preauth-secret';
process.env.LOGIN_EMAIL_DOMAIN ??= 'id.onboarding.internal';
process.env.TOTP_ISSUER ??= 'Onboarding Platform';

/**
 * The core BRD guarantee:
 *
 * Editing a department's template must never modify an onboarding
 * that has already been instantiated from that template.
 *
 * Everything this suite creates is removed in afterAll().
 */
describe('Template immutability (e2e)', () => {
  let app: INestApplication;
  let db: DatabaseService;

  let superadminToken: string;
  let superadminId: string;
  /* The session the token belongs to, and the CSRF value issued with it.
     JwtStrategy re-reads the session row on every request and CsrfGuard
     binds the header to that same row, so neither can be faked. */
  let superadminSessionId: string;
  let superadminCsrf: string;

  let engineeringDeptId: string;
  let originalActiveTemplateId: string;

  let newTemplateVersionId: string | undefined;
  let createdUserId: string | undefined;
  let createdOnboardingId: string | undefined;

  /* The joinee this suite creates was a fixed '+10000000001', so a run
     whose teardown did not finish left a row that made every later run
     fail on the phone_number unique constraint — a stale row, reported as
     a broken test. Stamped, each run gets its own. */
  const stamp = Date.now();
  const testPhone = `+1${String(stamp).slice(-10)}`;

  beforeAll(async () => {
    const moduleRef: TestingModule =
      await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

    app = moduleRef.createNestApplication();
    // main.ts registers this; createNestApplication() does not. Without it
    // req.cookies is undefined, the global CsrfGuard reads an empty cookie
    // and every write here 403s before reaching the handler.
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
    const tokens = moduleRef.get(TokenService);

    // ------------------------------------------------------------
    // IMPORTANT:
    // We MUST use a real SuperAdmin user here.
    //
    // RolesGuard only checks the token role, but AuthService also
    // writes an activity_log using actorId. activity_logs.actor_id
    // has a foreign-key constraint to users.id.
    // ------------------------------------------------------------

    const { rows: adminRows } = await db.query<{
      id: string;
      full_name: string;
      role: string;
    }>(
      `SELECT id, full_name, role
       FROM users
       WHERE role = 'superadmin_hr'
         AND deleted_at IS NULL
         AND status != 'disabled'
       ORDER BY created_at
       LIMIT 1`,
    );

    if (!adminRows[0]) {
      throw new Error(
        'No active superadmin_hr user found. Create a SuperAdmin user before running this test.',
      );
    }

    superadminId = adminRows[0].id;

    // Sign the token using the REAL database user ID, against a REAL
    // session: a signed token is no longer a credential on its own.
    const sessions = moduleRef.get(SessionsService);
    const issued = await sessions.createSession(superadminId, 'template-immutability-e2e');
    superadminSessionId = issued.sessionId;
    superadminCsrf = issued.csrfToken;
    superadminToken = tokens.signAccessToken(
      { id: superadminId, role: 'superadmin_hr', department_id: null } as any,
      superadminSessionId,
    );

    // ------------------------------------------------------------
    // Find Engineering department
    // ------------------------------------------------------------

    const { rows: deptRows } = await db.query<{ id: string }>(
      `SELECT id
       FROM departments
       WHERE name = 'Engineering'
       LIMIT 1`,
    );

    if (!deptRows[0]) {
      throw new Error(
        'Engineering department not found — run migrations (0003) against this DATABASE_URL first.',
      );
    }

    engineeringDeptId = deptRows[0].id;

    // ------------------------------------------------------------
    // Find the current active Engineering template
    // ------------------------------------------------------------

    const { rows: activeRows } = await db.query<{ id: string }>(
      `SELECT id
       FROM onboarding_templates
       WHERE department_id = $1
         AND is_active = true
       LIMIT 1`,
      [engineeringDeptId],
    );

    if (!activeRows[0]) {
      throw new Error(
        'No active Engineering template — run migrations (0005) against this DATABASE_URL first.',
      );
    }

    originalActiveTemplateId = activeRows[0].id;
  });

  afterAll(async () => {
    // ------------------------------------------------------------
    // Delete onboarding tasks first because they reference
    // onboardings.
    // ------------------------------------------------------------

    if (createdOnboardingId) {
      // Subtasks before tasks. Templates seed checklist items as of
      // migration 0034 (the install task and the reading task both carry
      // them), and onboarding_subtasks references onboarding_tasks with
      // no cascade — so deleting the tasks first fails the FK and leaves
      // the whole teardown half-done.
      await db.query(
        `DELETE FROM onboarding_subtasks
          WHERE onboarding_task_id IN (
            SELECT id FROM onboarding_tasks WHERE onboarding_id = $1)`,
        [createdOnboardingId],
      );

      await db.query(
        `DELETE FROM onboarding_tasks
         WHERE onboarding_id = $1`,
        [createdOnboardingId],
      );

      await db.query(
        `DELETE FROM onboardings
         WHERE id = $1`,
        [createdOnboardingId],
      );
    }

    // ------------------------------------------------------------
    // Delete the test employee.
    //
    // This is safe because the activity_logs created during this
    // test use superadminId as actor_id, NOT createdUserId.
    // ------------------------------------------------------------

    if (createdUserId) {
      await db.query(
        `DELETE FROM users
         WHERE id = $1`,
        [createdUserId],
      );
    }

    // ------------------------------------------------------------
    // Delete the new template version's tasks first.
    // ------------------------------------------------------------

    if (newTemplateVersionId) {
      await db.query(
        `DELETE FROM template_tasks
         WHERE template_id = $1`,
        [newTemplateVersionId],
      );

      await db.query(
        `DELETE FROM onboarding_templates
         WHERE id = $1`,
        [newTemplateVersionId],
      );
    }

    // ------------------------------------------------------------
    // Restore the original template as active.
    // ------------------------------------------------------------

    if (originalActiveTemplateId) {
      await db.query(
        `UPDATE onboarding_templates
         SET is_active = true
         WHERE id = $1`,
        [originalActiveTemplateId],
      );
    }

    // The session was opened on a REAL superadmin account that outlives
    // this suite, so it is removed by id rather than by user — deleting
    // every session for that user would sign the person out of their own
    // browser.
    if (superadminSessionId) {
      await db.query(`DELETE FROM user_sessions WHERE id = $1`, [superadminSessionId]);
    }

    if (app) {
      await app.close();
    }
  });

  it(
    'leaves an already-instantiated onboarding unchanged after the template is edited',
    async () => {
      // ============================================================
      // 1. CREATE EMPLOYEE
      // ============================================================

      const createUserRes = await request(app.getHttpServer())
        .post('/auth/users')
        .set('Authorization', `Bearer ${superadminToken}`)
        .set('Cookie', [`csrf_token=${superadminCsrf}`])
        .set('X-CSRF-Token', superadminCsrf)
        .send({
          fullName: `Template Immutability Test ${stamp}`,
          phoneNumber: testPhone,
          role: 'employee',
          departmentId: engineeringDeptId,
        });

      expect(createUserRes.status).toBe(201);

      createdUserId = createUserRes.body.user.id;

      expect(createdUserId).toBeDefined();

      // ============================================================
      // 2. CREATE ONBOARDING
      //
      // The onboarding should snapshot the CURRENT active template.
      // ============================================================

      const createOnboardingRes = await request(app.getHttpServer())
        .post('/onboardings')
        .set('Authorization', `Bearer ${superadminToken}`)
        .set('Cookie', [`csrf_token=${superadminCsrf}`])
        .set('X-CSRF-Token', superadminCsrf)
        .send({
          userId: createdUserId,
          startDate: '2026-09-07',
        });

      expect(createOnboardingRes.status).toBe(201);

      createdOnboardingId = createOnboardingRes.body.id;

      expect(createdOnboardingId).toBeDefined();

      const tasksBefore =
        createOnboardingRes.body.tasks as Array<Record<string, any>>;

      expect(tasksBefore.length).toBeGreaterThan(0);

      // ============================================================
      // 3. EDIT TEMPLATE
      //
      // Publishing a new version should NOT modify the onboarding
      // that was already instantiated above.
      // ============================================================

      const newVersionRes = await request(app.getHttpServer())
        .post(
          `/templates/${originalActiveTemplateId}/versions`,
        )
        .set('Authorization', `Bearer ${superadminToken}`)
        .set('Cookie', [`csrf_token=${superadminCsrf}`])
        .set('X-CSRF-Token', superadminCsrf)
        .send({
          tasks: [
            {
              title:
                'COMPLETELY DIFFERENT TASK — must never reach the existing joiner',
              ownerRole: 'task_owner',
              dueOffsetDays: 0,
              // Was 'dual', which the DTO has refused since migration 0028
              // (@IsIn(['employee']) on completionMode) — a template may not
              // author a task the joinee cannot close. What this suite is
              // actually about is that editing a template leaves existing
              // onboardings alone, and any valid mode serves that equally.
              completionMode: 'employee',
              isCheckpoint: true,
            },
          ],
        });

      expect(newVersionRes.status).toBe(201);

      newTemplateVersionId = newVersionRes.body.id;

      expect(newTemplateVersionId).toBeDefined();

      expect(newVersionRes.body.version).toBeGreaterThan(1);

      // ============================================================
      // 4. READ EXISTING ONBOARDING TASKS DIRECTLY FROM DATABASE
      //
      // This proves the instantiated onboarding did not change.
      // ============================================================

      const { rows: tasksAfter } =
        await db.query<Record<string, any>>(
          `SELECT *
           FROM onboarding_tasks
           WHERE onboarding_id = $1
           ORDER BY due_date, created_at`,
          [createdOnboardingId],
        );

      expect(tasksAfter).toHaveLength(tasksBefore.length);

      /* Matched by ID rather than by position.
       *
       * These two lists are ordered by different things and always were:
       * `tasksBefore` is the API's response, which comes back in TRAIL
       * order (see orderForTrail — paperwork, reading, kit, installs, the
       * rest), while `tasksAfter` is a raw query ordered by due_date. A
       * positional comparison was therefore asserting that those two
       * orderings agree, which is not what this suite is about and is not
       * true once several tasks share a due date.
       *
       * Keying on the id tests the thing that actually matters, and tests
       * it harder: every task that existed before still exists, unchanged,
       * and none has been added or swapped. */
      expect(new Set(tasksAfter.map((t) => t.id))).toEqual(
        new Set(tasksBefore.map((t) => t.id)),
      );

      const afterById = new Map(tasksAfter.map((t) => [t.id, t]));

      tasksBefore.forEach((before) => {
        const after = afterById.get(before.id);

        expect(after).toBeDefined();
        expect(after!.title).toBe(before.title);

        expect(
          after!.due_date.toISOString().slice(0, 10),
        ).toBe(
          before.due_date.slice(0, 10),
        );

        expect(after!.completion_mode).toBe(
          before.completion_mode,
        );

        expect(after!.is_checkpoint).toBe(
          before.is_checkpoint,
        );
      });

      // The newly published task must NOT appear in the existing
      // onboarding.
      expect(
        tasksAfter.some((task) =>
          task.title.includes(
            'COMPLETELY DIFFERENT TASK',
          ),
        ),
      ).toBe(false);

      // ============================================================
      // 5. VERIFY NEW TEMPLATE IS NOW ACTIVE
      //
      // A NEW onboarding should use the new template version.
      // ============================================================

      const activeTemplateRes = await request(
        app.getHttpServer(),
      )
        .get('/templates/active')
        .query({
          departmentId: engineeringDeptId,
        })
        .set(
          'Authorization',
          `Bearer ${superadminToken}`,
        );

      expect(activeTemplateRes.status).toBe(200);

      expect(activeTemplateRes.body.id).toBe(
        newTemplateVersionId,
      );
    },
  );
});