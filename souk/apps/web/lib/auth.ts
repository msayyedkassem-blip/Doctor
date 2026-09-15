import 'server-only';
import { cookies } from 'next/headers';
import {
  createHmac, randomBytes, scryptSync, timingSafeEqual,
} from 'node:crypto';

/**
 * Admin authentication.
 *
 * One operator, one password. No user table: a single shared secret held by
 * the hosting platform is both simpler to operate and a smaller attack
 * surface than a half-maintained account system for a one-person business.
 *
 * The password is stored as a scrypt hash (ADMIN_PASSWORD_HASH), so leaking
 * the environment does not leak the password itself. Generate one with:
 *
 *   pnpm --filter @souk/web hash-password 'your password'
 *
 * The hash fields are separated by ':' rather than the conventional '$'.
 * Dotenv-style loaders — including Next's own, and the environment editors of
 * most hosting platforms — perform variable expansion, so a '$' inside the
 * value is silently eaten and the hash arrives truncated. ':' has no such
 * meaning anywhere in that chain.
 */

const SESSION_COOKIE = 'souk_admin';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

/* ------------------------------------------------------------------ */
/* Password hashing                                                    */
/* ------------------------------------------------------------------ */

const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt:${salt.toString('hex')}:${key.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, keyHex] = stored.split(':');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;

  const expected = Buffer.from(keyHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  // Constant-time: a length check first, since timingSafeEqual throws on mismatch.
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/* ------------------------------------------------------------------ */
/* Session cookie                                                      */
/* ------------------------------------------------------------------ */

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new Error('SESSION_SECRET manquant ou trop court (32 caractères minimum).');
  }
  return value;
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

/** Token is `expiry.signature`; the signature covers the expiry. */
function issueToken(): string {
  const payload = String(Date.now() + SESSION_TTL_MS);
  return `${payload}.${sign(payload)}`;
}

function isTokenValid(token: string | undefined): boolean {
  if (!token) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;

  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;

  const expiry = Number(payload);
  return Number.isFinite(expiry) && expiry > Date.now();
}

export async function startSession(): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, issueToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_MS / 1000,
    path: '/',
  });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function isAuthenticated(): Promise<boolean> {
  return isTokenValid((await cookies()).get(SESSION_COOKIE)?.value);
}

/* ------------------------------------------------------------------ */
/* Login attempts                                                      */
/* ------------------------------------------------------------------ */

/**
 * Crude in-process throttle. Enough to make online guessing impractical for
 * a single-instance deployment; it resets on redeploy, which is acceptable
 * given the password is long and machine-generated.
 */
const attempts = new Map<string, { count: number; until: number }>();
const MAX_ATTEMPTS = 8;
const LOCKOUT_MS = 1000 * 60 * 10;

export function isLockedOut(key: string): boolean {
  const entry = attempts.get(key);
  return entry !== undefined && entry.count >= MAX_ATTEMPTS && entry.until > Date.now();
}

export function recordFailure(key: string): void {
  const entry = attempts.get(key) ?? { count: 0, until: 0 };
  entry.count += 1;
  entry.until = Date.now() + LOCKOUT_MS;
  attempts.set(key, entry);
}

export function clearFailures(key: string): void {
  attempts.delete(key);
}

export function adminPasswordHash(): string | null {
  return process.env.ADMIN_PASSWORD_HASH ?? null;
}
