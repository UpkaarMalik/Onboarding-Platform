import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CreateBlockerDto } from './dto/create-blocker.dto';
import { ResolveBlockerDto } from './dto/resolve-blocker.dto';

/** Postgres unique_violation. The one-open-blocker-per-task rule is an
 *  index, not a read-then-write check, so this is how a lost race
 *  arrives. */
const UNIQUE_VIOLATION = '23505';

export interface BlockerRow {
  id: string;
  onboarding_task_id: string;
  owner_role: string;
  owner_user_id: string | null;
  reason: string;
  waiting_since: Date;
  /** text, not a Date: see the RETURNING casts below. */
  expected_at: string | null;
  resolved_at: Date | null;
  resolved_by: string | null;
  created_by: string;
  provisioning_request_id: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Blockers (OP-36).
 *
 * WHAT A BLOCKER IS, AND WHAT IT IS NOT.
 * 'blocked' means a human looked at this task and said it is stuck.
 * That is the entire distinction from 'locked', which means the
 * sequence has not reached the task yet and no person has asserted
 * anything about it. Keeping those apart is why this table exists
 * rather than a second reason column: a status can say "stuck", only a
 * record can say why, whose desk it is on, since when, and until when.
 *
 * STATUS IS MIRRORED, DELIBERATELY.
 * Blocking writes the blockers row AND sets onboarding_tasks.status =
 * 'blocked' + blocked_reason, in the same transaction. The duplication
 * is not an oversight: five HR queries already written (the stuck
 * feed, the roster health filter, the employee dashboard, the trail
 * gate, the profile view) read status/blocked_reason today, and this
 * ticket is not a licence to rewrite all five as joins. One
 * transaction means the copy cannot drift from the record.
 *
 * RESOLVING RETURNS THE TASK TO 'pending'.
 * Blocking overwrote whatever the status used to be, so resolving has
 * to put something back, and the only safe value is the one that means
 * "open, nobody has claimed it is stuck". That is exactly right for
 * the tasks this service will accept — see the 'locked' guard in
 * block() below, which is what makes it true rather than hopeful.
 *
 * ponytail: when OP-18's resolveTaskState lands, state stops being a
 * stored column and is derived per read from dependencies + the open
 * blocker. At that point the status mirror here becomes redundant
 * (OP-18's interim rule is literally "treat status = 'blocked' as
 * blocked", which is what this writes) and the 'pending' restore can
 * be dropped in favour of letting the state function answer.
 */
@Injectable()
export class BlockersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly activityLog: ActivityLogService,
    private readonly notifications: NotificationsService,
  ) {}

  async block(
    taskId: string,
    dto: CreateBlockerDto,
    actor: AuthenticatedUser,
  ): Promise<BlockerRow> {
    const task = await this.getBlockableTaskOrThrow(taskId);
    this.assertMayActOnTask(task, actor);

    return this.db.transaction(async (client) => {
      let blocker: BlockerRow;
      try {
        const { rows } = await client.query<BlockerRow>(
          `INSERT INTO blockers (
             onboarding_task_id, owner_role, owner_user_id,
             reason, expected_at, created_by
           ) VALUES ($1, $2, $3, $4, $5, $6)
           -- expected_at LAST and cast to text, overriding the * above: a
           -- a pg date column becomes a JS Date and serializes as midnight
           -- UTC, so "expected Friday" came back as Thursday anywhere east of
           -- UTC. Same cast the read path already applies — see
           -- blocker-payload.util.
           RETURNING *, expected_at::text AS expected_at`,
          [
            taskId,
            // Defaults to the task's own owner, which is the answer
            // nearly every time — see CreateBlockerDto.
            dto.ownerRole ?? task.owner_role,
            dto.ownerUserId ?? task.owner_user_id,
            dto.reason,
            dto.expectedAt ?? null,
            actor.id,
          ],
        );
        blocker = rows[0];
      } catch (err: any) {
        // idx_blockers_one_open_per_task. Two people pressing "Mark as
        // blocked" on the same task at once is the ordinary way this
        // happens, not an edge case, and the second one should be told
        // it is already blocked rather than shown a 500.
        if (err?.code === UNIQUE_VIOLATION) {
          throw new ConflictException('This task already has an open blocker');
        }
        throw err;
      }

      // Guarded on the status we read above rather than blindly SET:
      // a completion landing between the read and here would otherwise
      // drag a finished task back to 'blocked'.
      await client.query(
        `UPDATE onboarding_tasks
            SET status = 'blocked', blocked_reason = $2
          WHERE id = $1 AND status NOT IN ('completed', 'cancelled')`,
        [taskId, dto.reason],
      );

      await this.activityLog.log(
        {
          actorId: actor.id,
          action: 'onboarding_task.blocked',
          entityType: 'onboarding_task',
          entityId: taskId,
          metadata: {
            blockerId: blocker.id,
            reason: dto.reason,
            ownerRole: blocker.owner_role,
            expectedAt: blocker.expected_at,
          },
        },
        client,
      );

      await this.notifications.notify(
        task.employee_id,
        'task_blocked',
        `${task.title} is blocked`,
        dto.reason,
        '/start-here',
        { actorId: actor.id, client },
      );
      // HR blocking something already knows; an owner doing it is news.
      if (actor.role !== 'superadmin_hr') {
        await this.notifications.notifyRole(
          'superadmin_hr',
          // Its own kind: the employee's 'task_blocked' is news with nothing
          // to do, this one is HR's to follow up (see NotificationBell).
          'task_blocked_by_owner',
          `${task.title} for ${task.employee_name} is blocked`,
          dto.reason,
          `/hr?profile=${task.employee_id}`,
          { actorId: actor.id, client },
        );
      }

      return blocker;
    });
  }

  async resolve(
    blockerId: string,
    actor: AuthenticatedUser,
    dto: ResolveBlockerDto = {},
  ): Promise<BlockerRow> {
    const { rows } = await this.db.query<
      BlockerRow & {
        task_owner_role: string;
        task_owner_user_id: string | null;
        task_title: string;
        employee_id: string;
      }
    >(
      `SELECT b.*,
              ot.owner_role    AS task_owner_role,
              ot.owner_user_id AS task_owner_user_id,
              ot.title         AS task_title,
              o.user_id        AS employee_id
         FROM blockers b
         JOIN onboarding_tasks ot ON ot.id = b.onboarding_task_id
         JOIN onboardings o ON o.id = ot.onboarding_id
        WHERE b.id = $1`,
      [blockerId],
    );
    const existing = rows[0];
    if (!existing) {
      throw new NotFoundException('Blocker not found');
    }
    if (existing.resolved_at) {
      throw new ConflictException('This blocker has already been resolved');
    }
    this.assertMayActOnTask(
      {
        owner_role: existing.task_owner_role,
        owner_user_id: existing.task_owner_user_id,
      },
      actor,
    );

    return this.db.transaction(async (client) => {
      // `AND resolved_at IS NULL` makes a double-resolve a no-op (0
      // rows) rather than a second overwrite of resolved_by — the same
      // pattern the confirmation columns use.
      const { rows: resolvedRows } = await client.query<BlockerRow>(
        `UPDATE blockers
            SET resolved_at = now(), resolved_by = $2
          WHERE id = $1 AND resolved_at IS NULL
          RETURNING *, expected_at::text AS expected_at`,
        [blockerId, actor.id],
      );
      const blocker = resolvedRows[0];
      if (!blocker) {
        throw new ConflictException('This blocker has already been resolved');
      }

      // Only a task still sitting at 'blocked' is restored. If it was
      // cancelled while blocked, that decision outranks this one.
      await client.query(
        `UPDATE onboarding_tasks
            SET status = 'pending', blocked_reason = NULL
          WHERE id = $1 AND status = 'blocked'`,
        [blocker.onboarding_task_id],
      );

      await this.activityLog.log(
        {
          actorId: actor.id,
          action: 'blocker.resolved',
          entityType: 'onboarding_task',
          entityId: blocker.onboarding_task_id,
          metadata: {
            blockerId: blocker.id,
            reason: blocker.reason,
            // How long it actually sat there. The number this whole
            // feature exists to make askable without Slack.
            waitingSince: blocker.waiting_since,
            // Optional, and only present when someone bothered to say why.
            ...(dto.note ? { note: dto.note } : {}),
          },
        },
        client,
      );

      await this.notifications.notify(
        existing.employee_id,
        'task_unblocked',
        `${existing.task_title} is no longer blocked`,
        dto.note ?? null,
        '/start-here',
        { actorId: actor.id, client },
      );

      return blocker;
    });
  }

  private async getBlockableTaskOrThrow(taskId: string) {
    const { rows } = await this.db.query<{
      id: string;
      status: string;
      owner_role: string;
      owner_user_id: string | null;
      title: string;
      employee_id: string;
      employee_name: string;
    }>(
      `SELECT ot.id, ot.status, ot.owner_role, ot.owner_user_id, ot.title,
              o.user_id AS employee_id, u.full_name AS employee_name
         FROM onboarding_tasks ot
         JOIN onboardings o ON o.id = ot.onboarding_id
         JOIN users u ON u.id = o.user_id
        WHERE ot.id = $1`,
      [taskId],
    );
    const task = rows[0];
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    if (task.status === 'cancelled') {
      throw new ConflictException('This task has been cancelled');
    }
    if (task.status === 'completed') {
      throw new ConflictException('This task is already completed');
    }
    // You cannot declare stuck something that has not started. This is
    // also what keeps resolve()'s restore to 'pending' honest: a
    // 'locked' task blocked and then resolved would come back unlocked,
    // handing the employee work the sequence has not reached. A blocker
    // on work that is waiting on an earlier step belongs on that
    // earlier step.
    if (task.status === 'locked') {
      throw new BadRequestException(
        'This task has not started yet — block the step it is waiting on instead',
      );
    }
    return task;
  }

  /**
   * HR, or this specific task's owner. Not a fixed @Roles() check: the
   * second half is data-dependent, and mirrors
   * OnboardingTasksService.completeAsOwner exactly — a claimed task
   * belongs to the claimer, an unclaimed one to anyone holding its
   * owner_role.
   */
  private assertMayActOnTask(
    task: { owner_role: string; owner_user_id: string | null },
    actor: AuthenticatedUser,
  ) {
    if (actor.role === 'superadmin_hr') return;
    if (task.owner_user_id) {
      if (task.owner_user_id === actor.id) return;
      throw new ForbiddenException(
        'This task has been claimed by a different task owner',
      );
    }
    if (actor.role === task.owner_role) return;
    throw new ForbiddenException(
      `Only HR or a ${task.owner_role} can block this task`,
    );
  }
}
