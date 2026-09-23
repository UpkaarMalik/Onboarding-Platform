import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { unlinkSync } from 'fs';
import { join } from 'path';

import { AppModule } from '../src/app.module';
import { TokenService } from '../src/auth/tokens/token.service';
import { SessionsService } from '../src/auth/sessions/sessions.service';
import { DatabaseService } from '../src/database/database.service';
import { JoineeDocumentsService } from '../src/joinee-documents/joinee-documents.service';

process.env.DATABASE_URL ??=
  'postgresql://postgres:postgres@localhost:5432/onboarding';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';
process.env.JWT_PREAUTH_SECRET ??= 'test-preauth-secret';
process.env.LOGIN_EMAIL_DOMAIN ??= 'id.onboarding.internal';
process.env.TOTP_ISSUER ??= 'Onboarding Platform';

/**
 * One real Engineering onboarding driven through the API, checking that
 * each event leaves exactly the notification it should, for the right
 * person, with the right link — and nothing for the person who acted.
 */
describe('Notification events (e2e)', () => {
  const suiteStartedAt = new Date();
  const stamp = Date.now();
  let app: INestApplication;
  let db: DatabaseService;
  let tokens: TokenService;
  let sessions: SessionsService;

  interface Creds { token: string; csrf: string }
  const ids: Record<'hr' | 'owner' | 'joinee', string> = {} as any;
  const creds: Record<'hr' | 'owner' | 'joinee', Creds> = {} as any;
  const createdUserIds: string[] = [];
  let onboardingId: string | undefined;
  let storedFile: string | undefined;
  const JOINEE = `Events Joinee ${stamp}`;

  const post = (path: string, who: Creds) =>
    request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${who.token}`)
      .set('Cookie', [`csrf_token=${who.csrf}`])
      .set('X-CSRF-Token', who.csrf);

  /** Rows created for this user since the last call, oldest first. */
  let seen = new Date(0);
  async function newFor(who: keyof typeof ids) {
    const { rows } = await db.query<{ kind: string; title: string; body: string | null; link: string }>(
      `SELECT kind, title, body, link FROM notifications
        WHERE user_id = $1 AND created_at > $2 ORDER BY created_at, title`,
      [ids[who], seen],
    );
    return rows;
  }
  async function mark() {
    seen = (await db.query<{ now: Date }>(`SELECT clock_timestamp() AS now`)).rows[0].now;
  }
  async function taskId(title: string) {
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM onboarding_tasks WHERE onboarding_id = $1 AND title = $2`,
      [onboardingId, title],
    );
    return rows[0].id;
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    db = moduleRef.get(DatabaseService);
    tokens = moduleRef.get(TokenService);
    sessions = moduleRef.get(SessionsService);
    storedFile = moduleRef.get(JoineeDocumentsService).getUploadsDir();

    const { rows: dept } = await db.query<{ id: string }>(
      `SELECT id FROM departments WHERE name = 'Engineering'`,
    );
    const people: Array<[keyof typeof ids, string, string, string | null]> = [
      ['hr', `Events HR ${stamp}`, 'superadmin_hr', null],
      ['owner', `Events Owner ${stamp}`, 'task_owner', dept[0].id],
      ['joinee', JOINEE, 'employee', dept[0].id],
    ];
    for (const [key, name, role, deptId] of people) {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO users (full_name, phone_number, joinee_id, password_hash, role,
                            department_id, status, must_reset_password)
         VALUES ($1, $2, $3, 'not-a-real-hash', $4, $5, 'active', false) RETURNING id`,
        [name, `+1995${createdUserIds.length}${stamp % 100000}`, `EVT-${stamp}-${key}`, role, deptId],
      );
      ids[key] = rows[0].id;
      createdUserIds.push(rows[0].id);
      const { sessionId, csrfToken } = await sessions.createSession(rows[0].id, 'events-e2e');
      creds[key] = {
        token: tokens.signAccessToken({ id: rows[0].id, role, department_id: deptId } as any, sessionId),
        csrf: csrfToken,
      };
    }
  });

  afterAll(async () => {
    const users = [createdUserIds];
    await db.query(
      `DELETE FROM notifications n
        WHERE n.user_id = ANY($1::uuid[])
           OR (n.created_at >= $2 AND n.title LIKE '%' || $3 || '%')`,
      [createdUserIds, suiteStartedAt, JOINEE],
    );
    if (onboardingId) {
      const tasks = `SELECT id FROM onboarding_tasks WHERE onboarding_id = '${onboardingId}'`;
      const { rows: files } = await db.query<{ file_url: string }>(
        `SELECT u.file_url FROM joinee_document_uploads u
           JOIN joinee_document_requirements r ON r.id = u.requirement_id
          WHERE r.user_id = $1`,
        [ids.joinee],
      );
      for (const f of files) {
        try { unlinkSync(join(storedFile!, f.file_url)); } catch { /* already gone */ }
      }
      await db.query(`DELETE FROM joinee_document_uploads WHERE requirement_id IN
                        (SELECT id FROM joinee_document_requirements WHERE user_id = $1)`, [ids.joinee]);
      await db.query(`DELETE FROM joinee_document_requirements WHERE user_id = $1`, [ids.joinee]);
      await db.query(`DELETE FROM blockers WHERE onboarding_task_id IN (${tasks})`);
      await db.query(`DELETE FROM onboarding_subtasks WHERE onboarding_task_id IN (${tasks})`);
      await db.query(`DELETE FROM onboarding_tasks WHERE onboarding_id = $1`, [onboardingId]);
      await db.query(`DELETE FROM onboardings WHERE id = $1`, [onboardingId]);
    }
    await db.query(`DELETE FROM activity_logs WHERE actor_id = ANY($1::uuid[])`, users);
    await db.query(`DELETE FROM user_sessions WHERE user_id = ANY($1::uuid[])`, users);
    await db.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, users);
    await app.close();
  });

  it('notifies the right person, with the right link, at every step', async () => {
    // 1. HR creates the onboarding: the department's task owner hears about it.
    const { rows: aadhaar } = await db.query<{ id: string }>(
      `SELECT id FROM document_types WHERE code = 'aadhaar_card'`,
    );
    const created = await post('/onboardings', creds.hr)
      .send({ userId: ids.joinee, startDate: new Date().toISOString().slice(0, 10), requiredDocumentTypeIds: [aadhaar[0].id] })
      .expect(201);
    onboardingId = created.body.id;
    expect(await newFor('owner')).toEqual([
      expect.objectContaining({ kind: 'task_waiting', title: `New tasks for ${JOINEE}`, link: '/my-tasks' }),
    ]);
    expect(await newFor('hr')).toEqual([]);
    await mark();

    // 2. The joinee uploads: HR is asked to review. The joinee is not told
    //    about their own upload.
    const { rows: req } = await db.query<{ id: string }>(
      `SELECT id FROM joinee_document_requirements WHERE user_id = $1`,
      [ids.joinee],
    );
    await post(`/joinee-documents/requirements/${req[0].id}/upload`, creds.joinee)
      .attach('file', Buffer.from('%PDF-1.4 test'), { filename: 'a.pdf', contentType: 'application/pdf' })
      .expect(201);
    expect(await newFor('hr')).toEqual([
      expect.objectContaining({ kind: 'document_uploaded', title: `${JOINEE} uploaded their Aadhaar Card`, link: `/hr?profile=${ids.joinee}` }),
    ]);
    expect(await newFor('joinee')).toEqual([]);
    await mark();

    // 3. HR approves: the joinee hears, and the steps it opened are announced.
    const { rows: up } = await db.query<{ id: string }>(
      `SELECT u.id FROM joinee_document_uploads u WHERE u.requirement_id = $1 AND u.superseded_at IS NULL`,
      [req[0].id],
    );
    await post(`/joinee-documents/uploads/${up[0].id}/review`, creds.hr)
      .send({ decision: 'approved' })
      .expect(201);
    expect(await newFor('joinee')).toEqual([
      { kind: 'task_available', title: 'A new step is ready: Company email & laptop handover', body: null, link: '/start-here' },
      { kind: 'task_available', title: 'A new step is ready: Read the docs', body: null, link: '/start-here' },
      { kind: 'task_completed', title: 'Upload your documents is complete', body: null, link: '/start-here' },
      { kind: 'document_approved', title: 'Your Aadhaar Card was approved', body: null, link: '/start-here' },
    ]);
    await mark();

    // 4. HR blocks and resolves the handover: the joinee hears both; HR,
    //    who did it, hears nothing.
    const handover = await taskId('Company email & laptop handover');
    const blocked = await post(`/onboarding-tasks/${handover}/block`, creds.hr)
      .send({ reason: 'Laptop stock arrives Friday' })
      .expect(201);
    await post(`/blockers/${blocked.body.id}/resolve`, creds.hr).send({}).expect(201);
    expect(await newFor('joinee')).toEqual([
      expect.objectContaining({ kind: 'task_blocked', title: 'Company email & laptop handover is blocked', body: 'Laptop stock arrives Friday' }),
      expect.objectContaining({ kind: 'task_unblocked', title: 'Company email & laptop handover is no longer blocked' }),
    ]);
    expect(await newFor('hr')).toEqual([]);
    await mark();

    // 5. HR finishing the handover opens nothing new ("Read the docs" is
    //    still open beside it) but is still news to the joinee.
    await post(`/onboarding-tasks/${handover}/complete-as-owner`, creds.hr).expect(201);
    expect(await newFor('joinee')).toEqual([
      { kind: 'task_completed', title: 'Company email & laptop handover is complete', body: null, link: '/start-here' },
    ]);
    await mark();

    // 6. The joinee finishes the stage themselves: the next step opens, but
    //    they are not notified about their own action.
    await post(`/onboarding-tasks/${await taskId('Read the docs')}/complete-as-employee`, creds.joinee).expect(201);
    expect(await newFor('joinee')).toEqual([]);
    await mark();

    // 7. A task owner blocking something is news to HR as well.
    await post(`/onboarding-tasks/${await taskId('Meet your reporting manager')}/block`, creds.owner)
      .send({ reason: 'Manager is on leave this week' })
      .expect(201);
    expect(await newFor('joinee')).toEqual([
      expect.objectContaining({ kind: 'task_blocked', title: 'Meet your reporting manager is blocked', link: '/start-here' }),
    ]);
    expect(await newFor('hr')).toEqual([
      expect.objectContaining({ kind: 'task_blocked_by_owner', title: `Meet your reporting manager for ${JOINEE} is blocked`, link: `/hr?profile=${ids.joinee}` }),
    ]);
  });
});
