/**
 * The roster's search, filters and sort, held in the URL.
 *
 * The controls live in the nav (components/Layout.tsx) and the list they
 * narrow lives in a route below it (pages/HrOverview.tsx), so the two are on
 * opposite sides of the router's <Outlet>. The query string is the shared
 * state: no context provider to thread through, and a narrowed roster
 * survives a reload and can be pasted to a colleague.
 *
 * `/hr` also carries `?profile=<userId>` (read by HrDashboard), which is why
 * every writer here edits the existing params rather than replacing them.
 */
export const ROSTER_PARAMS = ['q', 'dept', 'status', 'sort'] as const;

export type RosterSort = '' | 'name-asc' | 'name-desc' | 'date-desc' | 'date-asc';

export const SORT_OPTIONS: { value: RosterSort; label: string }[] = [
  { value: '', label: 'Default order' },
  { value: 'name-asc', label: 'Name A → Z' },
  { value: 'name-desc', label: 'Name Z → A' },
  { value: 'date-desc', label: 'Newest first' },
  { value: 'date-asc', label: 'Oldest first' },
];

export const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'progress', label: 'In progress' },
  { value: 'done', label: 'Completed' },
];

/** Where the roster lives — the nav jumps here when you search from
 *  another page, because filtering a list you cannot see does nothing. */
export const ROSTER_PATH = '/hr';

/** A copy of `params` with one roster key set, or removed when cleared.
 *  Both the nav control and the roster's own toolbar write through this, so
 *  the two sets of filters stay one piece of state. Everything else on the
 *  URL (notably `?profile=`) is preserved. */
export function withParam(
  params: URLSearchParams,
  key: string,
  value: string,
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (value) next.set(key, value);
  else next.delete(key);
  return next;
}

export function rosterQueryIsActive(params: URLSearchParams): boolean {
  return ROSTER_PARAMS.some((k) => !!params.get(k));
}

/** Compare two rows for the given sort. Kept here next to SORT_OPTIONS so a
 *  new option and its comparator cannot drift apart. */
export function compareRows(
  sort: RosterSort,
  a: { employee_name: string; start_date: string },
  b: { employee_name: string; start_date: string },
): number {
  switch (sort) {
    case 'name-asc':
      return a.employee_name.localeCompare(b.employee_name);
    case 'name-desc':
      return b.employee_name.localeCompare(a.employee_name);
    // ISO dates, so a string compare is a date compare.
    case 'date-asc':
      return a.start_date.localeCompare(b.start_date);
    case 'date-desc':
      return b.start_date.localeCompare(a.start_date);
    default:
      return 0;
  }
}
