import { t, numberLocale, currentLanguage } from './i18n.js';
/** DOM building blocks, formatters and the modal/toast plumbing. */

export const state = {
  user: null,
  permissions: [],
  settings: {},
  users: [],
  procedures: [],
};

// ---------- element helpers -------------------------------------------
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const frag = (children) => {
  const f = document.createDocumentFragment();
  for (const c of [].concat(children)) if (c) f.append(c);
  return f;
};

export function clear(node) { while (node.firstChild) node.firstChild.remove(); return node; }

// ---------- formatting -------------------------------------------------
export function money(cents, { sign = false } = {}) {
  const symbol = state.settings.currency_symbol || '$';
  const value = (Math.abs(Number(cents) || 0) / 100).toLocaleString(
    state.settings.locale || numberLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 },
  );
  const negative = Number(cents) < 0;
  const prefix = negative ? '−' : (sign ? '+' : '');
  return `${prefix}${symbol}${value}`;
}

export const cents = (input) => Math.round((Number(input) || 0) * 100);
export const toAmount = (c) => ((Number(c) || 0) / 100).toFixed(2);

// Short forms, written out rather than taken from Intl: a clinic reads these
// hundreds of times a day and they must be the same width every time.
const MONTHS = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  ar: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
};
const DAYS = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  ar: ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
};
const names = (set) => set[currentLanguage()] || set.en;

export function fmtDate(iso, { withYear = true, weekday = false } = {}) {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const parts = [];
  if (weekday) parts.push(`${names(DAYS)[date.getUTCDay()]},`);
  parts.push(`${d} ${names(MONTHS)[m - 1]}`);
  if (withYear) parts.push(String(y));
  return parts.join(' ');
}

export const fmtTime = (isoLocal) => (isoLocal ? isoLocal.slice(11, 16) : '');

export function fmtDateTime(isoLocal) {
  if (!isoLocal) return '—';
  return `${fmtDate(isoLocal)} · ${fmtTime(isoLocal)}`;
}

export function age(dob) {
  if (!dob) return null;
  const birth = new Date(`${dob}T00:00:00Z`);
  const now = new Date();
  let years = now.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - birth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < birth.getUTCDate())) years -= 1;
  return years;
}

export const todayISO = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now - offset).toISOString().slice(0, 10);
};

export function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function startOfWeek(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  // Weeks run Monday to Sunday, which is how clinics read a schedule.
  const shift = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - shift);
  return d.toISOString().slice(0, 10);
}

export const startOfMonth = (iso) => `${iso.slice(0, 7)}-01`;

export const initials = (name) => String(name || '?')
  .replace(/^(Dr|Mr|Mrs|Ms)\.?\s+/i, '')
  .split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

// ---------- permissions -------------------------------------------------
export function can(permission) {
  const granted = state.permissions || [];
  if (granted.includes('*')) return true;
  const [resource] = permission.split(':');
  return granted.includes(permission) || granted.includes(`${resource}:*`);
}

// ---------- badges ------------------------------------------------------
const APPOINTMENT_BADGES = {
  scheduled: ['badge-info', 'Scheduled'],
  confirmed: ['badge-accent', 'Confirmed'],
  arrived: ['badge-purple', 'Arrived'],
  completed: ['badge-success', 'Completed'],
  cancelled: ['badge', 'Cancelled'],
  no_show: ['badge-danger', 'No show'],
};

const INVOICE_BADGES = {
  draft: ['badge', 'Draft'],
  issued: ['badge-warning', 'Unpaid'],
  partial: ['badge-info', 'Part paid'],
  paid: ['badge-success', 'Paid'],
  void: ['badge', 'Void'],
};

const TREATMENT_BADGES = {
  planned: ['badge-info', 'Planned'],
  in_progress: ['badge-warning', 'In progress'],
  completed: ['badge-success', 'Completed'],
  cancelled: ['badge', 'Cancelled'],
};

const badgeFrom = (map) => (status) => {
  const [cls, label] = map[status] || ['badge', status];
  return el('span', { class: `badge ${cls}`, text: t(label) });
};

export const appointmentBadge = badgeFrom(APPOINTMENT_BADGES);
export const invoiceBadge = badgeFrom(INVOICE_BADGES);
export const treatmentBadge = badgeFrom(TREATMENT_BADGES);

export const APPOINTMENT_STATUSES = Object.entries(APPOINTMENT_BADGES)
  .map(([value, [, label]]) => ({ value, label }));

export const PAYMENT_METHODS = [
  { value: 'cash', label: t('Cash') },
  { value: 'card', label: t('Card') },
  { value: 'transfer', label: t('Bank transfer') },
  { value: 'insurance', label: t('Insurance') },
  { value: 'cheque', label: t('Cheque') },
  { value: 'online', label: t('Online') },
  { value: 'other', label: t('Other') },
];

export const TOOTH_CONDITIONS = [
  { value: 'healthy', label: t('Healthy') },
  { value: 'caries', label: t('Caries') },
  { value: 'filled', label: t('Filled') },
  { value: 'crown', label: t('Crown') },
  { value: 'bridge', label: t('Bridge') },
  { value: 'veneer', label: t('Veneer') },
  { value: 'implant', label: t('Implant') },
  { value: 'root_canal', label: t('Root canal') },
  { value: 'sealant', label: t('Sealant') },
  { value: 'extraction_needed', label: t('Needs extraction') },
  { value: 'missing', label: t('Missing') },
];

export const methodLabel = (value) =>
  PAYMENT_METHODS.find((m) => m.value === value)?.label || value;

// ---------- toasts ------------------------------------------------------
export function toast(message, kind = 'info') {
  let host = document.getElementById('toasts');
  if (!host) {
    host = el('div', { id: 'toasts' });
    document.body.append(host);
  }
  const node = el('div', { class: `toast ${kind}`, text: t(message) });
  host.append(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transition = 'opacity .2s';
    setTimeout(() => node.remove(), 220);
  }, kind === 'error' ? 5200 : 3000);
}

// ---------- modal -------------------------------------------------------
let openModal = null;

export function modal({ title, body, footer, width = '', onClose }) {
  closeModal();
  const backdrop = el('div', { class: 'modal-backdrop' });
  const box = el('div', { class: `modal ${width}` });

  box.append(
    el('div', { class: 'modal-head' }, [
      el('h2', { text: title }),
      el('button', { class: 'btn btn-ghost no-print', text: '✕', onClick: () => closeModal() }),
    ]),
    el('div', { class: 'modal-body' }, body),
  );
  if (footer) box.append(el('div', { class: 'modal-foot' }, footer));

  backdrop.append(box);
  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop) closeModal();
  });
  document.body.append(backdrop);
  openModal = { backdrop, onClose };

  const focusable = box.querySelector('input, select, textarea, button.btn-primary');
  if (focusable) setTimeout(() => focusable.focus(), 30);
  return { close: closeModal, box };
}

export function closeModal() {
  if (!openModal) return;
  const { backdrop, onClose } = openModal;
  openModal = null;
  backdrop.remove();
  if (onClose) onClose();
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeModal();
});

export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false, onConfirm }) {
  const button = el('button', {
    class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`,
    text: confirmLabel,
    onClick: async () => {
      button.disabled = true;
      try {
        await onConfirm();
        closeModal();
      } catch (err) {
        toast(err.message, 'error');
        button.disabled = false;
      }
    },
  });
  modal({
    title,
    body: el('p', { text: message }),
    footer: [el('button', { class: 'btn', text: t('Cancel'), onClick: () => closeModal() }), button],
  });
}

// ---------- forms -------------------------------------------------------
export function field(label, input, hint) {
  // Translating here rather than at each of the hundred call sites keeps the
  // forms readable, and a label that is already translated passes through.
  return el('div', { class: 'field' }, [
    label ? el('label', { text: t(label), for: input.id || null }) : null,
    input,
    hint ? el('div', { class: 'field-hint', text: t(hint) }) : null,
  ]);
}

export function input(name, attrs = {}) {
  return el('input', { name, ...attrs });
}

export function select(name, options, value, attrs = {}) {
  const node = el('select', { name, ...attrs });
  for (const option of options) {
    const opt = el('option', { value: option.value, text: option.label });
    if (String(option.value) === String(value)) opt.selected = true;
    node.append(opt);
  }
  return node;
}

/** Reads a <form> into a plain object, keeping empty strings out of the way. */
export function formData(form) {
  const out = {};
  for (const element of form.elements) {
    if (!element.name) continue;
    if (element.type === 'checkbox') out[element.name] = element.checked;
    else out[element.name] = element.value;
  }
  return out;
}

/**
 * Wires a submit handler that disables the button, surfaces API errors as
 * toasts, and leaves the form usable when something goes wrong.
 */
export function onSubmit(form, handler) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]') ||
      form.closest('.modal')?.querySelector('.modal-foot .btn-primary');
    if (button) button.disabled = true;
    try {
      await handler(formData(form));
    } catch (err) {
      toast(err.message || 'Something went wrong', 'error');
    } finally {
      if (button) button.disabled = false;
    }
  });
  return form;
}

export function emptyState(message, icon = '·') {
  return el('div', { class: 'empty' }, [
    el('span', { class: 'empty-icon', text: icon }),
    el('div', { text: t(message) }),
  ]);
}

export function loading() {
  return el('div', { class: 'loading', text: t('Loading…') });
}

/** Table builder: columns are { title, render, class }. */
export function table(columns, rows, { onRowClick, empty = 'Nothing here yet' } = {}) {
  if (!rows.length) return emptyState(empty);
  const head = el('tr', {},
    columns.map((c) => el('th', { class: c.class || null, text: t(c.title) })));
  const body = rows.map((row) => {
    const tr = el('tr', { class: onRowClick ? 'clickable' : null }, columns.map((c) => {
      const value = c.render(row);
      return el('td', { class: c.class || null }, value instanceof Node ? value : String(value ?? ''));
    }));
    if (onRowClick) tr.addEventListener('click', () => onRowClick(row));
    return tr;
  });
  return el('div', { class: 'table-wrap' }, [
    el('table', {}, [el('thead', {}, head), el('tbody', {}, body)]),
  ]);
}

export function statCard(label, value, meta, tone) {
  // Label and footnote are prose; the value is a figure and stays as it is.
  return el('div', { class: 'card stat' }, [
    el('div', { class: 'stat-label', text: t(label) }),
    el('div', { class: `stat-value ${tone || ''}`, text: value }),
    meta ? el('div', { class: 'stat-meta', text: t(meta) }) : null,
  ]);
}

export function avatar(name, color, size = 30) {
  return el('div', {
    class: 'avatar',
    style: { background: color || 'var(--accent)', width: `${size}px`, height: `${size}px`,
      fontSize: `${Math.round(size * 0.4)}px` },
    text: initials(name),
  });
}
