import { q } from '../db.js';
import { json, text } from '../lib/http.js';
import { requirePermission } from '../lib/auth.js';
import { badRequest } from '../lib/errors.js';

const today = () => new Date().toISOString().slice(0, 10);

function range(query) {
  const to = query.get('to') || today();
  const from = query.get('from') || `${to.slice(0, 7)}-01`;
  if (from > to) throw badRequest('The start date must come before the end date');
  return { from, to };
}

export default function register(router) {
  /** Everything the home screen shows, in one request. */
  router.get('/api/dashboard', async (ctx) => {
    requirePermission(ctx.user, 'appointments:read');
    const day = ctx.query.get('date') || today();
    const monthStart = `${day.slice(0, 7)}-01`;

    const todaysAppointments = q.all(
      `SELECT a.*, p.first_name || ' ' || p.last_name AS patient_name,
              p.code AS patient_code, p.phone AS patient_phone, p.allergies AS patient_allergies,
              u.name AS dentist_name, u.color AS dentist_color, pr.name AS procedure_name
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         JOIN users u ON u.id = a.dentist_id
         LEFT JOIN procedures pr ON pr.id = a.procedure_id
        WHERE a.starts_at >= ? AND a.starts_at <= ?
        ORDER BY a.starts_at`, `${day}T00:00`, `${day}T23:59`);

    const collected = (from, to) => q.get(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'refund' THEN -amount_cents
                                ELSE amount_cents END), 0) AS n
         FROM payments WHERE paid_at >= ? AND paid_at <= ?`, from, to).n;

    const spent = (from, to) => q.get(
      `SELECT COALESCE(SUM(amount_cents), 0) AS n FROM expenses
        WHERE spent_at >= ? AND spent_at <= ?`, from, to).n;

    const outstanding = q.get(
      `SELECT COALESCE(SUM(i.total_cents - COALESCE(paid.amount, 0)), 0) AS n
         FROM invoices i
         LEFT JOIN (SELECT invoice_id,
                           SUM(CASE WHEN direction = 'refund' THEN -amount_cents
                                    ELSE amount_cents END) AS amount
                      FROM payments GROUP BY invoice_id) paid ON paid.invoice_id = i.id
        WHERE i.status IN ('issued','partial')`).n;

    json(ctx.res, 200, {
      date: day,
      appointments: todaysAppointments,
      kpis: {
        collected_today_cents: collected(day, day),
        collected_month_cents: collected(monthStart, day),
        expenses_month_cents: spent(monthStart, day),
        outstanding_cents: outstanding,
        patients_total: q.get('SELECT COUNT(*) AS n FROM patients WHERE archived = 0').n,
        appointments_today: todaysAppointments.length,
        appointments_week: q.get(
          `SELECT COUNT(*) AS n FROM appointments
            WHERE starts_at >= ? AND starts_at <= ?
              AND status NOT IN ('cancelled','no_show')`,
          `${day}T00:00`, `${addDays(day, 7)}T23:59`).n,
        unpaid_invoices: q.get(
          `SELECT COUNT(*) AS n FROM invoices WHERE status IN ('issued','partial')`).n,
        planned_treatments: q.get(
          `SELECT COUNT(*) AS n FROM treatments WHERE status = 'planned'`).n,
      },
      recent_payments: q.all(
        `SELECT p.*, pa.first_name || ' ' || pa.last_name AS patient_name, i.number AS invoice_number
           FROM payments p
           JOIN patients pa ON pa.id = p.patient_id
           LEFT JOIN invoices i ON i.id = p.invoice_id
          ORDER BY p.created_at DESC LIMIT 8`),
      revenue_series: revenueSeries(addDays(day, -29), day),
    });
  });

  /** Money in, money out, and what is still owed, over a date range. */
  router.get('/api/reports/financial', async (ctx) => {
    requirePermission(ctx.user, 'reports:read');
    const { from, to } = range(ctx.query);

    const collections = q.get(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'refund' THEN -amount_cents
                                ELSE amount_cents END), 0) AS net,
              COALESCE(SUM(CASE WHEN direction = 'in' THEN amount_cents ELSE 0 END), 0) AS gross,
              COALESCE(SUM(CASE WHEN direction = 'refund' THEN amount_cents ELSE 0 END), 0) AS refunds,
              COUNT(*) AS count
         FROM payments WHERE paid_at >= ? AND paid_at <= ?`, from, to);

    const expenses = q.get(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total, COUNT(*) AS count
         FROM expenses WHERE spent_at >= ? AND spent_at <= ?`, from, to);

    const billed = q.get(
      `SELECT COALESCE(SUM(total_cents), 0) AS total, COUNT(*) AS count
         FROM invoices WHERE status NOT IN ('draft','void') AND issued_at >= ? AND issued_at <= ?`,
      from, to);

    const production = q.get(
      `SELECT COALESCE(SUM(price_cents - discount_cents), 0) AS total, COUNT(*) AS count
         FROM treatments WHERE status = 'completed' AND completed_at >= ? AND completed_at <= ?`,
      from, to);

    json(ctx.res, 200, {
      from,
      to,
      summary: {
        collected_cents: collections.net,
        gross_collected_cents: collections.gross,
        refunds_cents: collections.refunds,
        payments_count: collections.count,
        expenses_cents: expenses.total,
        expenses_count: expenses.count,
        net_cents: collections.net - expenses.total,
        billed_cents: billed.total,
        invoices_count: billed.count,
        production_cents: production.total,
        treatments_count: production.count,
      },
      by_method: q.all(
        `SELECT method,
                COALESCE(SUM(CASE WHEN direction = 'refund' THEN -amount_cents
                                  ELSE amount_cents END), 0) AS amount_cents,
                COUNT(*) AS count
           FROM payments WHERE paid_at >= ? AND paid_at <= ?
          GROUP BY method ORDER BY amount_cents DESC`, from, to),
      by_expense_category: q.all(
        `SELECT category, COALESCE(SUM(amount_cents), 0) AS amount_cents, COUNT(*) AS count
           FROM expenses WHERE spent_at >= ? AND spent_at <= ?
          GROUP BY category ORDER BY amount_cents DESC`, from, to),
      by_procedure: q.all(
        `SELECT pr.name, pr.code,
                COUNT(*) AS count,
                COALESCE(SUM(t.price_cents - t.discount_cents), 0) AS amount_cents
           FROM treatments t JOIN procedures pr ON pr.id = t.procedure_id
          WHERE t.status = 'completed' AND t.completed_at >= ? AND t.completed_at <= ?
          GROUP BY pr.id ORDER BY amount_cents DESC LIMIT 20`, from, to),
      by_dentist: q.all(
        `SELECT u.name,
                COUNT(*) AS treatments,
                COALESCE(SUM(t.price_cents - t.discount_cents), 0) AS amount_cents
           FROM treatments t JOIN users u ON u.id = t.dentist_id
          WHERE t.status = 'completed' AND t.completed_at >= ? AND t.completed_at <= ?
          GROUP BY u.id ORDER BY amount_cents DESC`, from, to),
      series: revenueSeries(from, to),
    });
  });

  /** Who owes what, oldest first. */
  router.get('/api/reports/receivables', async (ctx) => {
    requirePermission(ctx.user, 'reports:read');
    const rows = q.all(
      `SELECT i.id, i.number, i.issued_at, i.due_at, i.status, i.total_cents,
              p.id AS patient_id, p.code AS patient_code, p.phone AS patient_phone,
              p.first_name || ' ' || p.last_name AS patient_name,
              COALESCE((SELECT SUM(CASE WHEN direction = 'refund' THEN -amount_cents
                                        ELSE amount_cents END)
                          FROM payments WHERE invoice_id = i.id), 0) AS paid_cents
         FROM invoices i JOIN patients p ON p.id = i.patient_id
        WHERE i.status IN ('issued','partial')
        ORDER BY i.issued_at`);

    const now = today();
    const withAge = rows.map((r) => ({
      ...r,
      balance_cents: r.total_cents - r.paid_cents,
      days_outstanding: daysBetween(r.issued_at, now),
    })).filter((r) => r.balance_cents > 0);

    const bucket = (min, max) => withAge
      .filter((r) => r.days_outstanding >= min && (max === null || r.days_outstanding <= max))
      .reduce((s, r) => s + r.balance_cents, 0);

    json(ctx.res, 200, {
      invoices: withAge,
      total_cents: withAge.reduce((s, r) => s + r.balance_cents, 0),
      aging: {
        current_cents: bucket(0, 30),
        d31_60_cents: bucket(31, 60),
        d61_90_cents: bucket(61, 90),
        over_90_cents: bucket(91, null),
      },
    });
  });

  /** Schedule throughput: completed, cancelled and no-show rates per dentist. */
  router.get('/api/reports/appointments', async (ctx) => {
    requirePermission(ctx.user, 'reports:read');
    const { from, to } = range(ctx.query);
    const rows = q.all(
      `SELECT u.id, u.name, u.color,
              COUNT(*) AS total,
              SUM(CASE WHEN a.status = 'completed' THEN 1 ELSE 0 END) AS completed,
              SUM(CASE WHEN a.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
              SUM(CASE WHEN a.status = 'no_show' THEN 1 ELSE 0 END) AS no_show
         FROM appointments a JOIN users u ON u.id = a.dentist_id
        WHERE a.starts_at >= ? AND a.starts_at <= ?
        GROUP BY u.id ORDER BY total DESC`, `${from}T00:00`, `${to}T23:59`);

    const totals = rows.reduce((acc, r) => ({
      total: acc.total + r.total,
      completed: acc.completed + r.completed,
      cancelled: acc.cancelled + r.cancelled,
      no_show: acc.no_show + r.no_show,
    }), { total: 0, completed: 0, cancelled: 0, no_show: 0 });

    json(ctx.res, 200, { from, to, by_dentist: rows, totals });
  });

  /** CSV exports so the numbers can go straight to a spreadsheet or accountant. */
  router.get('/api/reports/export/:kind', async (ctx) => {
    requirePermission(ctx.user, 'reports:read');
    const { from, to } = range(ctx.query);
    const kind = ctx.params.kind;

    const exporters = {
      payments: () => q.all(
        `SELECT p.paid_at AS date, pa.code AS patient_code,
                pa.first_name || ' ' || pa.last_name AS patient, i.number AS invoice,
                p.direction, p.method, p.reference,
                printf('%.2f', p.amount_cents / 100.0) AS amount
           FROM payments p JOIN patients pa ON pa.id = p.patient_id
           LEFT JOIN invoices i ON i.id = p.invoice_id
          WHERE p.paid_at >= ? AND p.paid_at <= ? ORDER BY p.paid_at`, from, to),
      expenses: () => q.all(
        `SELECT spent_at AS date, category, description, vendor, method, reference,
                printf('%.2f', amount_cents / 100.0) AS amount
           FROM expenses WHERE spent_at >= ? AND spent_at <= ? ORDER BY spent_at`, from, to),
      invoices: () => q.all(
        `SELECT i.issued_at AS date, i.number, pa.code AS patient_code,
                pa.first_name || ' ' || pa.last_name AS patient, i.status,
                printf('%.2f', i.subtotal_cents / 100.0) AS subtotal,
                printf('%.2f', i.discount_cents / 100.0) AS discount,
                printf('%.2f', i.tax_cents / 100.0) AS tax,
                printf('%.2f', i.total_cents / 100.0) AS total
           FROM invoices i JOIN patients pa ON pa.id = i.patient_id
          WHERE i.issued_at >= ? AND i.issued_at <= ? ORDER BY i.issued_at`, from, to),
      appointments: () => q.all(
        `SELECT a.starts_at AS starts, a.ends_at AS ends, a.status, a.operatory,
                pa.code AS patient_code, pa.first_name || ' ' || pa.last_name AS patient,
                u.name AS dentist, COALESCE(pr.name, a.reason) AS reason
           FROM appointments a JOIN patients pa ON pa.id = a.patient_id
           JOIN users u ON u.id = a.dentist_id
           LEFT JOIN procedures pr ON pr.id = a.procedure_id
          WHERE a.starts_at >= ? AND a.starts_at <= ? ORDER BY a.starts_at`,
        `${from}T00:00`, `${to}T23:59`),
      patients: () => q.all(
        `SELECT code, first_name, last_name, dob, phone, email, city,
                insurance_provider, created_at
           FROM patients WHERE archived = 0 ORDER BY last_name, first_name`),
    };

    const exporter = exporters[kind];
    if (!exporter) throw badRequest(`Unknown export "${kind}"`);
    text(ctx.res, 200, toCsv(exporter()), {
      'Content-Disposition': `attachment; filename="${kind}-${from}-to-${to}.csv"`,
      'Content-Type': 'text/csv; charset=utf-8',
    });
  });
}

function revenueSeries(from, to) {
  const payments = q.all(
    `SELECT paid_at AS day,
            SUM(CASE WHEN direction = 'refund' THEN -amount_cents ELSE amount_cents END) AS cents
       FROM payments WHERE paid_at >= ? AND paid_at <= ? GROUP BY paid_at`, from, to);
  const expenses = q.all(
    `SELECT spent_at AS day, SUM(amount_cents) AS cents
       FROM expenses WHERE spent_at >= ? AND spent_at <= ? GROUP BY spent_at`, from, to);

  const income = new Map(payments.map((r) => [r.day, r.cents]));
  const outgo = new Map(expenses.map((r) => [r.day, r.cents]));
  const series = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    series.push({
      day,
      income_cents: income.get(day) || 0,
      expense_cents: outgo.get(day) || 0,
    });
  }
  return series;
}

function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(',')),
  ].join('\n');
}

export function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}
