import { q, insert, update, tx } from '../db.js';
import { json } from '../lib/http.js';
import { requirePermission } from '../lib/auth.js';
import { str, int, money, oneOf, date } from '../lib/validate.js';
import { notFound, badRequest } from '../lib/errors.js';
import { logAction } from '../lib/audit.js';
import { statusFromBalance } from '../lib/money.js';
import { paidOn } from './invoices.js';

const METHODS = ['cash', 'card', 'transfer', 'insurance', 'cheque', 'online', 'other'];

const SELECT_PAYMENT = `
  SELECT p.*, i.number AS invoice_number, i.total_cents AS invoice_total_cents,
         pa.first_name || ' ' || pa.last_name AS patient_name, pa.code AS patient_code,
         u.name AS created_by_name
    FROM payments p
    JOIN patients pa ON pa.id = p.patient_id
    LEFT JOIN invoices i ON i.id = p.invoice_id
    LEFT JOIN users u ON u.id = p.created_by`;

export default function register(router) {
  router.get('/api/payments', async (ctx) => {
    requirePermission(ctx.user, 'payments:read');
    const where = [];
    const params = [];
    const from = ctx.query.get('from');
    const to = ctx.query.get('to');
    const patientId = ctx.query.get('patient_id');
    const method = ctx.query.get('method');
    if (from) { where.push('p.paid_at >= ?'); params.push(from); }
    if (to) { where.push('p.paid_at <= ?'); params.push(to); }
    if (patientId) { where.push('p.patient_id = ?'); params.push(Number(patientId)); }
    if (method) { where.push('p.method = ?'); params.push(method); }

    const rows = q.all(
      `${SELECT_PAYMENT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY p.paid_at DESC, p.id DESC LIMIT 1000`, ...params,
    );
    const net = rows.reduce(
      (s, r) => s + (r.direction === 'refund' ? -r.amount_cents : r.amount_cents), 0);
    json(ctx.res, 200, { payments: rows, total_cents: net });
  });

  router.post('/api/payments', async (ctx) => {
    requirePermission(ctx.user, 'payments:write');
    const body = ctx.body;
    const amount = money(body, 'amount', { required: true });
    if (amount <= 0) throw badRequest('The amount must be greater than zero');

    const direction = oneOf(body, 'direction', ['in', 'refund'], { fallback: 'in' });
    const invoiceId = int(body, 'invoice_id');
    let patientId = int(body, 'patient_id');
    let invoice = null;

    if (invoiceId) {
      invoice = q.get('SELECT * FROM invoices WHERE id = ?', invoiceId);
      if (!invoice) throw notFound('Invoice not found');
      if (invoice.status === 'void') throw badRequest('That invoice is void');
      if (invoice.status === 'draft') throw badRequest('Issue the invoice before taking payment');
      patientId = invoice.patient_id;

      const alreadyPaid = paidOn(invoiceId);
      if (direction === 'in' && alreadyPaid + amount > invoice.total_cents) {
        throw badRequest(
          `That is more than the invoice still owes ` +
          `(${((invoice.total_cents - alreadyPaid) / 100).toFixed(2)} remaining)`,
        );
      }
      if (direction === 'refund' && amount > alreadyPaid) {
        throw badRequest('You cannot refund more than was paid on this invoice');
      }
    }

    if (!patientId) throw badRequest('Either patient_id or invoice_id is required');
    if (!q.get('SELECT id FROM patients WHERE id = ?', patientId)) throw notFound('Patient not found');

    const row = {
      patient_id: patientId,
      invoice_id: invoiceId,
      amount_cents: amount,
      method: oneOf(body, 'method', METHODS, { fallback: 'cash' }),
      direction,
      reference: str(body, 'reference', { max: 120 }),
      paid_at: date(body, 'paid_at', { fallback: new Date().toISOString().slice(0, 10) }),
      notes: str(body, 'notes', { max: 1000 }),
      created_by: ctx.user.id,
      created_at: new Date().toISOString(),
    };

    const id = tx(() => {
      const paymentId = insert('payments', row);
      if (invoice) syncInvoiceStatus(invoice.id);
      return paymentId;
    });

    logAction(ctx.user, direction === 'refund' ? 'refund' : 'payment', 'payment', id, {
      amount, invoice_id: invoiceId, patient_id: patientId,
    });
    json(ctx.res, 201, { payment: q.get(`${SELECT_PAYMENT} WHERE p.id = ?`, id) });
  });

  /**
   * Deleting a receipt is a correction, not a refund: it is restricted, audited
   * and leaves the invoice status recomputed.
   */
  router.delete('/api/payments/:id', async (ctx) => {
    requirePermission(ctx.user, 'payments:delete');
    const id = Number(ctx.params.id);
    const payment = q.get('SELECT * FROM payments WHERE id = ?', id);
    if (!payment) throw notFound('Payment not found');

    tx(() => {
      q.run('DELETE FROM payments WHERE id = ?', id);
      if (payment.invoice_id) syncInvoiceStatus(payment.invoice_id);
    });
    logAction(ctx.user, 'delete', 'payment', id, {
      amount: payment.amount_cents, invoice_id: payment.invoice_id,
    });
    json(ctx.res, 200, { ok: true });
  });
}

/** Recompute issued/partial/paid from what is actually on the invoice. */
export function syncInvoiceStatus(invoiceId) {
  const invoice = q.get('SELECT * FROM invoices WHERE id = ?', invoiceId);
  if (!invoice || invoice.status === 'void' || invoice.status === 'draft') return;
  const paid = paidOn(invoiceId);
  update('invoices', invoiceId, {
    status: statusFromBalance(invoice.total_cents, paid, invoice.status),
    updated_at: new Date().toISOString(),
  });
}
