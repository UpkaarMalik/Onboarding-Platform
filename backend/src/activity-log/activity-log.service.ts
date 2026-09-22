import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';
import { QueryResult, QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';
import { Pagination, paginateRows } from '../common/list-query.util';

/** Same structural-typing trick as every other *Service in this
 *  codebase — lets log() run inside a caller's own transaction (so the
 *  log entry commits or rolls back atomically with the change it
 *  describes) or standalone. */
interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;
}

export interface ActivityLogRow {
  id: string;
  actor_id: string | null;
  /** Who did it. NULL for system-initiated actions (actor_id is NULL). */
  actor_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  /** Who it was done to. NULL when the entity has no single person
   *  behind it (an entitlement, a template) — see TARGET_USER_SQL. */
  target_name: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

export interface LogEntry {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * "To whom" for the audit log: walks each entity_type back to the one
 * person the event is about. The subqueries run only over the page
 * already cut by LIMIT/OFFSET, not the whole table.
 *
 * Types absent here (entitlement, onboarding_template, community_post,
 * community_comment) have no single subject and resolve to NULL, which
 * the UI renders as a dash. Adding a new logged entity_type with a
 * person behind it means adding a WHEN here.
 */
/**
 * Types that still have rows but that nothing writes any more, so offering
 * them as a filter is offering a dead end. Sessions stopped being logged
 * (see SessionsService) and CommunityModule is parked — it is commented out
 * of AppModule, so its one row can never gain company. Their rows stay in
 * the table (it is append-only) and an explicit ?entityType= still returns
 * them; they are just not proposed.
 */
const RETIRED_ENTITY_TYPES = ['user_session', 'community_post'];

const TARGET_USER_SQL = `CASE l.entity_type
  WHEN 'user' THEN l.entity_id
  WHEN 'user_session' THEN (SELECT user_id FROM user_sessions WHERE id = l.entity_id)
  WHEN 'onboarding' THEN (SELECT user_id FROM onboardings WHERE id = l.entity_id)
  WHEN 'onboarding_task' THEN (
    SELECT o.user_id FROM onboarding_tasks ot
    JOIN onboardings o ON o.id = ot.onboarding_id
    WHERE ot.id = l.entity_id)
  WHEN 'onboarding_subtask' THEN (
    SELECT o.user_id FROM onboarding_subtasks os
    JOIN onboarding_tasks ot ON ot.id = os.onboarding_task_id
    JOIN onboardings o ON o.id = ot.onboarding_id
    WHERE os.id = l.entity_id)
  WHEN 'joinee_document_requirement' THEN (
    SELECT user_id FROM joinee_document_requirements WHERE id = l.entity_id)
  WHEN 'joinee_document_upload' THEN (
    SELECT r.user_id FROM joinee_document_uploads u
    JOIN joinee_document_requirements r ON r.id = u.requirement_id
    WHERE u.id = l.entity_id)
END`;

/**
 * This service's log() method is the only place in the codebase that
 * ever writes to activity_logs, and it only ever INSERTs — there is no
 * update()/delete() here, on purpose. That's discipline, not
 * enforcement; the real enforcement is migrations/0007's app_runtime
 * DB role, which has no UPDATE/DELETE grant on this table at the
 * database level, so even a bug or a compromised app process couldn't
 * violate append-only.
 *
 * Never pass note content, password hashes, or TOTP secrets in
 * metadata. In practice this is easy to keep true: NotesService never
 * calls this at all (notes must never appear in any admin-facing
 * query, logs included), and nothing in AuthService/UsersService ever
 * holds a plaintext password or TOTP secret in scope at the same time
 * as a log call — hashes and secrets live only in the users table.
 */
@Injectable()
export class ActivityLogService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Fires once per row written, so a watcher can react the moment
   * something happens instead of asking every few seconds.
   *
   * It carries no payload on purpose. A subscriber that wants the event
   * re-reads through listLogs(), which means it gets the row with its
   * actor and target names already resolved, in the same shape and
   * through the same authorisation as any other read. Pushing the raw
   * entry down the wire would be a second, unauthorised shape of the
   * same data that could drift from the first.
   *
   * ponytail: in-process, so it only reaches watchers connected to THIS
   * node. One node is what this runs on. For several, the notify becomes
   * `pg_notify` on the same INSERT and each node relays to its own
   * watchers — the subscriber side below does not change.
   */
  private readonly written$ = new Subject<void>();

  /** Stream of "something was just logged" ticks. */
  onWritten() {
    return this.written$.asObservable();
  }

  async log(entry: LogEntry, queryable: Queryable = this.db): Promise<void> {
    await queryable.query(
      `INSERT INTO activity_logs (actor_id, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        entry.actorId,
        entry.action,
        entry.entityType,
        entry.entityId ?? null,
        JSON.stringify(entry.metadata ?? {}),
      ],
    );
    /* After the INSERT, and deliberately not awaited by callers for
       anything: a watcher failing to receive a tick must never be able to
       fail the write that caused it. When `queryable` is a caller's
       transaction this fires before their COMMIT, so a watcher can in
       principle read a moment before the row is visible — harmless here,
       because the very next tick or poll picks it up, and the alternative
       is threading a commit hook through every call site. */
    this.written$.next();
  }

  /** HR/SuperAdmin audit trail read. Optional equality filters plus
   *  the standard limit/offset envelope every other list endpoint
   *  returns. Ordered by (created_at, id) DESC rather than created_at
   *  alone: several log rows share a timestamp when they're written in
   *  one transaction (creating a joinee writes user.created and
   *  onboarding.created at the same now()), and an unstable tiebreak
   *  makes paging skip or repeat those rows. */
  async listLogs(
    filters: { entityType?: string; entityId?: string; search?: string },
    pagination: Pagination,
  ) {
    const { rows } = await this.db.query<ActivityLogRow & { total_count: number }>(
      `WITH resolved AS (
         SELECT l.*,
                actor.full_name AS actor_name,
                target.full_name AS target_name
         FROM activity_logs l
         LEFT JOIN users actor ON actor.id = l.actor_id
         LEFT JOIN users target ON target.id = ${TARGET_USER_SQL}
         WHERE ($1::text IS NULL OR l.entity_type = $1)
           AND ($2::uuid IS NULL OR l.entity_id = $2)
           -- Two kinds of row we no longer write — session plumbing
           -- (see SessionsService) and the credential read that fired
           -- on every profile load (see AuthService.getCredentialsSummary).
           -- The backlog of them is append-only and stays in the table;
           -- it is hidden from the DEFAULT view rather than deleted, so
           -- that ~500 dead rows don't bury the events that matter.
           -- Passing an explicit entityType still returns them, so
           -- nothing is actually hidden from anyone who looks.
           AND (
             $1::text IS NOT NULL
             OR (l.entity_type <> 'user_session' AND l.action <> 'user.credentials_viewed')
           )
       )
       SELECT *, COUNT(*) OVER()::int AS total_count
       FROM resolved
       -- Matched against the row as a person reads it: either name, the
       -- action, the entity type, or any value recorded in metadata (a
       -- task title, a document label). jsonb's text form is good enough
       -- for a contains-search and costs no extra columns; if this ever
       -- needs to be fast, it wants a tsvector index, not a cleverer
       -- LIKE.
       WHERE $3::text IS NULL OR (
         coalesce(actor_name, '') || ' ' ||
         coalesce(target_name, '') || ' ' ||
         action || ' ' || entity_type || ' ' ||
         coalesce(metadata::text, '')
       ) ILIKE '%' || $3 || '%'
       ORDER BY created_at DESC, id DESC
       LIMIT $4 OFFSET $5`,
      [
        filters.entityType ?? null,
        filters.entityId ?? null,
        filters.search?.trim() || null,
        pagination.limit,
        pagination.offset,
      ],
    );
    return paginateRows(rows, pagination);
  }

  /** The entity types worth offering as a filter. Derived from the data
   *  rather than a list maintained by hand — a hardcoded one offered
   *  'document', 'entitlement' and 'onboarding_template', none of which
   *  had ever been written — minus the types nothing writes any more.
   *
   *  One DISTINCT over an indexed column (idx_activity_logs_entity leads
   *  with entity_type) is cheaper than a filter that lies. */
  async listEntityTypes(): Promise<string[]> {
    const { rows } = await this.db.query<{ entity_type: string }>(
      `SELECT DISTINCT entity_type FROM activity_logs
        WHERE entity_type <> ALL($1::text[])
        ORDER BY entity_type`,
      [RETIRED_ENTITY_TYPES],
    );
    return rows.map((r) => r.entity_type);
  }
}
