import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';

import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import {
  applySequenceGate,
  isTaskOpen,
  orderForTrail,
} from '../src/onboardings/utils/trail-order.util';

process.env.DATABASE_URL ??=
  'postgresql://postgres:postgres@localhost:5432/onboarding';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';
process.env.JWT_PREAUTH_SECRET ??= 'test-preauth-secret';
process.env.LOGIN_EMAIL_DOMAIN ??= 'id.onboarding.internal';
process.env.TOTP_ISSUER ??= 'Onboarding Platform';

/**
 * The onboarding gate, as a flow rather than as five separate rules.
 *
 *   1. Nothing opens until HR has APPROVED every document.
 *   2. Then TWO things open at once: Read the docs, and the laptop handover.
 *   3. Then the rest, one at a time.
 *
 * Driven against the real task titles the templates produce, because the
 * bands that decide the stages match on those titles — a test with invented
 * titles would pass while the real journey sat in the wrong stage.
 */
describe('Onboarding flow gate (e2e)', () => {
  let app: INestApplication;
  let db: DatabaseService;

  /** The titles every department's template produces, in due-date order. */
  let realTitles: { id: string; title: string; status: string; system_key: string | null; is_required: boolean }[];

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

    // A real onboarding's required tasks, so the stages are exercised against
    // the titles the seeded templates actually create.
    const { rows } = await db.query<{ id: string }>(
      `SELECT onboarding_id AS id FROM onboarding_tasks
        WHERE is_required GROUP BY onboarding_id
        ORDER BY COUNT(*) DESC LIMIT 1`,
    );
    const { rows: tasks } = await db.query<any>(
      `SELECT id, title, status, system_key, is_required
         FROM onboarding_tasks
        WHERE onboarding_id = $1 AND is_required = true
        ORDER BY due_date, created_at`,
      [rows[0].id],
    );
    realTitles = tasks;
  });

  afterAll(async () => {
    await app.close();
  });

  /** The journey as it stands on day one: nothing done yet. */
  function fresh() {
    return realTitles.map((t) => ({ ...t, status: 'locked' }));
  }

  function openTitles(tasks: any[]): string[] {
    return applySequenceGate(orderForTrail(tasks))
      .filter((t) => t.status !== 'locked' && t.status !== 'completed')
      .map((t) => t.title);
  }

  it('opens the document upload alone, and nothing else, on day one', () => {
    const open = openTitles(fresh());
    expect(open).toHaveLength(1);
    expect(open[0]).toMatch(/upload/i);
  });

  it('opens Read the docs AND the laptop handover together once documents are done', () => {
    const tasks = fresh().map((t) =>
      t.system_key === 'document_upload' ? { ...t, status: 'completed' } : t,
    );
    const open = openTitles(tasks);

    // Two at once — the whole point of stage 1. The employee reads while IT
    // sorts hardware; neither waits on the other.
    expect(open).toHaveLength(2);
    expect(open.some((t) => /read the docs/i.test(t))).toBe(true);
    expect(open.some((t) => /laptop|e-?mail/i.test(t))).toBe(true);

    // And nothing from the last stage has leaked forward.
    expect(open.some((t) => /install/i.test(t))).toBe(false);
  });

  it('holds the whole second stage until BOTH of its tasks are done', () => {
    const afterDocs = fresh().map((t) =>
      t.system_key === 'document_upload' ? { ...t, status: 'completed' } : t,
    );
    // Only the reading done: the handover is still open, and stage 2 has not
    // started.
    const halfway = afterDocs.map((t) =>
      /read the docs/i.test(t.title) ? { ...t, status: 'completed' } : t,
    );
    const open = openTitles(halfway);
    expect(open.some((t) => /laptop|e-?mail/i.test(t))).toBe(true);
    expect(open.some((t) => /install/i.test(t))).toBe(false);
  });

  it('then releases the rest one at a time', () => {
    const stageTwoDone = fresh().map((t) =>
      t.system_key === 'document_upload' ||
      /read the docs/i.test(t.title) ||
      /laptop|e-?mail/i.test(t.title)
        ? { ...t, status: 'completed' }
        : t,
    );
    const open = openTitles(stageTwoDone);
    // "Step by step" — exactly one, not the whole remainder at once.
    expect(open).toHaveLength(1);
  });

  it('refuses to call a later task open, which is what the completion guard asks', () => {
    const tasks = fresh();
    const install = tasks.find((t) => /install/i.test(t.title));
    const upload = tasks.find((t) => t.system_key === 'document_upload');
    expect(install && isTaskOpen(tasks, install.id)).toBe(false);
    expect(upload && isTaskOpen(tasks, upload.id)).toBe(true);
  });

  it('has moved the laptop handover to HR on every open task and every template', async () => {
    // Migration 0031. Asserted against the database rather than the file so
    // this fails if the migration is rolled back or a template is reseeded
    // from an older definition.
    const { rows: templates } = await db.query<{ owner_role: string; completion_mode: string }>(
      `SELECT owner_role, completion_mode FROM template_tasks
        WHERE title = 'Company email & laptop handover'`,
    );
    expect(templates.length).toBeGreaterThan(0);
    for (const t of templates) {
      expect(t.owner_role).toBe('superadmin_hr');
      expect(t.completion_mode).toBe('owner');
    }

    const { rows: open } = await db.query<{ owner_role: string; completion_mode: string; owner_user_id: string | null }>(
      `SELECT owner_role, completion_mode, owner_user_id FROM onboarding_tasks
        WHERE title = 'Company email & laptop handover'
          AND status NOT IN ('completed', 'cancelled')`,
    );
    for (const t of open) {
      expect(t.completion_mode).toBe('owner');
      expect(t.owner_role).toBe('superadmin_hr');
      // Cleared deliberately: a task_owner who had claimed it would otherwise
      // keep the exclusive right to close it, since completeAsOwner checks
      // owner_user_id before it checks the role.
      expect(t.owner_user_id).toBeNull();
    }

    // Nothing is asserted about tasks that are already COMPLETED, and that is
    // deliberate rather than an omission. They are a mix now: rows closed by
    // the joinee before 0031 and left as 'employee' because rewriting finished
    // history would make the activity log disagree with the row it describes,
    // and rows closed by HR since, which are correctly 'owner'. An assertion
    // that they are all one or the other was wrong the first time HR completed
    // one — which is exactly how this was caught.
  });

  it('keeps a blocked task holding its stage rather than skipping past it', () => {
    const tasks = fresh().map((t) =>
      t.system_key === 'document_upload' ? { ...t, status: 'blocked' } : t,
    );
    const gated = applySequenceGate(orderForTrail(tasks));
    const docs = gated.find((t: any) => t.system_key === 'document_upload')!;
    // Still the open step, and still reported as blocked rather than pending.
    expect(docs.status).toBe('blocked');
    expect(openTitles(tasks).some((t) => /read the docs/i.test(t))).toBe(false);
  });
});
