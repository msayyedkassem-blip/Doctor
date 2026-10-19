/**
 * Two languages, one set of strings.
 *
 * The key *is* the English text. That means English needs no catalogue at all,
 * a missing Arabic translation falls back to readable English rather than to
 * "settings.clinic.title", and adding a string to a screen needs no separate
 * naming step. The cost is that editing English text orphans its translation,
 * which `npm run i18n:check` finds.
 *
 * Server error messages pass through the same function: they are English
 * sentences, so `t(err.message)` translates any of them that appears in the
 * catalogue and leaves the rest alone.
 */
import { AR } from '../i18n/ar.js';

const CATALOGUES = { ar: AR };
const STORE_KEY = 'clinic.lang';

export const LANGUAGES = [
  { code: 'en', name: 'English', dir: 'ltr' },
  { code: 'ar', name: 'العربية', dir: 'rtl' },
];

function stored() {
  try { return localStorage.getItem(STORE_KEY); } catch { return null; }
}

let current = LANGUAGES.some((l) => l.code === stored()) ? stored() : 'en';

export const currentLanguage = () => current;
export const isRTL = () => direction() === 'rtl';
export const direction = () =>
  LANGUAGES.find((l) => l.code === current)?.dir || 'ltr';

/**
 * The locale used for numbers and dates. Arabic clinics overwhelmingly write
 * figures in Western digits — an invoice in Arabic-Indic numerals is harder to
 * check against a bank statement — so that is the default, and the clinic's own
 * locale setting still overrides it.
 */
export const numberLocale = () => (current === 'ar' ? 'ar-u-nu-latn' : 'en-US');

/**
 * Translates, filling in {name} placeholders.
 *
 * Anything not in the catalogue comes back as it went in, so a screen is never
 * blank or bracketed while a translation is missing.
 */
export function t(text, vars) {
  if (text === null || text === undefined) return text;
  const catalogue = CATALOGUES[current];
  let out = (catalogue && catalogue[text]) || String(text);
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      out = out.replaceAll(`{${name}}`, String(value));
    }
  }
  return out;
}

/** Changes language and reloads: every screen is already drawn in the old one. */
export function setLanguage(code) {
  if (!LANGUAGES.some((l) => l.code === code)) return;
  try { localStorage.setItem(STORE_KEY, code); } catch { /* ignore */ }
  current = code;
  applyDirection();
  window.location.reload();
}

/** Puts the language and reading direction on the page itself. */
export function applyDirection() {
  const root = document.documentElement;
  root.lang = current;
  root.dir = direction();
}
