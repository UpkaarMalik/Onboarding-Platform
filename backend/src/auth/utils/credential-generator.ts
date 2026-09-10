import { randomInt } from 'crypto';

const PASSWORD_ALPHABET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';

/** Slug for a REAL company email local-part: lowercase, letters/digits
 *  only, no separator ("Sam Row" -> "samrow") — unlike slugifyName
 *  above (used for the synthetic temp login), this has to read as a
 *  normal professional email address. */
export function slugifyNameForCompanyEmail(fullName: string): string {
  const collapsed = fullName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '');
  return collapsed || 'user';
}

/** Generates a random temporary password. Uses crypto.randomInt (CSPRNG),
 *  not Math.random. Excludes visually ambiguous characters (0/O, 1/l/I)
 *  since this gets read aloud or typed from a phone screen by HR. */
export function generateTempPassword(length = 12): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += PASSWORD_ALPHABET[randomInt(0, PASSWORD_ALPHABET.length)];
  }
  return out;
}
