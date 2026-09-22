/**
 * The open blocker attached to a task, in the one shape every endpoint
 * returns it in.
 *
 * Same reasoning as isOverdueSql next door: there is no shared query
 * builder in this codebase (every query is hand-written SQL on
 * purpose), so a fragment used by three endpoints has to live in one
 * function or it drifts — three call sites eventually means three
 * slightly different key sets, and a UI that has to defend against all
 * of them. Both halves are here because they only work together: the
 * SELECT expression reads the alias the JOIN introduces.
 *
 * `resolved_at IS NULL` is the whole definition of "open", and it is
 * the same predicate the partial unique index uses, so a task can have
 * at most one row on the other side of this join — it can never
 * multiply the result set, and needs no DISTINCT or aggregate.
 */

/** Alias the join introduces. Not 'b' at the call sites' mercy. */
const BLOCKER_ALIAS = 'blk';

export function openBlockerJoin(taskAlias: string): string {
  return `LEFT JOIN blockers ${BLOCKER_ALIAS}
            ON ${BLOCKER_ALIAS}.onboarding_task_id = ${taskAlias}.id
           AND ${BLOCKER_ALIAS}.resolved_at IS NULL`;
}

/**
 * NULL rather than an object of nulls when nothing is blocked —
 * `task.blocker && <BlockerLine/>` is the natural way to render this,
 * and an all-null object would be truthy and render an empty line.
 *
 * Only the fields the UI actually shows: why, whose desk, since when,
 * until when. created_by/resolved_* are audit columns and belong in
 * the activity log, not on every task in every list.
 */
export const OPEN_BLOCKER_JSON = `CASE
    WHEN ${BLOCKER_ALIAS}.id IS NULL THEN NULL
    ELSE json_build_object(
      'id', ${BLOCKER_ALIAS}.id,
      'reason', ${BLOCKER_ALIAS}.reason,
      'owner_role', ${BLOCKER_ALIAS}.owner_role,
      'owner_user_id', ${BLOCKER_ALIAS}.owner_user_id,
      'waiting_since', ${BLOCKER_ALIAS}.waiting_since,
      -- ::text for the same reason due_date is cast: node-pg maps a
      -- date column to a JS Date, which serializes as a UTC timestamp
      -- and can render as the previous day west of UTC.
      'expected_at', ${BLOCKER_ALIAS}.expected_at::text
    )
  END AS blocker`;

/** The shape of the object above, for the interfaces that carry it. */
export interface TaskBlocker {
  id: string;
  reason: string;
  owner_role: string;
  owner_user_id: string | null;
  waiting_since: string;
  expected_at: string | null;
}
