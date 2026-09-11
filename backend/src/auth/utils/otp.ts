import { randomInt } from 'crypto';
import * as bcrypt from 'bcrypt';

const OTP_HASH_ROUNDS = 8;
export const OTP_TTL_MS = 5 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;

/** The predictable code every account gets while the testing override is on. */
export const FIXED_DEV_OTP = '123456';

/**
 * Testing override: issue '123456' to everyone instead of a random code.
 *
 * ON by default so mobile+OTP login can be exercised without reading a code
 * out of the server log — but it CANNOT be switched on in production, and
 * that guard is deliberately not configurable. This is the same mechanism
 * `ISSUES.md` recorded as Critical #1 (a fixed '123456' that made every
 * account reachable with a known code) and that the current auth rewrite was
 * written to remove; it is acceptable only because this environment is local
 * and disposable.
 *
 * Set AUTH_FIXED_OTP=false to get real random codes back without touching
 * NODE_ENV.
 */
export function fixedOtpEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  return process.env.AUTH_FIXED_OTP !== 'false';
}

/** Random 6-digit numeric code, CSPRNG-backed (crypto.randomInt, not
 *  Math.random) — same standard as generateTempPassword.
 *
 *  Only the code itself is predictable under the testing override. It is
 *  still bcrypt-hashed, still expires after OTP_TTL_MS, still counts against
 *  OTP_MAX_ATTEMPTS, and is still verified by comparing against the stored
 *  hash — so the whole login path is genuinely exercised rather than
 *  short-circuited. */
export function generateOtpCode(): string {
  if (fixedOtpEnabled()) return FIXED_DEV_OTP;
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function hashOtp(code: string): Promise<string> {
  return bcrypt.hash(code, OTP_HASH_ROUNDS);
}

export function verifyOtpHash(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(code, hash);
}

/**
 * Sends the OTP to the user's registered mobile number. No SMS provider
 * is wired up yet — same gap as the SMTP config in .env.example that's
 * never actually used — so this just logs the code, which keeps login
 * working end-to-end in dev. Every call site already awaits this, so
 * swapping in a real provider (Twilio/MSG91/etc.) later is contained
 * to this one function.
 */
export async function sendOtpSms(phoneNumber: string, code: string): Promise<void> {
  const suffix = fixedOtpEnabled() ? '  (FIXED TEST CODE — AUTH_FIXED_OTP is on)' : '';
  console.log(`[OTP] Would SMS ${phoneNumber}: your login code is ${code}${suffix}`);
}
