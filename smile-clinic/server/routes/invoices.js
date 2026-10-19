import { q, insert, update, tx } from '../db.js';
import { json } from '../lib/http.js';
import { requirePermission } from '../lib/auth.js';
import { str, int, money, oneOf, date } from '../lib/validate.js';
import { notFound, badRequest } from '../lib/errors.js';
import { logAction } from '../lib/audit.js';
import { lineTotal, invoiceTotals, statusFromBalance } from '../lib/money.js';
import { allSettings } from './settings.js';
import { deviceCode } from '../lib/sync-core.js';

const SELECT_INVOICE = `
  SELECT i.*,
         p.first_name || ' ' || p.last_name AS patient_name,
         p.code AS patient_code, p.phone AS patient_phone,
         p.address AS patient_address, p.email AS patient_email,
         u.name AS created_by_name,
         (SELECT COALESCE(SUM(CASE WHEN direction = 'refund' THEN -amount_cents
                                   ELSE amount_cents END), 0)
            FROM payments WHERE invoice_id = i.id) AS paid_cents
    FROM invoices i
    JOIN patients p ON p.id = i.patient_id
    LEFT JOIN users u ON u.id = i.created_by`;

export default function register(router) {
  router.get('/api/invoices', async (ctx) => {
    requirePermission(ctx.user, 'invoices:read');
    const where = [];
    const params = [];
    const patientId = ctx.query.get('patient_id');
    const status = ctx.query.get('status');
    const from = ctx.query.get('from');
    const to = ctx.query.get('to');
    const search = (ctx.query.get('q') || '').trim();
    const unpaidOnly = ctx.query.get('unpaid') === '1';

    if (patientId) { where.push('i.patient_id = ?'); params.push(Number(patientId)); }
    if (status) { where.push('i.status = ?'); params.push(status); }
    if (from) { where.push('i.issued_at >= ?'); params.push(from); }
    if (to) { where.push('i.issued_at <= ?'); params.push(to); }
    if (unpaidOnly) where.push(`i.status IN ('issued','partial')`);
    if (search) {
      where.push(`(i.number LIKE ? OR p.first_name || ' ' || p.last_name LIKE ? OR p.code LIKE ?)`);
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const rows = q.all(
      `${SELECT_INVOICE} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY i.issued_at DESC, i.id DESC LIMIT 500`, ...params,
    );
    json(ctx.res, 200, {
      invoices: rows,
      totals: {
        billed_cents: rows.filter((r) => r.status !== 'void' && r.status !== 'draft')
          .reduce((s, r) => s + r.total_cents, 0),
        paid_cents: rows.reduce((s, r) => s + r.paid_cents, 0),
        outstanding_cents: rows.filter((r) => ['issued', 'partial'].includes(r.status))
          .reduce((s, r) => s + (r.total_cents - r.paid_cents), 0),
      },
    });
  });

  router.get('/api/invoices/:id', async (ctx) => {
    requirePermission(ctx.user, 'invoices:read');
    const invoice = q.get(`${SELECT_INVOICE} WHERE i.id = ?`, Number(ctx.params.id));
    if (!invoice) throw notFound('Invoice not found');
    json(ctx.res, 200, {
      invoice,
      items: q.all('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY position, id', invoice.id),
      payments: q.all(
        `SELECT p.*, u.name AS created_by_name FROM payments p
           LEFT JOIN users u ON u.id = p.created_by
          WHERE p.invoice_id = ? ORDER BY p.paid_at, p.id`, invoice.id),
      settings: allSettings(),
    });
  });

  router.post('/api/invoices', async (ctx) => {
    requirePermission(ctx.user, 'invoices:write');
    const body = ctx.body;
    const patientId = int(body, 'patient_id', { required: true, min: 1 });
    if (!q.get('SELECT id FROM patients WHERE id = ?', patientId)) throw notFound('Patient not found');

    const items = readItems(body.items, patientId);
    if (!items.length) throw badRequest('An invoice needs at least one line');

    const issuedAt = date(body, 'issued_at', { fallback: today() });
    const dueAt = date(body, 'due_at');
    const status = oneOf(body, 'status', ['draft', 'issued'], { fallback: 'issued' });
    const discount = money(body, 'discount', { fallback: 0 });
    const totals = invoiceTotals(items, discount);
    const now = new Date().toISOString();

    const id = tx(() => {
      const invoiceId = insert('invoices', {
        number: nextInvoiceNumber(issuedAt),
        patient_id: patientId,
        issued_at: issuedAt,
        due_at: dueAt,
        status,
        ...totals,
        notes: str(body, 'notes', { max: 2000 }),
        created_by: ctx.user.id,
        created_at: now,
        updated_at: now,
      });
      items.forEach((item, index) => {
        insert('invoice_items', { ...item, invoice_id: invoiceId, position: index });
        if (item.treatment_id) {
          update('treatments', item.treatment_id, { invoiced: 1, updated_at: now });
        }
      });
      return invoiceId;
    });

    logAction(ctx.user, 'create', 'invoice', id, { patient_id: patientId, total: totals.total_cents });
    json(ctx.res, 201, { invoice: q.get(`${SELECT_INVOICE} WHERE i.id = ?`, id) });
  });

  router.put('/api/invoices/:id', async (ctx) => {
    requirePermission(ctx.user, 'invoices:write');
    const id = Number(ctx.params.id);
    const existing = q.get('SELECT * FROM invoices WHERE id = ?', id);
    if (!existing) throw notFound('Invoice not found');
    if (existing.status === 'void') throw badRequest('A voided invoice cannot be edited');
    if (existing.status === 'paid') throw badRequest('A fully paid invoice cannot be edited');

    const items = readItems(ctx.body.items, existing.patient_id);
    if (!items.length) throw badRequest('An invoice needs at least one line');
    const discount = money(ctx.body, 'discount', { fallback: 0 });
    const totals = invoiceTotals(items, discount);
    const now = new Date().toISOString();
    const paid = paidOn(id);

    tx(() => {
      // Release treatments from the old lines before attaching the new ones.
      const oldItems = q.all('SELECT treatment_id FROM invoice_items WHERE invoice_id = ?', id);
      for (const old of oldItems) {
        if (old.treatment_id) update('treatments', old.treatment_id, { invoiced: 0, updated_at: now });
      }
      q.run('DELETE FROM invoice_items WHERE invoice_id = ?', id);
      items.forEach((item, index) => {
        insert('invoice_items', { ...item, invoice_id: id, position: index });
        if (item.treatment_id) update('treatments', item.treatment_id, { invoiced: 1, updated_at: now });
      });
      update('invoices', id, {
        ...totals,
        issued_at: date(ctx.body, 'issued_at', { fallback: existing.issued_at }),
        due_at: date(ctx.body, 'due_at', { fallback: existing.due_at }),
        notes: str(ctx.body, 'notes', { max: 2000 }),
        status: statusFromBalance(totals.total_cents, paid, existing.status),
        updated_at: now,
      });
    });

    logAction(ctx.user, 'update', 'invoice', id);
    json(ctx.res, 200, { invoice: q.get(`${SELECT_INVOICE} WHERE i.id = ?`, id) });
  });

  /** Move a draft to issued so it counts as receivable. */
  router.post('/api/invoices/:id/issue', async (ctx) => {
    requirePermission(ctx.user, 'invoices:write');
    const id = Number(ctx.params.id);
    const invoice = q.get('SELECT * FROM invoices WHERE id = ?', id);
    if (!invoice) throw notFound('Invoice not found');
    if (invoice.status !== 'draft') throw badRequest('Only a draft invoice can be issued');
    update('invoices', id, {
      status: statusFromBalance(invoice.total_cents, paidOn(id), 'issued'),
      issued_at: date(ctx.body, 'issued_at', { fallback: invoice.issued_at }),
      updated_at: new Date().toISOString(),
    });
    logAction(ctx.user, 'issue', 'invoice', id);
    json(ctx.res, 200, { invoice: q.get(`${SELECT_INVOICE} WHERE i.id = ?`, id) });
  });

  /** Void keeps the number in the ledger — invoices are never deleted. */
  router.post('/api/invoices/:id/void', async (ctx) => {
    requirePermission(ctx.user, 'invoices:void');
    const id = Number(ctx.params.id);
    const invoice = q.get('SELECT * FROM invoices WHERE id = ?', id);
    if (!invoice) throw notFound('Invoice not found');
    if (invoice.status === 'void') throw badRequest('This invoice is already void');
    if (paidOn(id) !== 0) {
      throw badRequest('Refund the payments on this invoice before voiding it');
    }
    const reason = str(ctx.body, 'reason', { required: true, max: 300 });
    const now = new Date().toISOString();
    tx(() => {
      const items = q.all('SELECT treatment_id FROM invoice_items WHERE invoice_id = ?', id);
      for (const item of items) {
        if (item.treatment_id) update('treatments', item.treatment_id, { invoiced: 0, updated_at: now });
      }
      update('invoices', id, { status: 'void', void_reason: reason, updated_at: now });
    });
    logAction(ctx.user, 'void', 'invoice', id, { reason });
    json(ctx.res, 200, { invoice: q.get(`${SELECT_INVOICE} WHERE i.id = ?`, id) });
  });

  /** One-click: bill every completed, not-yet-invoiced treatment for a patient. */
  router.post('/api/patients/:id/invoice-pending', async (ctx) => {
    requirePermission(ctx.user, 'invoices:write');
    const patientId = Number(ctx.params.id);
    if (!q.get('SELECT id FROM patients WHERE id = ?', patientId)) throw notFound('Patient not found');

    const pending = q.all(
      `SELECT t.*, pr.name AS procedure_name, pr.code AS procedure_code, pr.tax_rate_bp
         FROM treatments t JOIN procedures pr ON pr.id = t.procedure_id
        WHERE t.patient_id = ? AND t.invoiced = 0 AND t.status = 'completed'`, patientId);
    if (!pending.length) throw badRequest('This patient has no completed, uninvoiced treatments');

    const items = pending.map((t) => ({
      treatment_id: t.id,
      procedure_id: t.procedure_id,
      description: t.tooth ? `${t.procedure_name} — tooth ${t.tooth}` : t.procedure_name,
      tooth: t.tooth,
      quantity: 1,
      unit_price_cents: t.price_cents,
      discount_cents: t.discount_cents,
      tax_rate_bp: t.tax_rate_bp,
      line_total_cents: lineTotal({
        quantity: 1, unit_price_cents: t.price_cents, discount_cents: t.discount_cents,
      }),
    }));
    const totals = invoiceTotals(items, 0);
    const issuedAt = today();
    const now = new Date().toISOString();

    const id = tx(() => {
      const invoiceId = insert('invoices', {
        number: nextInvoiceNumber(issuedAt),
        patient_id: patientId,
        issued_at: issuedAt,
        due_at: null,
        status: 'issued',
        ...totals,
        notes: null,
        created_by: ctx.user.id,
        created_at: now,
        updated_at: now,
      });
      items.forEach((item, index) => {
        insert('invoice_items', { ...item, invoice_id: invoiceId, position: index });
        update('treatments', item.treatment_id, { invoiced: 1, updated_at: now });
      });
      return invoiceId;
    });

    logAction(ctx.user, 'create', 'invoice', id, { auto: true, treatments: pending.length });
    json(ctx.res, 201, { invoice: q.get(`${SELECT_INVOICE} WHERE i.id = ?`, id) });
  });
}

function readItems(rawItems, patientId) {
  if (!Array.isArray(rawItems)) throw badRequest('"items" must be a list of invoice lines');
  return rawItems.map((raw, index) => {
    const procedureId = int(raw, 'procedure_id');
    const procedure = procedureId ? q.get('SELECT * FROM procedures WHERE id = ?', procedureId) : null;
    if (procedureId && !procedure) throw badRequest(`Line ${index + 1}: unknown procedure`);

    const treatmentId = int(raw, 'treatment_id');
    if (treatmentId) {
      const treatment = q.get('SELECT * FROM treatments WHERE id = ?', treatmentId);
      if (!treatment) throw badRequest(`Line ${index + 1}: unknown treatment`);
      if (treatment.patient_id !== patientId) {
        throw badRequest(`Line ${index + 1}: that treatment belongs to another patient`);
      }
    }

    const quantity = int(raw, 'quantity', { fallback: 1, min: 1, max: 999 });
    const unitPrice = raw.unit_price === undefined && procedure
      ? procedure.default_price_cents
      : money(raw, 'unit_price', { fallback: 0 });
    const discount = money(raw, 'discount', { fallback: 0 });
    const taxRate = raw.tax_rate_bp === undefined && procedure
      ? procedure.tax_rate_bp
      : int(raw, 'tax_rate_bp', { fallback: 0, min: 0, max: 10000 });

    const description = str(raw, 'description', {
      max: 300, fallback: procedure ? procedure.name : null,
    });
    if (!description) throw badRequest(`Line ${index + 1}: a description is required`);
    if (discount > unitPrice * quantity) {
      throw badRequest(`Line ${index + 1}: the discount is larger than the line`);
    }

    return {
      treatment_id: treatmentId,
      procedure_id: procedureId,
      description,
      tooth: int(raw, 'tooth'),
      quantity,
      unit_price_cents: unitPrice,
      discount_cents: discount,
      tax_rate_bp: taxRate,
      line_total_cents: lineTotal({
        quantity, unit_price_cents: unitPrice, discount_cents: discount,
      }),
    };
  });
}

export function paidOn(invoiceId) {
  return q.get(
    `SELECT COALESCE(SUM(CASE WHEN direction = 'refund' THEN -amount_cents
                              ELSE amount_cents END), 0) AS n
       FROM payments WHERE invoice_id = ?`, invoiceId).n;
}

/**
 * Numbers are per-year and gap-free: INV-2026-0001.
 *
 * A synced device adds its letter — INV-2026-B-0001 — so two devices cannot
 * both issue the same invoice number. An invoice number ends up on a printed
 * receipt, so it must never have to be changed afterwards.
 */
function nextInvoiceNumber(issuedAt) {
  const settings = allSettings();
  const prefix = (settings.invoice_prefix || 'INV').toUpperCase();
  const year = issuedAt.slice(0, 4);
  const code = deviceCode();
  const stem = code ? `${prefix}-${year}-${code}-` : `${prefix}-${year}-`;
  const row = q.get(
    `SELECT number FROM invoices WHERE number GLOB ?
      ORDER BY LENGTH(number) DESC, number DESC LIMIT 1`, `${stem}[0-9]*`);
  const last = row ? Number(String(row.number).slice(stem.length)) : 0;
  return `${stem}${String((Number.isFinite(last) ? last : 0) + 1).padStart(4, '0')}`;
}

const today = () => new Date().toISOString().slice(0, 10);
