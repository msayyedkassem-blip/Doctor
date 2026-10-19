/**
 * Drafting a message to a patient.
 *
 * The route's real job is deciding what leaves the clinic. It gathers a few
 * facts from the record — a first name, the next appointment, what is owed —
 * and sends those and nothing else. The medical notes, the chart and the
 * images stay where they are.
 */
import { q } from '../db.js';
import { json } from '../lib/http.js';
import { requirePermission } from '../lib/auth.js';
import { badRequest } from '../lib/errors.js';
import { str, int } from '../lib/validate.js';
import { logAction } from '../lib/audit.js';
import { allSettings } from './settings.js';
import { draftReply, DEFAULT_MODEL } from '../lib/assistant.js';

export default function register(router) {
  router.get('/api/assistant', async (ctx) => {
    requirePermission(ctx.user, 'messages:read');
    const settings = allSettings();
    json(ctx.res, 200, {
      enabled: Boolean(settings.assistant_enabled && settings.assistant_key),
      configured: Boolean(settings.assistant_key),
      model: settings.assistant_model || DEFAULT_MODEL,
    });
  });

  router.post('/api/assistant/draft', async (ctx) => {
    requirePermission(ctx.user, 'messages:write');
    const settings = allSettings();
    if (!settings.assistant_enabled) {
      throw badRequest('The assistant is switched off. An administrator can turn it on '
        + 'in Settings.');
    }

    const patientId = int(ctx.body, 'patient_id');
    const facts = [];

    if (patientId) {
      const patient = q.get(
        `SELECT id, first_name, last_name, code FROM patients WHERE id = ?`, patientId);
      if (!patient) throw badRequest('No such patient');

      // Deliberately a first name. The surname adds nothing to a reply and
      // identifies somebody to a company that has no business knowing them.
      facts.push(`The patient's first name is ${patient.first_name}.`);

      const next = q.get(
        `SELECT a.starts_at, u.name AS dentist FROM appointments a
           LEFT JOIN users u ON u.id = a.dentist_id
          WHERE a.patient_id = ? AND a.starts_at >= ?
            AND a.status NOT IN ('cancelled','no_show')
          ORDER BY a.starts_at LIMIT 1`,
        patient.id, new Date().toISOString());
      if (next) {
        facts.push(`Their next appointment is ${next.starts_at.slice(0, 16).replace('T', ' at ')}`
          + `${next.dentist ? ` with ${next.dentist}` : ''}.`);
      } else {
        facts.push('They have no appointment booked.');
      }

      const owed = q.get(
        `SELECT COALESCE(SUM(i.total_cents), 0)
                - COALESCE((SELECT SUM(CASE WHEN direction = 'refund' THEN -amount_cents
                                            ELSE amount_cents END)
                              FROM payments WHERE patient_id = ?), 0) AS balance
           FROM invoices i
          WHERE i.patient_id = ? AND i.status NOT IN ('void','draft')`,
        patient.id, patient.id)?.balance || 0;
      if (owed > 0) {
        facts.push(`They owe ${(owed / 100).toFixed(2)} ${settings.currency || ''}`.trim() + '.');
      } else {
        facts.push('Their account is settled.');
      }
    }

    facts.push(`The clinic is called ${settings.clinic_name || 'the clinic'}.`);
    if (settings.clinic_phone) facts.push(`Its phone number is ${settings.clinic_phone}.`);
    if (settings.day_start && settings.day_end) {
      facts.push(`It is open from ${settings.day_start} to ${settings.day_end}.`);
    }
    if (settings.clinic_address) facts.push(`It is at ${settings.clinic_address}.`);

    const result = await draftReply({
      apiKey: settings.assistant_key,
      model: settings.assistant_model || DEFAULT_MODEL,
      patientMessage: str(ctx.body, 'message', { max: 2000 }),
      instruction: str(ctx.body, 'about', { max: 500 }),
      facts,
      endpoint: settings.assistant_endpoint || undefined,
    });

    // Recorded without the text: who used it and when is useful, what a
    // patient wrote is not ours to keep twice.
    logAction(ctx.user, 'draft', 'assistant', patientId || null);
    json(ctx.res, 200, { draft: result.text, model: result.model });
  });
}
