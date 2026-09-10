import { randomInt } from 'crypto';
import * as bcrypt from 'bcrypt';

const OTP_HASH_ROUNDS = 8;
export const OTP_TTL_MS = 5 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;

/** Random 6-digit numeric code, CSPRNG-backed (crypto.randomInt, not
 *  Math.random) — same standard as generateTempPassword. */
export function generateOtpCode(): string {
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
  console.log(`[OTP] Would SMS ${phoneNumber}: your login code is ${code}`);
}
