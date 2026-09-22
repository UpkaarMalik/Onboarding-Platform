import { differenceInCalendarDays, parseISO } from 'date-fns';
import { formatDayMonth } from '../lib/format';

/**
 * An open blocker on a task, in the one shape every endpoint returns it —
 * see backend/src/onboardings/utils/blocker-payload.util.ts, which builds
 * exactly these keys in exactly one place for the same reason this type
 * lives in exactly one place.
 */
export interface TaskBlocker {
  id: string;
  reason: string;
  owner_role: string;
  owner_user_id?: string | null;
  waiting_since: string;
  expected_at: string | null;
}

/**
 * `owner_role` is an application role, not a department — its real values
 * are the three in the users table. The ticket's example line reads
 * "Owner: IT", but no blocker can say that today: there is no desk column
 * to hold it. When one arrives this map is where it goes.
 */
const OWNER_LABELS: Record<string, string> = {
  task_owner: 'Task owner',
  superadmin_hr: 'HR',
  employee: 'Joinee',
};

const ownerLabel = (role: string) =>
  OWNER_LABELS[role] ?? role.replace(/_/g, ' ');

/** "3 days waiting", worked out here rather than sent by the server: it
 *  changes every midnight, and a number baked into a response is wrong by
 *  the time anyone reads it on a page left open overnight. */
function waitedFor(waitingSince: string): string | null {
  const days = differenceInCalendarDays(new Date(), parseISO(waitingSince));
  if (!Number.isFinite(days) || days < 0) return null;
  if (days === 0) return 'today';
  return `${days} day${days === 1 ? '' : 's'} waiting`;
}

/**
 * The one-line summary of why a task is stuck, used everywhere a task
 * appears: the employee's trail and task popup, HR's profile task list,
 * HR's roster, and the task owner's dashboard.
 *
 * One component rather than four renderings of the same five fields —
 * those four had already started to drift, showing between one and three
 * of them and wording each differently, so the same blocker read as a
 * different problem depending on who was looking at it.
 *
 * Segments are dropped rather than shown empty: `expected_at` is nullable
 * by design ("NULL means nobody would guess"), and "expected —" is worse
 * than nothing.
 */
export default function BlockerLine({
  blocker,
  className = '',
}: {
  blocker: TaskBlocker;
  className?: string;
}) {
  const waited = waitedFor(blocker.waiting_since);
  const since = formatDayMonth(blocker.waiting_since);
  const expected = blocker.expected_at ? formatDayMonth(blocker.expected_at) : null;

  const parts = [
    `Owner: ${ownerLabel(blocker.owner_role)}`,
    since && `since ${since}`,
    waited,
    expected && `expected ${expected}`,
  ].filter(Boolean) as string[];

  return (
    <p className={`blocker-line ${className}`.trim()}>
      {/* Never colour alone: the word "Blocked" carries the state and the
          dot only reinforces it. */}
      <span className="blocker-line-dot" aria-hidden="true" />
      <span className="blocker-line-state">Blocked</span>
      <span className="blocker-line-reason">{blocker.reason}</span>
      <span className="blocker-line-meta">{parts.join(' · ')}</span>
    </p>
  );
}
