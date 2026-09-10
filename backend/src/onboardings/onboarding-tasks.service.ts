import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { isOverdueSql } from './utils/overdue.util';
import { AssignTaskDto } from './dto/assign-task.dto';
import {
  assertDateIfPresent,
  assertOneOfIfPresent,
  assertOnlyAllowedKeys,
  parseSort,
  parsePagination,
  paginateRows,
} from '../common/list-query.util';

/** Same structural-typing trick as OnboardingsService/TemplatesService —
 *  lets maybeCompleteOnboarding run against either the pooled
 *  DatabaseService or a transaction's PoolClient. */
interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;
}

const TASK_STATUS_VALUES = [
  'locked',
  'pending',
  'in_progress',
  'blocked',
  'completed',
  'cancelled',
] as const;
const PRIORITY_VALUES = ['low', 'normal', 'high'] as const;

/** Bare column names as they appear in listMyTasks' OUTER query (the
 *  wrapping SELECT * FROM (...)) — built from a fixed dictionary keyed
 *  by the already-allow-listed sort field, never the client's raw
 *  sort string. */
const TASK_SORT_EXPRESSIONS: Record<string, string> = {
  dueDate: 'due_date',
  priority: `CASE priority WHEN 'high' THEN 3 WHEN 'normal' THEN 2 WHEN 'low' THEN 1 ELSE 0 END`,
};

export interface OnboardingTaskRow {
  id: string;
  onboarding_id: string;
  source_template_task_id: string | null;
  title: string;
  description: string | null;
  owner_role: string;
  owner_user_id: string | null;
  due_date: Date;
  priority: string;
  is_required: boolean;
  completion_mode: string;
  is_checkpoint: boolean;
  status: string;
  blocked_reason: string | null;
  cancel_reason: string | null;
  employee_confirmed_by: string | null;
  employee_confirmed_at: Date | null;
  owner_confirmed_by: string | null;
  owner_confirmed_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface OnboardingSubtaskRow {
  id: string;
  onboarding_task_id: string;
  source_template_subtask_id: string | null;
  title: string;
  description: string | null;
  display_order: number;
  is_required: boolean;
  completed_at: Date | null;
  completed_by: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Step 18 generalizes Step 16's checkpoint-only dual confirmation to
 * all three completion_mode values, for any task:
 *   - 'employee': the employee alone closes it, one action.
 *   - 'owner':    a user matching the task's owner_role alone closes
 *                 it, one action.
 *   - 'dual':     both sides must confirm independently — same
 *                 mechanism the checkpoint already used in Step 16/17,
 *                 now available to any task marked 'dual', not just
 *                 is_checkpoint ones.
 *
 * The two endpoints stay "which side is confirming", not "which mode
 * is this" — the caller doesn't need to know a task's completion_mode
 * up front; the service figures out from completion_mode whether their
 * confirmation alone finishes the task (employee/owner) or needs to
 * wait on the other side (dual).
 *
 * Step 20 adds the missing piece: onboarding_tasks.owner_user_id stays
 * NULL at instantiation (see OnboardingsService), and until now nothing
 * ever set it — "the owner side" was authorized by role match against
 * owner_role alone. claimTask() lets any task_owner claim an unclaimed
 * owner/dual task matching their role, which is what makes a "tasks
 * scoped to owner_id = self" dashboard (listMyTasks) mean anything.
 * completeAsOwner() now prefers a specific claim when one exists —
 * once claimed, only that task_owner may complete it — and falls back
 * to the original role-match behavior for never-claimed tasks (e.g. the
 * checkpoint handover, which nothing in this codebase claims). The
 * employee side is unaffected: still a strict identity match against
 * the onboarding's user_id, since there's exactly one employee per
 * onboarding and nothing to claim.
 */
@Injectable()
export class OnboardingTasksService {
  constructor(
    private readonly db: DatabaseService,
    private readonly activityLog: ActivityLogService,
  ) {}

  async completeAsOwner(taskId: string, actor: AuthenticatedUser) {
    const task = await this.getActionableTaskOrThrow(taskId);

    if (task.completion_mode === 'employee') {
      throw new BadRequestException('This task does not take an owner confirmation');
    }
    if (task.owner_user_id) {
      if (task.owner_user_id !== actor.id) {
        throw new ForbiddenException(
          'This task has been claimed by a different task owner',
        );
      }
    } else if (actor.role !== task.owner_role) {
      throw new ForbiddenException(`Only a ${task.owner_role} can complete this task`);
    }
    if (task.owner_confirmed_at) {
      throw new ConflictException('Already confirmed by the owner side');
    }

    if (task.completion_mode === 'owner') {
      return this.completeSingleSided(
        taskId,
        'owner_confirmed_by',
        'owner_confirmed_at',
        actor.id,
        'onboarding_task.owner_completed',
      );
    }
    return this.applyDualConfirmation(
      taskId,
      'owner_confirmed_by',
      'owner_confirmed_at',
      'employee_confirmed_at',
      actor.id,
      'onboarding_task.owner_confirmed',
    );
  }

  async completeAsEmployee(taskId: string, actor: AuthenticatedUser) {
    const task = await this.getActionableTaskOrThrow(taskId);

    if (task.completion_mode === 'owner') {
      throw new BadRequestException('This task does not take an employee confirmation');
    }

    const onboarding = await this.getOnboardingOrThrow(task.onboarding_id);
    if (onboarding.user_id !== actor.id) {
      throw new ForbiddenException(
        'Only the employee on this onboarding can complete this task',
      );
    }
    if (task.employee_confirmed_at) {
      throw new ConflictException('Already confirmed by the employee');
    }

    if (task.completion_mode === 'employee') {
      return this.completeSingleSided(
        taskId,
        'employee_confirmed_by',
        'employee_confirmed_at',
        actor.id,
        'onboarding_task.employee_completed',
      );
    }
    return this.applyDualConfirmation(
      taskId,
      'employee_confirmed_by',
      'employee_confirmed_at',
      'owner_confirmed_at',
      actor.id,
      'onboarding_task.employee_confirmed',
    );
  }

  /**
   * Self-service claim: a task_owner takes ownership of a specific
   * owner/dual task matching their role, as long as nobody's claimed
   * it yet. This is a different "claim" than KnowledgeModule's
   * ClaimedAccountGuard (which is about a claimed login account) —
   * unrelated concepts that happen to share the word.
   *
   * Employee-mode tasks have no owner side at all — owner_role is set
   * on them too (e.g. "read the onboarding guide" has owner_role
   * 'employee'), but there's nothing for a task_owner to claim there.
   */
  async claimTask(taskId: string, actor: AuthenticatedUser): Promise<OnboardingTaskRow> {
    const task = await this.getActionableTaskOrThrow(taskId);

    if (task.completion_mode === 'employee') {
      throw new BadRequestException('This task has no owner side to claim');
    }
    if (actor.role !== task.owner_role) {
      throw new ForbiddenException(`Only a ${task.owner_role} can claim this task`);
    }
    if (task.owner_user_id) {
      throw new ConflictException('This task has already been claimed');
    }

    const { rows } = await this.db.query<OnboardingTaskRow>(
      `UPDATE onboarding_tasks SET owner_user_id = $2
       WHERE id = $1 AND owner_user_id IS NULL
       RETURNING *`,
      [taskId, actor.id],
    );
    if (!rows[0]) {
      throw new ConflictException('This task has already been claimed');
    }

    await this.activityLog.log({
      actorId: actor.id,
      action: 'onboarding_task.claimed',
      entityType: 'onboarding_task',
      entityId: taskId,
    });

    return rows[0];
  }

  /**
   * Step 20: the TaskOwner dashboard. Scoped server-side to
   * owner_user_id = actor.id — not a role filter, not a client-
   * supplied id — so a task_owner only ever sees tasks they've
   * personally claimed, across every onboarding. is_overdue (Step 25)
   * uses the same shared definition as the HR and Employee dashboards.
   *
   * Step 32: allow-listed status/priority/dateFrom/dateTo filters on
   * top of that base scope, plus dueDate/priority sort. `query` is the
   * full raw query object so assertOnlyAllowedKeys can reject any key
   * outside that list rather than silently ignore it.
   */
  async listMyTasks(actor: AuthenticatedUser, query: Record<string, string | undefined>) {
    assertOnlyAllowedKeys(query, [
      'status',
      'priority',
      'dateFrom',
      'dateTo',
      'sort',
      'limit',
      'offset',
    ]);
    assertOneOfIfPresent(query.status, 'status', TASK_STATUS_VALUES);
    assertOneOfIfPresent(query.priority, 'priority', PRIORITY_VALUES);
    assertDateIfPresent(query.dateFrom, 'dateFrom');
    assertDateIfPresent(query.dateTo, 'dateTo');
    const { field, direction } = parseSort(query.sort, Object.keys(TASK_SORT_EXPRESSIONS), 'dueDate');
    const pagination = parsePagination(query);

    const { rows } = await this.db.query(
      `SELECT *, COUNT(*) OVER()::int AS total_count FROM (
         SELECT
           ot.id, ot.onboarding_id, ot.title, ot.description, ot.due_date,
           ot.priority, ot.status, ot.completion_mode, ot.is_checkpoint,
           ot.blocked_reason,
           ${isOverdueSql('ot.')} AS is_overdue,
           u.full_name AS employee_name,
           d.name AS department_name
         FROM onboarding_tasks ot
         JOIN onboardings o ON o.id = ot.onboarding_id
         JOIN users u ON u.id = o.user_id
         JOIN departments d ON d.id = o.department_id
         WHERE ot.owner_user_id = $1
           AND ($2::text IS NULL OR ot.status = $2)
           AND ($3::text IS NULL OR ot.priority = $3)
           AND ($4::date IS NULL OR ot.due_date >= $4)
           AND ($5::date IS NULL OR ot.due_date <= $5)
       ) AS task_rows
       ORDER BY ${TASK_SORT_EXPRESSIONS[field]} ${direction}
       LIMIT $6 OFFSET $7`,
      [
        actor.id,
        query.status ?? null,
        query.priority ?? null,
        query.dateFrom ?? null,
        query.dateTo ?? null,
        pagination.limit,
        pagination.offset,
      ],
    );
    return paginateRows(rows, pagination);
  }

  /** The other half of claimTask(): what a task_owner can see to claim
   *  in the first place. Same actionability rules as claimTask itself
   *  (not locked/cancelled/completed, has an owner side, unclaimed,
   *  role matches) so nothing shown here would fail if claimed. */
  async listClaimableTasks(actor: AuthenticatedUser) {
    const { rows } = await this.db.query(
      `SELECT
         ot.id, ot.onboarding_id, ot.title, ot.description, ot.due_date,
         ot.priority, ot.status, ot.completion_mode, ot.is_checkpoint,
         u.full_name AS employee_name,
         d.name AS department_name
       FROM onboarding_tasks ot
       JOIN onboardings o ON o.id = ot.onboarding_id
       JOIN users u ON u.id = o.user_id
       JOIN departments d ON d.id = o.department_id
       WHERE ot.owner_role = $1
         AND ot.owner_user_id IS NULL
         AND ot.completion_mode != 'employee'
         AND ot.status NOT IN ('locked', 'cancelled', 'completed')
       ORDER BY ot.due_date ASC`,
      [actor.role],
    );
    return rows;
  }

  /**
   * A task owner's own department roster — every onboarding whose
   * department_id matches the caller's department_id (from their JWT,
   * never a client-supplied value), same required-task progress counts
   * as HR's company-wide listAllOnboardings. A task owner with no
   * department set gets an empty list rather than an error — there's
   * nothing to scope to. Newest-started employee first, so a task
   * owner sees their most recently joined reports up top.
   */
  async listDepartmentOnboardings(actor: AuthenticatedUser) {
    if (!actor.departmentId) {
      return [];
    }
    const { rows } = await this.db.query(
      `SELECT
         o.id, o.status, o.start_date, o.created_at,
         u.full_name AS employee_name,
         (
           SELECT COUNT(*) FROM onboarding_tasks ot
           WHERE ot.onboarding_id = o.id AND ot.is_required = true
         )::int AS required_task_count,
         (
           SELECT COUNT(*) FROM onboarding_tasks ot
           WHERE ot.onboarding_id = o.id AND ot.is_required = true AND ot.status = 'completed'
         )::int AS required_task_completed_count
       FROM onboardings o
       JOIN users u ON u.id = o.user_id
       WHERE o.department_id = $1
       ORDER BY o.created_at DESC`,
      [actor.departmentId],
    );
    return rows;
  }

  /**
   * A task owner assigning an ad-hoc task onto one onboarding in their
   * own department — the task-owner-scoped counterpart to HR's
   * OnboardingsService.createAdHocTask. Restricted to the caller's own
   * department (403, not 404, if the onboarding exists but belongs to
   * someone else's — same "don't confirm/deny existence differently"
   * stance as NotesService). Fixed server-side, unlike HR's version:
   * owner_role is always 'task_owner', completion_mode is always
   * 'owner' (a task the assigning owner alone closes), never a
   * checkpoint, not required (it's extra, outside the template's
   * mandatory checklist — never gates the "steps"/progress view), and
   * auto-claimed by the assigner so it shows up on their own "My tasks"
   * immediately rather than sitting in claimable for someone else.
   */
  async assignTaskByOwner(actor: AuthenticatedUser, dto: AssignTaskDto) {
    const { rows: onboardingRows } = await this.db.query<{ department_id: string }>(
      `SELECT department_id FROM onboardings WHERE id = $1`,
      [dto.onboardingId],
    );
    const onboarding = onboardingRows[0];
    if (!onboarding) {
      throw new NotFoundException('Onboarding not found');
    }
    if (!actor.departmentId || onboarding.department_id !== actor.departmentId) {
      throw new ForbiddenException('You can only assign tasks within your own department');
    }

    const { rows } = await this.db.query<OnboardingTaskRow>(
      `INSERT INTO onboarding_tasks (
         onboarding_id, source_template_task_id, title, description,
         owner_role, owner_user_id, due_date, priority, is_required,
         completion_mode, is_checkpoint, status
       ) VALUES ($1, NULL, $2, $3, 'task_owner', $4, $5, $6, false, 'owner', false, 'pending')
       RETURNING *`,
      [
        dto.onboardingId,
        dto.title,
        dto.description ?? null,
        actor.id,
        dto.dueDate,
        dto.priority ?? 'normal',
      ],
    );

    await this.activityLog.log({
      actorId: actor.id,
      action: 'onboarding_task.assigned_by_owner',
      entityType: 'onboarding_task',
      entityId: rows[0].id,
      metadata: { onboardingId: dto.onboardingId, title: dto.title },
    });

    return rows[0];
  }

  // ============================================================
  // Subtasks — the checklist inside a major task's popup.
  // ============================================================

  /**
   * The popup's contents. Readable by the employee the onboarding
   * belongs to and by SuperAdmin/HR (who sees the same list read-only on
   * the employee profile screen). A task_owner is deliberately not
   * included: subtasks are the employee's own checklist, and nothing in
   * the current product asks a task owner to watch them.
   */
  async listSubtasks(taskId: string, actor: AuthenticatedUser): Promise<OnboardingSubtaskRow[]> {
    const { rows: taskRows } = await this.db.query<{ onboarding_id: string; user_id: string }>(
      `SELECT ot.onboarding_id, o.user_id
       FROM onboarding_tasks ot
       JOIN onboardings o ON o.id = ot.onboarding_id
       WHERE ot.id = $1`,
      [taskId],
    );
    const task = taskRows[0];
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    if (actor.role !== 'superadmin_hr' && task.user_id !== actor.id) {
      throw new ForbiddenException('You cannot view this task');
    }

    const { rows } = await this.db.query<OnboardingSubtaskRow>(
      `SELECT * FROM onboarding_subtasks
       WHERE onboarding_task_id = $1
       ORDER BY display_order`,
      [taskId],
    );
    return rows;
  }

  /**
   * Ticks one subtask and, if it was the last outstanding REQUIRED one,
   * completes the parent task in the same transaction.
   *
   * Auto-completion only fires for a parent whose completion_mode is
   * 'employee' — a single-sided close by the joinee. An 'owner' or
   * 'dual' task that happens to carry subtasks still completes through
   * its own confirmation endpoints; ticking subtasks there is progress
   * tracking, not completion, because auto-closing a dual-confirm
   * checkpoint from one side would defeat the point of it (and
   * chk_dual_confirmation would reject the write anyway).
   */
  async markSubtaskDone(subtaskId: string, actor: AuthenticatedUser) {
    return this.db.transaction(async (client) => {
      const subtask = await this.getOwnSubtaskForUpdateOrThrow(client, subtaskId, actor);

      if (subtask.completed_at) {
        throw new ConflictException('This subtask is already done');
      }

      const { rows } = await client.query<OnboardingSubtaskRow>(
        `UPDATE onboarding_subtasks
         SET completed_at = now(), completed_by = $2
         WHERE id = $1 AND completed_at IS NULL
         RETURNING *`,
        [subtaskId, actor.id],
      );
      if (!rows[0]) {
        throw new ConflictException('This subtask is already done');
      }

      const { rows: remainingRows } = await client.query<{ remaining: number }>(
        `SELECT COUNT(*)::int AS remaining FROM onboarding_subtasks
         WHERE onboarding_task_id = $1 AND is_required = true AND completed_at IS NULL`,
        [subtask.onboarding_task_id],
      );

      let parentCompleted = false;
      if (
        Number(remainingRows[0].remaining) === 0 &&
        subtask.completion_mode === 'employee' &&
        subtask.task_status !== 'completed'
      ) {
        await this.completeSingleSidedIn(
          client,
          subtask.onboarding_task_id,
          'employee_confirmed_by',
          'employee_confirmed_at',
          actor.id,
          'onboarding_task.completed_via_subtasks',
        );
        parentCompleted = true;
      }

      await this.activityLog.log(
        {
          actorId: actor.id,
          action: 'onboarding_subtask.completed',
          entityType: 'onboarding_subtask',
          entityId: subtaskId,
          metadata: { taskId: subtask.onboarding_task_id, parentCompleted },
        },
        client,
      );

      return { ...rows[0], parent_task_completed: parentCompleted };
    });
  }

  /**
   * Un-ticks a subtask. Deliberately does NOT reopen a parent task that
   * has already completed — task completion is a one-way door here, so
   * correcting a checklist entry after the fact cannot silently pull a
   * finished task (and with it the onboarding's progress and any
   * unlocked follow-on work) backwards.
   */
  async unmarkSubtaskDone(subtaskId: string, actor: AuthenticatedUser) {
    return this.db.transaction(async (client) => {
      const subtask = await this.getOwnSubtaskForUpdateOrThrow(client, subtaskId, actor);

      if (!subtask.completed_at) {
        throw new ConflictException('This subtask is not done');
      }

      const { rows } = await client.query<OnboardingSubtaskRow>(
        `UPDATE onboarding_subtasks
         SET completed_at = NULL, completed_by = NULL
         WHERE id = $1 AND completed_at IS NOT NULL
         RETURNING *`,
        [subtaskId],
      );
      if (!rows[0]) {
        throw new ConflictException('This subtask is not done');
      }

      await this.activityLog.log(
        {
          actorId: actor.id,
          action: 'onboarding_subtask.reopened',
          entityType: 'onboarding_subtask',
          entityId: subtaskId,
          metadata: {
            taskId: subtask.onboarding_task_id,
            parentTaskStatus: subtask.task_status,
          },
        },
        client,
      );

      return rows[0];
    });
  }

  /**
   * Completes an employee-mode task because the work behind it is
   * finished, rather than because someone pressed a "complete" button —
   * the joinee submitting the last requested document is the one caller
   * today (JoineeDocumentsService).
   *
   * Takes the caller's transaction client so the underlying write and
   * this completion are one atomic step, and no-ops rather than throwing
   * if the task is already closed: the trigger for it (an upload) is
   * legitimate to repeat, so "already complete" is not an error at this
   * boundary the way it is on a direct completion endpoint.
   */
  async completeEmployeeTaskAsSystem(
    queryable: Queryable,
    taskId: string,
    actorId: string,
    action: string,
  ): Promise<boolean> {
    const { rows } = await queryable.query<OnboardingTaskRow>(
      `UPDATE onboarding_tasks
       SET employee_confirmed_by = $2,
           employee_confirmed_at = now(),
           status = 'completed',
           completed_at = now()
       WHERE id = $1
         AND completion_mode = 'employee'
         AND status NOT IN ('locked', 'cancelled', 'completed')
       RETURNING *`,
      [taskId, actorId],
    );
    if (!rows[0]) {
      return false;
    }

    await this.activityLog.log(
      { actorId, action, entityType: 'onboarding_task', entityId: taskId },
      queryable,
    );

    if (rows[0].is_required) {
      await this.maybeCompleteOnboarding(queryable, rows[0].onboarding_id);
    }
    return true;
  }

  /**
   * Row-locks the subtask together with the parent task's completion
   * state, so a concurrent tick of two final subtasks can't both see
   * "one remaining" and race into completing the parent twice.
   *
   * Authorization is a strict identity match against the onboarding's
   * user_id — the same rule completeAsEmployee applies, and for the same
   * reason: there is exactly one employee per onboarding and nothing
   * here to claim.
   */
  private async getOwnSubtaskForUpdateOrThrow(
    client: PoolClient,
    subtaskId: string,
    actor: AuthenticatedUser,
  ): Promise<OnboardingSubtaskRow & {
    completion_mode: string;
    task_status: string;
    onboarding_user_id: string;
  }> {
    const { rows } = await client.query<
      OnboardingSubtaskRow & {
        completion_mode: string;
        task_status: string;
        onboarding_user_id: string;
      }
    >(
      `SELECT s.*, ot.completion_mode, ot.status AS task_status, o.user_id AS onboarding_user_id
       FROM onboarding_subtasks s
       JOIN onboarding_tasks ot ON ot.id = s.onboarding_task_id
       JOIN onboardings o ON o.id = ot.onboarding_id
       WHERE s.id = $1
       FOR UPDATE OF s, ot`,
      [subtaskId],
    );
    const subtask = rows[0];
    if (!subtask) {
      throw new NotFoundException('Subtask not found');
    }
    if (subtask.onboarding_user_id !== actor.id) {
      throw new ForbiddenException('Only the employee on this onboarding can update its subtasks');
    }
    if (subtask.task_status === 'locked') {
      throw new ForbiddenException('This task is locked until the checkpoint is completed');
    }
    if (subtask.task_status === 'cancelled') {
      throw new ConflictException('This task has been cancelled');
    }
    return subtask;
  }

  /**
   * Checked after any completion that could be the LAST required task
   * on an onboarding: if none remain outstanding, the onboarding itself
   * advances to 'completed'. Without this, onboardings.status simply
   * never reaches 'completed' — it would sit at 'active' forever even
   * once every required task is done, which is exactly what stalls the
   * frontend's JourneyTrack (driven off onboarding.status, not the
   * numeric percent) short of its final stage. The WHERE status =
   * 'active' guard makes this a no-op if the onboarding was already
   * completed/cancelled, and safe to call unconditionally — from
   * multiple concurrent completions — without a transaction of its own.
   */
  private async maybeCompleteOnboarding(queryable: Queryable, onboardingId: string) {
    const { rows } = await queryable.query<{ remaining: string }>(
      `SELECT COUNT(*)::int AS remaining FROM onboarding_tasks
       WHERE onboarding_id = $1 AND is_required = true AND status <> 'completed'`,
      [onboardingId],
    );
    if (Number(rows[0].remaining) === 0) {
      await queryable.query(
        `UPDATE onboardings SET status = 'completed' WHERE id = $1 AND status = 'active'`,
        [onboardingId],
      );
    }
  }

  private async getActionableTaskOrThrow(taskId: string): Promise<OnboardingTaskRow> {
    const { rows } = await this.db.query<OnboardingTaskRow>(
      `SELECT * FROM onboarding_tasks WHERE id = $1`,
      [taskId],
    );
    const task = rows[0];
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    if (task.status === 'locked') {
      throw new ForbiddenException(
        'This task is locked until the checkpoint is completed',
      );
    }
    if (task.status === 'cancelled') {
      throw new ConflictException('This task has been cancelled');
    }
    if (task.status === 'completed') {
      throw new ConflictException('This task is already completed');
    }
    return task;
  }

  private async getOnboardingOrThrow(onboardingId: string): Promise<{ user_id: string }> {
    const { rows } = await this.db.query<{ user_id: string }>(
      `SELECT user_id FROM onboardings WHERE id = $1`,
      [onboardingId],
    );
    const onboarding = rows[0];
    if (!onboarding) {
      throw new NotFoundException('Onboarding not found');
    }
    return onboarding;
  }

  /** employee-only / owner-only: one action closes the task outright —
   *  no other side to wait on. The confirmation column is still
   *  recorded (who/when), it just isn't gating anything.
   *
   *  Wraps a transaction of its own because completing a CHECKPOINT
   *  single-sided now also unlocks the phase-2 tasks and advances the
   *  onboarding (applyCompletionSideEffects) — three statements that
   *  must not half-apply. markSubtaskDone already holds a transaction,
   *  so it calls completeSingleSidedIn directly with its own client. */
  private completeSingleSided(
    taskId: string,
    confirmedByColumn: 'owner_confirmed_by' | 'employee_confirmed_by',
    confirmedAtColumn: 'owner_confirmed_at' | 'employee_confirmed_at',
    actorId: string,
    action: string,
  ): Promise<OnboardingTaskRow> {
    return this.db.transaction((client) =>
      this.completeSingleSidedIn(
        client,
        taskId,
        confirmedByColumn,
        confirmedAtColumn,
        actorId,
        action,
      ),
    );
  }

  private async completeSingleSidedIn(
    queryable: Queryable,
    taskId: string,
    confirmedByColumn: 'owner_confirmed_by' | 'employee_confirmed_by',
    confirmedAtColumn: 'owner_confirmed_at' | 'employee_confirmed_at',
    actorId: string,
    action: string,
  ): Promise<OnboardingTaskRow> {
    const { rows } = await queryable.query<OnboardingTaskRow>(
      `UPDATE onboarding_tasks
       SET ${confirmedByColumn} = $2,
           ${confirmedAtColumn} = now(),
           status = 'completed',
           completed_at = now()
       WHERE id = $1 AND ${confirmedAtColumn} IS NULL AND status NOT IN ('cancelled', 'completed')
       RETURNING *`,
      [taskId, actorId],
    );

    if (!rows[0]) {
      throw new ConflictException('Already completed');
    }

    await this.activityLog.log({
      actorId,
      action,
      entityType: 'onboarding_task',
      entityId: taskId,
    });

    await this.applyCompletionSideEffects(queryable, rows[0]);

    return rows[0];
  }

  /**
   * What has to happen once ANY task reaches 'completed', regardless of
   * which completion_mode got it there.
   *
   * This used to live only in applyDualConfirmation, which was fine
   * while every checkpoint was a dual-confirm task. The moment a
   * checkpoint is single-sided, that placement silently strands the
   * onboarding: the checkpoint closes, but nothing unlocks the phase-2
   * tasks waiting behind it and the onboarding never leaves
   * 'pre_onboarding'. Keeping it here means the unlock follows from
   * "the checkpoint is done", not from "the checkpoint was confirmed by
   * two people".
   */
  private async applyCompletionSideEffects(
    queryable: Queryable,
    task: OnboardingTaskRow,
  ): Promise<void> {
    if (task.status !== 'completed') return;

    if (task.is_checkpoint) {
      await this.unlockPhaseTwoTasks(queryable, task.onboarding_id);
      await this.activateOnboarding(queryable, task.onboarding_id);
    }
    if (task.is_required) {
      await this.maybeCompleteOnboarding(queryable, task.onboarding_id);
    }
  }

  /**
   * dual: one atomic UPDATE, not read-then-write — the CASE expressions
   * read the *other* side's confirmation column as of this statement's
   * own row lock, so two confirmations arriving concurrently still
   * serialize correctly (whichever commits second is the one that sees
   * the first's value and flips status to 'completed'). The
   * `<column> IS NULL` guard in WHERE makes a double-confirmation from
   * the same side a no-op (0 rows) rather than silently overwriting
   * who confirmed it.
   *
   * When this confirmation is the one that completes the CHECKPOINT
   * specifically (is_checkpoint, not just any dual task — Step 17),
   * two more things happen in the same transaction: every other
   * 'locked' task on this onboarding flips to 'pending', and the
   * onboarding itself advances to 'active'. A regular dual-mode task
   * (is_checkpoint = false) completing does neither — it's just a task.
   */
  private async applyDualConfirmation(
    taskId: string,
    confirmedByColumn: 'owner_confirmed_by' | 'employee_confirmed_by',
    confirmedAtColumn: 'owner_confirmed_at' | 'employee_confirmed_at',
    otherConfirmedAtColumn: 'owner_confirmed_at' | 'employee_confirmed_at',
    actorId: string,
    action: string,
  ): Promise<OnboardingTaskRow> {
    return this.db.transaction(async (client) => {
      const { rows } = await client.query<OnboardingTaskRow>(
        `UPDATE onboarding_tasks
         SET ${confirmedByColumn} = $2,
             ${confirmedAtColumn} = now(),
             status = CASE WHEN ${otherConfirmedAtColumn} IS NOT NULL THEN 'completed' ELSE status END,
             completed_at = CASE WHEN ${otherConfirmedAtColumn} IS NOT NULL THEN now() ELSE completed_at END
         WHERE id = $1 AND ${confirmedAtColumn} IS NULL AND status NOT IN ('cancelled', 'completed')
         RETURNING *`,
        [taskId, actorId],
      );

      const task = rows[0];
      if (!task) {
        throw new ConflictException('Already confirmed from this side');
      }

      await this.activityLog.log(
        {
          actorId,
          action,
          entityType: 'onboarding_task',
          entityId: taskId,
          metadata: { completedThisConfirmation: task.status === 'completed' },
        },
        client,
      );

      await this.applyCompletionSideEffects(client, task);

      return task;
    });
  }

  /** The phase-2 gate itself: everything that started 'locked' at
   *  instantiation (see OnboardingsService.insertOnboardingTask)
   *  becomes actionable the moment the checkpoint is done. Tasks in
   *  any other status (already 'pending'/'completed'/'cancelled') are
   *  untouched. */
  private async unlockPhaseTwoTasks(queryable: Queryable, onboardingId: string) {
    await queryable.query(
      `UPDATE onboarding_tasks SET status = 'pending'
       WHERE onboarding_id = $1 AND status = 'locked'`,
      [onboardingId],
    );
  }

  /** Third and final onboarding.status transition (Step 17). Guarded
   *  on an IN-list of every pre-active status rather than exactly
   *  'checkpoint_pending' — HR/IT/the employee are independent actors,
   *  so the checkpoint can realistically be confirmed before the
   *  company email dance is finished. This only ever moves status
   *  forward, and is a no-op if the onboarding is already active or
   *  beyond. */
  private async activateOnboarding(queryable: Queryable, onboardingId: string) {
    await queryable.query(
      `UPDATE onboardings SET status = 'active'
       WHERE id = $1 AND status IN ('pre_onboarding', 'email_provisioned', 'checkpoint_pending')`,
      [onboardingId],
    );
  }
}
