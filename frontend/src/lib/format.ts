import {
  format,
  parseISO,
  differenceInCalendarDays,
  isToday as dfnsIsToday,
  isTomorrow as dfnsIsTomorrow,
  isYesterday as dfnsIsYesterday,
  subDays,
  getHours,
} from 'date-fns';

/**
 * Parse a date value safely, treating plain date strings (e.g. "2026-09-23")
 * as local dates — not UTC — to avoid the off-by-one-day problem near midnight.
 */
function toLocalDate(value: string | Date): Date {
  if (value instanceof Date) return value;
  const s = String(value).slice(0, 10);
  return new Date(s + 'T00:00:00');
}

/** "02 Sep 2026" */
export function formatDate(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  try {
    return format(toLocalDate(value), 'dd MMM yyyy');
  } catch {
    return String(value);
  }
}

/** "2 Sep" — no year, for dense rows. */
export function formatDateShort(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  try {
    return format(toLocalDate(value), 'd MMM');
  } catch {
    return null;
  }
}

/** Today's date as "yyyy-MM-dd" in the viewer's local timezone. */
export function todayIso(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

/** ISO date string `n` days before today, local timezone. */
export function daysAgoIso(n: number): string {
  return format(subDays(new Date(), n), 'yyyy-MM-dd');
}

export function isOverdue(dueDate: string | null | undefined, status: string): boolean {
  if (!dueDate) return false;
  if (status === 'completed' || status === 'cancelled' || status === 'locked') return false;
  return String(dueDate).slice(0, 10) < todayIso();
}

/** Relative day label: "Due today", "Due tomorrow", "3 days overdue", etc. */
export function dueLabel(dueDate: string | null | undefined, status: string): string | null {
  if (!dueDate) return null;
  const due = toLocalDate(dueDate);
  const today = new Date();
  if (dfnsIsToday(due)) return 'Due today';
  if (dfnsIsTomorrow(due)) return 'Due tomorrow';
  const diff = differenceInCalendarDays(due, today);
  if (diff > 1) return `Due in ${diff} days`;
  if (status === 'completed' || status === 'cancelled' || status === 'locked') {
    return `Due ${formatDate(dueDate)}`;
  }
  const absDiff = Math.abs(diff);
  return `${absDiff} day${absDiff === 1 ? '' : 's'} overdue`;
}

/** "dd MMM yyyy, hh:mm a" — for timestamps (created_at, etc.) */
export function formatDateTime(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  try {
    const d = value instanceof Date ? value : parseISO(String(value));
    return format(d, 'dd MMM yyyy, hh:mm a');
  } catch {
    return String(value);
  }
}

/** "d MMM" — a day within the current few weeks, like "15 Sep". No year:
 *  it is used for blocker dates, which are always near today, and a year
 *  there is noise that pushes the useful part off a narrow line. */
export function formatDayMonth(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  try {
    const d = value instanceof Date ? value : parseISO(String(value));
    return format(d, 'd MMM');
  } catch {
    return null;
  }
}

/** "MMM d" — short date like "Sep 2" */
export function formatMonthDay(value: string | Date): string {
  return format(toLocalDate(value), 'MMM d');
}

/** Greeting based on current hour. */
export function greeting(): string {
  const hour = getHours(new Date());
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** Check if a date string is today. */
export function isToday(dateStr: string): boolean {
  return dfnsIsToday(toLocalDate(dateStr));
}

/** Check if a date string is yesterday. */
export function isYesterday(dateStr: string): boolean {
  return dfnsIsYesterday(toLocalDate(dateStr));
}

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

export function onboardingStatusTone(status: string): 'pending' | 'progress' | 'done' | 'closed' {
  if (status === 'pre_onboarding') return 'pending';
  if (status === 'completed') return 'done';
  if (status === 'cancelled') return 'closed';
  return 'progress';
}
