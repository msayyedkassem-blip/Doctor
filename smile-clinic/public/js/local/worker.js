/**
 * The clinic server, running inside the phone.
 *
 * This is the same router and the same route handlers the Node server uses —
 * they are imported directly, not reimplemented. What changes is only what sits
 * underneath: SQLite is WebAssembly rather than a built-in module, crypto is
 * WebCrypto, and a request arrives as a postMessage instead of over a socket.
 */
import { Router, json } from '../../shared/lib/http.js';
import { HttpError } from '../../shared/lib/errors.js';
import { userFromToken, purgeExpiredSessions, COOKIE_NAME } from '../../shared/lib/auth.js';
import { sha256Hex, hashPassword } from '../../shared/lib/crypto.js';
import { q, insert } from '../../shared/db.js';

import registerAuth from '../../shared/routes/auth.js';
import registerUsers from '../../shared/routes/users.js';
import registerSettings from '../../shared/routes/settings.js';
import registerPatients from '../../shared/routes/patients.js';
import registerAppointments from '../../shared/routes/appointments.js';
import registerProcedures from '../../shared/routes/procedures.js';
import registerClinical from '../../shared/routes/clinical.js';
import registerInvoices from '../../shared/routes/invoices.js';
import registerPayments from '../../shared/routes/payments.js';
import registerExpenses from '../../shared/routes/expenses.js';
import registerReports from '../../shared/routes/reports.js';
import registerMessages from '../../shared/routes/messages.js';
import registerLicence from '../../shared/routes/licence.js';
import registerAttachments from '../../shared/routes/attachments.js';
import registerStock from '../../shared/routes/stock.js';

import { runSync, registerDevice, syncSummary } from '../../shared/lib/sync-client.js';
import { installBrowserDriver, exportDatabase, databaseSize } from './sqlite-driver.js';
import { installBrowserCrypto } from './crypto-browser.js';
import { LICENCE_PUBLIC_KEY } from './licence-key.js';
import { setLicencePublicKey } from '../../shared/lib/licence.js';
import { licenceState, startTrial } from '../../shared/lib/licence-state.js';

const router = new Router();
for (const register of [
  registerAuth, registerUsers, registerSettings, registerPatients, registerAppointments,
  registerProcedures, registerClinical, registerInvoices, registerPayments,
  registerExpenses, registerReports, registerMessages, registerLicence,
  registerAttachments, registerStock,
]) register(router);

router.get('/api/health', async (ctx) => {
  json(ctx.res, 200, { ok: true, version: 1, local: true, time: new Date().toISOString() });
}, { public: true });

/** Endpoints that must answer even when the app is read-only. */
const ALWAYS_ALLOWED = new Set([
  '/api/auth/login', '/api/auth/logout', '/api/licence',
]);

/** A stand-in for Node's ServerResponse, capturing what a handler writes. */
function makeResponse() {
  const captured = { status: 200, headers: {}, body: '', headersSent: false };
  return {
    captured,
    setHeader(name, value) { captured.headers[name.toLowerCase()] = value; },
    writeHead(status, headers) {
      captured.status = status;
      captured.headersSent = true;
      for (const [name, value] of Object.entries(headers || {})) {
        captured.headers[name.toLowerCase()] = value;
      }
    },
    end(body) { if (body !== undefined) captured.body = body; },
    on() { /* the shared code only listens for 'finish', which never fires here */ },
    get headersSent() { return captured.headersSent; },
  };
}

let ready = null;

async function boot() {
  installBrowserCrypto();
  await installBrowserDriver();
  setLicencePublicKey(LICENCE_PUBLIC_KEY || null);
  // A phone used on its own gets its own trial; one that joins a clinic takes
  // on the clinic's licence at the first sync and the trial stops mattering.
  startTrial();
  await ensureFirstAdmin();
  purgeExpiredSessions();
}

/**
 * A brand-new phone database has nobody in it. Rather than leave the app
 * unusable, create an administrator with a known first password and require it
 * to be changed — the same shape as the server's first run.
 */
async function ensureFirstAdmin() {
  if (q.get('SELECT COUNT(*) AS n FROM users').n > 0) return;
  const now = new Date().toISOString();
  const id = insert('users', {
    name: 'Clinic Administrator',
    email: 'admin@clinic.local',
    password_hash: await hashPassword('changeme'),
    role: 'admin',
    color: '#2f7d8c',
    active: 1,
    created_at: now,
    updated_at: now,
  });

  // Remember it, so joining a clinic can stand it down rather than let it merge
  // with the clinic's real administrator.
  const created = q.get('SELECT uuid FROM users WHERE id = ?', id);
  if (created) q.run('UPDATE sync_state SET provisional_user_uuid = ? WHERE id = 1', created.uuid);
}

async function handle({ method, path: pathname, query, body, token }) {
  const url = new URLSearchParams(query || '');
  const user = token ? await userFromToken(token) : null;

  const matched = router.match(method, pathname);
  if (!matched) return { status: 404, body: JSON.stringify({ error: 'No such endpoint' }) };

  // The same rule the server applies: unlicensed means read-only, never locked.
  if (!['GET', 'HEAD'].includes(method) && !ALWAYS_ALLOWED.has(pathname)) {
    const licence = await licenceState();
    if (!licence.writable) {
      return { status: 402, body: JSON.stringify({
        error: licence.status === 'trial-over'
          ? 'The free trial has ended. Enter a licence key in Settings to carry on '
            + 'adding records — everything already here stays readable.'
          : 'This copy is read-only until a licence key is entered in Settings. '
            + 'Everything already here stays readable.',
        licence: licence.status,
      }) };
    }
  }

  const res = makeResponse();
  const ctx = {
    req: { method, headers: {}, url: pathname },
    res,
    user,
    token,
    tokenHash: token ? await sha256Hex(token) : null,
    params: matched.params,
    query: url,
    body: body || {},
  };

  await matched.route.handler(ctx);
  return res.captured;
}

self.onmessage = async (event) => {
  const { id, type, request } = event.data || {};
  try {
    if (!ready) ready = boot();
    await ready;

    if (type === 'request') {
      const result = await handle(request);
      self.postMessage({ id, ok: true, result });
      return;
    }
    if (type === 'export') {
      const bytes = exportDatabase();
      self.postMessage({ id, ok: true, result: { bytes, size: bytes.length } }, [bytes.buffer]);
      return;
    }
    if (type === 'sync') {
      const result = await runSync({
        onProgress: (progress) => self.postMessage({ id, progress }),
      });
      self.postMessage({ id, ok: true, result });
      return;
    }
    if (type === 'sync-register') {
      const result = await registerDevice(request);
      self.postMessage({ id, ok: true, result });
      return;
    }
    if (type === 'sync-issues') {
      self.postMessage({ id, ok: true, result: {
        issues: q.all(
          `SELECT table_name, reason, kind, COUNT(*) AS n FROM sync_issues
            WHERE resolved = 0 GROUP BY table_name, reason, kind
            ORDER BY kind, n DESC LIMIT 30`),
        total: q.get(
          "SELECT COUNT(*) AS n FROM sync_issues WHERE resolved = 0 AND kind = 'blocked'").n,
        renumbered: q.get(
          "SELECT COUNT(*) AS n FROM sync_issues WHERE resolved = 0 AND kind = 'renumbered'").n,
      } });
      return;
    }
    if (type === 'sync-summary') {
      self.postMessage({ id, ok: true, result: syncSummary() });
      return;
    }
    if (type === 'status') {
      self.postMessage({ id, ok: true, result: {
        size: databaseSize(),
        patients: q.get('SELECT COUNT(*) AS n FROM patients WHERE archived = 0').n,
        users: q.get('SELECT COUNT(*) AS n FROM users').n,
      } });
      return;
    }
    throw new Error(`Unknown worker message "${type}"`);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    self.postMessage({
      id,
      ok: false,
      result: {
        status,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: err.message, details: err.details }),
      },
    });
  }
};

export { COOKIE_NAME };
