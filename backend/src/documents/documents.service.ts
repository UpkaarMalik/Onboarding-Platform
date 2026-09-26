import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { DatabaseService } from '../database/database.service';
import { UsersService } from '../users/users.service';

export interface DocumentRow {
  id: string;
  title: string;
  file_url: string;
  department_id: string | null;
  category: string | null;
  is_available: boolean;
  uploaded_by: string;
  created_at: Date;
}

/**
 * file_url stores the server-generated on-disk filename (a random
 * UUID + original extension, assigned by multer in DocumentsModule's
 * storage config) — never the client-supplied original filename, which
 * would otherwise be a path-traversal / collision risk if used as-is.
 * The human-readable name lives in `title` instead, which is exactly
 * what documents.title is already for.
 *
 * Visibility (list and download both) is company-wide (department_id
 * IS NULL) or the caller's own department — derived from their own
 * user row, never a client-supplied department, same pattern as
 * KnowledgeModule/EntitlementsModule.
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly usersService: UsersService,
    private readonly config: ConfigService,
    private readonly activityLog: ActivityLogService,
  ) {}

  async createDocument(
    actorId: string,
    title: string,
    departmentId: string | null,
    storedFilename: string,
    category: string | null = null,
    isAvailable = true,
  ): Promise<DocumentRow> {
    const { rows } = await this.db.query<DocumentRow>(
      `INSERT INTO documents (title, file_url, department_id, category, is_available, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, title, file_url, department_id, category, is_available, uploaded_by, created_at`,
      [title, storedFilename, departmentId, category, isAvailable, actorId],
    );

    // Title only — never the stored filename, which is the on-disk
    // path to the file itself.
    await this.activityLog.log({
      actorId,
      action: 'document.uploaded',
      entityType: 'document',
      entityId: rows[0].id,
      metadata: { title, departmentId, category },
    });

    return rows[0];
  }

  /**
   * Edit an existing document: its title, which branch it is active for, or
   * the PDF itself. HR-only, enforced on the controller.
   *
   * `departmentId` is deliberately three-valued — see UpdateDocumentDto.
   * `undefined` leaves the scope alone and `null` makes it company-wide, and
   * conflating them would mean every title-only edit silently published a
   * departmental policy to the whole company.
   *
   * The previous file is left on disk when a new one replaces it. Deleting
   * an uploaded file is irreversible and nothing here knows whether it is
   * backed up; the row no longer points at it, so it is invisible either
   * way. If that cruft ever matters it wants a sweep that can be reviewed
   * before it runs, not a silent unlink in the middle of a PATCH.
   */
  async updateDocument(
    actorId: string,
    documentId: string,
    changes: {
      title?: string;
      departmentId?: string | null;
      storedFilename?: string;
      category?: string | null;
      isAvailable?: boolean;
    },
  ): Promise<DocumentRow> {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (changes.title !== undefined) {
      sets.push(`title = $${values.push(changes.title)}`);
    }
    if (changes.departmentId !== undefined) {
      sets.push(`department_id = $${values.push(changes.departmentId)}`);
    }
    if (changes.storedFilename !== undefined) {
      sets.push(`file_url = $${values.push(changes.storedFilename)}`);
    }
    if (changes.category !== undefined) {
      sets.push(`category = $${values.push(changes.category)}`);
    }
    if (changes.isAvailable !== undefined) {
      sets.push(`is_available = $${values.push(changes.isAvailable)}`);
    }
    if (sets.length === 0) {
      // Nothing asked for. Return the row as it stands rather than running
      // an UPDATE with an empty SET, which is a syntax error.
      const { rows } = await this.db.query<DocumentRow>(
        `SELECT id, title, file_url, department_id, category, is_available, uploaded_by, created_at
         FROM documents WHERE id = $1 AND deleted_at IS NULL`,
        [documentId],
      );
      if (!rows[0]) throw new NotFoundException('Document not found');
      return rows[0];
    }

    const { rows } = await this.db.query<DocumentRow>(
      `UPDATE documents SET ${sets.join(', ')}
       WHERE id = $${values.push(documentId)} AND deleted_at IS NULL
       RETURNING id, title, file_url, department_id, category, is_available, uploaded_by, created_at`,
      values,
    );
    const doc = rows[0];
    if (!doc) {
      throw new NotFoundException('Document not found');
    }

    // Which fields moved, never the stored filename — that is the on-disk
    // path to the file itself.
    await this.activityLog.log({
      actorId,
      action: 'document.updated',
      entityType: 'document',
      entityId: doc.id,
      metadata: {
        title: doc.title,
        departmentId: changes.departmentId,
        category: changes.category,
        isAvailable: changes.isAvailable,
        fileReplaced: changes.storedFilename !== undefined,
      },
    });

    return doc;
  }

  async listVisibleForActor(actorId: string): Promise<DocumentRow[]> {
    const user = await this.usersService.findById(actorId);
    const departmentId = user?.department_id ?? null;
    // HR is exempt from BOTH scopes — department and availability. This is
    // the page HR manages every policy from, so it must show all of them:
    // a policy scoped to a department HR is not in (HR's own department is
    // usually NULL), and a policy taken down, both have to remain visible or
    // HR loses the only way to reach them. Everyone else sees company-wide
    // plus their own department, available only.
    const isHr = user?.role === 'superadmin_hr';

    const { rows } = await this.db.query<DocumentRow>(
      `SELECT id, title, file_url, department_id, category, is_available, uploaded_by, created_at
       FROM documents
       WHERE deleted_at IS NULL
         AND ($2 OR (
           (department_id IS NULL OR department_id = $1)
           AND is_available = true
         ))
       ORDER BY created_at DESC`,
      [departmentId, isHr],
    );
    return rows;
  }

  /** Soft delete: sets deleted_at, so the row drops out of every list and
   *  download (all of which filter deleted_at IS NULL) but is not destroyed.
   *  The uploaded file is left on disk — same reasoning as an edit that
   *  replaces the file: unlinking is irreversible and belongs in a reviewed
   *  sweep, not a request handler. */
  async softDeleteDocument(actorId: string, documentId: string): Promise<void> {
    const { rowCount } = await this.db.query(
      `UPDATE documents SET deleted_at = now()
       WHERE id = $1 AND deleted_at IS NULL`,
      [documentId],
    );
    if (!rowCount) {
      throw new NotFoundException('Document not found');
    }
    await this.activityLog.log({
      actorId,
      action: 'document.deleted',
      entityType: 'document',
      entityId: documentId,
    });
  }

  /** Same visibility rule as listVisibleForActor, applied to one
   *  document. A document outside the caller's department comes back
   *  as 404, not 403 — its existence isn't confirmed to someone who
   *  isn't allowed to see it, same reasoning as OnboardingsService's
   *  active-template lookup. */
  async getDownloadableOrThrow(
    documentId: string,
    actorId: string,
  ): Promise<{ title: string; storedFilename: string }> {
    const user = await this.usersService.findById(actorId);
    const departmentId = user?.department_id ?? null;

    const { rows } = await this.db.query<DocumentRow>(
      `SELECT title, file_url
       FROM documents
       WHERE id = $1 AND deleted_at IS NULL
         AND ($3 OR (
           (department_id IS NULL OR department_id = $2)
           AND is_available = true
         ))`,
      [documentId, departmentId, user?.role === 'superadmin_hr'],
    );
    const doc = rows[0];
    if (!doc) {
      throw new NotFoundException('Document not found');
    }
    return { title: doc.title, storedFilename: doc.file_url };
  }

  getUploadsDir(): string {
    return this.config.get<string>('UPLOADS_DIR') ?? './uploads';
  }
}
