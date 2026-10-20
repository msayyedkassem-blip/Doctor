import { q, insert, update } from '../db.js';
import { runtime } from './runtime.js';
import { unauthorized, forbidden } from './errors.js';
import { randomToken, sha256Hex, hashPassword, verifyPassword, needsRehash } from './crypto.js';

export const COOKIE_NAME = 'clinic_session';

export { hashPassword, verifyPassword, needsRehash };

const tokenHash = (token) => sha256Hex(token);

export async function createSession(userId, userAgent) {
  const token = randomToken();
  const now = new Date();
  const expires = new Date(now.getTime() + runtime.sessionDays * 86400_000);
  insert('sessions', {
    token_hash: await tokenHash(token),
    user_id: userId,
    created_at: now.toISOString(),
    expires_at: expires.toISOString(),
    last_seen: now.toISOString(),
    user_agent: (userAgent || '').slice(0, 250),
  });
  return { token, expires };
}

export async function destroySession(token) {
  if (token) q.run('DELETE FROM sessions WHERE token_hash = ?', await tokenHash(token));
}

export async function userFromToken(token) {
  if (!token) return null;
  const row = q.get(
    `SELECT s.token_hash, s.expires_at, u.id, u.name, u.email, u.role, u.color, u.active
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`,
    await tokenHash(token),
  );
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    q.run('DELETE FROM sessions WHERE token_hash = ?', row.token_hash);
    return null;
  }
  if (!row.active) return null;

  // A device in daily use should never be asked to sign in again. Without
  // this the window runs from the day of sign-in, so a receptionist's phone
  // logs itself out every week however often it is used — which reads, quite
  // reasonably, as the account not staying open on that phone.
  //
  // The write is skipped while the session is young, so the common request
  // costs one UPDATE of last_seen rather than two of the row.
  const now = new Date();
  const full = runtime.sessionDays * 86400_000;
  const remaining = new Date(row.expires_at) - now;
  const fields = { last_seen: now.toISOString() };
  if (remaining < full - 86400_000) {
    fields.expires_at = new Date(now.getTime() + full).toISOString();
  }
  const columns = Object.keys(fields);
  q.run(
    `UPDATE sessions SET ${columns.map((c) => `${c} = ?`).join(', ')} WHERE token_hash = ?`,
    ...columns.map((c) => fields[c]), row.token_hash,
  );
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    color: row.color,
    // Set only when the window moved, so the caller knows to tell the browser
    // too: a cookie that expires on its original date would sign the device
    // out regardless of what the server now thinks.
    renewedUntil: fields.expires_at ? new Date(fields.expires_at) : null,
  };
}

export function purgeExpiredSessions() {
  q.run('DELETE FROM sessions WHERE expires_at < ?', new Date().toISOString());
}

export function sessionCookie(token, expires) {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Expires=${expires.toUTCString()}`,
  ];
  if (runtime.secureCookies) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

/**
 * Permission matrix. A permission is `<resource>:<action>`; '*' means every
 * action on that resource. Roles mirror how a small clinic actually divides
 * work, so a receptionist can run the desk without touching clinical records.
 */
const PERMISSIONS = {
  admin: ['*'],
  dentist: [
    'patients:*', 'appointments:*', 'clinical:*', 'treatments:*',
    'procedures:read', 'invoices:read', 'payments:read', 'reports:read', 'users:read',
    'messages:read', 'messages:write', 'stock:*',
  ],
  receptionist: [
    'patients:*', 'appointments:*', 'clinical:read', 'treatments:read',
    'procedures:read', 'invoices:*', 'payments:*', 'expenses:read',
    'reports:read', 'users:read', 'messages:read', 'messages:write', 'stock:*',
  ],
  accountant: [
    'patients:read', 'appointments:read', 'treatments:read', 'procedures:read',
    'invoices:*', 'payments:*', 'expenses:*', 'reports:*', 'users:read',
    'messages:read', 'messages:write', 'stock:read',
  ],
};

export function can(user, permission) {
  if (!user) return false;
  const granted = PERMISSIONS[user.role] || [];
  if (granted.includes('*')) return true;
  const [resource] = permission.split(':');
  return granted.includes(permission) || granted.includes(`${resource}:*`);
}

export function requireAuth(user) {
  if (!user) throw unauthorized();
  return user;
}

export function requirePermission(user, permission) {
  requireAuth(user);
  if (!can(user, permission)) throw forbidden(`Your role (${user.role}) cannot ${permission}`);
  return user;
}

export function permissionsFor(role) {
  return PERMISSIONS[role] || [];
}
