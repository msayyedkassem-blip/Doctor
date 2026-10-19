/**
 * The clinic's medicine list, and what was prescribed from it.
 *
 * A prescription copies the words it needs out of the list rather than
 * pointing at it. Correcting a dose on the list next year must not rewrite
 * what a patient was told to take last year — the paper they are holding and
 * the record have to agree for ever.
 */
import { q, insert, update, tx } from '../db.js';
import { json } from '../lib/http.js';
import { requirePermission } from '../lib/auth.js';
import { badRequest, notFound } from '../lib/errors.js';
import { str, int } from '../lib/validate.js';
import { logAction } from '../lib/audit.js';
import { seedFormulary } from '../lib/dental-formulary.js';

export default function register(router) {
  router.get('/api/medicines', async (ctx) => {
    requirePermission(ctx.user, 'clinical:read');
    const search = (ctx.query.get('q') || '').trim();
    const all = ctx.query.get('all') === '1';

    const where = [];
    const params = [];
    if (!all) where.push('active = 1');
    if (search) {
      where.push('(name LIKE ? OR name_ar LIKE ? OR generic LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    json(ctx.res, 200, {
      medicines: q.all(`SELECT * FROM medicines ${clause} ORDER BY category, name`, ...params),
      categories: q.all(
        'SELECT DISTINCT category FROM medicines ORDER BY category').map((r) => r.category),
    });
  });

  /**
   * Puts the dental starter list in, for a clinic that has not built its own.
   * Skips anything already there by name, so it can be run twice safely.
   */
  router.post('/api/medicines/seed', async (ctx) => {
    requirePermission(ctx.user, 'procedures:write');
    const now = new Date().toISOString();
    const added = tx(() => seedFormulary(insert, q, now));
    logAction(ctx.user, 'seed', 'medicines', null, { added });
    json(ctx.res, 200, { added });
  });

  router.post('/api/medicines', async (ctx) => {
    requirePermission(ctx.user, 'procedures:write');
    const now = new Date().toISOString();
    const id = insert('medicines', { ...fields(ctx.body), created_at: now, updated_at: now });
    logAction(ctx.user, 'create', 'medicine', id);
    json(ctx.res, 201, { medicine: q.get('SELECT * FROM medicines WHERE id = ?', id) });
  });

  router.put('/api/medicines/:id', async (ctx) => {
    requirePermission(ctx.user, 'procedures:write');
    const row = q.get('SELECT id FROM medicines WHERE id = ?', Number(ctx.params.id));
    if (!row) throw notFound('No such medicine');
    update('medicines', row.id, { ...fields(ctx.body), updated_at: new Date().toISOString() });
    json(ctx.res, 200, { medicine: q.get('SELECT * FROM medicines WHERE id = ?', row.id) });
  });

  router.delete('/api/medicines/:id', async (ctx) => {
    requirePermission(ctx.user, 'procedures:write');
    const row = q.get('SELECT id FROM medicines WHERE id = ?', Number(ctx.params.id));
    if (!row) throw notFound('No such medicine');
    update('medicines', row.id, { active: 0, updated_at: new Date().toISOString() });
    json(ctx.res, 200, { ok: true });
  });

  // ---- prescriptions ------------------------------------------------------

  router.get('/api/patients/:id/prescriptions', async (ctx) => {
    requirePermission(ctx.user, 'clinical:read');
    const patientId = int(ctx.params, 'id', { required: true });
    const rows = q.all(
      `SELECT p.*, u.name AS prescriber FROM prescriptions p
         LEFT JOIN users u ON u.id = p.created_by
        WHERE p.patient_id = ? ORDER BY p.issued_on DESC, p.id DESC`, patientId);
    json(ctx.res, 200, {
      prescriptions: rows.map((row) => ({
        ...row,
        items: q.all(
          'SELECT * FROM prescription_items WHERE prescription_id = ? ORDER BY id', row.id),
      })),
    });
  });

  router.post('/api/patients/:id/prescriptions', async (ctx) => {
    requirePermission(ctx.user, 'clinical:write');
    const patientId = int(ctx.params, 'id', { required: true });
    if (!q.get('SELECT id FROM patients WHERE id = ?', patientId)) {
      throw notFound('No such patient');
    }

    const items = Array.isArray(ctx.body.items) ? ctx.body.items : [];
    if (!items.length) throw badRequest('A prescription needs at least one medicine');

    const now = new Date().toISOString();
    const id = tx(() => {
      const made = insert('prescriptions', {
        patient_id: patientId,
        issued_on: str(ctx.body, 'issued_on', { max: 10 }) || now.slice(0, 10),
        notes: str(ctx.body, 'notes', { max: 1000 }),
        created_by: ctx.user.id,
        created_at: now,
        updated_at: now,
      });
      for (const line of items) {
        const name = str(line, 'name', { required: true, max: 160 });
        insert('prescription_items', {
          prescription_id: made,
          medicine_id: int(line, 'medicine_id') || null,
          name,
          form: str(line, 'form', { max: 40 }),
          strength: str(line, 'strength', { max: 60 }),
          dose: str(line, 'dose', { max: 80 }),
          frequency: str(line, 'frequency', { max: 80 }),
          duration: str(line, 'duration', { max: 80 }),
          instructions: str(line, 'instructions', { max: 400 }),
          created_at: now,
          updated_at: now,
        });
      }
      return made;
    });

    logAction(ctx.user, 'prescribe', 'patient', patientId, { prescription: id });
    json(ctx.res, 201, { id });
  });

  router.delete('/api/prescriptions/:id', async (ctx) => {
    requirePermission(ctx.user, 'clinical:write');
    const row = q.get('SELECT id FROM prescriptions WHERE id = ?', Number(ctx.params.id));
    if (!row) throw notFound('No such prescription');
    q.run('DELETE FROM prescriptions WHERE id = ?', row.id);
    logAction(ctx.user, 'delete', 'prescription', row.id);
    json(ctx.res, 200, { ok: true });
  });
}

function fields(body) {
  return {
    name: str(body, 'name', { required: true, max: 160 }),
    name_ar: str(body, 'name_ar', { max: 160 }),
    generic: str(body, 'generic', { max: 160 }),
    category: str(body, 'category', { max: 60 }) || 'Other',
    form: str(body, 'form', { max: 40 }) || 'tablet',
    strength: str(body, 'strength', { max: 60 }),
    dose: str(body, 'dose', { max: 80 }),
    frequency: str(body, 'frequency', { max: 80 }),
    duration: str(body, 'duration', { max: 80 }),
    instructions: str(body, 'instructions', { max: 400 }),
    caution: str(body, 'caution', { max: 400 }),
    active: body.active === undefined ? 1 : (body.active ? 1 : 0),
  };
}
