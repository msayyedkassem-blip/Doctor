import { q, insert, update } from '../db.js';
import { json } from '../lib/http.js';
import { requirePermission } from '../lib/auth.js';
import { str, int, money, oneOf, tooth, surfaces, date } from '../lib/validate.js';
import { notFound, badRequest } from '../lib/errors.js';
import { logAction } from '../lib/audit.js';
import { getPatient } from './patients.js';

const CONDITIONS = ['healthy', 'caries', 'filled', 'crown', 'bridge', 'implant',
  'root_canal', 'missing', 'extraction_needed', 'sealant', 'veneer'];
const TREATMENT_STATUSES = ['planned', 'in_progress', 'completed', 'cancelled'];

const SELECT_TREATMENT = `
  SELECT t.*, pr.name AS procedure_name, pr.code AS procedure_code,
         pr.tax_rate_bp, u.name AS dentist_name,
         p.first_name || ' ' || p.last_name AS patient_name
    FROM treatments t
    JOIN procedures pr ON pr.id = t.procedure_id
    JOIN patients p ON p.id = t.patient_id
    LEFT JOIN users u ON u.id = t.dentist_id`;

export default function register(router) {
  // ---- Odontogram -----------------------------------------------------
  router.get('/api/patients/:id/chart', async (ctx) => {
    requirePermission(ctx.user, 'clinical:read');
    const patient = getPatient(ctx.params.id);
    json(ctx.res, 200, {
      chart: q.all('SELECT * FROM tooth_chart WHERE patient_id = ? ORDER BY tooth', patient.id),
    });
  });

  router.put('/api/patients/:id/chart/:tooth', async (ctx) => {
    requirePermission(ctx.user, 'clinical:write');
    const patient = getPatient(ctx.params.id);
    const toothNo = tooth({ tooth: ctx.params.tooth }, 'tooth', { required: true });
    const condition = oneOf(ctx.body, 'condition', CONDITIONS, { required: true });
    const now = new Date().toISOString();
    const row = {
      condition,
      surfaces: surfaces(ctx.body, 'surfaces', ''),
      note: str(ctx.body, 'note', { max: 500 }),
      updated_by: ctx.user.id,
      updated_at: now,
    };

    const existing = q.get('SELECT id FROM tooth_chart WHERE patient_id = ? AND tooth = ?',
      patient.id, toothNo);
    if (existing) update('tooth_chart', existing.id, row);
    else insert('tooth_chart', { patient_id: patient.id, tooth: toothNo, ...row });

    logAction(ctx.user, 'chart', 'patient', patient.id, { tooth: toothNo, condition });
    json(ctx.res, 200, {
      tooth: q.get('SELECT * FROM tooth_chart WHERE patient_id = ? AND tooth = ?',
        patient.id, toothNo),
    });
  });

  // ---- Treatment plan / performed work --------------------------------
  router.get('/api/treatments', async (ctx) => {
    requirePermission(ctx.user, 'treatments:read');
    const where = [];
    const params = [];
    const patientId = ctx.query.get('patient_id');
    const status = ctx.query.get('status');
    const uninvoiced = ctx.query.get('uninvoiced');
    if (patientId) { where.push('t.patient_id = ?'); params.push(Number(patientId)); }
    if (status) { where.push('t.status = ?'); params.push(status); }
    if (uninvoiced === '1') where.push('t.invoiced = 0');

    json(ctx.res, 200, {
      treatments: q.all(
        `${SELECT_TREATMENT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY COALESCE(t.completed_at, t.planned_at, t.created_at) DESC LIMIT 500`,
        ...params,
      ),
    });
  });

  router.post('/api/treatments', async (ctx) => {
    requirePermission(ctx.user, 'treatments:write');
    const data = readTreatment(ctx.body, ctx.user);
    const now = new Date().toISOString();
    const id = insert('treatments', { ...data, created_at: now, updated_at: now });
    logAction(ctx.user, 'create', 'treatment', id, {
      patient_id: data.patient_id, procedure_id: data.procedure_id,
    });
    json(ctx.res, 201, { treatment: q.get(`${SELECT_TREATMENT} WHERE t.id = ?`, id) });
  });

  router.put('/api/treatments/:id', async (ctx) => {
    requirePermission(ctx.user, 'treatments:write');
    const id = Number(ctx.params.id);
    const existing = q.get('SELECT * FROM treatments WHERE id = ?', id);
    if (!existing) throw notFound('Treatment not found');
    if (existing.invoiced) {
      throw badRequest('This treatment is already on an invoice — void the invoice first');
    }
    const data = readTreatment(ctx.body, ctx.user);
    update('treatments', id, { ...data, updated_at: new Date().toISOString() });
    logAction(ctx.user, 'update', 'treatment', id);
    json(ctx.res, 200, { treatment: q.get(`${SELECT_TREATMENT} WHERE t.id = ?`, id) });
  });

  router.delete('/api/treatments/:id', async (ctx) => {
    requirePermission(ctx.user, 'treatments:write');
    const id = Number(ctx.params.id);
    const existing = q.get('SELECT * FROM treatments WHERE id = ?', id);
    if (!existing) throw notFound('Treatment not found');
    if (existing.invoiced) throw badRequest('Invoiced treatments cannot be deleted');
    q.run('DELETE FROM treatments WHERE id = ?', id);
    logAction(ctx.user, 'delete', 'treatment', id);
    json(ctx.res, 200, { ok: true });
  });
}

function readTreatment(body, user) {
  const patientId = int(body, 'patient_id', { required: true, min: 1 });
  if (!q.get('SELECT id FROM patients WHERE id = ?', patientId)) throw notFound('Patient not found');

  const procedureId = int(body, 'procedure_id', { required: true, min: 1 });
  const procedure = q.get('SELECT * FROM procedures WHERE id = ?', procedureId);
  if (!procedure) throw notFound('Procedure not found');

  const appointmentId = int(body, 'appointment_id');
  if (appointmentId && !q.get('SELECT id FROM appointments WHERE id = ?', appointmentId)) {
    throw notFound('Appointment not found');
  }

  const status = oneOf(body, 'status', TREATMENT_STATUSES, { fallback: 'planned' });
  const price = body.price === undefined || body.price === null || body.price === ''
    ? procedure.default_price_cents
    : money(body, 'price');
  const discount = money(body, 'discount', { fallback: 0 });
  if (discount > price) throw badRequest('The discount cannot be larger than the price');

  const dentistId = int(body, 'dentist_id', { fallback: user.role === 'dentist' ? user.id : null });

  return {
    patient_id: patientId,
    procedure_id: procedureId,
    appointment_id: appointmentId,
    dentist_id: dentistId,
    tooth: tooth(body, 'tooth'),
    surfaces: surfaces(body, 'surfaces', ''),
    status,
    price_cents: price,
    discount_cents: discount,
    notes: str(body, 'notes', { max: 2000 }),
    planned_at: date(body, 'planned_at', { fallback: new Date().toISOString().slice(0, 10) }),
    completed_at: status === 'completed'
      ? date(body, 'completed_at', { fallback: new Date().toISOString().slice(0, 10) })
      : null,
  };
}
