import { q, insert, update } from '../db.js';
import { json } from '../lib/http.js';
import { requirePermission } from '../lib/auth.js';
import { str, int, money, bool } from '../lib/validate.js';
import { notFound, conflict } from '../lib/errors.js';
import { logAction } from '../lib/audit.js';

export default function register(router) {
  router.get('/api/procedures', async (ctx) => {
    requirePermission(ctx.user, 'procedures:read');
    const includeInactive = ctx.query.get('include_inactive') === '1';
    const rows = q.all(
      `SELECT * FROM procedures ${includeInactive ? '' : 'WHERE active = 1'}
        ORDER BY category, name`,
    );
    json(ctx.res, 200, { procedures: rows });
  });

  router.post('/api/procedures', async (ctx) => {
    requirePermission(ctx.user, 'procedures:write');
    const data = readProcedure(ctx.body);
    if (q.get('SELECT id FROM procedures WHERE code = ?', data.code)) {
      throw conflict('A procedure with that code already exists');
    }
    const now = new Date().toISOString();
    const id = insert('procedures', { ...data, created_at: now, updated_at: now });
    logAction(ctx.user, 'create', 'procedure', id, { code: data.code });
    json(ctx.res, 201, { procedure: q.get('SELECT * FROM procedures WHERE id = ?', id) });
  });

  router.put('/api/procedures/:id', async (ctx) => {
    requirePermission(ctx.user, 'procedures:write');
    const id = Number(ctx.params.id);
    const existing = q.get('SELECT * FROM procedures WHERE id = ?', id);
    if (!existing) throw notFound('Procedure not found');

    const data = readProcedure(ctx.body);
    if (data.code !== existing.code && q.get('SELECT id FROM procedures WHERE code = ?', data.code)) {
      throw conflict('A procedure with that code already exists');
    }
    update('procedures', id, { ...data, updated_at: new Date().toISOString() });
    logAction(ctx.user, 'update', 'procedure', id);
    json(ctx.res, 200, { procedure: q.get('SELECT * FROM procedures WHERE id = ?', id) });
  });

  router.delete('/api/procedures/:id', async (ctx) => {
    requirePermission(ctx.user, 'procedures:write');
    const id = Number(ctx.params.id);
    if (!q.get('SELECT id FROM procedures WHERE id = ?', id)) throw notFound('Procedure not found');
    // Prices are referenced by history, so retire rather than delete.
    update('procedures', id, { active: 0, updated_at: new Date().toISOString() });
    logAction(ctx.user, 'retire', 'procedure', id);
    json(ctx.res, 200, { ok: true });
  });
}

function readProcedure(body) {
  const taxRate = int(body, 'tax_rate_bp', { fallback: 0, min: 0, max: 10000 });
  return {
    code: str(body, 'code', { required: true, max: 20 }).toUpperCase(),
    name: str(body, 'name', { required: true, max: 160 }),
    category: str(body, 'category', { max: 60, fallback: 'General' }),
    default_price_cents: money(body, 'default_price', { fallback: 0 }),
    default_duration_min: int(body, 'default_duration_min', { fallback: 30, min: 5, max: 600 }),
    tax_rate_bp: taxRate,
    tooth_specific: bool(body, 'tooth_specific', false) ? 1 : 0,
    active: bool(body, 'active', true) ? 1 : 0,
  };
}
