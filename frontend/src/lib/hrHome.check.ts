/**
 * Self-check for the HR home's pure helpers: the roster's sort and filter
 * query, and the department donut's aggregation and legend rule.
 *
 * No test runner is installed, and a comparator and a guard are not worth
 * adding a dependency for. Node strips the types itself:
 *
 *     node frontend/src/lib/hrHome.check.ts
 *
 * Silence means every assertion held.
 */
import { compareRows, rosterQueryIsActive, SORT_OPTIONS, type RosterSort } from './rosterQuery.ts';
import { departmentSlices, nextHidden } from './departmentStats.ts';
import {
  DEPT_SLOTS,
  DEPT_INKS,
  DEPT_TINTS,
  DEPT_TINTS_LIGHT,
  avatarClass,
  deptLightClass,
  deptSlots,
  deptTint,
} from './deptColor.ts';

/* Hand-rolled rather than node:assert, because @types/node is not installed
   and `tsc -b` typechecks everything under src/. */
function eq(actual: unknown, expected: unknown, what: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${what}\n  expected ${b}\n  got      ${a}`);
}
function ok(cond: boolean, what: string): void {
  if (!cond) throw new Error(what);
}

const rows = [
  { employee_name: 'Chandra Rao', start_date: '2026-03-01' },
  { employee_name: 'aarav Mehta', start_date: '2026-01-15' },
  { employee_name: 'Bhavna Iyer', start_date: '2026-05-20' },
];

const names = (s: RosterSort) => [...rows].sort((a, b) => compareRows(s, a, b)).map((r) => r.employee_name);
const dates = (s: RosterSort) => [...rows].sort((a, b) => compareRows(s, a, b)).map((r) => r.start_date);

// localeCompare, so the lowercased name sorts by letter and not by char code.
eq(names('name-asc'), ['aarav Mehta', 'Bhavna Iyer', 'Chandra Rao'], 'name-asc');
eq(names('name-desc'), ['Chandra Rao', 'Bhavna Iyer', 'aarav Mehta'], 'name-desc');
eq(dates('date-asc'), ['2026-01-15', '2026-03-01', '2026-05-20'], 'date-asc');
eq(dates('date-desc'), ['2026-05-20', '2026-03-01', '2026-01-15'], 'date-desc');

// No sort selected must leave the incoming order alone — the roster relies on
// that to keep the server's ordering when the control reads "Default order".
eq(names(''), rows.map((r) => r.employee_name), 'default order is left alone');

// Every option in the dropdown must actually sort, or it is a dead choice.
for (const opt of SORT_OPTIONS) {
  if (!opt.value) continue;
  ok(
    names(opt.value).join() !== names('').join() || opt.value === 'name-asc',
    `${opt.value} is in the dropdown but does not reorder`,
  );
}

// The nav's "a filter is on" dot: only the four roster params count, so
// ?profile= alone must not light it up.
eq(rosterQueryIsActive(new URLSearchParams('')), false, 'empty query');
eq(rosterQueryIsActive(new URLSearchParams('profile=abc')), false, 'profile is not a roster filter');
eq(rosterQueryIsActive(new URLSearchParams('q=rao')), true, 'q counts');
eq(rosterQueryIsActive(new URLSearchParams('sort=name-asc&profile=abc')), true, 'sort counts');
// A key present but empty is not a filter — clearing a field leaves "".
eq(rosterQueryIsActive(new URLSearchParams('q=')), false, 'an empty key is not a filter');


/* ---- the department donut ---- */

// The real shape of the data: one row per joinee, department repeated.
const roster = [
  { department_id: 'fin', department_name: 'Finance' },
  { department_id: 'eng', department_name: 'Engineering' },
  { department_id: 'fin', department_name: 'Finance' },
  { department_id: 'ops', department_name: 'Operations' },
  { department_id: 'eng', department_name: 'Engineering' },
  { department_id: 'fin', department_name: 'Finance' },
  // Nobody is dropped for having no department on file, or the ring's total
  // would quietly disagree with the roster's count.
  { department_id: null, department_name: null },
];

const slices = departmentSlices(roster);
eq(slices.map((s) => [s.name, s.count]), [
  ['Finance', 3],
  ['Engineering', 2],
  ['No department', 1],
  ['Operations', 1],
], 'counted per department, largest first, ties by name');
eq(
  slices.reduce((n, s) => n + s.count, 0),
  roster.length,
  'every row lands in exactly one slice',
);

eq(departmentSlices([]), [], 'no rows, no slices');

// The legend rule: the last one showing cannot be switched off.
const none = new Set<string>();
eq([...nextHidden(none, 'fin', 3)], ['fin'], 'one of three switches off');
eq([...nextHidden(new Set(['fin']), 'eng', 3)], ['fin', 'eng'], 'two of three switch off');
const downToOne = new Set(['fin', 'eng']);
ok(nextHidden(downToOne, 'ops', 3) === downToOne, 'the last one showing is refused, by identity');
eq([...nextHidden(downToOne, 'fin', 3)], ['eng'], 'switching one back on always works');
ok(nextHidden(new Set(['fin']), 'fin', 1) !== new Set(['fin']), 'a single department can be switched back on');
eq([...nextHidden(new Set(['fin']), 'fin', 1)], [], 'and comes back');


/* ---- one department, one colour, everywhere ---- */

/* The real department list. Hashing the id used to decide the slot, and on
   this exact data Engineering and Finance collided onto the same colour —
   two of three departments painted identically. The ordered assignment is
   what fixes it, so this asserts the property the hash broke. */
const REAL_DEPARTMENTS = [
  { id: '795cbaea-043e-4a04-aa0e-1c7a389e7ee0', name: 'Engineering' },
  { id: 'c7b54500-29e1-4871-844f-cdd57506bfa9', name: 'Finance' },
  { id: '031ce3fb-e435-4bb1-9a58-6e016638d04d', name: 'Operations' },
];

const real = deptSlots(REAL_DEPARTMENTS);
eq(
  REAL_DEPARTMENTS.map((d) => [d.name, real.get(d.id)]),
  [
    ['Engineering', 0],
    ['Finance', 1],
    ['Operations', 2],
  ],
  'slots follow the alphabetical order of the department names',
);
eq(
  new Set(REAL_DEPARTMENTS.map((d) => real.get(d.id))).size,
  REAL_DEPARTMENTS.length,
  'no two departments share a slot',
);

// The property, not just this data: any list up to DEPT_SLOTS is collision
// free, and the order it arrives in does not matter.
const many = Array.from({ length: DEPT_SLOTS }, (_, i) => ({ id: `id-${i}`, name: `Dept ${i}` }));
eq(new Set(deptSlots(many).values()).size, DEPT_SLOTS, 'a full list uses every slot exactly once');
eq(
  [...deptSlots([...many].reverse()).entries()].sort(),
  [...deptSlots(many).entries()].sort(),
  'the incoming order of the list does not change the answer',
);

// Solid marks and light surfaces are the SAME slot, so a card, its avatar
// and its donut segment cannot end up on different hues.
eq(DEPT_TINTS_LIGHT.length, DEPT_TINTS.length, 'a light pair for every solid tint');
eq(DEPT_TINTS.length, DEPT_SLOTS, 'one tint per slot');
for (const d of REAL_DEPARTMENTS) {
  const solid = avatarClass(real, d.id).replace('avatar-', '');
  const light = deptLightClass(real, d.id).replace('dept-light-', '');
  eq(light, solid, `${d.name} resolves to one slot in both palettes`);
  eq(deptTint(real, d.id), DEPT_TINTS[Number(solid)], `${d.name}'s hex matches its class`);
}

// Unknown department: no class and no hex either way, so the element keeps
// its own neutral background instead of borrowing slot 0's colour.
eq(avatarClass(real, null), '', 'no department, no avatar tint class');
eq(deptLightClass(real, null), '', 'no department, no light tint class');
eq(deptTint(real, null), null, 'no department, no hex');
eq(avatarClass(real, 'not-a-department'), '', 'an unknown id gets no colour');
eq(deptLightClass(real, ''), '', 'an empty id is not a department');
// Before the list loads the map is empty, and nothing may be mis-coloured.
eq(avatarClass(deptSlots([]), REAL_DEPARTMENTS[0].id), '', 'no colour before the list loads');

// Every light pair must be a real pair of hex colours the CSS can mirror.
for (const [i, pair] of DEPT_TINTS_LIGHT.entries()) {
  eq(pair.length, 2, `slot ${i} has two stops`);
  for (const hex of pair) ok(/^#[0-9a-f]{6}$/.test(hex), `slot ${i} stop ${hex} is a 6-digit hex`);
}
ok(new Set(DEPT_TINTS_LIGHT.map((p) => p[0])).size === DEPT_TINTS_LIGHT.length, 'no two slots share a light tint');
ok(new Set(DEPT_TINTS).size === DEPT_TINTS.length, 'no two slots share a solid tint');

/* --- the ink, which is the only thing that survives the roster surface ---

   The pill's fill measures ~1.01:1 against the roster's glass, so the edge
   and the word are what identify the department there. That is a contrast
   claim, and a contrast claim that nothing checks is a contrast claim that
   drifts — Finance reached 2.27:1 exactly that way. These assertions are the
   guard: darken the surface, lighten an ink, or add a fifth slot, and this
   fails before anyone has to notice a washed-out pill on a screen. */
function relativeLuminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/* .roster-shell's glass over the HR home's warmest ambient region — the
   worst case on the page, and where Finance's amber vanished. */
const ROSTER_SURFACE = '#fcf1e6';

eq(DEPT_INKS.length, DEPT_SLOTS, 'one ink per slot');
ok(new Set(DEPT_INKS).size === DEPT_INKS.length, 'no two slots share an ink');
for (const [i, ink] of DEPT_INKS.entries()) {
  ok(/^#[0-9a-f]{6}$/.test(ink), `slot ${i} ink ${ink} is a 6-digit hex`);
  // WCAG 1.4.11: a boundary that identifies a component needs 3:1.
  ok(
    contrast(ink, ROSTER_SURFACE) >= 3,
    `slot ${i} ink ${ink} is only ${contrast(ink, ROSTER_SURFACE).toFixed(2)}:1 against the roster surface`,
  );
  // And it is the pill's text as well as its edge, so it needs 4.5:1 on its
  // own fill.
  ok(
    contrast(ink, DEPT_TINTS_LIGHT[i][0]) >= 4.5,
    `slot ${i} ink ${ink} is only ${contrast(ink, DEPT_TINTS_LIGHT[i][0]).toFixed(2)}:1 on its own fill`,
  );
}
