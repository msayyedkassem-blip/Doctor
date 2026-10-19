/**
 * The clinic's store cupboard.
 *
 * The count is never edited directly. Every change is a movement with a
 * reason — received, used, wasted, expired, counted — and the item's quantity
 * follows from them. A number somebody can simply overwrite is a number
 * nobody trusts by the end of the month.
 */
import { q, insert, update, tx } from '../db.js';
import { json } from '../lib/http.js';
import { requirePermission } from '../lib/auth.js';
import { badRequest, notFound } from '../lib/errors.js';
import { str, int, num } from '../lib/validate.js';
import { logAction } from '../lib/audit.js';

const REASONS = ['received', 'used', 'wasted', 'expired', 'counted'];

/**
 * Running low, or already out.
 *
 * `min_quantity` of zero means nobody has said what "enough" is, so the item
 * is only flagged when it reaches nothing at all.
 */
const LOW = `(CASE WHEN min_quantity > 0 THEN quantity <= min_quantity
                   ELSE quantity <= 0 END)`;

export default function register(router) {
  router.get('/api/stock', async (ctx) => {
    requirePermission(ctx.user, 'stock:read');
    const low = ctx.query.get('low') === '1';
    const includeInactive = ctx.query.get('all') === '1';
    const search = (ctx.query.get('q') || '').trim();

    const where = [];
    const params = [];
    if (!includeInactive) where.push('active = 1');
    if (low) where.push(LOW);
    if (search) {
      where.push('(name LIKE ? OR category LIKE ? OR supplier LIKE ? OR barcode LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const items = q.all(
      `SELECT *, ${LOW} AS low FROM stock_items ${clause}
        ORDER BY ${LOW} DESC, category, name`, ...params);

    json(ctx.res, 200, {
      items,
      summary: {
        total: q.get('SELECT COUNT(*) AS n FROM stock_items WHERE active = 1').n,
        low: q.get(`SELECT COUNT(*) AS n FROM stock_items WHERE active = 1 AND ${LOW}`).n,
        value_cents: Math.round(q.get(
          `SELECT COALESCE(SUM(quantity * unit_cost_cents), 0) AS v
             FROM stock_items WHERE active = 1`).v),
      },
      categories: q.all(
        'SELECT DISTINCT category FROM stock_items ORDER BY category').map((r) => r.category),
    });
  });

  /** What is running out, for whoever is going to the supplier. */
  router.get('/api/stock/shopping-list', async (ctx) => {
    requirePermission(ctx.user, 'stock:read');
    const items = q.all(
      `SELECT id, name, category, unit, quantity, min_quantity, supplier, unit_cost_cents
         FROM stock_items WHERE active = 1 AND ${LOW} ORDER BY supplier, category, name`);
    json(ctx.res, 200, {
      items: items.map((item) => ({
        ...item,
        // Enough to get back to the minimum, rounded up to a whole unit.
        suggested: Math.max(1, Math.ceil((item.min_quantity || 1) - item.quantity)),
      })),
    });
  });

  router.get('/api/stock/:id', async (ctx) => {
    requirePermission(ctx.user, 'stock:read');
    const item = q.get(`SELECT *, ${LOW} AS low FROM stock_items WHERE id = ?`,
      Number(ctx.params.id));
    if (!item) throw notFound('No such item');
    json(ctx.res, 200, {
      item,
      moves: q.all(
        `SELECT m.*, u.name AS by_name FROM stock_moves m
           LEFT JOIN users u ON u.id = m.created_by
          WHERE m.item_id = ? ORDER BY m.created_at DESC, m.id DESC LIMIT 100`, item.id),
    });
  });

  router.post('/api/stock', async (ctx) => {
    requirePermission(ctx.user, 'stock:write');
    const now = new Date().toISOString();
    const quantity = num(ctx.body, 'quantity', { min: 0, fallback: 0 });
    const id = tx(() => {
      const made = insert('stock_items', { ...fields(ctx.body), quantity: 0,
        created_at: now, updated_at: now });
      // An opening count is a movement like any other, so the history starts
      // where the cupboard does rather than with an unexplained number.
      if (quantity) {
        insert('stock_moves', {
          item_id: made, change: quantity, reason: 'counted',
          note: 'Opening count', created_by: ctx.user.id, created_at: now,
        });
        update('stock_items', made, { quantity, updated_at: now });
      }
      return made;
    });
    logAction(ctx.user, 'create', 'stock_item', id);
    json(ctx.res, 201, { item: q.get('SELECT * FROM stock_items WHERE id = ?', id) });
  });

  router.put('/api/stock/:id', async (ctx) => {
    requirePermission(ctx.user, 'stock:write');
    const item = q.get('SELECT id FROM stock_items WHERE id = ?', Number(ctx.params.id));
    if (!item) throw notFound('No such item');
    update('stock_items', item.id, { ...fields(ctx.body), updated_at: new Date().toISOString() });
    json(ctx.res, 200, { item: q.get(`SELECT *, ${LOW} AS low FROM stock_items WHERE id = ?`, item.id) });
  });

  /**
   * A delivery, a use, a breakage, or a recount.
   *
   * `counted` is the odd one: the number given is what is actually on the
   * shelf, so the movement recorded is the difference. Everything else is the
   * change itself.
   */
  router.post('/api/stock/:id/move', async (ctx) => {
    requirePermission(ctx.user, 'stock:write');
    const item = q.get('SELECT * FROM stock_items WHERE id = ?', Number(ctx.params.id));
    if (!item) throw notFound('No such item');

    const reason = str(ctx.body, 'reason', { max: 10 }) || 'used';
    if (!REASONS.includes(reason)) throw badRequest('That is not a reason for a change');

    const amount = num(ctx.body, 'amount', { required: true });
    if (!Number.isFinite(amount)) throw badRequest('Enter a number');

    let change;
    if (reason === 'counted') change = amount - item.quantity;
    else if (reason === 'received') change = Math.abs(amount);
    else change = -Math.abs(amount);
    if (!change) throw badRequest('That would not change anything');

    const now = new Date().toISOString();
    const quantity = Math.round((item.quantity + change) * 1000) / 1000;
    if (quantity < 0) throw badRequest('There is not that much to take');

    tx(() => {
      insert('stock_moves', {
        item_id: item.id, change, reason,
        note: str(ctx.body, 'note', { max: 200 }),
        created_by: ctx.user.id, created_at: now,
      });
      update('stock_items', item.id, { quantity, updated_at: now });
    });
    logAction(ctx.user, reason, 'stock_item', item.id, { change });
    json(ctx.res, 200, {
      item: q.get(`SELECT *, ${LOW} AS low FROM stock_items WHERE id = ?`, item.id),
    });
  });

  /** Retired, not deleted: what was used last year still happened. */
  router.delete('/api/stock/:id', async (ctx) => {
    requirePermission(ctx.user, 'stock:write');
    const item = q.get('SELECT id FROM stock_items WHERE id = ?', Number(ctx.params.id));
    if (!item) throw notFound('No such item');
    update('stock_items', item.id, { active: 0, updated_at: new Date().toISOString() });
    logAction(ctx.user, 'retire', 'stock_item', item.id);
    json(ctx.res, 200, { ok: true });
  });
}

function fields(body) {
  return {
    name: str(body, 'name', { required: true, max: 120 }),
    category: str(body, 'category', { max: 60 }) || 'General',
    unit: str(body, 'unit', { max: 20 }) || 'piece',
    min_quantity: num(body, 'min_quantity', { min: 0, fallback: 0 }),
    unit_cost_cents: int(body, 'unit_cost_cents', { min: 0, fallback: 0 }),
    supplier: str(body, 'supplier', { max: 120 }),
    barcode: str(body, 'barcode', { max: 60 }),
    expires_on: str(body, 'expires_on', { max: 10 }) || null,
    notes: str(body, 'notes', { max: 500 }),
    active: body.active === undefined ? 1 : (body.active ? 1 : 0),
  };
}
