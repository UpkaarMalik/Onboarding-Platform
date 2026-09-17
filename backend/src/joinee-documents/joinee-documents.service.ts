import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { OnboardingTasksService } from '../onboardings/onboarding-tasks.service';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ReviewDocumentDto } from './dto/review-document.dto';

export interface DocumentTypeRow {
  id: string;
  code: string;
  label: string;
  display_order: number;
  is_default_required: boolean;
  is_sensitive: boolean;
}

export interface JoineeDocumentRow {
  requirement_id: string;
  status: string;
  document_type_id: string;
  code: string;
  label: string;
  display_order: number;
  is_sensitive: boolean;
  upload_id: string | null;
  original_filename: string | null;
  mime_type: string | null;
  size_bytes: string | null;
  uploaded_at: Date | null;
  review_status: string | null;
  review_note: string | null;
  reviewed_at: Date | null;
}

/**
 * Joinee-uploaded identity documents. Deliberately a separate module
 * from DocumentsModule: that one serves HR-authored company policy
 * material to every authenticated user, this one serves one employee's
 * Aadhaar/PAN/bank paperwork to that employee and HR only. Same reason
 * they don't share a table — see migration 0027.
 *
 * Every read is scoped by "the requirement's own user_id is the caller,
 * or the caller is superadmin_hr". A joinee outside that check gets 404
 * rather than 403 on another user's document, matching
 * DocumentsService/NotesService: existence isn't confirmed to someone
 * not allowed to see it.
 */
@Injectable()
export class JoineeDocumentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly activityLog: ActivityLogService,
    private readonly onboardingTasks: OnboardingTasksService,
    private readonly config: ConfigService,
  ) {}

  /** The checkbox grid for the Create New Joinee "Documents" step. */
  async listDocumentTypes(): Promise<DocumentTypeRow[]> {
    const { rows } = await this.db.query<DocumentTypeRow>(
      `SELECT id, code, label, display_order, is_default_required, is_sensitive
       FROM document_types
       WHERE is_active
       ORDER BY display_order`,
    );
    return rows;
  }

  /**
   * One joinee's requirements joined to their current upload — the
   * document-task popup for the employee, and the documents section of
   * HR's employee profile screen. Superseded uploads are excluded, so
   * this is always "where does each document stand right now".
   */
  async listForUser(userId: string, actor: AuthenticatedUser): Promise<JoineeDocumentRow[]> {
    if (actor.role !== 'superadmin_hr' && userId !== actor.id) {
      throw new ForbiddenException('You can only view your own documents');
    }

    const { rows } = await this.db.query<JoineeDocumentRow>(
      `SELECT
         r.id AS requirement_id, r.status, r.document_type_id,
         dt.code, dt.label, dt.display_order, dt.is_sensitive,
         u.id AS upload_id, u.original_filename, u.mime_type, u.size_bytes,
         u.created_at AS uploaded_at, u.review_status, u.review_note, u.reviewed_at
       FROM joinee_document_requirements r
       JOIN document_types dt ON dt.id = r.document_type_id
       LEFT JOIN joinee_document_uploads u
         ON u.requirement_id = r.id AND u.superseded_at IS NULL
       WHERE r.user_id = $1
       ORDER BY dt.display_order`,
      [userId],
    );
    return rows;
  }

  /**
   * Records an uploaded file against a requirement.
   *
   * A re-upload supersedes the previous attempt rather than replacing
   * it: for identity paperwork, the fact that a rejected scan was once
   * submitted is worth keeping. The partial unique index
   * joinee_document_uploads_current_key guarantees only one live row per
   * requirement, so the supersede and the insert have to be one
   * transaction.
   *
   * Submitting the last outstanding document completes the gating task
   * (Decision B1: on upload, not on HR approval) so the joinee is never
   * left waiting on a review to continue their onboarding. HR's verdict
   * lands afterwards and, if it's a rejection, reopens that requirement.
   */
  async recordUpload(
    requirementId: string,
    actor: AuthenticatedUser,
    file: Express.Multer.File,
  ) {
    return this.db.transaction(async (client) => {
      const { rows: reqRows } = await client.query<{
        id: string;
        user_id: string;
        onboarding_task_id: string | null;
      }>(
        `SELECT id, user_id, onboarding_task_id
         FROM joinee_document_requirements
         WHERE id = $1
         FOR UPDATE`,
        [requirementId],
      );
      const requirement = reqRows[0];
      if (!requirement) {
        throw new NotFoundException('Document requirement not found');
      }
      // The joinee uploads their own documents. HR uploading on their
      // behalf is a separate feature, not this endpoint — uploaded_by
      // exists to make the two distinguishable if it's ever added.
      if (requirement.user_id !== actor.id) {
        throw new NotFoundException('Document requirement not found');
      }

      await client.query(
        `UPDATE joinee_document_uploads
         SET superseded_at = now()
         WHERE requirement_id = $1 AND superseded_at IS NULL`,
        [requirementId],
      );

      const { rows: uploadRows } = await client.query<{ id: string }>(
        `INSERT INTO joinee_document_uploads (
           requirement_id, uploaded_by, file_url, original_filename,
           mime_type, size_bytes
         ) VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          requirementId,
          actor.id,
          file.filename,
          file.originalname,
          file.mimetype,
          file.size,
        ],
      );

      await client.query(
        `UPDATE joinee_document_requirements SET status = 'submitted' WHERE id = $1`,
        [requirementId],
      );

      const taskCompleted = requirement.onboarding_task_id
        ? await this.maybeCompleteDocumentTask(
            client,
            requirement.onboarding_task_id,
            actor.id,
          )
        : false;

      await this.activityLog.log(
        {
          actorId: actor.id,
          action: 'joinee_document.uploaded',
          entityType: 'joinee_document_requirement',
          entityId: requirementId,
          // Filename only — never the file's contents, and nothing
          // derived from a sensitive document's data.
          metadata: { uploadId: uploadRows[0].id, taskCompleted },
        },
        client,
      );

      return { uploadId: uploadRows[0].id, status: 'submitted', taskCompleted };
    });
  }

  /** HR's verdict on the current upload for a requirement. */
  async review(uploadId: string, actor: AuthenticatedUser, dto: ReviewDocumentDto) {
    return this.db.transaction(async (client) => {
      const { rows } = await client.query<{
        requirement_id: string;
        onboarding_task_id: string | null;
      }>(
        `UPDATE joinee_document_uploads AS u
            SET review_status = $2,
                reviewed_by   = $3,
                reviewed_at   = now(),
                review_note   = $4
           FROM joinee_document_requirements r
          WHERE u.id = $1 AND u.superseded_at IS NULL
            AND r.id = u.requirement_id
        RETURNING u.requirement_id, r.onboarding_task_id`,
        [uploadId, dto.decision, actor.id, dto.note ?? null],
      );
      const upload = rows[0];
      if (!upload) {
        throw new NotFoundException('Document upload not found');
      }

      // A rejection sends the requirement back to the joinee AND flips
      // the gating task back to 'pending'. This deliberately breaks the
      // "task completion is one-way" invariant that held before: a
      // completed doc-upload task whose document was later rejected was
      // still shown as done on the trail, which mis-reported the
      // employee's actual state (they had a document to re-upload).
      // Since the trail's open step is derived from the DB status of
      // the tasks (see backend/src/onboardings/utils/trail-order.util.ts
      // — SETTLED = {completed, cancelled}), flipping this task off
      // 'completed' is what puts the docs step back at the front of
      // the trail with no other coordination needed.
      await client.query(
        `UPDATE joinee_document_requirements SET status = $2 WHERE id = $1`,
        [upload.requirement_id, dto.decision === 'approved' ? 'approved' : 'rejected'],
      );

      if (dto.decision === 'rejected' && upload.onboarding_task_id) {
        await this.reopenDocumentTaskIfCompleted(
          client,
          upload.onboarding_task_id,
          actor.id,
        );
      }

      await this.activityLog.log(
        {
          actorId: actor.id,
          action: `joinee_document.${dto.decision}`,
          entityType: 'joinee_document_upload',
          entityId: uploadId,
        },
        client,
      );

      return { uploadId, reviewStatus: dto.decision };
    });
  }

  /**
   * Reopen the gating doc-upload task if a review just rejected the
   * document that closed it. Idempotent — a task that was never
   * completed, or that has been re-completed by a subsequent upload
   * arriving between review calls, is a no-op. Only the 'employee'
   * completion fields are cleared (the checkpoint is not a
   * doc-upload task).
   */
  private async reopenDocumentTaskIfCompleted(
    client: PoolClient,
    taskId: string,
    actorId: string,
  ): Promise<void> {
    const { rows } = await client.query<{ id: string }>(
      `UPDATE onboarding_tasks
          SET status                 = 'pending',
              completed_at           = NULL,
              employee_confirmed_by  = NULL,
              employee_confirmed_at  = NULL
        WHERE id = $1
          AND status = 'completed'
          AND system_key = 'document_upload'
        RETURNING id`,
      [taskId],
    );
    if (!rows[0]) return;
    await this.activityLog.log(
      {
        actorId,
        action: 'onboarding_task.reopened_by_document_rejection',
        entityType: 'onboarding_task',
        entityId: taskId,
      },
      client,
    );
  }

  /** HR's "documents waiting on me" queue. */
  async listPendingReview() {
    const { rows } = await this.db.query(
      `SELECT
         u.id AS upload_id, u.original_filename, u.mime_type, u.created_at AS uploaded_at,
         dt.label AS document_label,
         usr.id AS user_id, usr.full_name AS employee_name, usr.joinee_id
       FROM joinee_document_uploads u
       JOIN joinee_document_requirements r ON r.id = u.requirement_id
       JOIN document_types dt ON dt.id = r.document_type_id
       JOIN users usr ON usr.id = r.user_id
       WHERE u.review_status = 'pending_review' AND u.superseded_at IS NULL
       ORDER BY u.created_at`,
    );
    return rows;
  }

  /**
   * Resolves an upload to something the preview/download route can
   * stream. Returns the stored mime_type so the response's Content-Type
   * is the value validated at upload time rather than one re-sniffed
   * from disk — the file is rendered inline in HR's browser, so what it
   * claims to be matters.
   */
  async getFileOrThrow(
    uploadId: string,
    actor: AuthenticatedUser,
  ): Promise<{ storedFilename: string; originalFilename: string; mimeType: string }> {
    const { rows } = await this.db.query<{
      file_url: string;
      original_filename: string;
      mime_type: string;
      user_id: string;
    }>(
      `SELECT u.file_url, u.original_filename, u.mime_type, r.user_id
       FROM joinee_document_uploads u
       JOIN joinee_document_requirements r ON r.id = u.requirement_id
       WHERE u.id = $1`,
      [uploadId],
    );
    const upload = rows[0];
    if (!upload) {
      throw new NotFoundException('Document not found');
    }
    if (actor.role !== 'superadmin_hr' && upload.user_id !== actor.id) {
      throw new NotFoundException('Document not found');
    }
    return {
      storedFilename: upload.file_url,
      originalFilename: upload.original_filename,
      mimeType: upload.mime_type,
    };
  }

  getUploadsDir(): string {
    return this.config.get<string>('JOINEE_UPLOADS_DIR') ?? './uploads/joinee-documents';
  }

  /** True if this upload was the one that closed out the gating task. */
  private async maybeCompleteDocumentTask(
    client: PoolClient,
    taskId: string,
    actorId: string,
  ): Promise<boolean> {
    const { rows } = await client.query<{ outstanding: number }>(
      `SELECT COUNT(*)::int AS outstanding
       FROM joinee_document_requirements
       WHERE onboarding_task_id = $1 AND status IN ('awaiting_upload', 'rejected')`,
      [taskId],
    );
    if (Number(rows[0].outstanding) > 0) {
      return false;
    }
    return this.onboardingTasks.completeEmployeeTaskAsSystem(
      client,
      taskId,
      actorId,
      'onboarding_task.completed_via_documents',
    );
  }
}
