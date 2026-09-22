import { format, formatDistanceToNowStrict, isToday, isYesterday, parseISO } from 'date-fns';

/** One row of GET /activity-logs, names already resolved server-side. */
export interface ActivityRow {
  id: string;
  actor_name: string | null;
  action: string;
  entity_type: string;
  target_name: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ActivityPage {
  data: ActivityRow[];
  total: number;
}

export const humanize = (s: string) => s.replace(/_/g, ' ');

const actor = (r: ActivityRow) => r.actor_name ?? 'The system';
const target = (r: ActivityRow) => r.target_name ?? 'someone';
const meta = (r: ActivityRow, key: string) => r.metadata?.[key];

/** The thing the event was about, as the log recorded its name: a task
 *  title, a document type's label, a subtask step, a company document. */
const named = (r: ActivityRow): string | null => {
  const value = meta(r, 'title') ?? meta(r, 'document') ?? meta(r, 'step');
  return typeof value === 'string' && value ? value : null;
};
const quoted = (r: ActivityRow, fallback: string) => {
  const name = named(r);
  return name ? `\u201c${name}\u201d` : fallback;
};

/**
 * Only for actions whose derived label would be misleading or would bury
 * what actually happened — an audit trail is read months later by someone
 * who wasn't there, and 'Created' on a user row doesn't say a temporary
 * password was issued with it. Anything not listed falls through to
 * actionLabel()'s derivation, so a newly logged action still reads
 * sensibly without anyone editing this map.
 */
const ACTION_LABELS: Record<string, string> = {
  'user.created': 'Account created — temporary password issued',
  'user.credentials_regenerated': 'New temporary password issued',
  'user.credentials_viewed': 'Temporary password viewed by HR',
  'user.password_reset_completed': 'Set their own password',
  'onboarding.created': 'Onboarding started',
  'onboarding.completed': 'Onboarding completed — all tasks done',
  'onboarding.email_provisioned': 'Company email provisioned',
  'onboarding.assignments_updated': 'Manager / buddy allotted',
  'document.uploaded': 'Company document uploaded',
  'joinee_document.uploaded': 'Document uploaded',
  'joinee_document.reuploaded_after_rejection': 'New document uploaded after rejection',
  'joinee_document.approved': 'Document approved by HR',
  'joinee_document.rejected': 'Document rejected by HR',
  'onboarding_task.reopened_by_document_rejection': 'Task reopened — document was rejected',
};

/**
 * 'onboarding_task.assigned_by_owner' -> 'Assigned by owner', with the
 * thing's own name folded in when the log recorded one — a row that says
 * `Completed “Laptop & dev environment handover”` is worth reading, and
 * `Task completed` is not.
 */
export function actionLabel(row: ActivityRow): string {
  const base =
    ACTION_LABELS[row.action] ??
    (() => {
      const verb = humanize(row.action.slice(row.action.indexOf('.') + 1));
      return verb.charAt(0).toUpperCase() + verb.slice(1);
    })();
  const name = named(row);
  return name ? `${base} \u2014 \u201c${name}\u201d` : base;
}

/**
 * The same event as one plain sentence, for the dashboard feed where
 * there are no who/what/to-whom columns to carry the structure.
 *
 * Per-action phrasing because there is no way to derive "Company email
 * issued to Devansh Verma" from an action string — but only for actions
 * a person would actually scan for. Everything else composes from the
 * label and the two names, which reads adequately and never goes stale.
 */
const SENTENCES: Record<string, (r: ActivityRow) => string> = {
  'user.created': (r) => `${actor(r)} created an account for ${target(r)} and issued a temporary password.`,
  'user.credentials_regenerated': (r) => `${actor(r)} issued a new temporary password to ${target(r)}.`,
  'user.credentials_viewed': (r) => `${actor(r)} viewed the temporary password for ${target(r)}.`,
  'user.password_reset_completed': (r) => `${target(r)} set their own password.`,
  'user.enabled': (r) => `${actor(r)} re-enabled ${target(r)}'s account.`,
  'user.disabled': (r) => `${actor(r)} disabled ${target(r)}'s account.`,
  'onboarding.created': (r) => `${actor(r)} started onboarding for ${target(r)}.`,
  'onboarding.completed': (r) => {
    const count = meta(r, 'taskCount');
    return `${target(r)} completed all ${count ?? ''} onboarding tasks.`.replace('all  ', 'all ');
  },
  'onboarding.email_provisioned': (r) => `Company email issued to ${target(r)}.`,
  'onboarding.assignments_updated': (r) => {
    const manager = meta(r, 'managerName');
    const buddy = meta(r, 'buddyName');
    const parts = [manager && `manager ${manager}`, buddy && `buddy ${buddy}`].filter(Boolean);
    return parts.length
      ? `${target(r)} was allotted ${parts.join(' and ')}.`
      : `${actor(r)} cleared the manager and buddy for ${target(r)}.`;
  },
  'document.uploaded': (r) => `${actor(r)} uploaded the company document ${quoted(r, 'a file')}.`,
  'joinee_document.uploaded': (r) => `${actor(r)} uploaded ${quoted(r, 'a document')}.`,
  'joinee_document.reuploaded_after_rejection': (r) =>
    `${actor(r)} uploaded a new ${quoted(r, 'document')} after the last one was rejected.`,
  'joinee_document.approved': (r) => `${actor(r)} approved ${quoted(r, 'a document')} from ${target(r)}.`,
  'joinee_document.rejected': (r) => {
    const reason = meta(r, 'reason');
    const why = typeof reason === 'string' && reason ? ` \u2014 ${reason}` : '';
    return `${actor(r)} rejected ${quoted(r, 'a document')} from ${target(r)}${why}.`;
  },
  'onboarding_task.reopened_by_document_rejection': (r) =>
    `${quoted(r, 'A task')} was reopened for ${target(r)} — their document was rejected.`,
  'onboarding_task.claimed': (r) => `${actor(r)} claimed ${quoted(r, 'a task')} for ${target(r)}.`,
  'onboarding_task.scheduled': (r) => `${actor(r)} scheduled ${quoted(r, 'a task')} for ${target(r)}.`,
  'onboarding_task.assigned_by_owner': (r) => `${actor(r)} assigned ${quoted(r, 'a task')} to ${target(r)}.`,
  'onboarding_task.owner_completed': (r) => `${actor(r)} completed ${quoted(r, 'a task')} for ${target(r)}.`,
  'onboarding_task.employee_completed': (r) => `${target(r)} completed ${quoted(r, 'a task')}.`,
  'onboarding_task.owner_confirmed': (r) => `${actor(r)} confirmed ${quoted(r, 'a task')} for ${target(r)}.`,
  'onboarding_task.employee_confirmed': (r) => `${target(r)} confirmed ${quoted(r, 'a task')}.`,
  'onboarding_task.completed_via_subtasks': (r) =>
    `${target(r)} finished every step of ${quoted(r, 'a task')}.`,
  'onboarding_subtask.completed': (r) => `${actor(r)} completed ${quoted(r, 'a step')} for ${target(r)}.`,
  'onboarding_subtask.reopened': (r) => `${actor(r)} reopened ${quoted(r, 'a step')} for ${target(r)}.`,
};

export function activitySentence(row: ActivityRow): string {
  const build = SENTENCES[row.action];
  if (build) return build(row);
  const suffix = row.target_name ? ` — ${row.target_name}` : '';
  return `${actor(row)}: ${actionLabel(row).toLowerCase()}${suffix}.`;
}

/** Drives the dot beside a feed item: something finished, something
 *  needs attention, or neither. */
export type ActivityTone = 'done' | 'attention' | 'neutral';

export function activityTone(action: string): ActivityTone {
  if (
    action === 'onboarding.completed' ||
    action === 'joinee_document.approved' ||
    action.endsWith('.completed') ||
    action.endsWith('_completed')
  ) {
    return 'done';
  }
  if (
    action === 'joinee_document.rejected' ||
    action === 'user.disabled' ||
    action.includes('reopened') ||
    action.includes('rejection')
  ) {
    return 'attention';
  }
  return 'neutral';
}

/**
 * "18 minutes ago" for today, "Yesterday, 4:12 PM" for yesterday, and an
 * absolute date beyond that — a relative distance stops being useful
 * ("3 months ago") long before it stops being computable.
 */
export function relativeTime(value: string): string {
  const d = parseISO(value);
  if (isToday(d)) return `${formatDistanceToNowStrict(d)} ago`;
  if (isYesterday(d)) return `Yesterday, ${format(d, 'h:mm a')}`;
  return format(d, 'd MMM yyyy, h:mm a');
}

/**
 * The metadata each log() call site recorded, rendered as one muted line
 * under the action on the full audit page. Generic rather than
 * per-action so a new call site's detail shows up here for free.
 *
 * Raw ids are dropped — they're uuids, unreadable, and the names they
 * point at are already resolved into the who/to-whom columns. A false
 * boolean is dropped too and a true one shows as its bare key, so
 * `{taskCompleted: true}` reads "task completed" rather than
 * "task completed: true".
 */
export function detailLine(metadata: Record<string, unknown>): string {
  return Object.entries(metadata ?? {})
    // title/document/step are folded into the action label itself, and
    // repeating them under it just says the same thing twice.
    .filter(
      ([key, value]) =>
        !/id$/i.test(key) &&
        key !== 'title' &&
        key !== 'document' &&
        key !== 'step' &&
        value !== null &&
        value !== '' &&
        value !== false,
    )
    .map(([key, value]) => {
      const label = humanize(key.replace(/([A-Z])/g, ' $1').toLowerCase());
      if (value === true) return label;
      // A session's user agent is a 120-character string that would
      // otherwise wrap over three lines and bury every other row on the
      // page. Truncating by length rather than by key so any future long
      // value is handled the same way.
      const text = String(value);
      return `${label}: ${text.length > 60 ? `${text.slice(0, 60)}…` : text}`;
    })
    .join(' · ');
}
