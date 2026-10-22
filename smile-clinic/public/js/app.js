import { t, LANGUAGES, currentLanguage, setLanguage, applyDirection } from './i18n.js';
import { api } from './api.js';
import { isLocalMode, describeMode } from './mode.js';
import { VERSION } from './version.js';
import {
  state, el, clear, toast, avatar, loading, can, modal, field, input, onSubmit, closeModal,
} from './ui.js';

import dashboard from './views/dashboard.js';
import calendar from './views/calendar.js';
import patients from './views/patients.js';
import patient from './views/patient.js';
import billing from './views/billing.js';
import expenses from './views/expenses.js';
import reports from './views/reports.js';
import settings from './views/settings.js';
import reminders from './views/whatsapp.js';
import stock from './views/stock.js';

const ROUTES = [
  { path: /^\/?$/, view: dashboard, nav: 'dashboard' },
  { path: /^\/calendar$/, view: calendar, nav: 'calendar' },
  { path: /^\/patients$/, view: patients, nav: 'patients' },
  { path: /^\/patients\/(\d+)$/, view: patient, nav: 'patients' },
  { path: /^\/billing$/, view: billing, nav: 'billing' },
  { path: /^\/expenses$/, view: expenses, nav: 'expenses' },
  { path: /^\/reports$/, view: reports, nav: 'reports' },
  { path: /^\/stock$/, view: stock, nav: 'stock' },
  { path: /^\/reminders$/, view: reminders, nav: 'reminders' },
  { path: /^\/settings$/, view: settings, nav: 'settings' },
];

const NAV = [
  { id: 'dashboard', label: t('Dashboard'), icon: '◧', href: '#/' },
  { id: 'calendar', label: t('Schedule'), icon: '▦', href: '#/calendar' },
  { id: 'patients', label: t('Patients'), icon: '☺', href: '#/patients' },
  { id: 'billing', label: t('Billing'), icon: '❐', href: '#/billing', permission: 'invoices:read' },
  { id: 'expenses', label: t('Expenses'), icon: '↗', href: '#/expenses', permission: 'expenses:read' },
  { id: 'reminders', label: t('Reminders'), icon: '✆', href: '#/reminders', permission: 'messages:write' },
  { id: 'stock', label: t('Stock'), icon: '▤', href: '#/stock', permission: 'stock:read' },
  { id: 'reports', label: t('Reports'), icon: '◔', href: '#/reports', permission: 'reports:read' },
  { id: 'settings', label: t('Settings'), icon: '⚙', href: '#/settings' },
];

const root = document.getElementById('app');

export const navigate = (hash) => { window.location.hash = hash; };

/** Reload the reference data views rely on, then re-render. */
export async function refreshLookups() {
  const [settingsRes, usersRes, proceduresRes] = await Promise.all([
    api.settings(), api.users(), api.procedures(),
  ]);
  state.settings = settingsRes.settings;
  state.users = usersRes.users;
  state.procedures = proceduresRes.procedures;
}

async function boot() {
  // Before anything is drawn: the whole page flips for Arabic.
  applyDirection();
  root.append(loading());
  try {
    const me = await api.me();
    state.user = me.user;
    state.permissions = me.permissions;
    await refreshLookups();
    renderShell();
    await route();
  } catch (err) {
    if (err.status === 401) renderLogin();
    else {
      clear(root);
      root.append(el('div', { class: 'loading' }, [
        el('p', { text: t('The app could not reach the server.') }),
        el('p', { class: 'small faint', text: err.message }),
        // Most of what lands here clears on a second go — a database still
        // held by the last copy of the app, a clinic computer still starting
        // up. Staring at the message is not a step anybody can take.
        el('button', {
          class: 'btn btn-primary mt', type: 'button', text: t('Try again'),
          onClick: () => window.location.reload(),
        }),
      ]));
    }
  }
}

// ---------- login -------------------------------------------------------
function renderLogin() {
  clear(root);
  const form = el('form', {}, [
    field('Email', input('email', { type: 'email', required: true, autocomplete: 'username',
      placeholder: t('you@clinic.local') })),
    field('Password', input('password', { type: 'password', required: true,
      autocomplete: 'current-password' })),
    el('button', { class: 'btn btn-primary btn-block', type: 'submit', text: t('Sign in') }),
  ]);

  onSubmit(form, async (data) => {
    const res = await api.login(data.email, data.password);
    state.user = res.user;
    state.permissions = res.permissions;
    await refreshLookups();
    renderShell();
    await route();
  });

  clear(root).append(el('div', { class: 'login-page' }, [
    el('div', { class: 'login-card' }, [
      el('div', { class: 'login-head' }, [
        el('div', { class: 'brand-mark', text: '🦷' }),
        el('h1', { text: t('Smile Clinic') }),
        el('div', { class: 'muted small', text: t('Dental practice management') }),
      ]),
      el('div', { class: 'card' }, [el('div', { class: 'card-body' }, form)]),
      el('div', { class: 'lang-row' }, LANGUAGES.map((l) => el('button', {
        type: 'button',
        class: `btn btn-ghost btn-sm${l.code === currentLanguage() ? ' active' : ''}`,
        text: l.name,
        onClick: () => setLanguage(l.code),
      }))),
      el('div', { class: 'demo-hint', html:
        'Demo sign-in: <code>admin@clinic.local</code> / <code>demo1234</code><br>' +
        'Other roles: <code>front-desk@</code>, <code>lucas@</code>, <code>accounts@clinic.local</code>' }),
    ]),
  ]));
}

/**
 * Says, once and calmly, that records can still be read but not changed.
 *
 * Deliberately not a dialogue: a receptionist with a patient in the chair
 * should not have to dismiss anything to see today's schedule.
 */
async function showLicenceBanner() {
  const host = document.getElementById('licence-banner');
  if (!host) return;
  let licence;
  try {
    licence = await api.licence();
  } catch {
    return;
  }
  if (licence.writable || licence.status === 'unlicensed-build') return;

  host.append(el('div', { class: 'licence-strip' }, [
    el('span', { text: licence.status === 'trial-over'
      ? t('The free trial has ended — records can be read and printed, but not changed.')
      : t('This copy is read-only — records can be read and printed, but not changed.') }),
    can('settings:write')
      ? el('a', { class: 'btn btn-sm btn-primary', href: '#/settings',
        text: t('Enter a licence code') })
      : null,
  ]));
}

// ---------- shell -------------------------------------------------------
function renderShell() {
  clear(root);

  const nav = el('nav', { class: 'nav' }, NAV
    .filter((item) => !item.permission || can(item.permission))
    .map((item) => el('a', { class: 'nav-item', href: item.href, dataset: { nav: item.id } }, [
      el('span', { class: 'nav-icon', text: item.icon }),
      el('span', { text: item.label }),
    ])));

  const sidebar = el('aside', { class: 'sidebar' }, [
    el('div', { class: 'brand' }, [
      el('div', { class: 'brand-mark', text: '🦷' }),
      el('div', {}, [
        el('div', { class: 'brand-name', text: state.settings.clinic_name || 'Smile Clinic' }),
        el('div', { class: 'brand-sub', text: t('Practice management') }),
      ]),
    ]),
    nav,
    el('div', { class: 'mode-strip', title: isLocalMode()
      ? 'Records are stored on this device'
      : 'Records are stored on the clinic computer' }, [
      el('span', { class: `mode-dot ${isLocalMode() ? 'local' : 'server'}` }),
      el('span', { text: describeMode() }),
      // Says which copy of the app is actually being served, so "I replaced the
      // files and nothing changed" is answerable without guessing.
      el('span', { class: 'mode-version', title: t('App version'), text: `v${VERSION}` }),
    ]),
    el('div', { class: 'user-box' }, [
      avatar(state.user.name, state.user.color),
      el('div', { style: { minWidth: 0, flex: 1 } }, [
        el('div', { class: 'user-name', text: state.user.name }),
        el('div', { class: 'user-role', text: state.user.role }),
      ]),
      el('button', {
        class: 'btn btn-ghost btn-sm', title: t('Account'), text: '⋯',
        onClick: accountMenu,
      }),
    ]),
  ]);

  // A clinic that cannot save needs to be told once, at the top of every screen
  // — not by each form failing in turn.
  const banner = el('div', { id: 'licence-banner' });

  const main = el('main', { class: 'main' }, [
    el('div', { class: 'topbar' }, [
      el('button', { class: 'btn btn-ghost menu-toggle', text: '☰',
        onClick: () => document.body.classList.toggle('nav-open') }),
      el('div', { class: 'topbar-title', id: 'topbar-title' }),
      el('div', { class: 'topbar-actions', id: 'topbar-actions' }),
    ]),
    banner,
    el('div', { class: 'content', id: 'view' }),
  ]);

  root.append(el('div', { class: 'layout' }, [sidebar, main]));
  showLicenceBanner();
  nav.addEventListener('click', () => document.body.classList.remove('nav-open'));
}

function accountMenu() {
  modal({
    title: t('Account'),
    body: el('div', {}, [
      el('dl', { class: 'kv' }, [
        el('dt', { text: t('Name') }), el('dd', { text: state.user.name }),
        el('dt', { text: t('Email') }), el('dd', { text: state.user.email }),
        el('dt', { text: t('Role') }), el('dd', { text: state.user.role }),
      ]),
      el('hr', { style: { border: 0, borderTop: '1px solid var(--border)', margin: '16px 0' } }),
      changePasswordForm(),
    ]),
    footer: [
      el('button', {
        class: 'btn btn-danger', text: t('Sign out'),
        onClick: async () => { await api.logout(); window.location.reload(); },
      }),
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn', text: t('Close'), onClick: () => closeModal() }),
    ],
  });
}

function changePasswordForm() {
  const form = el('form', {}, [
    el('h3', { text: t('Change password'), style: { marginBottom: '12px' } }),
    field('Current password', input('current_password', { type: 'password', required: true })),
    field('New password', input('new_password', { type: 'password', required: true, minlength: 8 }),
      'At least 8 characters. Your other devices will be signed out.'),
    el('button', { class: 'btn btn-primary', type: 'submit', text: t('Update password') }),
  ]);
  return onSubmit(form, async (data) => {
    await api.changePassword(data);
    toast(t('Password updated'), 'success');
    form.reset();
  });
}

// ---------- routing -----------------------------------------------------
function setTitle(title, subtitle, actions = []) {
  const titleHost = clear(document.getElementById('topbar-title'));
  // Translated here, like field labels, so every screen does not have to.
  titleHost.append(el('h1', {}, title instanceof Node ? title : t(String(title))));
  if (subtitle) titleHost.append(el('div', { class: 'topbar-sub' },
    subtitle instanceof Node ? subtitle : t(String(subtitle))));
  const actionHost = clear(document.getElementById('topbar-actions'));
  for (const action of [].concat(actions)) if (action) actionHost.append(action);
}

async function route() {
  if (!state.user) return;
  const hash = window.location.hash.replace(/^#/, '') || '/';
  const matched = ROUTES.map((r) => ({ r, m: r.path.exec(hash) })).find((x) => x.m);

  for (const link of document.querySelectorAll('.nav-item')) {
    link.classList.toggle('active', link.dataset.nav === matched?.r.nav);
  }

  const host = document.getElementById('view');
  if (!host) return;
  clear(host).append(loading());

  if (!matched) {
    clear(host).append(el('div', { class: 'empty' }, t('That page does not exist.')));
    return setTitle('Not found');
  }

  const context = { setTitle, navigate, rerender: route, params: matched.m.slice(1), query: {} };
  try {
    const content = await matched.r.view(context);
    clear(host);
    if (content) host.append(content);
  } catch (err) {
    if (err.status === 401) return renderLogin();
    clear(host).append(el('div', { class: 'empty' }, [
      el('div', { text: t('This page could not be loaded.') }),
      el('div', { class: 'small faint', text: err.message }),
    ]));
    toast(err.message, 'error');
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);

/**
 * Registering the service worker is what lets Android and iOS offer "install"
 * and give the clinic a real app icon. It is entirely optional: if it fails,
 * the app keeps working as an ordinary web page.
 */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Blocked (private mode, or plain HTTP on a non-localhost host). Not fatal.
    });
  });
}

boot();
