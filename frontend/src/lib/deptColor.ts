/**
 * Department colour.
 *
 * One department, one colour, everywhere it appears: the roster avatar and
 * department badge, the upcoming-joinee card, the donut segment and its
 * legend swatch.
 *
 * Slots are assigned from a STABLE ALPHABETICAL ORDER of the whole
 * department list, not by hashing the id. Hashing was the first attempt and
 * it collided in production: Engineering and Finance both landed on the same
 * slot, so two of three departments were the same colour. An ordered
 * assignment cannot collide while there are no more departments than slots.
 *
 * That is why the lookups here take a map built once per page rather than an
 * id on its own — a colour that depends on the whole set cannot be derived
 * from one member of it.
 */

/* Four hues, ordered so the calmest sit first and a small org never reaches
   the rest. Validated as a categorical palette against a light surface with
   every pair compared, not just neighbours, because the donut shows them all
   at once: lightness band, chroma floor and CVD separation all pass. The
   worst pair sits in the 6–8 ΔE band, which is permitted only alongside a
   second channel — every use of these has the department's name in text
   beside it, and the amber's sub-3:1 contrast is covered by the same labels.

   ponytail: four is where an all-pairs-separable palette runs out; a fifth
   hue failed every candidate. Past four, slots repeat — if the org grows
   beyond four departments, pair the tint with the badge text (already
   present) or move the chart to a sorted bar. */
export const DEPT_SLOTS = 4;

export const DEPT_TINTS = ['#1f7a4d', '#e0921f', '#2f6fa8', '#b5432f'] as const;

/**
 * The light pair per slot, for surfaces a department OWNS — a card, a badge —
 * as opposed to the small saturated marks above. Two stops so a surface can
 * be a gradient; the deeper one is the worst case for text, and every slot
 * clears 4.5:1 against both --color-text and --color-muted.
 *
 * Mirrored as the `.dept-light-N` rules in index.css, which is what most
 * call sites use. Change one, change the other.
 */
export const DEPT_TINTS_LIGHT = [
  ['#e9f5ee', '#ddf0e6'],
  ['#fdf3e2', '#fbeacd'],
  ['#ebf3fa', '#e0ecf7'],
  ['#fceeeb', '#fae3de'],
] as const;

/**
 * The INK per slot: the department's colour at a weight that can carry a
 * boundary or a word, as opposed to fill a shape.
 *
 * Three of these are simply the solid tint above, which already clears both
 * 3:1 against the roster surface and 4.5:1 as text on its own light fill.
 * Slot 1 is the exception and the reason this array exists. Amber #e0921f
 * measures 2.27:1 against the roster's warm glass — the only slot under the
 * 3:1 floor for a non-text boundary — and the palette comment above already
 * conceded the point ("the amber's sub-3:1 contrast is covered by the same
 * labels"). That concession holds while the label is the only thing doing the
 * work; it stops holding on a surface the same hue as the tint, where the
 * pill's own edge disappears and the department reads as unlabelled.
 *
 * The replacement is not a new colour: #9a5a08 is --color-accent-ink, already
 * in :root, already defined as "the amber darkened until it clears 4.5:1
 * against its own tint". Same hue, same family, 4.91:1 against the surface.
 *
 * DEPT_TINTS is deliberately NOT changed — the donut segment and the roster
 * avatar are saturated marks on an opaque surface where the lighter amber is
 * both legible and better looking. One department still has one identity;
 * this is that identity at the weight a boundary needs, exactly as
 * --color-accent-ink relates to --color-accent.
 *
 * Mirrored as `--dept-ink` in the `.dept-light-N` rules in index.css.
 * Change one, change the other.
 */
export const DEPT_INKS = ['#1f7a4d', '#9a5a08', '#2f6fa8', '#b5432f'] as const;

export type DeptSlots = ReadonlyMap<string, number>;

/**
 * Slot per department id. Sorted by name so the assignment is explicable
 * ("first department alphabetically is green") and stable between renders
 * and between pages — every caller passes the same list, so every caller
 * gets the same answer.
 */
export function deptSlots(departments: { id: string; name: string }[]): DeptSlots {
  return new Map(
    [...departments]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((d, i) => [d.id, i % DEPT_SLOTS] as const),
  );
}

/** The class carrying a department's SOLID tint, for small marks. Empty when
 *  there is no department on file, or when the list has not loaded yet, so
 *  the element keeps its own neutral background. */
export function avatarClass(slots: DeptSlots, id: string | null | undefined): string {
  const slot = id ? slots.get(id) : undefined;
  return slot === undefined ? '' : `avatar-${slot}`;
}

/** The class carrying a department's LIGHT surface. */
export function deptLightClass(slots: DeptSlots, id: string | null | undefined): string {
  const slot = id ? slots.get(id) : undefined;
  return slot === undefined ? '' : `dept-light-${slot}`;
}

/** The solid tint itself, for marks that cannot use a class — an SVG stroke.
 *  Null when the department is unknown, so the caller decides the fallback. */
export function deptTint(slots: DeptSlots, id: string | null | undefined): string | null {
  const slot = id ? slots.get(id) : undefined;
  return slot === undefined ? null : DEPT_TINTS[slot];
}
