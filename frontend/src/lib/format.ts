const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * "02 Sep 2026" from either a plain date string or a full ISO timestamp.
 *
 * Parses the date part as TEXT and never constructs a Date. Two reasons, both
 * of which bit this app already:
 *  - `new Date('2026-09-23T18:30:00.000Z')` read with local getters renders the
 *    PREVIOUS day anywhere west of UTC. Postgres `date` columns arrive as a
 *    UTC-midnight timestamp, so every joining date was one day off.
 *  - `toLocaleDateString(undefined, ...)` follows the viewer's locale, so en-US
 *    yields "Sep 02, 2026" rather than the day-first order the design uses.
 */
export function formatDate(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const iso = value instanceof Date ? value.toISOString() : String(value);
  const [y, m, d] = iso.slice(0, 10).split('-');
  const month = MONTHS[Number(m) - 1];
  if (!y || !month || !d) return iso;
  return `${d} ${month} ${y}`;
}

/** "2 Sep" — no year, for dense rows where the year is obvious from context. */
export function formatDateShort(value: string | Date | null | undefined): string | null {
  const full = formatDate(value);
  if (!full) return null;
  const [d, month] = full.split(' ');
  return `${Number(d)} ${month}`;
}

/**
 * A literal port of the backend's single definition of overdue
 * (backend/src/onboardings/utils/overdue.util.ts) so the two can't disagree.
 * A locked task is never overdue: its due date was computed from the start
 * date at instantiation, independent of when the checkpoint unlocks it.
 */
export function isOverdue(dueDate: string | null | undefined, status: string): boolean {
  if (!dueDate) return false;
  if (status === 'completed' || status === 'cancelled' || status === 'locked') return false;
  return String(dueDate).slice(0, 10) < todayIso();
}

export function todayIso(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  // Local calendar day, not UTC — "is this overdue" is a question about the
  // viewer's today.
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Relative day label for a due date: "Today", "Tomorrow", "3 days overdue". */
export function dueLabel(dueDate: string | null | undefined, status: string): string | null {
  if (!dueDate) return null;
  const due = String(dueDate).slice(0, 10);
  const today = todayIso();
  if (due === today) return 'Due today';
  const dayMs = 86_400_000;
  const diff = Math.round((Date.parse(due + 'T00:00:00') - Date.parse(today + 'T00:00:00')) / dayMs);
  if (diff === 1) return 'Due tomorrow';
  if (diff > 1) return `Due in ${diff} days`;
  if (status === 'completed' || status === 'cancelled' || status === 'locked') {
    return `Due ${formatDate(due)}`;
  }
  return `${Math.abs(diff)} day${Math.abs(diff) === 1 ? '' : 's'} overdue`;
}

/** Status label for display. The stored vocabulary is longer than the four
 *  states the UI actually communicates, so several statuses collapse. */
export function onboardingStatusLabel(status: string): string {
  switch (status) {
    case 'pre_onboarding':
      return 'Pending';
    case 'email_provisioned':
    case 'checkpoint_pending':
    case 'active':
      return 'In progress';
    case 'completed':
      return 'Completed';
    case 'cancelled':
      return 'Closed';
    default:
      return status.replace(/_/g, ' ');
  }
}

/** Coarse bucket behind the status pill's colour. */
export function onboardingStatusTone(status: string): 'pending' | 'progress' | 'done' | 'closed' {
  if (status === 'pre_onboarding') return 'pending';
  if (status === 'completed') return 'done';
  if (status === 'cancelled') return 'closed';
  return 'progress';
}
