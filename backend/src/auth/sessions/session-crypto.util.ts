import { createHash, randomBytes } from 'crypto';

/**
 * Generation and hashing of the opaque halves of a session credential:
 * the refresh token that lives in the HttpOnly cookie, and the CSRF
 * token that pairs with it. Both are random URL-safe strings; only
 * their sha256 hex digest ever reaches the database.
 *
 * sha256 is fine here (and much cheaper than bcrypt) because the input
 * is a 256-bit random value we generated ourselves — brute-forcing it
 * from the hash costs the same as guessing the token, i.e. infeasible.
 * bcrypt exists to defend low-entropy inputs (passwords); refresh
 * tokens aren't that.
 */

const REFRESH_TOKEN_BYTES = 48; // 384 bits → 64-char base64url
const CSRF_TOKEN_BYTES = 32; // 256 bits → 43-char base64url

/** URL-safe random string with no padding, safe to put in a cookie
 *  value verbatim. */
function randomUrlSafe(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

export function generateRefreshToken(): string {
  return randomUrlSafe(REFRESH_TOKEN_BYTES);
}

export function generateCsrfToken(): string {
  return randomUrlSafe(CSRF_TOKEN_BYTES);
}

/** sha256, hex. Constant-time comparison isn't needed here because
 *  callers always hash the incoming value and let Postgres do an
 *  equality on hashes — a timing side-channel would only leak whether
 *  a hash exists, which is uninteresting on its own. */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
