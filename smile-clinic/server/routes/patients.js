import { q, insert, update } from '../db.js';
import { json } from '../lib/http.js';
import { requirePermission } from '../lib/auth.js';
import { str, date, email, pagination, bool } from '../lib/validate.js';
import { notFound } from '../lib/errors.js';
import { logAction } from '../lib/audit.js';
import { netPaid } from '../lib/money.js';
import { deviceCode } from '../lib/sync-core.js';

export default function register(router) {
  router.get('/api/patients', async (ctx) => {
    requirePermission(ctx.user, 'patients:read');
    const { limit, offset, page } = pagination(ctx.query);
    const search = (ctx.query.get('q') || '').trim();
    const archived = ctx.query.get('archived') === '1' ? 1 : 0;

    const SEARCH_COLUMNS = [
      'first_name', 'last_name', 'phone', 'email', 'code', 'national_id',
      "(first_name || ' ' || last_name)",
    ];
    let clause = 'archived = ?';
    const params = [archived];
    if (search) {
      clause += ` AND (${SEARCH_COLUMNS.map((c) => `${c} LIKE ?`).join(' OR ')})`;
      params.push(...SEARCH_COLUMNS.map(() => `%${search}%`));
    }

    const rows = q.all(
      `SELECT * FROM patients WHERE ${clause}
        ORDER BY last_name, first_name LIMIT ? OFFSET ?`,
      ...params, limit, offset,
    );
    const total = q.get(`SELECT COUNT(*) AS n FROM patients WHERE ${clause}`, ...params).n;

    json(ctx.res, 200, {
      patients: rows.map((p) => ({ ...p, balance_cents: patientBalance(p.id) })),
      total, page, limit,
    });
  });

  router.get('/api/patients/:id', async (ctx) => {
    requirePermission(ctx.user, 'patients:read');
    const patient = getPatient(ctx.params.id);
    json(ctx.res, 200, { patient: { ...patient, balance_cents: patientBalance(patient.id) } });
  });

  router.post('/api/patients', async (ctx) => {
    requirePermission(ctx.user, 'patients:write');
    const data = readPatient(ctx.body);
    const now = new Date().toISOString();
    const id = insert('patients', {
      ...data, code: nextPatientCode(), created_at: now, updated_at: now,
    });
    logAction(ctx.user, 'create', 'patient', id, { name: `${data.first_name} ${data.last_name}` });
    json(ctx.res, 201, { patient: q.get('SELECT * FROM patients WHERE id = ?', id) });
  });

  router.put('/api/patients/:id', async (ctx) => {
    requirePermission(ctx.user, 'patients:write');
    const patient = getPatient(ctx.params.id);
    update('patients', patient.id, {
      ...readPatient(ctx.body),
      archived: bool(ctx.body, 'archived', !!patient.archived) ? 1 : 0,
      updated_at: new Date().toISOString(),
    });
    logAction(ctx.user, 'update', 'patient', patient.id);
    json(ctx.res, 200, { patient: q.get('SELECT * FROM patients WHERE id = ?', patient.id) });
  });

  router.delete('/api/patients/:id', async (ctx) => {
    requirePermission(ctx.user, 'patients:delete');
    const patient = getPatient(ctx.params.id);
    // Clinical and financial history must survive, so deleting archives instead.
    update('patients', patient.id, { archived: 1, updated_at: new Date().toISOString() });
    logAction(ctx.user, 'archive', 'patient', patient.id);
    json(ctx.res, 200, { ok: true, archived: true });
  });

  /** Everything the patient file screen needs, in one round trip. */
  router.get('/api/patients/:id/summary', async (ctx) => {
    requirePermission(ctx.user, 'patients:read');
    const patient = getPatient(ctx.params.id);
    const id = patient.id;

    const appointments = q.all(
      `SELECT a.*, u.name AS dentist_name, u.color AS dentist_color, p.name AS procedure_name
         FROM appointments a
         JOIN users u ON u.id = a.dentist_id
         LEFT JOIN procedures p ON p.id = a.procedure_id
        WHERE a.patient_id = ? ORDER BY a.starts_at DESC LIMIT 100`, id);

    const treatments = q.all(
      `SELECT t.*, p.name AS procedure_name, p.code AS procedure_code, u.name AS dentist_name
         FROM treatments t
         JOIN procedures p ON p.id = t.procedure_id
         LEFT JOIN users u ON u.id = t.dentist_id
        WHERE t.patient_id = ? ORDER BY COALESCE(t.completed_at, t.planned_at, t.created_at) DESC`, id);

    const invoices = q.all(
      `SELECT i.*,
              (SELECT COALESCE(SUM(CASE WHEN direction = 'refund' THEN -amount_cents
                                        ELSE amount_cents END), 0)
                 FROM payments WHERE invoice_id = i.id) AS paid_cents
         FROM invoices i WHERE i.patient_id = ? ORDER BY i.issued_at DESC, i.id DESC`, id);

    const payments = q.all(
      `SELECT p.*, i.number AS invoice_number, u.name AS created_by_name
         FROM payments p
         LEFT JOIN invoices i ON i.id = p.invoice_id
         LEFT JOIN users u ON u.id = p.created_by
        WHERE p.patient_id = ? ORDER BY p.paid_at DESC, p.id DESC`, id);

    const chart = q.all('SELECT * FROM tooth_chart WHERE patient_id = ? ORDER BY tooth', id);

    json(ctx.res, 200, {
      patient: { ...patient, balance_cents: patientBalance(id) },
      appointments, treatments, invoices, payments, chart,
      stats: {
        visits: appointments.filter((a) => a.status === 'completed').length,
        no_shows: appointments.filter((a) => a.status === 'no_show').length,
        planned_treatments: treatments.filter((t) => t.status === 'planned').length,
        billed_cents: invoices.filter((i) => i.status !== 'void' && i.status !== 'draft')
          .reduce((s, i) => s + i.total_cents, 0),
        paid_cents: netPaid(payments),
      },
    });
  });
}

export function getPatient(id) {
  const patient = q.get('SELECT * FROM patients WHERE id = ?', Number(id));
  if (!patient) throw notFound('Patient not found');
  return patient;
}

/** Outstanding balance: issued invoices minus net payments received. */
export function patientBalance(patientId) {
  const billed = q.get(
    `SELECT COALESCE(SUM(total_cents), 0) AS n FROM invoices
      WHERE patient_id = ? AND status NOT IN ('draft','void')`, patientId).n;
  const paid = q.get(
    `SELECT COALESCE(SUM(CASE WHEN direction = 'refund' THEN -amount_cents
                              ELSE amount_cents END), 0) AS n
       FROM payments WHERE patient_id = ?`, patientId).n;
  return billed - paid;
}

function readPatient(body) {
  return {
    first_name: str(body, 'first_name', { required: true, max: 80 }),
    last_name: str(body, 'last_name', { required: true, max: 80 }),
    dob: date(body, 'dob'),
    gender: str(body, 'gender', { max: 20 }),
    phone: str(body, 'phone', { max: 40 }),
    email: email(body, 'email'),
    address: str(body, 'address', { max: 300 }),
    city: str(body, 'city', { max: 100 }),
    national_id: str(body, 'national_id', { max: 60 }),
    insurance_provider: str(body, 'insurance_provider', { max: 120 }),
    insurance_number: str(body, 'insurance_number', { max: 80 }),
    allergies: str(body, 'allergies', { max: 1000 }),
    medical_notes: str(body, 'medical_notes', { max: 4000 }),
    referral_source: str(body, 'referral_source', { max: 120 }),
  };
}

/**
 * Sequential clinic file numbers: P-0001, P-0002, ...
 *
 * Once a second device syncs it gets a letter, and its numbers become P-B-0001
 * onwards. Without that, two devices working offline would both reach P-0007
 * and one of them could never be merged in.
 */
function nextPatientCode() {
  const code = deviceCode();
  const stem = code ? `P-${code}-` : 'P-';
  const row = q.get(
    `SELECT code FROM patients WHERE code GLOB ?
      ORDER BY LENGTH(code) DESC, code DESC LIMIT 1`, `${stem}[0-9]*`);
  const last = row ? Number(String(row.code).slice(stem.length)) : 0;
  const next = (Number.isFinite(last) ? last : 0) + 1;
  return `${stem}${String(next).padStart(4, '0')}`;
}
