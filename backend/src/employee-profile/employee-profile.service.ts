import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

/**
 * Read-only aggregation behind HR's "click a joinee, see everything"
 * screen: the details HR filled in at creation, the documents the joinee
 * uploaded, and their task list split into outstanding and done.
 *
 * Its own module rather than a method on UsersService or
 * JoineeDocumentsService because it reads across all three domains.
 * Hanging it off either one would mean UsersModule importing
 * JoineeDocumentsModule, which imports OnboardingsModule, which imports
 * UsersModule — a cycle. Reading the tables directly with SQL, the way
 * every other service here does, avoids that entirely.
 *
 * Nothing in here is scoped to a caller: the controller restricts the
 * route to superadmin_hr, which is the whole audience for this view.
 */
@Injectable()
export class EmployeeProfileService {
  constructor(private readonly db: DatabaseService) {}

  async getProfile(userId: string) {
    const { rows: userRows } = await this.db.query(
      `SELECT
         u.id, u.full_name, u.joinee_id, u.phone_number, u.personal_email,
         u.company_email, u.role, u.status, u.must_reset_password,
         u.department_id, d.name AS department_name, u.created_at
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       WHERE u.id = $1 AND u.deleted_at IS NULL`,
      [userId],
    );
    const user = userRows[0];
    if (!user) {
      throw new NotFoundException('Employee not found');
    }

    // LEFT JOIN in spirit: a user created but not yet onboarded (the
    // window between HR's two create calls) still has a viewable
    // profile, just with no onboarding block.
    const { rows: onboardingRows } = await this.db.query(
      `SELECT
         o.id, o.status, o.start_date::text AS start_date, o.manager_name, o.buddy_name,
         o.template_version, o.experience_rating, o.created_at,
         t.name AS template_name
       FROM onboardings o
       JOIN onboarding_templates t ON t.id = o.template_id
       WHERE o.user_id = $1`,
      [userId],
    );
    const onboarding = onboardingRows[0] ?? null;

    const { rows: documents } = await this.db.query(
      `SELECT
         r.id AS requirement_id, r.status, dt.code, dt.label,
         dt.display_order, dt.is_sensitive,
         up.id AS upload_id, up.original_filename, up.mime_type,
         up.size_bytes, up.created_at AS uploaded_at,
         up.review_status, up.review_note, up.reviewed_at
       FROM joinee_document_requirements r
       JOIN document_types dt ON dt.id = r.document_type_id
       LEFT JOIN joinee_document_uploads up
         ON up.requirement_id = r.id AND up.superseded_at IS NULL
       WHERE r.user_id = $1
       ORDER BY dt.display_order`,
      [userId],
    );

    // Subtask counts come from a correlated aggregate rather than a
    // second round trip, so a task's popup progress ("2 of 4") renders
    // without the client fetching every task's subtasks up front.
    const { rows: tasks } = onboarding
      ? await this.db.query(
          `SELECT
             ot.id, ot.title, ot.description, ot.status, ot.due_date,
             ot.priority, ot.is_required, ot.completion_mode,
             ot.is_checkpoint, ot.system_key, ot.completed_at,
             (SELECT COUNT(*) FROM onboarding_subtasks s
              WHERE s.onboarding_task_id = ot.id)::int AS subtask_count,
             (SELECT COUNT(*) FROM onboarding_subtasks s
              WHERE s.onboarding_task_id = ot.id AND s.completed_at IS NOT NULL)::int
               AS subtask_completed_count
           FROM onboarding_tasks ot
           WHERE ot.onboarding_id = $1
           ORDER BY ot.due_date, ot.created_at`,
          [onboarding.id],
        )
      : { rows: [] as Record<string, unknown>[] };

    const completedTasks = tasks.filter((task) => task.status === 'completed');
    const pendingTasks = tasks.filter(
      (task) => task.status !== 'completed' && task.status !== 'cancelled',
    );

    return {
      user,
      onboarding,
      documents,
      tasks: {
        pending: pendingTasks,
        completed: completedTasks,
        // Counted over required tasks only, matching how
        // OnboardingsService.listAllOnboardings computes the dashboard's
        // progress fraction — so the two screens never disagree.
        requiredTotal: tasks.filter((task) => task.is_required).length,
        requiredCompleted: completedTasks.filter((task) => task.is_required).length,
      },
    };
  }
}
