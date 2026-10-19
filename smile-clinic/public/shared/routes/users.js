import { q, insert, update } from '../db.js';
import { json } from '../lib/http.js';
import { requirePermission, hashPassword } from '../lib/auth.js';
import { str, email, oneOf, bool } from '../lib/validate.js';
import { badRequest, notFound, conflict } from '../lib/errors.js';
import { logAction } from '../lib/audit.js';
import { publicUser } from './auth.js';

const ROLES = ['admin', 'dentist', 'receptionist', 'accountant'];

export default function register(router) {
  router.get('/api/users', async (ctx) => {
    requirePermission(ctx.user, 'users:read');
    const includeInactive = ctx.query.get('include_inactive') === '1';
    const rows = q.all(
      `SELECT * FROM users ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY name`,
    );
    json(ctx.res, 200, { users: rows.map(publicUser) });
  });

  router.post('/api/users', async (ctx) => {
    requirePermission(ctx.user, 'users:write');
    const data = await readUser(ctx.body, { requirePassword: true });
    if (q.get('SELECT id FROM users WHERE email = ?', data.email)) {
      throw conflict('A user with that email already exists');
    }
    const now = new Date().toISOString();
    const id = insert('users', { ...data, created_at: now, updated_at: now });
    logAction(ctx.user, 'create', 'user', id, { email: data.email, role: data.role });
    json(ctx.res, 201, { user: publicUser(q.get('SELECT * FROM users WHERE id = ?', id)) });
  });

  router.put('/api/users/:id', async (ctx) => {
    requirePermission(ctx.user, 'users:write');
    const id = Number(ctx.params.id);
    const existing = q.get('SELECT * FROM users WHERE id = ?', id);
    if (!existing) throw notFound('User not found');

    const data = await readUser(ctx.body, { requirePassword: false });
    if (data.email !== existing.email && q.get('SELECT id FROM users WHERE email = ?', data.email)) {
      throw conflict('A user with that email already exists');
    }
    // Never let the last active admin lock everybody out of the clinic.
    if (existing.role === 'admin' && (data.role !== 'admin' || data.active === 0)) {
      const admins = q.get(
        'SELECT COUNT(*) AS n FROM users WHERE role = ? AND active = 1 AND id != ?', 'admin', id,
      ).n;
      if (admins === 0) throw badRequest('This is the last active administrator');
    }
    update('users', id, { ...data, updated_at: new Date().toISOString() });
    if (data.active === 0) q.run('DELETE FROM sessions WHERE user_id = ?', id);
    logAction(ctx.user, 'update', 'user', id);
    json(ctx.res, 200, { user: publicUser(q.get('SELECT * FROM users WHERE id = ?', id)) });
  });

  router.post('/api/users/:id/password', async (ctx) => {
    requirePermission(ctx.user, 'users:write');
    const id = Number(ctx.params.id);
    if (!q.get('SELECT id FROM users WHERE id = ?', id)) throw notFound('User not found');
    const next = str(ctx.body, 'new_password', { required: true, min: 8, max: 200 });
    update('users', id, {
      password_hash: await hashPassword(next),
      updated_at: new Date().toISOString(),
    });
    q.run('DELETE FROM sessions WHERE user_id = ?', id);
    logAction(ctx.user, 'password_reset', 'user', id);
    json(ctx.res, 200, { ok: true });
  });
}

async function readUser(body, { requirePassword }) {
  const data = {
    name: str(body, 'name', { required: true, max: 120 }),
    email: email(body, 'email', { required: true }),
    role: oneOf(body, 'role', ROLES, { required: true }),
    color: str(body, 'color', { max: 20, fallback: '#2f7d8c' }),
    phone: str(body, 'phone', { max: 40 }),
    active: bool(body, 'active', true) ? 1 : 0,
  };
  const password = str(body, 'password', { required: requirePassword, min: 8, max: 200 });
  if (password) data.password_hash = await hashPassword(password);
  return data;
}
