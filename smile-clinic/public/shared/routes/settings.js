import { q, getDb } from '../db.js';
import { json } from '../lib/http.js';
import { requireAuth, requirePermission } from '../lib/auth.js';
import { logAction } from '../lib/audit.js';

export const DEFAULT_SETTINGS = {
  assistant_enabled: '',
  assistant_key: '',
  assistant_model: 'claude-opus-5-5',
  assistant_endpoint: '',
  clinic_name: 'Smile Dental Clinic',
  clinic_address: '',
  clinic_phone: '',
  clinic_email: '',
  clinic_tax_id: '',
  currency: 'USD',
  currency_symbol: '$',
  locale: 'en-US',
  default_tax_rate_bp: '0',
  invoice_prefix: 'INV',
  invoice_terms: 'Payment due within 30 days.',
  slot_minutes: '15',
  day_start: '08:00',
  day_end: '19:00',
  working_days: '1,2,3,4,5,6',
  operatories: 'Chair 1,Chair 2,Chair 3',
  expense_categories: 'Supplies,Lab,Rent,Utilities,Salaries,Equipment,Marketing,Taxes,Other',
  // WhatsApp. 'link' opens the clinic's own WhatsApp with the text ready to
  // send; 'cloud' sends automatically through Meta's Business API.
  whatsapp_mode: 'link',
  whatsapp_country_code: '',
  whatsapp_number: '',
  whatsapp_phone_number_id: '',
  whatsapp_token: '',
  whatsapp_default_language: 'ar',
};

/** Never sent to the browser, and never returned by the settings endpoint. */
const SECRET_SETTINGS = new Set(['whatsapp_token', 'assistant_key']);

export function allSettings() {
  const rows = q.all('SELECT key, value FROM settings');
  const out = { ...DEFAULT_SETTINGS };
  for (const row of rows) out[row.key] = row.value;
  return out;
}

export function setting(key) {
  return allSettings()[key];
}

/**
 * Settings safe to hand to the browser: secrets are replaced by a flag saying
 * whether one is set, so the UI can show "configured" without ever seeing it.
 */
export function publicSettings() {
  const all = allSettings();
  const out = {};
  for (const [key, value] of Object.entries(all)) {
    if (SECRET_SETTINGS.has(key)) out[`${key}_set`] = value ? '1' : '';
    else out[key] = value;
  }
  return out;
}

export default function register(router) {
  router.get('/api/settings', async (ctx) => {
    requireAuth(ctx.user);
    json(ctx.res, 200, { settings: publicSettings() });
  });

  router.put('/api/settings', async (ctx) => {
    requirePermission(ctx.user, 'settings:write');
    const now = new Date().toISOString();
    const stmt = getDb().prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    );
    const changed = [];
    for (const [key, value] of Object.entries(ctx.body)) {
      if (!(key in DEFAULT_SETTINGS)) continue;
      stmt.run(key, String(value ?? '').slice(0, 2000), now);
      changed.push(key);
    }
    logAction(ctx.user, 'update', 'settings', null, { keys: changed });
    json(ctx.res, 200, { settings: publicSettings() });
  });
}
