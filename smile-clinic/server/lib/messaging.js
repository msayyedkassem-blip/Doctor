/**
 * Message templating and WhatsApp addressing.
 *
 * Two sending modes are supported and they are deliberately honest about what
 * they can promise:
 *   link  — we build a wa.me URL with the text pre-filled. Staff taps send.
 *           Free, no approval, but we can never know it was actually sent.
 *   cloud — WhatsApp Business Cloud API. Genuinely automatic, but Meta requires
 *           a registered business number and pre-approved templates.
 */
import { badRequest } from './errors.js';

const PLACEHOLDER = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

/**
 * Substitutes {{placeholders}} from `values`.
 *
 * A line that is nothing but placeholders and resolves to nothing disappears
 * completely — that is how optional lines like {{procedure_line}} work. A line
 * the author deliberately left blank survives as a paragraph break.
 */
export function render(template, values) {
  const fill = (text) => text.replace(PLACEHOLDER, (_, name) => {
    const value = values[name.toLowerCase()];
    return value === undefined || value === null ? '' : String(value);
  });

  const kept = [];
  for (const line of String(template || '').split('\n')) {
    const filled = fill(line).replace(/[ \t]+$/, '');
    const isPlaceholderOnly = PLACEHOLDER.test(line) &&
      line.replace(PLACEHOLDER, '').trim() === '';
    PLACEHOLDER.lastIndex = 0; // the regex is global; reset between tests
    if (filled.trim() === '' && isPlaceholderOnly) continue;
    // Never start with, or repeat, a blank line.
    if (filled.trim() === '' && (kept.length === 0 || kept.at(-1).trim() === '')) continue;
    kept.push(filled);
  }
  while (kept.length && kept.at(-1).trim() === '') kept.pop();
  return kept.join('\n');
}

/** Every placeholder a template actually uses, for the editor's help text. */
export function placeholdersIn(template) {
  return [...new Set([...String(template || '').matchAll(PLACEHOLDER)]
    .map((m) => m[1].toLowerCase()))];
}

/** Arabic-Indic and Eastern Arabic digits, as typed on many local keyboards. */
const DIGIT_MAP = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};

/**
 * Turns whatever is in the patient's phone field into the digits-only
 * international form WhatsApp needs (no +, no spaces, no leading zeros).
 *
 * Returns { ok, phone, reason }. It refuses to guess: a local number with no
 * clinic country code configured is an error, not a silent assumption, because
 * guessing wrong means messaging a stranger.
 */
export function normalisePhone(raw, countryCode = '') {
  const input = String(raw || '').replace(/[٠-٩۰-۹]/g, (d) => DIGIT_MAP[d] || d).trim();
  if (!input) return { ok: false, reason: 'This patient has no phone number on file.' };

  const hadPlus = input.startsWith('+') || input.startsWith('00');
  let digits = input.replace(/\D/g, '');
  if (input.startsWith('00')) digits = digits.slice(2);

  const cc = String(countryCode || '').replace(/\D/g, '');

  if (!hadPlus) {
    if (digits.startsWith('0')) {
      // National format (07xx…): swap the trunk zero for the country code.
      if (!cc) {
        return { ok: false, reason: 'Set your clinic country code in Settings → WhatsApp first.' };
      }
      digits = cc + digits.replace(/^0+/, '');
    } else if (cc && !digits.startsWith(cc)) {
      digits = cc + digits;
    } else if (!cc) {
      return { ok: false, reason: 'Set your clinic country code in Settings → WhatsApp first.' };
    }
  }

  if (digits.length < 8 || digits.length > 15) {
    return { ok: false, reason: `"${raw}" does not look like a valid phone number.` };
  }
  return { ok: true, phone: digits };
}

/** The click-to-chat URL. Works on phones and on web.whatsapp.com alike. */
export function whatsappLink(phone, body) {
  return `https://wa.me/${phone}?text=${encodeURIComponent(body)}`;
}

/**
 * Sends through the WhatsApp Business Cloud API.
 *
 * Meta only allows free-form text inside the 24-hour window after the patient
 * last messaged the clinic; outside it, a pre-approved template must be named.
 * We send a template when the clinic has registered one, and plain text
 * otherwise, and we surface Meta's own error text rather than inventing one.
 */
export async function sendViaCloud({ token, phoneNumberId, to, body, templateName, language }) {
  if (!token || !phoneNumberId) {
    throw badRequest('WhatsApp API is not configured — add the token and phone number ID in Settings.');
  }

  const payload = templateName
    ? {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: { name: templateName, language: { code: language === 'en' ? 'en' : 'ar' } },
    }
    : {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { preview_url: false, body },
    };

  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });

  const result = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = result?.error?.message || `WhatsApp API returned ${res.status}`;
    return { ok: false, error: detail };
  }
  return { ok: true, id: result?.messages?.[0]?.id || null };
}
