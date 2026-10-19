import { q, insert, update } from '../db.js';
import { json } from '../lib/http.js';
import { requirePermission } from '../lib/auth.js';
import { str, money, oneOf, date } from '../lib/validate.js';
import { notFound, badRequest } from '../lib/errors.js';
import { logAction } from '../lib/audit.js';

const METHODS = ['cash', 'card', 'transfer', 'cheque', 'online', 'other'];

const SELECT_EXPENSE = `
  SELECT e.*, u.name AS created_by_name
    FROM expenses e LEFT JOIN users u ON u.id = e.created_by`;

export default function register(router) {
  router.get('/api/expenses', async (ctx) => {
    requirePermission(ctx.user, 'expenses:read');
    const where = [];
    const params = [];
    const from = ctx.query.get('from');
    const to = ctx.query.get('to');
    const category = ctx.query.get('category');
    if (from) { where.push('e.spent_at >= ?'); params.push(from); }
    if (to) { where.push('e.spent_at <= ?'); params.push(to); }
    if (category) { where.push('e.category = ?'); params.push(category); }

    const rows = q.all(
      `${SELECT_EXPENSE} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY e.spent_at DESC, e.id DESC LIMIT 1000`, ...params,
    );
    json(ctx.res, 200, {
      expenses: rows,
      total_cents: rows.reduce((s, r) => s + r.amount_cents, 0),
    });
  });

  router.post('/api/expenses', async (ctx) => {
    requirePermission(ctx.user, 'expenses:write');
    const data = readExpense(ctx.body);
    const id = insert('expenses', {
      ...data, created_by: ctx.user.id, created_at: new Date().toISOString(),
    });
    logAction(ctx.user, 'create', 'expense', id, { amount: data.amount_cents });
    json(ctx.res, 201, { expense: q.get(`${SELECT_EXPENSE} WHERE e.id = ?`, id) });
  });

  router.put('/api/expenses/:id', async (ctx) => {
    requirePermission(ctx.user, 'expenses:write');
    const id = Number(ctx.params.id);
    if (!q.get('SELECT id FROM expenses WHERE id = ?', id)) throw notFound('Expense not found');
    update('expenses', id, readExpense(ctx.body));
    logAction(ctx.user, 'update', 'expense', id);
    json(ctx.res, 200, { expense: q.get(`${SELECT_EXPENSE} WHERE e.id = ?`, id) });
  });

  router.delete('/api/expenses/:id', async (ctx) => {
    requirePermission(ctx.user, 'expenses:write');
    const id = Number(ctx.params.id);
    const expense = q.get('SELECT * FROM expenses WHERE id = ?', id);
    if (!expense) throw notFound('Expense not found');
    q.run('DELETE FROM expenses WHERE id = ?', id);
    logAction(ctx.user, 'delete', 'expense', id, { amount: expense.amount_cents });
    json(ctx.res, 200, { ok: true });
  });
}

function readExpense(body) {
  const amount = money(body, 'amount', { required: true });
  if (amount <= 0) throw badRequest('The amount must be greater than zero');
  return {
    category: str(body, 'category', { max: 60, fallback: 'Other' }),
    description: str(body, 'description', { required: true, max: 300 }),
    vendor: str(body, 'vendor', { max: 160 }),
    amount_cents: amount,
    method: oneOf(body, 'method', METHODS, { fallback: 'cash' }),
    reference: str(body, 'reference', { max: 120 }),
    spent_at: date(body, 'spent_at', { fallback: new Date().toISOString().slice(0, 10) }),
    notes: str(body, 'notes', { max: 1000 }),
  };
}
