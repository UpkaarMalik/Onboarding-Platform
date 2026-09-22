/**
 * The illustration each department's upcoming-joinee card carries.
 *
 * Keyed on the department NAME because that is how the artwork was chosen
 * ("this one for Finance"), matched case-insensitively so a rename that only
 * changes capitalisation still lands. A department with no artwork of its own
 * falls back rather than showing an empty card.
 *
 * Every file here is padded to the same 4:3 canvas with the figure centred,
 * whatever shape it arrived in. That is what lets one CSS rule place them
 * all identically — at their natural aspects, a portrait image rendered
 * small beside a band of empty space while a landscape one filled the row.
 * Run a new one through scripts/normalise-card-art.py before adding it.
 */
import cardDefault from '../assets/card-default.png';
import cardEngineering from '../assets/card-engineering.png';
import cardFinance from '../assets/card-finance.png';

const BY_DEPARTMENT: Record<string, string> = {
  engineering: cardEngineering,
  finance: cardFinance,
  // operations: awaiting its illustration — falls back until then.
};

export function deptArt(departmentName: string | null | undefined): string {
  return BY_DEPARTMENT[(departmentName ?? '').trim().toLowerCase()] ?? cardDefault;
}
