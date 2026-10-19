import { q, insert, update } from '../db.js';
import { json } from '../lib/http.js';
import { requirePermission } from '../lib/auth.js';
import { str, int, datetime, oneOf, date } from '../lib/validate.js';
import { notFound, badRequest, conflict } from '../lib/errors.js';
import { logAction } from '../lib/audit.js';

const STATUSES = ['scheduled', 'confirmed', 'arrived', 'completed', 'cancelled', 'no_show'];
const BLOCKING = ['scheduled', 'confirmed', 'arrived', 'completed'];

const SELECT_APPT = `
  SELECT a.*,
         p.first_name || ' ' || p.last_name AS patient_name,
         p.code AS patient_code, p.phone AS patient_phone,
         p.allergies AS patient_allergies,
         u.name AS dentist_name, u.color AS dentist_color,
         pr.name AS procedure_name, pr.code AS procedure_code
    FROM appointments a
    JOIN patients p ON p.id = a.patient_id
    JOIN users u ON u.id = a.dentist_id
    LEFT JOIN procedures pr ON pr.id = a.procedure_id`;

export default function register(router) {
  router.get('/api/appointments', async (ctx) => {
    requirePermission(ctx.user, 'appointments:read');
    const from = ctx.query.get('from');
    const to = ctx.query.get('to');
    const dentistId = ctx.query.get('dentist_id');
    const patientId = ctx.query.get('patient_id');
    const status = ctx.query.get('status');

    const where = [];
    const params = [];
    if (from) { where.push('a.starts_at >= ?'); params.push(`${from}T00:00`); }
    if (to) { where.push('a.starts_at <= ?'); params.push(`${to}T23:59`); }
    if (dentistId) { where.push('a.dentist_id = ?'); params.push(Number(dentistId)); }
    if (patientId) { where.push('a.patient_id = ?'); params.push(Number(patientId)); }
    if (status) { where.push('a.status = ?'); params.push(status); }

    const sql = `${SELECT_APPT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                 ORDER BY a.starts_at LIMIT 1000`;
    json(ctx.res, 200, { appointments: q.all(sql, ...params) });
  });

  /** Free slots for a dentist on a given day, respecting existing bookings. */
  router.get('/api/appointments/availability', async (ctx) => {
    requirePermission(ctx.user, 'appointments:read');
    const day = ctx.query.get('date');
    const dentistId = Number(ctx.query.get('dentist_id'));
    const duration = Math.max(5, Number(ctx.query.get('duration') || 30));
    if (!day || !dentistId) throw badRequest('date and dentist_id are required');

    const booked = q.all(
      `SELECT starts_at, ends_at FROM appointments
        WHERE dentist_id = ? AND status IN (${BLOCKING.map(() => '?').join(',')})
          AND starts_at >= ? AND starts_at <= ?`,
      dentistId, ...BLOCKING, `${day}T00:00`, `${day}T23:59`,
    );

    const slots = [];
    const step = 15;
    for (let m = 8 * 60; m + duration <= 19 * 60; m += step) {
      const start = `${day}T${hhmm(m)}`;
      const end = `${day}T${hhmm(m + duration)}`;
      const free = !booked.some((b) => overlaps(start, end, b.starts_at, b.ends_at));
      slots.push({ start, end, free });
    }
    json(ctx.res, 200, { slots });
  });

  router.get('/api/appointments/:id', async (ctx) => {
    requirePermission(ctx.user, 'appointments:read');
    const row = q.get(`${SELECT_APPT} WHERE a.id = ?`, Number(ctx.params.id));
    if (!row) throw notFound('Appointment not found');
    json(ctx.res, 200, { appointment: row });
  });

  router.post('/api/appointments', async (ctx) => {
    requirePermission(ctx.user, 'appointments:write');
    const data = readAppointment(ctx.body);
    assertFree(data, null, ctx.body);
    const now = new Date().toISOString();
    const id = insert('appointments', {
      ...data, status: data.status || 'scheduled',
      created_by: ctx.user.id, created_at: now, updated_at: now,
    });
    logAction(ctx.user, 'create', 'appointment', id, { starts_at: data.starts_at });
    json(ctx.res, 201, { appointment: q.get(`${SELECT_APPT} WHERE a.id = ?`, id) });
  });

  router.put('/api/appointments/:id', async (ctx) => {
    requirePermission(ctx.user, 'appointments:write');
    const id = Number(ctx.params.id);
    const existing = q.get('SELECT * FROM appointments WHERE id = ?', id);
    if (!existing) throw notFound('Appointment not found');

    const data = readAppointment(ctx.body);
    assertFree(data, id, ctx.body);
    update('appointments', id, { ...data, updated_at: new Date().toISOString() });
    logAction(ctx.user, 'update', 'appointment', id);
    json(ctx.res, 200, { appointment: q.get(`${SELECT_APPT} WHERE a.id = ?`, id) });
  });

  /** Status-only transition — the common desk action (arrived, completed, no-show). */
  router.patch('/api/appointments/:id/status', async (ctx) => {
    requirePermission(ctx.user, 'appointments:write');
    const id = Number(ctx.params.id);
    const existing = q.get('SELECT * FROM appointments WHERE id = ?', id);
    if (!existing) throw notFound('Appointment not found');

    const status = oneOf(ctx.body, 'status', STATUSES, { required: true });
    const cancelReason = str(ctx.body, 'cancel_reason', { max: 300 });
    if (status === 'cancelled' && !cancelReason) {
      throw badRequest('Please give a reason when cancelling an appointment');
    }
    update('appointments', id, {
      status,
      cancel_reason: status === 'cancelled' ? cancelReason : null,
      updated_at: new Date().toISOString(),
    });
    logAction(ctx.user, 'status', 'appointment', id, { from: existing.status, to: status });
    json(ctx.res, 200, { appointment: q.get(`${SELECT_APPT} WHERE a.id = ?`, id) });
  });

  router.delete('/api/appointments/:id', async (ctx) => {
    requirePermission(ctx.user, 'appointments:delete');
    const id = Number(ctx.params.id);
    if (!q.get('SELECT id FROM appointments WHERE id = ?', id)) throw notFound('Appointment not found');
    q.run('DELETE FROM appointments WHERE id = ?', id);
    logAction(ctx.user, 'delete', 'appointment', id);
    json(ctx.res, 200, { ok: true });
  });

}

function readAppointment(body) {
  const patientId = int(body, 'patient_id', { required: true, min: 1 });
  if (!q.get('SELECT id FROM patients WHERE id = ?', patientId)) throw notFound('Patient not found');

  const dentistId = int(body, 'dentist_id', { required: true, min: 1 });
  if (!q.get('SELECT id FROM users WHERE id = ? AND active = 1', dentistId)) {
    throw notFound('Practitioner not found');
  }

  const procedureId = int(body, 'procedure_id');
  if (procedureId && !q.get('SELECT id FROM procedures WHERE id = ?', procedureId)) {
    throw notFound('Procedure not found');
  }

  const startsAt = datetime(body, 'starts_at', { required: true });
  let endsAt = datetime(body, 'ends_at');
  if (!endsAt) {
    const duration = int(body, 'duration_min', { fallback: 30, min: 5, max: 600 });
    endsAt = addMinutes(startsAt, duration);
  }
  if (endsAt <= startsAt) throw badRequest('The appointment must end after it starts');

  return {
    patient_id: patientId,
    dentist_id: dentistId,
    procedure_id: procedureId,
    starts_at: startsAt,
    ends_at: endsAt,
    operatory: str(body, 'operatory', { max: 60, fallback: 'Chair 1' }),
    reason: str(body, 'reason', { max: 300 }),
    status: oneOf(body, 'status', STATUSES, { fallback: 'scheduled' }),
    notes: str(body, 'notes', { max: 2000 }),
  };
}

/** Refuse double-booking the same practitioner or the same chair. */
function assertFree(data, excludeId, body) {
  if (data.status === 'cancelled' || data.status === 'no_show') return;
  if (String(body.force || '') === '1') return;

  const clashes = q.all(
    `SELECT a.id, a.starts_at, a.ends_at, a.operatory, a.dentist_id,
            p.first_name || ' ' || p.last_name AS patient_name
       FROM appointments a JOIN patients p ON p.id = a.patient_id
      WHERE a.status IN (${BLOCKING.map(() => '?').join(',')})
        AND a.id IS NOT ?
        AND a.starts_at < ? AND a.ends_at > ?
        AND (a.dentist_id = ? OR a.operatory = ?)`,
    ...BLOCKING, excludeId, data.ends_at, data.starts_at, data.dentist_id, data.operatory,
  );
  if (clashes.length) {
    const first = clashes[0];
    const what = first.dentist_id === data.dentist_id ? 'practitioner' : first.operatory;
    throw conflict(
      `That slot is already taken (${what}: ${first.patient_name}, ` +
      `${first.starts_at.slice(11)}–${first.ends_at.slice(11)})`,
      { clashes },
    );
  }
}

export function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

export function addMinutes(isoLocal, minutes) {
  const [datePart, timePart] = isoLocal.split('T');
  const [h, m] = timePart.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const dayShift = Math.floor(total / 1440);
  const within = ((total % 1440) + 1440) % 1440;
  const d = new Date(`${datePart}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dayShift);
  return `${d.toISOString().slice(0, 10)}T${hhmm(within)}`;
}

function hhmm(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
