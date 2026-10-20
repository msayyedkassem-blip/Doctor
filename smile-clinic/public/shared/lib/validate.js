import { badRequest } from './errors.js';

export function str(body, field, { required = false, max = 500, min = 0, fallback = null } = {}) {
  const raw = body[field];
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    if (required) throw badRequest(`"${field}" is required`);
    return fallback;
  }
  const value = String(raw).trim();
  if (value.length > max) throw badRequest(`"${field}" must be at most ${max} characters`);
  if (value.length < min) throw badRequest(`"${field}" must be at least ${min} characters`);
  return value;
}

export function int(body, field, { required = false, min = null, max = null, fallback = null } = {}) {
  const raw = body[field];
  if (raw === undefined || raw === null || raw === '') {
    if (required) throw badRequest(`"${field}" is required`);
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw badRequest(`"${field}" must be a whole number`);
  }
  if (min !== null && value < min) throw badRequest(`"${field}" must be at least ${min}`);
  if (max !== null && value > max) throw badRequest(`"${field}" must be at most ${max}`);
  return value;
}

/**
 * A quantity that may have a fraction: half a box, 2.5 ml of anaesthetic.
 *
 * Rounded to three places, which is finer than anything a clinic counts and
 * stops 0.1 + 0.2 from turning into a number with sixteen digits.
 */
export function num(body, field, { required = false, min = null, max = null, fallback = null } = {}) {
  const raw = body[field];
  if (raw === undefined || raw === null || raw === '') {
    if (required) throw badRequest(`"${field}" is required`);
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) throw badRequest(`"${field}" must be a number`);
  if (min !== null && value < min) throw badRequest(`"${field}" must be at least ${min}`);
  if (max !== null && value > max) throw badRequest(`"${field}" must be at most ${max}`);
  return Math.round(value * 1000) / 1000;
}

/** Accepts 120, "120", "1.20" (as a decimal amount) and returns integer cents. */
export function money(body, field, { required = false, fallback = 0, allowNegative = false } = {}) {
  const raw = body[field];
  if (raw === undefined || raw === null || raw === '') {
    if (required) throw badRequest(`"${field}" is required`);
    return fallback;
  }
  const num = Number(raw);
  if (!Number.isFinite(num)) throw badRequest(`"${field}" must be an amount`);
  const cents = Math.round(num * 100);
  if (!allowNegative && cents < 0) throw badRequest(`"${field}" cannot be negative`);
  if (Math.abs(cents) > 1_000_000_000) throw badRequest(`"${field}" is out of range`);
  return cents;
}

export function bool(body, field, fallback = false) {
  const raw = body[field];
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (typeof raw === 'boolean') return raw;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
}

export function oneOf(body, field, allowed, { required = false, fallback = null } = {}) {
  const value = str(body, field, { required });
  if (value === null) return fallback;
  if (!allowed.includes(value)) {
    throw badRequest(`"${field}" must be one of: ${allowed.join(', ')}`);
  }
  return value;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/;

export function date(body, field, { required = false, fallback = null } = {}) {
  const value = str(body, field, { required });
  if (value === null) return fallback;
  if (!DATE_RE.test(value)) throw badRequest(`"${field}" must be a date (YYYY-MM-DD)`);
  if (Number.isNaN(Date.parse(`${value}T00:00:00`))) throw badRequest(`"${field}" is not a real date`);
  return value;
}

/** Normalises to "YYYY-MM-DDTHH:MM" (clinic-local, no timezone suffix). */
export function datetime(body, field, { required = false, fallback = null } = {}) {
  const value = str(body, field, { required });
  if (value === null) return fallback;
  if (!DATETIME_RE.test(value)) {
    throw badRequest(`"${field}" must look like YYYY-MM-DDTHH:MM`);
  }
  const normalised = value.replace(' ', 'T').slice(0, 16);
  if (Number.isNaN(Date.parse(`${normalised}:00`))) throw badRequest(`"${field}" is not a real date/time`);
  return normalised;
}

export function email(body, field, { required = false, fallback = null } = {}) {
  const value = str(body, field, { required, max: 200 });
  if (value === null) return fallback;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw badRequest(`"${field}" must be a valid email`);
  return value.toLowerCase();
}

/** Permanent-dentition FDI quadrant numbering, plus primary teeth 51-85. */
export function tooth(body, field, { required = false, fallback = null } = {}) {
  const value = int(body, field, { required, fallback: null });
  if (value === null) return fallback;
  if (!isValidTooth(value)) throw badRequest(`"${field}" must be a valid FDI tooth number`);
  return value;
}

export function isValidTooth(n) {
  const quadrant = Math.floor(n / 10);
  const position = n % 10;
  if (quadrant >= 1 && quadrant <= 4) return position >= 1 && position <= 8;
  if (quadrant >= 5 && quadrant <= 8) return position >= 1 && position <= 5;
  return false;
}

const SURFACES = ['M', 'O', 'D', 'B', 'L', 'I', 'V', 'P'];

export function surfaces(body, field, fallback = '') {
  const value = str(body, field, { max: 16 });
  if (value === null) return fallback;
  const chars = [...new Set(value.toUpperCase().replace(/[^A-Z]/g, '').split(''))];
  for (const c of chars) {
    if (!SURFACES.includes(c)) throw badRequest(`"${field}" has an unknown surface "${c}"`);
  }
  return chars.join('');
}

export function pagination(query) {
  const limit = Math.min(Math.max(Number(query.get('limit') || 50), 1), 200);
  const page = Math.max(Number(query.get('page') || 1), 1);
  return { limit, offset: (page - 1) * limit, page };
}
