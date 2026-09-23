import { Injectable, NotFoundException } from '@nestjs/common';
import { Subject } from 'rxjs';
import { QueryResult, QueryResultRow } from 'pg';
import { afterCommit, DatabaseService } from '../database/database.service';

/** Same structural-typing trick as ActivityLogService — lets notify() run
 *  inside the caller's transaction, so a notification commits or rolls
 *  back with the change it announces. */
interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;
}

export interface NotificationRow {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string;
  read_at: Date | null;
  created_at: Date;
}

export interface NotifyOptions {
  /** Whoever caused the event. Never notified about their own action. */
  actorId?: string | null;
  /** The caller's transaction client, when there is one. */
  client?: Queryable;
}

/**
 * Deliberately not logged to the activity log: a notification is a side
 * effect of an event that is already logged where it happens, and marking
 * one read is acknowledging something you saw — a read, not a change.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly db: DatabaseService) {}

  /** User ids with something new, emitted after the write commits. Same
   *  in-process shape (and the same one-node ceiling) as
   *  ActivityLogService.onWritten. */
  private readonly notified$ = new Subject<string>();

  onNotified() {
    return this.notified$.asObservable();
  }

  private announce(queryable: unknown, userIds: string[]) {
    afterCommit(queryable, () => userIds.forEach((id) => this.notified$.next(id)));
  }

  async notify(
    userId: string,
    kind: string,
    title: string,
    body: string | null,
    link: string,
    opts: NotifyOptions = {},
  ): Promise<void> {
    if (userId === opts.actorId) return;
    const q = opts.client ?? this.db;
    await q.query(
      `INSERT INTO notifications (user_id, kind, title, body, link)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, kind, title, body, link],
    );
    this.announce(q, [userId]);
  }

  /** notify() for everyone holding a role, optionally within one
   *  department — "notify HR", "notify this department's task owners". */
  async notifyRole(
    role: string,
    kind: string,
    title: string,
    body: string | null,
    link: string,
    opts: NotifyOptions & { departmentId?: string | null } = {},
  ): Promise<void> {
    const q = opts.client ?? this.db;
    const { rows } = await q.query<{ user_id: string }>(
      `INSERT INTO notifications (user_id, kind, title, body, link)
       SELECT id, $2, $3, $4, $5 FROM users
        WHERE role = $1 AND deleted_at IS NULL AND status <> 'disabled'
          AND ($6::uuid IS NULL OR department_id = $6)
          AND ($7::uuid IS NULL OR id <> $7)
       RETURNING user_id`,
      [role, kind, title, body, link, opts.departmentId ?? null, opts.actorId ?? null],
    );
    this.announce(q, rows.map((r) => r.user_id));
  }

  async list(userId: string, unreadOnly: boolean, limit: number, offset = 0) {
    const [{ rows }, { rows: count }] = await Promise.all([
      this.db.query<NotificationRow>(
        `SELECT id, kind, title, body, link, read_at, created_at
           FROM notifications
          WHERE user_id = $1 AND ($2::boolean IS FALSE OR read_at IS NULL)
          -- id breaks the tie between rows one transaction wrote at the same
          -- now(), so paging never skips or repeats one.
          ORDER BY created_at DESC, id
          LIMIT $3 OFFSET $4`,
        [userId, unreadOnly, limit, offset],
      ),
      this.db.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM notifications
          WHERE user_id = $1 AND read_at IS NULL`,
        [userId],
      ),
    ]);
    return { data: rows, unreadCount: count[0].n };
  }

  /** Scoped by user_id, so someone else's id is a 404, not a 403 —
   *  existence isn't confirmed to someone not allowed to see it. */
  async markRead(userId: string, id: string): Promise<void> {
    const { rowCount } = await this.db.query(
      `UPDATE notifications SET read_at = COALESCE(read_at, now())
        WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    if (!rowCount) throw new NotFoundException('Notification not found');
  }

  async markAllRead(userId: string): Promise<void> {
    await this.db.query(
      `UPDATE notifications SET read_at = now()
        WHERE user_id = $1 AND read_at IS NULL`,
      [userId],
    );
  }
}
