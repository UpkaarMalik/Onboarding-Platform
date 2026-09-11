/**
 * The order an employee's journey is presented in, and the sequential gate
 * that goes with it: one task is open at a time, and finishing it opens the
 * next.
 *
 * WHY THIS IS SERVER-SIDE, AND ONLY HERE. The order and the gate are one
 * decision, made once: the dashboard returns steps already ordered and already
 * gated, and the trail simply draws what it is given. There is deliberately no
 * second check anywhere else — not in the client, which would be a second
 * opinion on the same question, and not in the completion endpoint, which
 * would be the same rule written twice and free to drift.
 *
 * WHY TITLES. The five bands below are a product decision — paperwork, then
 * reading, then the laptop and email, then what gets installed on that laptop,
 * then everything else — and the templates carry nothing that expresses it:
 * `system_key` is set on exactly one task type (document_upload) and
 * `milestone`/`due_offset_days` only say when something is due, not what kind
 * of thing it is. Matching titles is the honest cost of not changing the
 * schema. A task whose title fits no band falls to the last one rather than
 * disappearing, so a new template can never lose a task off the trail.
 */

export interface TrailTask {
  title: string;
  system_key?: string | null;
  status: string;
  is_required?: boolean;
}

/** First match wins, so each test only has to exclude what an earlier band has
 *  already claimed. */
const TRAIL_BANDS: Array<(task: TrailTask) => boolean> = [
  // Paperwork. Keyed on system_key first — the one band the data identifies
  // for us, and the one most likely to be renamed.
  (t) => t.system_key === 'document_upload' || /\bupload\b/i.test(t.title),
  // Reading. Deliberately not matching "docs" alone, which would pull
  // "Read the docs" into the paperwork band above.
  (t) => /\bread\b|handbook|polic/i.test(t.title),
  // The kit: laptop and company email.
  (t) => /laptop|e-?mail/i.test(t.title),
  // Everything installed onto that laptop.
  (t) => /\binstall\b/i.test(t.title),
];

export function trailBand(task: TrailTask): number {
  const found = TRAIL_BANDS.findIndex((match) => match(task));
  return found === -1 ? TRAIL_BANDS.length : found;
}

/** A task in one of these has had its turn; the gate moves past it. */
const SETTLED = new Set(['completed', 'cancelled']);

/**
 * Sorted into band order, keeping the incoming order (due date, then created)
 * inside each band. The index tiebreak is explicit rather than relying on
 * Array.prototype.sort being stable — it is, per spec, but the numbering the
 * employee sees should not depend on a reader knowing that.
 */
export function orderForTrail<T extends TrailTask>(tasks: T[]): T[] {
  return tasks
    .map((task, index) => ({ task, index, band: trailBand(task) }))
    .sort((a, b) => a.band - b.band || a.index - b.index)
    .map((entry) => entry.task);
}

/**
 * Index of the one open task: the first in trail order that is neither
 * completed nor cancelled. -1 when the whole journey is settled.
 *
 * Note what this does NOT do — it does not skip a task it considers awkward.
 * A 'blocked' task holds the gate, which is the point: the employee's next
 * step is the blocked one, and the trail should say so rather than quietly
 * handing them work from further down the list.
 */
export function openIndex(ordered: TrailTask[]): number {
  return ordered.findIndex((task) => !SETTLED.has(task.status));
}

/**
 * The status the employee should be shown for each step, given the gate.
 *
 * A task that is already completed or cancelled keeps its own status wherever
 * it sits — including one completed out of order under the old rules, which is
 * history and not something to rewrite. Everything else is either THE open
 * task or locked behind it.
 */
export function applySequenceGate<T extends TrailTask>(ordered: T[]): T[] {
  const open = openIndex(ordered);
  return ordered.map((task, index) => {
    if (SETTLED.has(task.status)) return task;
    if (index === open) {
      // 'blocked' is a real state of the task itself and outranks the gate.
      return task.status === 'blocked' ? task : { ...task, status: 'pending' };
    }
    return { ...task, status: 'locked' };
  });
}
