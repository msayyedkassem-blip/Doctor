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
    json(ctx.res, 200, { user: ctx.user, permissions: permissionsFor(ctx.user.role) });
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

export function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, color: u.color, active: !!u.active };
}
