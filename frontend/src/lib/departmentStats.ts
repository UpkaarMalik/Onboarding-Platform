/**
 * Department headcount for the home donut.
 *
 * Counting only — the colour is added by the component from
 * lib/deptColor. Keeping this module import-free is what lets the checks in
 * hrHome.check.ts run it under plain `node` without mounting React.
 */
export interface DeptSlice {
  id: string;
  name: string;
  count: number;
}

/** What the chart needs off a roster row. */
export interface DeptRow {
  department_id: string | null;
  department_name: string | null;
}

/** Counts per department, largest first, ties broken by name so the ring's
 *  order is stable between renders. Derived from rows the page already
 *  fetched, so the chart cannot disagree with the list below it. */
export function departmentSlices(rows: DeptRow[]): DeptSlice[] {
  const byId = new Map<string, DeptSlice>();
  for (const r of rows) {
    /* Someone with no department on file is still a joinee, so they are
       counted under one bucket rather than dropped — losing them would make
       the ring's total disagree with the roster's. */
    const id = r.department_id ?? '__none__';
    const at = byId.get(id);
    if (at) {
      at.count += 1;
      continue;
    }
    byId.set(id, { id, name: r.department_name ?? 'No department', count: 1 });
  }
  return [...byId.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * The next set of switched-off departments after clicking `id`.
 *
 * Switching one back on is always allowed. Switching one off is refused when
 * it is the only one left showing: an empty ring says nothing, so the click
 * would read as broken rather than as declined. Returns the SAME set object
 * when refused, so React skips the re-render.
 */
export function nextHidden(hidden: Set<string>, id: string, total: number): Set<string> {
  const turningOff = !hidden.has(id);
  if (turningOff && total - hidden.size <= 1) return hidden;
  const next = new Set(hidden);
  if (turningOff) next.add(id);
  else next.delete(id);
  return next;
}
