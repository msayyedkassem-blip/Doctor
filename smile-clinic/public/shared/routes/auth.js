import { q, update } from '../db.js';
import { json } from '../lib/http.js';
import {
  verifyPassword, hashPassword, createSession, destroySession,
  sessionCookie, clearCookie, permissionsFor, requireAuth, needsRehash,
} from '../lib/auth.js';
import { badRequest, unauthorized } from '../lib/errors.js';
import { str, email } from '../lib/validate.js';
import { logAction } from '../lib/audit.js';

export default function register(router) {
  router.post('/api/auth/login', async (ctx) => {
    const addr = email(ctx.body, 'email', { required: true });
    const password = str(ctx.body, 'password', { required: true, max: 200 });

    const user = q.get('SELECT * FROM users WHERE email = ?', addr);
    // Same generic message whether the email or the password was wrong.
    if (!user || !user.active || !(await verifyPassword(password, user.password_hash))) {
      logAction(null, 'login_failed', 'user', null, { email: addr });
      throw unauthorized('Email or password is incorrect');
    }

    // Quietly move an old scrypt hash to PBKDF2, which a phone can also check.
    if (needsRehash(user.password_hash)) {
      update('users', user.id, {
        password_hash: await hashPassword(password),
        updated_at: new Date().toISOString(),
      });
    }

    const { token, expires } = await createSession(user.id, ctx.req.headers['user-agent']);
    logAction(user, 'login', 'user', user.id);
    ctx.res.setHeader('Set-Cookie', sessionCookie(token, expires));
    json(ctx.res, 200, { user: publicUser(user), permissions: permissionsFor(user.role) });
  }, { public: true });

  router.post('/api/auth/logout', async (ctx) => {
    await destroySession(ctx.token);
    ctx.res.setHeader('Set-Cookie', clearCookie());
    json(ctx.res, 200, { ok: true });
  }, { public: true });

  router.get('/api/auth/me', async (ctx) => {
    requireAuth(ctx.user);
    const { id, name, email: address, role, color } = ctx.user;
    json(ctx.res, 200, {
      user: { id, name, email: address, role, color },
      permissions: permissionsFor(ctx.user.role),
    });
  });

  /**
   * Where this account is signed in.
   *
   * The same sign-in is meant to be used on the phone, the tablet and the
   * front desk at once, so the list is the answer to the other half of that:
   * when one of those devices is lost, it has to be possible to cut it off
   * without changing the password on all of them.
   */
  router.get('/api/auth/devices', async (ctx) => {
    requireAuth(ctx.user);
    const rows = q.all(
      `SELECT token_hash, created_at, last_seen, expires_at, user_agent
         FROM sessions WHERE user_id = ? ORDER BY last_seen DESC`, ctx.user.id);
    json(ctx.res, 200, {
      devices: rows.map((row) => ({
        id: row.token_hash,
        device: describeDevice(row.user_agent),
        created_at: row.created_at,
        last_seen: row.last_seen,
        expires_at: row.expires_at,
        current: row.token_hash === ctx.tokenHash,
      })),
    });
  });

  router.delete('/api/auth/devices/:id', async (ctx) => {
    requireAuth(ctx.user);
    // Scoped to this account: one person signing another out is what the
    // staff screen is for, with the permission check that goes with it.
    const removed = q.run('DELETE FROM sessions WHERE token_hash = ? AND user_id = ?',
      ctx.params.id, ctx.user.id);
    if (ctx.params.id === ctx.tokenHash) ctx.res.setHeader('Set-Cookie', clearCookie());
    logAction(ctx.user, 'device_signed_out', 'user', ctx.user.id);
    json(ctx.res, 200, { ok: true, removed: removed?.changes ?? 1 });
  });

  router.post('/api/auth/password', async (ctx) => {
    requireAuth(ctx.user);
    const current = str(ctx.body, 'current_password', { required: true, max: 200 });
    const next = str(ctx.body, 'new_password', { required: true, min: 8, max: 200 });

    const row = q.get('SELECT password_hash FROM users WHERE id = ?', ctx.user.id);
    if (!(await verifyPassword(current, row.password_hash))) {
      throw badRequest('Your current password is not correct');
    }
    update('users', ctx.user.id, {
      password_hash: await hashPassword(next),
      updated_at: new Date().toISOString(),
    });
    // Other devices are signed out; this one keeps its session.
    q.run('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?',
      ctx.user.id, ctx.tokenHash || '');
    logAction(ctx.user, 'password_changed', 'user', ctx.user.id);
    json(ctx.res, 200, { ok: true });
  });
}

/**
 * A sign-in turned into something a person recognises.
 *
 * Browsers lie to each other in user-agent strings, so this reads only what is
 * reliable enough to tell one of the clinic's own devices from another.
 */
export function describeDevice(agent) {
  const ua = String(agent || '');
  if (!ua) return 'Unknown device';
  const app = /\bclinic-app\b/i.test(ua) || /\bwv\b/.test(ua) ? ' app' : '';
  if (/iPad/i.test(ua)) return `iPad${app}`;
  if (/iPhone/i.test(ua)) return `iPhone${app}`;
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? `Android phone${app}` : `Android tablet${app}`;
  if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows PC';
  if (/Linux/i.test(ua)) return 'Linux computer';
  return 'Unknown device';
}

export function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, color: u.color, active: !!u.active };
}
