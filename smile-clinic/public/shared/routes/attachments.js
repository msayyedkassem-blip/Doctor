/**
 * X-rays and clinical photographs.
 *
 * The image arrives already downscaled by whichever screen captured it — a
 * phone camera's four megabytes is not a better diagnosis than a quarter of
 * one, and it is the difference between syncing over clinic Wi-Fi and not.
 * The limit here is the backstop, not the plan.
 */
import { q, insert, update } from '../db.js';
import { json } from '../lib/http.js';
import { requireAuth, requirePermission } from '../lib/auth.js';
import { badRequest, notFound } from '../lib/errors.js';
import { str, int } from '../lib/validate.js';
import { logAction } from '../lib/audit.js';

/** Generous for a downscaled image, far under what a phone would send raw. */
const MAX_BASE64 = 6_000_000;

const KINDS = ['xray', 'photo'];
const TYPES = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
};

/**
 * Everything but the full image.
 *
 * The thumbnail rides along — it is a few kilobytes, and a grid that shows
 * twenty of them should be one response, not twenty.
 */
const SUMMARY = `id, patient_id, kind, caption, tooth, taken_on, mime,
  width, height, bytes, thumb, created_by, created_at, updated_at`;

export default function register(router) {
  router.get('/api/patients/:id/attachments', async (ctx) => {
    requirePermission(ctx.user, 'clinical:read');
    json(ctx.res, 200, {
      attachments: q.all(
        `SELECT ${SUMMARY} FROM attachments WHERE patient_id = ?
          ORDER BY COALESCE(taken_on, created_at) DESC, id DESC`,
        int(ctx.params, 'id', { required: true }),
      ),
    });
  });

  /**
   * One image at full size.
   *
   * Base64 in JSON rather than decoded bytes, because this same handler runs
   * inside the phone where there is no Buffer and no socket to write to — and
   * an x-ray that only opens when the clinic computer is on would defeat the
   * point of the app working offline.
   */
  router.get('/api/attachments/:id', async (ctx) => {
    requirePermission(ctx.user, 'clinical:read');
    const row = q.get(
      `SELECT ${SUMMARY}, data FROM attachments WHERE id = ?`, Number(ctx.params.id));
    if (!row) throw notFound('No such image');
    json(ctx.res, 200, { attachment: row });
  });

  router.post('/api/patients/:id/attachments', async (ctx) => {
    requirePermission(ctx.user, 'clinical:write');
    const patientId = int(ctx.params, 'id', { required: true });
    const patient = q.get('SELECT id FROM patients WHERE id = ?', patientId);
    if (!patient) throw notFound('No such patient');

    const data = String(ctx.body.data || '').replace(/^data:[^,]*,/, '');
    if (!data) throw badRequest('No image was sent');
    if (data.length > MAX_BASE64) {
      throw badRequest('That image is too large. Please take or choose a smaller one.');
    }
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw badRequest('That file is not an image');

    const mime = str(ctx.body, 'mime', { max: 40 }) || 'image/jpeg';
    if (!TYPES[mime]) throw badRequest('Only JPEG, PNG and WebP images can be stored');

    const kind = str(ctx.body, 'kind', { max: 10 }) || 'photo';
    if (!KINDS.includes(kind)) throw badRequest('An image is either an x-ray or a photo');

    const now = new Date().toISOString();
    const id = insert('attachments', {
      patient_id: patientId,
      kind,
      caption: str(ctx.body, 'caption', { max: 200 }),
      tooth: int(ctx.body, 'tooth', { min: 11, max: 85 }) || null,
      taken_on: str(ctx.body, 'taken_on', { max: 10 }) || now.slice(0, 10),
      mime,
      width: int(ctx.body, 'width', { min: 0, max: 20000 }) || null,
      height: int(ctx.body, 'height', { min: 0, max: 20000 }) || null,
      // What the image actually weighs, not the base64 it travelled as.
      bytes: Math.floor((data.length * 3) / 4),
      data,
      thumb: str(ctx.body, 'thumb', { max: 400_000 }).replace(/^data:[^,]*,/, '') || null,
      created_by: ctx.user.id,
      created_at: now,
      updated_at: now,
    });

    logAction(ctx.user, 'add', 'attachment', id);
    json(ctx.res, 201, {
      attachment: q.get(`SELECT ${SUMMARY} FROM attachments WHERE id = ?`, id),
    });
  });

  router.patch('/api/attachments/:id', async (ctx) => {
    requirePermission(ctx.user, 'clinical:write');
    const row = q.get('SELECT id FROM attachments WHERE id = ?', Number(ctx.params.id));
    if (!row) throw notFound('No such image');

    const fields = { updated_at: new Date().toISOString() };
    if (ctx.body.caption !== undefined) fields.caption = str(ctx.body, 'caption', { max: 200 });
    if (ctx.body.kind !== undefined) {
      const kind = str(ctx.body, 'kind', { max: 10 });
      if (!KINDS.includes(kind)) throw badRequest('An image is either an x-ray or a photo');
      fields.kind = kind;
    }
    if (ctx.body.tooth !== undefined) {
      fields.tooth = int(ctx.body, 'tooth', { min: 11, max: 85 }) || null;
    }
    if (ctx.body.taken_on !== undefined) fields.taken_on = str(ctx.body, 'taken_on', { max: 10 });

    update('attachments', row.id, fields);
    json(ctx.res, 200, {
      attachment: q.get(`SELECT ${SUMMARY} FROM attachments WHERE id = ?`, row.id),
    });
  });

  router.delete('/api/attachments/:id', async (ctx) => {
    requireAuth(ctx.user);
    requirePermission(ctx.user, 'clinical:write');
    const row = q.get('SELECT id, patient_id FROM attachments WHERE id = ?', Number(ctx.params.id));
    if (!row) throw notFound('No such image');
    q.run('DELETE FROM attachments WHERE id = ?', row.id);
    logAction(ctx.user, 'delete', 'attachment', row.id);
    json(ctx.res, 200, { ok: true });
  });
}
