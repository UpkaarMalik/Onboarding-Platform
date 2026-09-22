import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';
import { UsersService } from '../users/users.service';
import { TemplatesService } from '../templates/templates.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { AuthService } from '../auth/auth.service';
import { CreateUserDto } from '../auth/dto/create-user.dto';
import { CreateOnboardingDto } from './dto/create-onboarding.dto';
import { CreateJoineeDto } from './dto/create-joinee.dto';
import { ProvisionCompanyEmailDto } from './dto/provision-company-email.dto';
import { CreateAdHocTaskDto } from './dto/create-ad-hoc-task.dto';
import { UpdateAssignmentsDto } from './dto/update-assignments.dto';
import { computeDueDate } from './utils/due-date.util';
import { isOverdueSql } from './utils/overdue.util';
import { toCsv } from './utils/csv.util';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import {
  assertDateIfPresent,
  assertOneOfIfPresent,
  assertOnlyAllowedKeys,
  assertUuidIfPresent,
  parseSort,
} from '../common/list-query.util';
import { applySequenceGate, orderForTrail } from './utils/trail-order.util';
import {
  OPEN_BLOCKER_JSON,
  openBlockerJoin,
  type TaskBlocker,
} from './utils/blocker-payload.util';

const ONBOARDING_STATUS_VALUES = [
  'pre_onboarding',
  'email_provisioned',
  'checkpoint_pending',
  'active',
  'completed',
  'cancelled',
] as const;
const HEALTH_VALUES = ['stuck', 'on_track'] as const;
const PRIORITY_VALUES = ['low', 'normal', 'high'] as const;

/** Column names as they appear in listAllOnboardings' OUTER query (the
 *  wrapping SELECT * FROM (...) — bare column/alias names, not
 *  table-prefixed), so ORDER BY can reference them directly. Built
 *  from a fixed dictionary keyed by the already-allow-listed sort
 *  field name — never the client's raw sort string. */
const ONBOARDING_SORT_EXPRESSIONS: Record<string, string> = {
  name: 'employee_name',
  startDate: 'start_date',
  progress: `CASE WHEN required_task_count = 0 THEN 0
               ELSE ROUND(100.0 * required_task_completed_count / required_task_count) END`,
  // Creation time. Named in camelCase to match the other keys so the
  // ?sort= query string reads consistently, and passed through as the
  // bare column name (see comment on the outer SELECT * above) — HR
  // orders the roster by it (newest first, `?sort=-createdAt`) so a
  // freshly-created joinee lands at the top of the list without a
  // search.
  createdAt: 'created_at',
};

const STUCK_SORT_EXPRESSIONS: Record<string, string> = {
  dueDate: 'ot.due_date',
  priority: `CASE ot.priority WHEN 'high' THEN 3 WHEN 'normal' THEN 2 WHEN 'low' THEN 1 ELSE 0 END`,
};

/** Same structural-typing trick as TemplatesService — lets the read
 *  helper below run against either the pooled DatabaseService or a
 *  transaction's PoolClient. */
interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;
}

export interface OnboardingRow {
  id: string;
  user_id: string;
  department_id: string;
  template_id: string;
  template_version: number;
  start_date: Date;
  status: string;
  cancel_reason: string | null;
  manager_name: string | null;
  buddy_name: string | null;
  created_at: Date;
  updated_at: Date;
}

const UNIQUE_VIOLATION = '23505';

/** onboarding_tasks.system_key for the single task that gates document
 *  upload. The frontend keys off this to render the document rows in the
 *  task's popup instead of the generic subtask checklist, and the
 *  service uses it to find the task without matching on its title —
 *  see migration 0023. */
export const DOCUMENT_UPLOAD_SYSTEM_KEY = 'document_upload';

@Injectable()
export class OnboardingsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly usersService: UsersService,
    private readonly templatesService: TemplatesService,
    private readonly activityLog: ActivityLogService,
    private readonly config: ConfigService,
    private readonly auth: AuthService,
  ) {}

  /**
   * Create-joiner: snapshots the employee's department's active
   * template into a fresh, dated checklist. Every field copied onto
   * onboarding_tasks below is frozen at this moment — Step 10's
   * template versioning is what makes that safe; a later template
   * edit publishes a new version and never touches these rows.
   */
  async createOnboarding(
    dto: CreateOnboardingDto,
    actorId: string,
    /* When supplied, everything below runs on the caller's transaction
       instead of opening its own — that is what lets createJoinee roll the
       user back too when a template is missing. */
    outer?: PoolClient,
  ) {
    const user = await this.usersService.findById(dto.userId, outer ?? this.db);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (user.role !== 'employee') {
      throw new BadRequestException('Only employee accounts can be onboarded');
    }
    if (!user.department_id) {
      throw new BadRequestException('Employee has no department set');
    }

    const template = await this.templatesService.getActiveTemplateForDepartment(
      user.department_id,
    );
    if (!template) {
      throw new NotFoundException('No active template for this department');
    }

    const startDate = new Date(dto.startDate);

    /* One body, two ways in: on the caller's client when there is one, or
       on a transaction of its own. Without this the work would have to be
       written twice and the two copies would drift. */
    const work = async (client: PoolClient) => {
      {
        const { rows } = await client.query<OnboardingRow>(
          `INSERT INTO onboardings (
             user_id, department_id, template_id, template_version, start_date,
             status, manager_name, buddy_name
           )
           VALUES ($1, $2, $3, $4, $5, 'pre_onboarding', $6, $7)
           RETURNING *`,
          [
            user.id,
            user.department_id,
            template.id,
            template.version,
            dto.startDate,
            dto.managerName ?? null,
            dto.buddyName ?? null,
          ],
        );
        const onboarding = rows[0];

        for (const task of template.tasks) {
          await this.insertOnboardingTask(client, onboarding.id, task, startDate);
        }

        if (dto.requiredDocumentTypeIds?.length) {
          await this.insertDocumentUploadTask(
            client,
            onboarding.id,
            user.id,
            dto.requiredDocumentTypeIds,
            startDate,
            actorId,
          );
        }

        await this.activityLog.log(
          {
            actorId,
            action: 'onboarding.created',
            entityType: 'onboarding',
            entityId: onboarding.id,
            // manager/buddy are recorded here as well as in
            // 'onboarding.assignments_updated' — they can be filled in
            // on the create form, and an allotment that only ever
            // happened at creation would otherwise never appear.
            metadata: {
              userId: user.id,
              departmentId: user.department_id,
              templateId: template.id,
              startDate: dto.startDate,
              managerName: dto.managerName ?? null,
              buddyName: dto.buddyName ?? null,
            },
          },
          client,
        );

        return this.toOnboardingWithTasks(client, onboarding.id);
      }
    };

    try {
      /* A caller's transaction is NOT wrapped in another one: nested
         BEGIN/COMMIT on the same client is not a nested transaction in
         Postgres, it is one flat transaction with a spurious COMMIT in the
         middle — which would defeat the whole point by committing the user
         row before the onboarding was safe. */
      return outer ? await work(outer) : await this.db.transaction(work);
    } catch (err: any) {
      if (err?.code === UNIQUE_VIOLATION) {
        throw new ConflictException('This user already has an onboarding');
      }
      throw err;
    }
  }

  /**
   * Create the account and its onboarding as one all-or-nothing request.
   *
   * Two calls from the browser could not be made safe: if POST /onboardings
   * failed after POST /auth/users had succeeded — a department with no
   * active template returns 404 — the account already existed, its
   * one-time password had already been shown and discarded, and nobody
   * could ever sign in as that person. The row had to be found and deleted
   * by hand.
   *
   * Everything here shares one client, so a failure at any point leaves the
   * database exactly as it was. The credentials come back from the same
   * response, which is also the only time the temporary password exists
   * outside the hash.
   */
  async createJoinee(dto: CreateJoineeDto, actorId: string) {
    return this.db.transaction(async (client) => {
      /* Typed, not cast. `as CreateUserDto` compiled just as well and
         would have gone on compiling if CreateUserDto ever grew a
         required field this does not pass — which is the kind of thing
         that fails at runtime, on the one request that must not. */
      const newUser: CreateUserDto = {
        fullName: dto.fullName,
        phoneNumber: dto.phoneNumber,
        personalEmail: dto.personalEmail,
        role: 'employee',
        departmentId: dto.departmentId,
      };
      const created = await this.auth.createUser(newUser, actorId, client);

      const onboarding = await this.createOnboarding(
        {
          userId: created.user.id,
          startDate: dto.startDate,
          managerName: dto.managerName,
          buddyName: dto.buddyName,
          requiredDocumentTypeIds: dto.requiredDocumentTypeIds,
        },
        actorId,
        client,
      );

      return { ...created, onboarding };
    });
  }

  /**
   * Every task starts 'locked' except the checkpoint itself, which
   * starts 'pending' so it's immediately actionable — it's what
   * unlocks everything else. Step 17 (Day 3) adds the transition that
   * flips the remaining phase-2 tasks to 'pending' once the checkpoint
   * reaches dual confirmation; nothing here needs to change for that.
   */
  private async insertOnboardingTask(
    client: PoolClient,
    onboardingId: string,
    task: {
      id: string;
      title: string;
      description: string | null;
      owner_role: string;
      due_offset_days: number;
      priority: string;
      is_required: boolean;
      completion_mode: string;
      is_checkpoint: boolean;
      subtasks?: {
        id: string;
        title: string;
        description: string | null;
        display_order: number;
        is_required: boolean;
      }[];
    },
    startDate: Date,
  ) {
    const dueDate = computeDueDate(startDate, task.due_offset_days);
    const status = task.is_checkpoint ? 'pending' : 'locked';

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO onboarding_tasks (
         onboarding_id, source_template_task_id, title, description,
         owner_role, due_date, priority, is_required, completion_mode,
         is_checkpoint, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        onboardingId,
        task.id,
        task.title,
        task.description,
        task.owner_role,
        dueDate.toISOString().slice(0, 10),
        task.priority,
        task.is_required,
        task.completion_mode,
        task.is_checkpoint,
        status,
      ],
    );

    // Title/description/order are copied rather than joined through to
    // template_subtasks, for the same reason the parent task's fields
    // are: publishing a new template version must never rewrite the
    // checklist of an onboarding already in flight.
    for (const subtask of task.subtasks ?? []) {
      await client.query(
        `INSERT INTO onboarding_subtasks (
           onboarding_task_id, source_template_subtask_id, title,
           description, display_order, is_required
         ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          rows[0].id,
          subtask.id,
          subtask.title,
          subtask.description,
          subtask.display_order,
          subtask.is_required,
        ],
      );
    }
  }

  /**
   * The single gating task that carries the documents HR asked for.
   *
   * Inserted here per onboarding rather than authored into every
   * department template: templates are versioned and immutable
   * (test/template-immutability.e2e-spec.ts), so adding a shared task to
   * all of them would mean publishing a new version of each one and
   * doing it again for every future department. The task is identified
   * by system_key, never by title — see DOCUMENT_UPLOAD_SYSTEM_KEY.
   *
   * completion_mode is 'employee': the joinee alone closes it by
   * uploading, and HR's review runs alongside without blocking
   * progression. is_required is true so it counts toward the
   * onboarding's progress and gates completion; status starts 'pending'
   * rather than 'locked' because paperwork is exactly what a joinee can
   * do before their checkpoint.
   */
  private async insertDocumentUploadTask(
    client: PoolClient,
    onboardingId: string,
    userId: string,
    documentTypeIds: string[],
    startDate: Date,
    actorId: string,
  ) {
    const { rows: typeRows } = await client.query<{ id: string }>(
      `SELECT id FROM document_types WHERE id = ANY($1::uuid[]) AND is_active`,
      [documentTypeIds],
    );
    if (typeRows.length !== documentTypeIds.length) {
      throw new BadRequestException('One or more document types are unknown or inactive');
    }

    const dueDate = computeDueDate(startDate, 0);
    const { rows: taskRows } = await client.query<{ id: string }>(
      `INSERT INTO onboarding_tasks (
         onboarding_id, source_template_task_id, title, description,
         owner_role, due_date, priority, is_required, completion_mode,
         is_checkpoint, status, system_key
       ) VALUES ($1, NULL, $2, $3, 'employee', $4, 'high', true, 'employee', false, 'pending', $5)
       RETURNING id`,
      [
        onboardingId,
        'Upload your documents',
        'Upload each document HR has requested. Your onboarding continues once they are submitted.',
        dueDate.toISOString().slice(0, 10),
        DOCUMENT_UPLOAD_SYSTEM_KEY,
      ],
    );

    for (const typeId of documentTypeIds) {
      await client.query(
        `INSERT INTO joinee_document_requirements
           (user_id, document_type_id, onboarding_task_id, requested_by)
         VALUES ($1, $2, $3, $4)`,
        [userId, typeId, taskRows[0].id, actorId],
      );
    }
  }

  /**
   * Step 17, first of the two status transitions this module owns: HR
   * recording the company email moves the onboarding from
   * 'pre_onboarding' to 'email_provisioned'. Recording the email and
   * flipping onboarding status happen in one transaction — see
   * UsersService.recordCompanyEmail's optional queryable param.
   *
   * The guard is `status = 'pre_onboarding'` specifically (not a wider
   * IN-list): unlike the checkpoint-completion transition below, there's
   * exactly one legitimate prior state here, and re-provisioning a
   * company email for an onboarding that's already past this point
   * would be a mistake worth surfacing, not silently absorbing.
   */
  async provisionCompanyEmail(
    onboardingId: string,
    dto: ProvisionCompanyEmailDto,
    actorId: string,
  ) {
    const { rows } = await this.db.query<OnboardingRow>(
      `SELECT * FROM onboardings WHERE id = $1`,
      [onboardingId],
    );
    const onboarding = rows[0];
    if (!onboarding) {
      throw new NotFoundException('Onboarding not found');
    }
    if (onboarding.status !== 'pre_onboarding') {
      throw new ConflictException(
        `Cannot provision a company email from status '${onboarding.status}'`,
      );
    }
    const user = await this.usersService.findById(onboarding.user_id);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const { onboardingUpdated, companyEmail } = await this.db.transaction(async (client) => {
      // A manual companyEmail is a deliberate override; the normal
      // path (HR clicks one button, nothing typed) omits it and gets
      // name@domain / name1@domain / ... — see
      // UsersService.generateUniqueCompanyEmail.
      const domain = this.config.get<string>('COMPANY_EMAIL_DOMAIN')!;
      const resolvedEmail =
        dto.companyEmail ??
        (await this.usersService.generateUniqueCompanyEmail(user.full_name, domain, client));

      await this.usersService.recordCompanyEmail(onboarding.user_id, resolvedEmail, client);

      const { rows: updatedRows } = await client.query<OnboardingRow>(
        `UPDATE onboardings SET status = 'email_provisioned'
         WHERE id = $1 AND status = 'pre_onboarding'
         RETURNING *`,
        [onboardingId],
      );
      const updated = updatedRows[0];
      if (!updated) {
        throw new ConflictException(
          'Onboarding status changed concurrently — company email not provisioned',
        );
      }

      // Never the email address itself in metadata — not a secret like
      // a password or TOTP secret, but there's no audit need for it
      // either; entity_id (the onboarding) is enough to find it.
      await this.activityLog.log(
        {
          actorId,
          action: 'onboarding.email_provisioned',
          entityType: 'onboarding',
          entityId: onboardingId,
        },
        client,
      );

      // Auto-assign every still-unclaimed task_owner-role task on this
      // onboarding (laptop handover, meet-manager, etc.) to the named
      // IT contact, the moment their actual trigger — the company
      // email going out — happens. A missing 'Bhupendra' account
      // (a different demo seed, a renamed contact) just means nothing
      // gets auto-claimed; HR/the task owner can still claim manually.
      const { rows: itRows } = await client.query<{ id: string }>(
        `SELECT id FROM users WHERE role = 'task_owner' AND full_name = 'Bhupendra' AND deleted_at IS NULL LIMIT 1`,
      );
      const itContactId = itRows[0]?.id;
      if (itContactId) {
        const { rows: claimedTasks } = await client.query<{ id: string }>(
          `UPDATE onboarding_tasks
           SET owner_user_id = $2
           WHERE onboarding_id = $1 AND owner_role = 'task_owner' AND owner_user_id IS NULL
           RETURNING id`,
          [onboardingId, itContactId],
        );
        for (const task of claimedTasks) {
          await this.activityLog.log(
            {
              actorId,
              action: 'onboarding_task.auto_assigned',
              entityType: 'onboarding_task',
              entityId: task.id,
              metadata: { assignedTo: itContactId },
            },
            client,
          );
        }
      }

      return { onboardingUpdated: updated, companyEmail: resolvedEmail };
    });

    return {
      onboarding: onboardingUpdated,
      // Not a login credential — company_email can't be used to log in
      // (Joinee ID + password and mobile + OTP are the only two login
      // methods). This is just the recorded address for HR's records.
      companyEmail,
    };
  }

  /**
   * The task scheduler: HR adding a one-off task onto an already-
   * running onboarding, outside anything the template snapshotted in.
   * Always starts 'pending' (immediately actionable, never 'locked' —
   * there's no phase-2 gate for a task that didn't come from the
   * template) and is never a checkpoint. source_template_task_id
   * stays NULL, which is exactly how the schema already distinguishes
   * "traceable to a template" from "not" for any task.
   */
  async createAdHocTask(onboardingId: string, dto: CreateAdHocTaskDto, actorId: string) {
    const onboarding = await this.getOnboardingOrThrow(onboardingId);

    const { rows } = await this.db.query(
      `INSERT INTO onboarding_tasks (
         onboarding_id, source_template_task_id, title, description,
         owner_role, due_date, priority, is_required, completion_mode,
         is_checkpoint, status
       ) VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, false, 'pending')
       RETURNING *`,
      [
        onboarding.id,
        dto.title,
        dto.description ?? null,
        dto.ownerRole,
        dto.dueDate,
        dto.priority,
        dto.isRequired,
        dto.completionMode,
      ],
    );

    await this.activityLog.log({
      actorId,
      action: 'onboarding_task.scheduled',
      entityType: 'onboarding_task',
      entityId: rows[0].id,
      metadata: { onboardingId: onboarding.id, title: dto.title },
    });

    return rows[0];
  }

  /** HR's view into one onboarding's full task list — every status,
   *  not just the actionable subset getMyDashboard's buckets show the
   *  employee themselves. Read-only from this side: completion still
   *  only happens through the employee/task_owner endpoints, which
   *  keeps "who is allowed to mark a task done" in exactly one place. */
  /**
   * Fills in (or corrects) manager and buddy after creation. Both are
   * optional on the create form, so this is the path for the common case
   * where HR doesn't know the buddy on day one.
   *
   * A separate "was this key present" boolean per field, rather than
   * COALESCE on the value: COALESCE can't tell "leave this alone" from
   * "set this to NULL", and both are things HR needs to do. The flag
   * carries presence, the value carries content, so one statement
   * handles set, clear, and leave-untouched for either field
   * independently.
   */
  async updateAssignments(
    onboardingId: string,
    dto: UpdateAssignmentsDto,
    actorId: string,
  ) {
    const { rows } = await this.db.query<OnboardingRow>(
      `UPDATE onboardings
       SET manager_name = CASE WHEN $2::boolean THEN $3::text ELSE manager_name END,
           buddy_name   = CASE WHEN $4::boolean THEN $5::text ELSE buddy_name   END
       WHERE id = $1
       RETURNING *`,
      [
        onboardingId,
        dto.managerName !== undefined,
        dto.managerName || null,
        dto.buddyName !== undefined,
        dto.buddyName || null,
      ],
    );
    const onboarding = rows[0];
    if (!onboarding) {
      throw new NotFoundException('Onboarding not found');
    }

    await this.activityLog.log({
      actorId,
      action: 'onboarding.assignments_updated',
      entityType: 'onboarding',
      entityId: onboardingId,
      // The names, not just presence flags: "assignments updated" with
      // no names is unreadable months later, which is the one moment
      // an audit trail exists for. Read back off the updated row so a
      // field left untouched logs the value that actually stands.
      metadata: {
        managerName: onboarding.manager_name,
        buddyName: onboarding.buddy_name,
        managerChanged: dto.managerName !== undefined,
        buddyChanged: dto.buddyName !== undefined,
      },
    });

    return onboarding;
  }

  /**
   * The one line the HR home shows under the greeting: how many joinees
   * are mid-onboarding, and how many of those are stuck.
   *
   * WHY THIS IS AN ENDPOINT AND NOT A REDUCE ON THE CLIENT.
   * The home page already holds every onboarding row (it fetches
   * /onboardings?limit=100 for the cards), so counting the first number
   * in the browser would cost nothing — but the second number is not in
   * those rows. "Blocked" is a join to an open blocker, per task, and
   * putting it on every roster row to let the client count them would
   * ship a list to answer a question about its length. It also silently
   * caps at whatever limit the list was fetched with; a count does not.
   *
   * `blocked` is a SUBSET of `onboarding` — the summary reads
   * "3 joinees onboarding · 1 blocked", so the 1 is one of the 3, not a
   * fourth joinee somewhere else.
   */
  async getSummary() {
    const { rows } = await this.db.query<{
      upcoming: number;
      onboarding: number;
      blocked: number;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE running AND not_started)::int AS upcoming,
         COUNT(*) FILTER (WHERE running)::int AS onboarding,
         COUNT(*) FILTER (WHERE running AND has_open_blocker)::int AS blocked
       FROM (
         SELECT
           o.status NOT IN ('completed', 'cancelled') AS running,
           -- "Upcoming" is a running onboarding whose joining date has not
           -- arrived. CURRENT_DATE, not now(): start_date is a DATE, so
           -- someone joining today is counted as started, not upcoming.
           o.start_date >= CURRENT_DATE AS not_started,
           EXISTS (
             SELECT 1
               FROM onboarding_tasks ot
               JOIN blockers b
                 ON b.onboarding_task_id = ot.id
                AND b.resolved_at IS NULL
              WHERE ot.onboarding_id = o.id
           ) AS has_open_blocker
         FROM onboardings o
       ) AS flagged`,
    );
    return rows[0];
  }

  async getOnboardingTasks(onboardingId: string) {
    await this.getOnboardingOrThrow(onboardingId);
    // Aliased to `ot` only so the blocker join has something to hang
    // off — the column list is otherwise unchanged. `blocker` is the
    // open one or null (OP-36).
    const { rows } = await this.db.query(
      `SELECT ot.id, ot.title, ot.description, ot.owner_role, ot.due_date, ot.priority,
              ot.is_required, ot.completion_mode, ot.is_checkpoint, ot.status,
              ot.blocked_reason,
              ${isOverdueSql('ot.')} AS is_overdue,
              ${OPEN_BLOCKER_JSON}
       FROM onboarding_tasks ot
       ${openBlockerJoin('ot')}
       WHERE ot.onboarding_id = $1
       ORDER BY ot.due_date, ot.created_at`,
      [onboardingId],
    );
    return rows;
  }

  private async getOnboardingOrThrow(onboardingId: string): Promise<OnboardingRow> {
    const { rows } = await this.db.query<OnboardingRow>(
      `SELECT * FROM onboardings WHERE id = $1`,
      [onboardingId],
    );
    const onboarding = rows[0];
    if (!onboarding) {
      throw new NotFoundException('Onboarding not found');
    }
    return onboarding;
  }

  /**
   * Step 32: SuperAdmin/HR dashboard, now with an allow-listed filter
   * and sort surface instead of the two ad-hoc equality params this
   * had through Step 28. `query` is the FULL, raw query object —
   * assertOnlyAllowedKeys rejects (400) any key outside
   * ['department','status','health','dateFrom','dateTo','sort']
   * rather than silently ignoring a typo'd or probing one.
   *
   * `health` is derived, not stored: 'stuck' means at least one
   * required task on the onboarding is blocked or overdue (the exact
   * Step 25/26 definition, via EXISTS/isOverdueSql), 'on_track' means
   * none are. Progress is still two plain COUNT subqueries, never a
   * stored column — same rule as everywhere else — and 'progress' as a
   * sort field is computed from those same two counts via a fixed
   * (never client-supplied) SQL expression, applied only after the
   * allow-list check has already validated the requested sort field.
   */
  async listAllOnboardings(query: Record<string, string | undefined>) {
    assertOnlyAllowedKeys(query, [
      'department',
      'status',
      'health',
      'dateFrom',
      'dateTo',
      'sort',
      'limit',
      'offset',
    ]);

    assertUuidIfPresent(query.department, 'department');
    assertOneOfIfPresent(query.status, 'status', ONBOARDING_STATUS_VALUES);
    assertOneOfIfPresent(query.health, 'health', HEALTH_VALUES);
    assertDateIfPresent(query.dateFrom, 'dateFrom');
    assertDateIfPresent(query.dateTo, 'dateTo');

    const { field, direction } = parseSort(
      query.sort,
      Object.keys(ONBOARDING_SORT_EXPRESSIONS),
      'startDate',
    );

    /*
    * Pagination
    *
    * Defaults:
    *   limit = 20
    *   offset = 0
    *
    * The limit must be between 1 and 100.
    */
    const limit = query.limit === undefined ? 20 : Number(query.limit);
    const offset = query.offset === undefined ? 0 : Number(query.offset);

    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      throw new BadRequestException(
        "'limit' must be an integer between 1 and 100",
      );
    }

    if (
      !Number.isInteger(offset) ||
      offset < 0
    ) {
      throw new BadRequestException(
        "'offset' must be a non-negative integer",
      );
    }

    const stuckExists = `EXISTS (
      SELECT 1
      FROM onboarding_tasks ot2
      WHERE ot2.onboarding_id = o.id
        AND ot2.is_required = true
        AND (
          ot2.status = 'blocked'
          OR ${isOverdueSql('ot2.')}
        )
    )`;

    const healthCondition =
      query.health === 'stuck'
        ? stuckExists
        : query.health === 'on_track'
          ? `NOT ${stuckExists}`
          : 'true';

    const { rows } = await this.db.query(
      `SELECT *
      FROM (
        SELECT
          o.id,
          o.user_id,
          o.department_id,
          o.template_id,
          o.template_version,
          -- ::text for the same reason as due_date below: a date column comes
          -- back from node-pg as a JS Date and serializes to UTC midnight,
          -- which the client then renders as the previous day west of UTC.
          o.start_date::text AS start_date,
          o.status,
          o.created_at,
          o.updated_at,
          u.full_name AS employee_name,
          -- Joinee ID and personal email are shown per row on the HR overview
          -- (the ID pill, and the address under the name). There is no bulk
          -- users endpoint, and a per-row /employee-profile call would be one
          -- request per visible joinee.
          u.joinee_id,
          u.personal_email,
          -- Read-only, and not a login credential (see provisionEmail). The HR
          -- home counts "Email issued" straight off this rather than inferring
          -- it from o.status, which only says the stage was *passed*.
          u.company_email,
          -- The account state that gates sign-in, so the HR roster can show
          -- and flip it per row. Distinct from o.status, which is about the
          -- onboarding, not about whether they can log in.
          u.status AS user_status,
          d.name AS department_name,
          t.name AS template_name,

          (
            SELECT COUNT(*)
            FROM onboarding_tasks ot
            WHERE ot.onboarding_id = o.id
              AND ot.is_required = true
          )::int AS required_task_count,

          (
            SELECT COUNT(*)
            FROM onboarding_tasks ot
            WHERE ot.onboarding_id = o.id
              AND ot.is_required = true
              AND ot.status = 'completed'
          )::int AS required_task_completed_count

        FROM onboardings o

        JOIN users u
          ON u.id = o.user_id

        JOIN departments d
          ON d.id = o.department_id

        JOIN onboarding_templates t
          ON t.id = o.template_id

        WHERE ($1::uuid IS NULL OR o.department_id = $1)
          AND ($2::text IS NULL OR o.status = $2)
          AND ($3::date IS NULL OR o.start_date >= $3)
          AND ($4::date IS NULL OR o.start_date <= $4)
          AND ${healthCondition}
      ) AS onboarding_rows

      ORDER BY ${ONBOARDING_SORT_EXPRESSIONS[field]} ${direction}

      LIMIT $5
      OFFSET $6`,
      [
        query.department ?? null,
        query.status ?? null,
        query.dateFrom ?? null,
        query.dateTo ?? null,
        limit,
        offset,
      ],
    );

    /*
    * Get the total number of rows matching the filters.
    *
    * This is deliberately separate from the paginated query because
    * `rows.length` only tells us how many rows are on this page.
    */
    const { rows: countRows } = await this.db.query<{ total: string }>(
      `SELECT COUNT(*)::int AS total
      FROM onboardings o

      JOIN users u
        ON u.id = o.user_id

      JOIN departments d
        ON d.id = o.department_id

      JOIN onboarding_templates t
        ON t.id = o.template_id

      WHERE ($1::uuid IS NULL OR o.department_id = $1)
        AND ($2::text IS NULL OR o.status = $2)
        AND ($3::date IS NULL OR o.start_date >= $3)
        AND ($4::date IS NULL OR o.start_date <= $4)
        AND ${healthCondition}`,
      [
        query.department ?? null,
        query.status ?? null,
        query.dateFrom ?? null,
        query.dateTo ?? null,
      ],
    );

    const total = Number(countRows[0]?.total ?? 0);

    return {
      data: rows,
      total,
      limit,
      offset,
    };
  }

  /**
   * Step 28's CSV export, now sharing Step 32's same allow-listed
   * filters as listAllOnboardings (department/status/dateFrom/dateTo —
   * no health/sort here, an export doesn't need ordering the way a UI
   * list does). This query never joins or selects from the notes
   * table, anywhere — not filtered out, structurally absent. "Notes
   * never appear in export, log, search, or any admin-facing query" is
   * a non-negotiable precisely because a filter is something a future
   * edit could accidentally loosen; a table that was never joined in
   * the first place can't leak through one.
   */
  async exportOnboardingsCsv(query: Record<string, string | undefined>): Promise<string> {
    assertOnlyAllowedKeys(query, ['department', 'status', 'dateFrom', 'dateTo']);
    assertUuidIfPresent(query.department, 'department');
    assertOneOfIfPresent(query.status, 'status', ONBOARDING_STATUS_VALUES);
    assertDateIfPresent(query.dateFrom, 'dateFrom');
    assertDateIfPresent(query.dateTo, 'dateTo');

    const { rows } = await this.db.query(
      `SELECT
         u.full_name AS employee_name,
         d.name AS department_name,
         t.name AS template_name,
         o.status AS onboarding_status,
         o.start_date,
         ot.title AS task_title,
         ot.status AS task_status,
         ot.priority,
         ot.completion_mode,
         ot.is_checkpoint,
         ot.is_required,
         ot.due_date,
         ot.completed_at
       FROM onboarding_tasks ot
       JOIN onboardings o ON o.id = ot.onboarding_id
       JOIN users u ON u.id = o.user_id
       JOIN departments d ON d.id = o.department_id
       JOIN onboarding_templates t ON t.id = o.template_id
       WHERE ($1::uuid IS NULL OR o.department_id = $1)
         AND ($2::text IS NULL OR o.status = $2)
         AND ($3::date IS NULL OR o.start_date >= $3)
         AND ($4::date IS NULL OR o.start_date <= $4)
       ORDER BY d.name, u.full_name, ot.due_date`,
      [query.department ?? null, query.status ?? null, query.dateFrom ?? null, query.dateTo ?? null],
    );

    const columns = [
      'employee_name',
      'department_name',
      'template_name',
      'onboarding_status',
      'start_date',
      'task_title',
      'task_status',
      'priority',
      'completion_mode',
      'is_checkpoint',
      'is_required',
      'due_date',
      'completed_at',
    ];
    return toCsv(rows, columns);
  }

  /**
   * Step 26: the single-screen "what's stuck" view — one row per
   * required, not-yet-done task that is either explicitly blocked or
   * overdue, on an onboarding that hasn't finished. isOverdueSql
   * (Step 25) now excludes 'locked' tasks, so a phase-2 task sitting
   * behind an unconfirmed checkpoint no longer floods this view with
   * false positives — if an onboarding is stuck because the checkpoint
   * itself hasn't been confirmed, THAT task is what shows up here
   * (is_checkpoint = true on the row makes it obvious at a glance which
   * kind of "stuck" it is), not every locked task behind it.
   *
   * onboarding_status is included so HR can immediately see whether a
   * stuck onboarding is still pre-checkpoint or already active but
   * lagging — the two call for different follow-up.
   *
   * Step 32 adds an allow-listed filter/sort surface: `department`,
   * `owner` (the claimed task_owner's user id, Step 20), and `priority`
   * as filters; `dueDate`/`priority` as sort fields. `owner` belongs
   * here rather than on listAllOnboardings — there's no single "owner"
   * of an onboarding, but every stuck row IS one specific task, which
   * does have one.
   */
  async listStuckTasks(query: Record<string, string | undefined>) {
    assertOnlyAllowedKeys(query, ['department', 'owner', 'priority', 'sort', 'limit', 'offset']);
    assertUuidIfPresent(query.department, 'department');
    assertUuidIfPresent(query.owner, 'owner');
    assertOneOfIfPresent(query.priority, 'priority', PRIORITY_VALUES);
    const { field, direction } = parseSort(query.sort, Object.keys(STUCK_SORT_EXPRESSIONS), 'dueDate');

    // Same hand-rolled limit/offset + separate COUNT(*) pattern as
    // listAllOnboardings above, for consistency within this file.
    const limit = query.limit === undefined ? 20 : Number(query.limit);
    const offset = query.offset === undefined ? 0 : Number(query.offset);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException("'limit' must be an integer between 1 and 100");
    }
    if (!Number.isInteger(offset) || offset < 0) {
      throw new BadRequestException("'offset' must be a non-negative integer");
    }

    const stuckWhere = `o.status NOT IN ('completed', 'cancelled')
         AND ot.is_required = true
         AND ot.status NOT IN ('completed', 'cancelled')
         AND (ot.status = 'blocked' OR ${isOverdueSql('ot.')})
         AND ($1::uuid IS NULL OR o.department_id = $1)
         AND ($2::uuid IS NULL OR ot.owner_user_id = $2)
         AND ($3::text IS NULL OR ot.priority = $3)`;
    const filterParams = [query.department ?? null, query.owner ?? null, query.priority ?? null];

    const { rows } = await this.db.query(
      `SELECT
         o.id AS onboarding_id,
         o.status AS onboarding_status,
         u.full_name AS employee_name,
         d.name AS department_name,
         ot.id AS task_id,
         ot.title AS task_title,
         ot.is_checkpoint,
         ot.priority,
         ot.due_date,
         ot.status AS task_status,
         ot.blocked_reason,
         (ot.status = 'blocked') AS is_blocked,
         ${isOverdueSql('ot.')} AS is_overdue
       FROM onboarding_tasks ot
       JOIN onboardings o ON o.id = ot.onboarding_id
       JOIN users u ON u.id = o.user_id
       JOIN departments d ON d.id = o.department_id
       WHERE ${stuckWhere}
       ORDER BY ${STUCK_SORT_EXPRESSIONS[field]} ${direction}
       LIMIT $4 OFFSET $5`,
      [...filterParams, limit, offset],
    );

    const { rows: countRows } = await this.db.query<{ total: string }>(
      `SELECT COUNT(*)::int AS total
       FROM onboarding_tasks ot
       JOIN onboardings o ON o.id = ot.onboarding_id
       WHERE ${stuckWhere}`,
      filterParams,
    );
    const total = Number(countRows[0]?.total ?? 0);

    return { data: rows, total, limit, offset };
  }

  /**
   * Step 21: Employee dashboard — the caller's own onboarding, bucketed
   * into today/upcoming/overdue, plus progress computed live from
   * required tasks only (never a stored/editable field — same rule as
   * everywhere else in this codebase).
   *
   * 'locked' tasks are excluded from all three time buckets: their
   * due_date was computed from start_date + offset regardless of when
   * the checkpoint actually completes, so a locked phase-2 task can
   * easily show a due_date in the past through no fault of the
   * employee's — surfacing that as "overdue" would be actively
   * misleading. They still count toward the progress denominator,
   * since progress means "of everything in my plan," not "of
   * everything I can currently act on."
   */
  async getMyDashboard(actor: AuthenticatedUser) {
    const onboarding = await this.findByUserId(actor.id);
    if (!onboarding) {
      throw new NotFoundException('No onboarding found for this account');
    }

    const { rows: bucketedTasks } = await this.db.query<{
      id: string;
      title: string;
      description: string | null;
      owner_role: string;
      // Cast to text in the SQL below — a plain `date` comes back as a JS Date
      // and serializes to a UTC timestamp, which renders as the wrong day west
      // of UTC.
      due_date: string;
      priority: string;
      is_required: boolean;
      completion_mode: string;
      is_checkpoint: boolean;
      status: string;
      blocked_reason: string | null;
      system_key: string | null;
      subtask_count: number;
      subtask_completed_count: number;
      bucket: 'overdue' | 'today' | 'upcoming';
      is_overdue: boolean;
      blocker: TaskBlocker | null;
    }>(
      `SELECT
         ot.id, ot.title, ot.description, ot.owner_role, ot.due_date::text AS due_date, ot.priority,
         ot.is_required, ot.completion_mode, ot.is_checkpoint, ot.status,
         ot.blocked_reason, ot.system_key,
         -- Counts, not the subtasks themselves: the dashboard only needs
         -- to know whether to show "2/4 steps" and open a checklist. The
         -- rows are fetched on demand by GET /onboarding-tasks/:id/subtasks.
         (SELECT COUNT(*) FROM onboarding_subtasks s
          WHERE s.onboarding_task_id = ot.id)::int AS subtask_count,
         (SELECT COUNT(*) FROM onboarding_subtasks s
          WHERE s.onboarding_task_id = ot.id AND s.completed_at IS NOT NULL)::int
           AS subtask_completed_count,
         CASE
           WHEN ot.due_date < CURRENT_DATE THEN 'overdue'
           WHEN ot.due_date = CURRENT_DATE THEN 'today'
           ELSE 'upcoming'
         END AS bucket,
         ${isOverdueSql('ot.')} AS is_overdue,
         ${OPEN_BLOCKER_JSON}
       FROM onboarding_tasks ot
       ${openBlockerJoin('ot')}
       WHERE ot.onboarding_id = $1
         AND ot.status NOT IN ('locked', 'completed', 'cancelled')
       ORDER BY ot.due_date`,
      [onboarding.id],
    );

    const { rows: progressRows } = await this.db.query<{
      required_total: string;
      required_completed: string;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE is_required) AS required_total,
         COUNT(*) FILTER (WHERE is_required AND status = 'completed') AS required_completed
       FROM onboarding_tasks
       WHERE onboarding_id = $1`,
      [onboarding.id],
    );
    const requiredTotal = Number(progressRows[0].required_total);
    const requiredCompleted = Number(progressRows[0].required_completed);

    // Required-only, every status included (unlike the three buckets
    // above) — this is what a "your onboarding journey" step list
    // renders: completed steps with a checkmark, one current step,
    // the rest as upcoming. Order matches how the employee will
    // actually move through it.
    const { rows: steps } = await this.db.query<{
      id: string;
      title: string;
      description: string | null;
      status: string;
      due_date: string;
      is_checkpoint: boolean;
      system_key: string | null;
      priority: string;
      blocked_reason: string | null;
      completion_mode: string;
      blocker: TaskBlocker | null;
      subtask_count: number;
      subtask_completed_count: number;
    }>(
      // The bucketed query above excludes locked/completed/cancelled, so this is
      // the only place the employee's FULL journey is available — the roadmap
      // renders from here and needs enough per step to draw a card, not just a
      // label. due_date is cast to text because node-pg maps a `date` column to a
      // JS Date, which serializes as a UTC timestamp and can render as the
      // previous day west of UTC (same reason diary.service.ts casts entry_date).
      `SELECT
         ot.id, ot.title, ot.description, ot.status, ot.due_date::text AS due_date,
         ot.is_checkpoint, ot.system_key, ot.priority, ot.blocked_reason,
         ot.completion_mode,
         ${OPEN_BLOCKER_JSON},
         (SELECT COUNT(*) FROM onboarding_subtasks s
          WHERE s.onboarding_task_id = ot.id)::int AS subtask_count,
         (SELECT COUNT(*) FROM onboarding_subtasks s
          WHERE s.onboarding_task_id = ot.id AND s.completed_at IS NOT NULL)::int
           AS subtask_completed_count
       FROM onboarding_tasks ot
       ${openBlockerJoin('ot')}
       WHERE ot.onboarding_id = $1 AND ot.is_required = true
       ORDER BY ot.due_date, ot.created_at`,
      [onboarding.id],
    );

    // Presented in trail order, with the sequential gate applied: exactly one
    // step is open and the rest are locked behind it. Both come from
    // trail-order.util, which the completion guard also reads — the trail can
    // therefore never offer a step that OnboardingTasksService would refuse.
    // The ORDER BY above is not redundant: it is the tiebreak inside each band.
    const orderedSteps = applySequenceGate(orderForTrail(steps));

    return {
      onboarding,
      today: bucketedTasks.filter((t) => t.bucket === 'today'),
      upcoming: bucketedTasks.filter((t) => t.bucket === 'upcoming'),
      overdue: bucketedTasks.filter((t) => t.bucket === 'overdue'),
      steps: orderedSteps,
      progress: {
        requiredTotal,
        requiredCompleted,
        percent:
          requiredTotal === 0 ? 0 : Math.round((requiredCompleted / requiredTotal) * 100),
      },
    };
  }

  /** Used by ClaimedAccountGuard (KnowledgeModule) to check the caller's
   *  own checkpoint status and department — never a client-supplied
   *  value. Returns null for accounts with no onboarding at all
   *  (task_owner/superadmin_hr), which callers should treat as
   *  ineligible for anything onboarding-status-gated. */
  async findByUserId(userId: string): Promise<OnboardingRow | null> {
    const { rows } = await this.db.query<OnboardingRow>(
      `SELECT * FROM onboardings WHERE user_id = $1`,
      [userId],
    );
    return rows[0] ?? null;
  }

  private async toOnboardingWithTasks(queryable: Queryable, onboardingId: string) {
    const { rows: onboardingRows } = await queryable.query<OnboardingRow>(
      `SELECT * FROM onboardings WHERE id = $1`,
      [onboardingId],
    );
    const onboarding = onboardingRows[0];

    const { rows: taskRows } = await queryable.query(
      `SELECT * FROM onboarding_tasks WHERE onboarding_id = $1 ORDER BY due_date, created_at`,
      [onboardingId],
    );

    return { ...onboarding, tasks: taskRows };
  }
}
