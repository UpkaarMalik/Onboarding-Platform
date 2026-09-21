/**
 * Avatar tint, keyed on the department.
 *
 * The roster used to tint by row index (`index % AVATAR_COLORS.length`),
 * which meant the same person changed colour whenever the list was sorted,
 * filtered or paged — and the colour said nothing. Keying on the department
 * makes the tint mean something: everyone on a team reads as that team,
 * in the roster and in the nav avatar alike.
 *
 * The key is hashed into one of the eight `.avatar-0` … `.avatar-7` slots
 * defined in index.css, so a department added in the admin UI picks up a
 * colour without a code change. Prefer passing the department *id*: names
 * get renamed, ids do not.
 *
 * No department on file returns an empty class rather than slot 0, which
 * would otherwise paint "unknown" in a real department's green. The
 * avatar's own amber gradient shows through instead.
 */
const AVATAR_SLOTS = 8;

export function avatarClass(key: string | null | undefined): string {
  if (!key) return '';
  // Rolling hash. Anything deterministic works here; the modulus keeps the
  // running value inside a safe integer for long ids.
  let h = 0;
  for (let i = 0; i < key.length; i += 1) {
    h = (h * 31 + key.charCodeAt(i)) % 100003;
  }
  return `avatar-${h % AVATAR_SLOTS}`;
}
