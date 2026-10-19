import { q, insert, update } from '../db.js';
import { json } from '../lib/http.js';
import { requirePermission } from '../lib/auth.js';
import { str, int, oneOf, bool } from '../lib/validate.js';
import { notFound, badRequest } from '../lib/errors.js';
import { logAction } from '../lib/audit.js';
import { render, placeholdersIn, normalisePhone, whatsappLink, sendViaCloud } from '../lib/messaging.js';
import { allSettings } from './settings.js';
import { patientBalance } from './patients.js';

const CATEGORIES = ['appointment', 'billing', 'general'];
const CONTEXTS = ['patient', 'appointment', 'invoice', 'payment'];

export default function register(router) {
  router.get('/api/messages/templates', async (ctx) => {
    requirePermission(ctx.user, 'messages:read');
    const rows = q.all('SELECT * FROM message_templates ORDER BY category, name');
    json(ctx.res, 200, {
      templates: rows.map((t) => ({
        ...t,
        placeholders: placeholdersIn(`${t.body_ar}\n${t.body_en}`),
      })),
      settings: safeWhatsappSettings(),
    });
  });

  router.put('/api/messages/templates/:key', async (ctx) => {
    requirePermission(ctx.user, 'messages:manage');
    const key = ctx.params.key;
    const existing = q.get('SELECT * FROM message_templates WHERE key = ?', key);
    if (!existing) throw notFound('Template not found');

    update('message_templates', existing.id, {
      name: str(ctx.body, 'name', { required: true, max: 120 }),
      body_ar: str(ctx.body, 'body_ar', { required: true, max: 4000 }),
      body_en: str(ctx.body, 'body_en', { max: 4000, fallback: '' }),
      cloud_name: str(ctx.body, 'cloud_name', { max: 120, fallback: '' }),
      active: bool(ctx.body, 'active', true) ? 1 : 0,
      updated_at: new Date().toISOString(),
    });
    logAction(ctx.user, 'update', 'message_template', key);
    json(ctx.res, 200, { template: q.get('SELECT * FROM message_templates WHERE key = ?', key) });
  });

  router.post('/api/messages/templates', async (ctx) => {
    requirePermission(ctx.user, 'messages:manage');
    const key = str(ctx.body, 'key', { required: true, max: 60 })
      .toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (q.get('SELECT id FROM message_templates WHERE key = ?', key)) {
      throw badRequest('A template with that key already exists');
    }
    const now = new Date().toISOString();
    insert('message_templates', {
      key,
      name: str(ctx.body, 'name', { required: true, max: 120 }),
      category: oneOf(ctx.body, 'category', CATEGORIES, { fallback: 'general' }),
      context: oneOf(ctx.body, 'context', CONTEXTS, { fallback: 'patient' }),
      body_ar: str(ctx.body, 'body_ar', { required: true, max: 4000 }),
      body_en: str(ctx.body, 'body_en', { max: 4000, fallback: '' }),
      cloud_name: str(ctx.body, 'cloud_name', { max: 120, fallback: '' }),
      active: 1,
      built_in: 0,
      created_at: now,
      updated_at: now,
    });
    logAction(ctx.user, 'create', 'message_template', key);
    json(ctx.res, 201, { template: q.get('SELECT * FROM message_templates WHERE key = ?', key) });
  });

  router.delete('/api/messages/templates/:key', async (ctx) => {
    requirePermission(ctx.user, 'messages:manage');
    const existing = q.get('SELECT * FROM message_templates WHERE key = ?', ctx.params.key);
    if (!existing) throw notFound('Template not found');
    if (existing.built_in) throw badRequest('Built-in templates can be edited but not deleted');
    q.run('DELETE FROM message_templates WHERE key = ?', ctx.params.key);
    logAction(ctx.user, 'delete', 'message_template', ctx.params.key);
    json(ctx.res, 200, { ok: true });
  });

  /**
   * Renders a template against a real record and returns the exact text plus a
   * ready-to-open WhatsApp link. Nothing is sent and nothing is logged — this
   * is what the composer shows before the clinic commits to sending.
   */
  router.post('/api/messages/preview', async (ctx) => {
    requirePermission(ctx.user, 'messages:read');
    json(ctx.res, 200, buildMessage(ctx.body));
  });

  /**
   * Records that a message went out. In link mode the clinic's phone does the
   * actual sending, so the status is 'opened', never 'sent'.
   */
  router.post('/api/messages/send', async (ctx) => {
    requirePermission(ctx.user, 'messages:write');
    const built = buildMessage(ctx.body);
    if (!built.phone_ok) throw badRequest(built.phone_error);

    const settings = whatsappSettings();
    const requested = oneOf(ctx.body, 'mode', ['link', 'cloud'], { fallback: settings.mode });
    const mode = requested === 'cloud' && settings.cloud_ready ? 'cloud' : 'link';

    let status = 'opened';
    let providerId = null;
    let error = null;

    if (mode === 'cloud') {
      const result = await sendViaCloud({
        token: settings.token,
        phoneNumberId: settings.phone_number_id,
        to: built.phone,
        body: built.body,
        templateName: built.cloud_name || null,
        language: built.language,
      });
      status = result.ok ? 'sent' : 'failed';
      providerId = result.id || null;
      error = result.error || null;
    }

    const id = insert('messages', {
      patient_id: built.patient_id,
      template_key: built.template_key,
      channel: 'whatsapp',
      mode,
      phone: built.phone,
      language: built.language,
      body: built.body,
      status,
      provider_id: providerId,
      error,
      appointment_id: built.appointment_id,
      invoice_id: built.invoice_id,
      created_by: ctx.user.id,
      created_at: new Date().toISOString(),
    });

    logAction(ctx.user, 'message', 'patient', built.patient_id, {
      template: built.template_key, mode, status,
    });
    json(ctx.res, status === 'failed' ? 502 : 201, {
      message: q.get('SELECT * FROM messages WHERE id = ?', id),
      link: built.link,
      mode,
      error,
    });
  });

  router.get('/api/messages', async (ctx) => {
    requirePermission(ctx.user, 'messages:read');
    const where = [];
    const params = [];
    const patientId = ctx.query.get('patient_id');
    if (patientId) { where.push('m.patient_id = ?'); params.push(Number(patientId)); }

    json(ctx.res, 200, {
      messages: q.all(
        `SELECT m.*, p.first_name || ' ' || p.last_name AS patient_name,
                u.name AS sent_by_name
           FROM messages m
           LEFT JOIN patients p ON p.id = m.patient_id
           LEFT JOIN users u ON u.id = m.created_by
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY m.created_at DESC LIMIT 300`, ...params),
    });
  });

  /**
   * Tomorrow's appointments with a reminder not yet sent — the daily job a
   * receptionist would otherwise do by hand.
   */
  router.get('/api/messages/due-reminders', async (ctx) => {
    requirePermission(ctx.user, 'messages:read');
    const day = ctx.query.get('date') || tomorrow();
    const rows = q.all(
      `SELECT a.id AS appointment_id, a.starts_at, a.ends_at, a.status,
              p.id AS patient_id, p.first_name || ' ' || p.last_name AS patient_name,
              p.phone, p.code AS patient_code,
              u.name AS dentist_name, pr.name AS procedure_name,
              (SELECT COUNT(*) FROM messages m
                WHERE m.appointment_id = a.id AND m.template_key = 'appointment_reminder'
                  AND m.status != 'failed') AS reminded
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         JOIN users u ON u.id = a.dentist_id
         LEFT JOIN procedures pr ON pr.id = a.procedure_id
        WHERE a.starts_at >= ? AND a.starts_at <= ?
          AND a.status IN ('scheduled','confirmed')
        ORDER BY a.starts_at`, `${day}T00:00`, `${day}T23:59`);

    const cc = allSettings().whatsapp_country_code;
    json(ctx.res, 200, {
      date: day,
      appointments: rows.map((r) => {
        const phone = normalisePhone(r.phone, cc);
        return { ...r, reminded: !!r.reminded, phone_ok: phone.ok, phone_error: phone.reason || null };
      }),
    });
  });
}

/** Builds the message text, the recipient and the link from one request body. */
function buildMessage(body) {
  const templateKey = str(body, 'template_key', { required: true, max: 60 });
  const template = q.get('SELECT * FROM message_templates WHERE key = ?', templateKey);
  if (!template) throw notFound('Template not found');

  const language = oneOf(body, 'language', ['ar', 'en'], { fallback: 'ar' });
  const settings = allSettings();

  const context = gatherContext({
    patientId: int(body, 'patient_id'),
    appointmentId: int(body, 'appointment_id'),
    invoiceId: int(body, 'invoice_id'),
    paymentId: int(body, 'payment_id'),
    settings,
    language,
  });

  const source = language === 'en' && template.body_en ? template.body_en : template.body_ar;
  // An edited body from the composer wins, so staff can adjust before sending.
  const overridden = str(body, 'body', { max: 4000 });
  const text = overridden || render(source, context.values);

  const phone = normalisePhone(
    str(body, 'phone', { max: 40 }) || context.patient.phone,
    settings.whatsapp_country_code,
  );

  return {
    template_key: templateKey,
    cloud_name: template.cloud_name || '',
    language,
    body: text,
    values: context.values,
    patient_id: context.patient.id,
    patient_name: `${context.patient.first_name} ${context.patient.last_name}`,
    appointment_id: context.appointmentId,
    invoice_id: context.invoiceId,
    phone_ok: phone.ok,
    phone: phone.ok ? phone.phone : null,
    phone_error: phone.ok ? null : phone.reason,
    raw_phone: context.patient.phone,
    link: phone.ok ? whatsappLink(phone.phone, text) : null,
  };
}

/** Collects every placeholder value available for the records referenced. */
function gatherContext({ patientId, appointmentId, invoiceId, paymentId, settings, language }) {
  let appointment = null;
  let invoice = null;
  let payment = null;

  if (appointmentId) {
    appointment = q.get(
      `SELECT a.*, u.name AS dentist_name, pr.name AS procedure_name
         FROM appointments a
         JOIN users u ON u.id = a.dentist_id
         LEFT JOIN procedures pr ON pr.id = a.procedure_id
        WHERE a.id = ?`, appointmentId);
    if (!appointment) throw notFound('Appointment not found');
    patientId = patientId || appointment.patient_id;
  }
  if (invoiceId) {
    invoice = q.get('SELECT * FROM invoices WHERE id = ?', invoiceId);
    if (!invoice) throw notFound('Invoice not found');
    patientId = patientId || invoice.patient_id;
  }
  if (paymentId) {
    payment = q.get('SELECT * FROM payments WHERE id = ?', paymentId);
    if (!payment) throw notFound('Payment not found');
    patientId = patientId || payment.patient_id;
    if (payment.invoice_id && !invoice) {
      invoice = q.get('SELECT * FROM invoices WHERE id = ?', payment.invoice_id);
    }
  }

  if (!patientId) throw badRequest('A patient is required to build this message');
  const patient = q.get('SELECT * FROM patients WHERE id = ?', patientId);
  if (!patient) throw notFound('Patient not found');

  const balance = patientBalance(patient.id);
  const cash = (cents) => formatMoney(cents, settings, language);

  const values = {
    patient_name: `${patient.first_name} ${patient.last_name}`.trim(),
    patient_first_name: patient.first_name,
    patient_code: patient.code,
    clinic_name: settings.clinic_name,
    clinic_phone: settings.clinic_phone,
    clinic_address: settings.clinic_address,
    balance: cash(Math.max(0, balance)),
  };

  if (appointment) {
    values.date = formatDate(appointment.starts_at.slice(0, 10), language);
    values.time = formatTime(appointment.starts_at.slice(11, 16), language);
    values.dentist = appointment.dentist_name;
    values.procedure = appointment.procedure_name || appointment.reason || '';
    values.chair = appointment.operatory;
    values.procedure_line = values.procedure
      ? (language === 'en' ? `Treatment: ${values.procedure}` : `🦷 العلاج: ${values.procedure}`)
      : '';
  }

  if (invoice) {
    values.invoice_number = invoice.number;
    values.total = cash(invoice.total_cents);
    values.invoice_line = language === 'en'
      ? `Invoice: ${invoice.number}`
      : `🧾 رقم الفاتورة: ${invoice.number}`;
    values.due_line = invoice.due_at
      ? (language === 'en'
        ? `Due by: ${formatDate(invoice.due_at, language)}`
        : `📆 تاريخ الاستحقاق: ${formatDate(invoice.due_at, language)}`)
      : '';
    if (!appointment) values.date = formatDate(invoice.issued_at, language);
  }

  if (payment) {
    values.amount = cash(payment.amount_cents);
    values.method = methodLabel(payment.method, language);
    values.date = formatDate(payment.paid_at, language);
  }

  if (!values.date) values.date = formatDate(new Date().toISOString().slice(0, 10), language);

  return { patient, values, appointmentId: appointment?.id ?? null, invoiceId: invoice?.id ?? null };
}

const AR_METHODS = {
  cash: 'نقداً', card: 'بطاقة', transfer: 'تحويل بنكي',
  insurance: 'تأمين', cheque: 'شيك', online: 'دفع إلكتروني', other: 'أخرى',
};
const EN_METHODS = {
  cash: 'Cash', card: 'Card', transfer: 'Bank transfer',
  insurance: 'Insurance', cheque: 'Cheque', online: 'Online', other: 'Other',
};

const methodLabel = (method, language) =>
  (language === 'en' ? EN_METHODS : AR_METHODS)[method] || method;

function formatMoney(cents, settings, language) {
  const amount = (Math.abs(Number(cents) || 0) / 100).toLocaleString(
    language === 'en' ? (settings.locale || 'en-US') : 'en-US',
    { minimumFractionDigits: 2, maximumFractionDigits: 2 },
  );
  return `${amount} ${settings.currency_symbol || settings.currency || ''}`.trim();
}

const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const AR_DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const EN_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function formatDate(iso, language) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return language === 'en'
    ? `${EN_DAYS[weekday]} ${d} ${EN_MONTHS[m - 1]} ${y}`
    : `${AR_DAYS[weekday]} ${d} ${AR_MONTHS[m - 1]} ${y}`;
}

/** 24-hour clock turned into something a patient reads without thinking. */
function formatTime(hhmm, language) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const minutes = String(m).padStart(2, '0');
  if (language === 'en') return `${hour12}:${minutes} ${h < 12 ? 'AM' : 'PM'}`;
  return `${hour12}:${minutes} ${h < 12 ? 'صباحاً' : 'مساءً'}`;
}

/** The same settings with every secret removed, safe to send to a browser. */
export function safeWhatsappSettings() {
  const { token, phone_number_id: phoneNumberId, ...rest } = whatsappSettings();
  return { ...rest, token_set: Boolean(token), phone_number_id_set: Boolean(phoneNumberId) };
}

export function whatsappSettings() {
  const s = allSettings();
  // Environment variables exist on a server but not inside a phone, where the
  // stored settings are the only source.
  const env = typeof process !== 'undefined' && process.env ? process.env : {};
  const token = env.WHATSAPP_TOKEN || s.whatsapp_token || '';
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID || s.whatsapp_phone_number_id || '';
  return {
    mode: s.whatsapp_mode === 'cloud' ? 'cloud' : 'link',
    country_code: s.whatsapp_country_code || '',
    clinic_number: s.whatsapp_number || '',
    phone_number_id: phoneNumberId,
    token,
    // Never leak the token to the browser; the UI only needs to know it exists.
    cloud_ready: Boolean(token && phoneNumberId),
    token_from_env: Boolean(env.WHATSAPP_TOKEN),
  };
}

function tomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}
