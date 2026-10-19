import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { sha256Hex } from './lib/crypto.js';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { config } from './config.js';
import { q } from './db.js';
import { installNodeDriver } from './db-node.js';
import { installNodeCrypto } from './lib/crypto-node.js';
import { Router, json, readBody, parseCookies } from './lib/http.js';
import { serveStatic } from './lib/static.js';
import { HttpError } from './lib/errors.js';
import { userFromToken, purgeExpiredSessions, COOKIE_NAME, sessionCookie } from './lib/auth.js';
import { hashPassword } from './lib/auth.js';
import { insert } from './db.js';
import { setLicencePublicKey } from './lib/licence.js';
import { licenceState, startTrial } from './lib/licence-state.js';

import registerAuth from './routes/auth.js';
import registerUsers from './routes/users.js';
import registerSettings from './routes/settings.js';
import registerPatients from './routes/patients.js';
import registerAppointments from './routes/appointments.js';
import registerProcedures from './routes/procedures.js';
import registerClinical from './routes/clinical.js';
import registerInvoices from './routes/invoices.js';
import registerPayments from './routes/payments.js';
import registerExpenses from './routes/expenses.js';
import registerReports from './routes/reports.js';
import registerMessages from './routes/messages.js';
import registerNetwork from './routes/network.js';
import registerSync from './routes/sync.js';
import registerLicence from './routes/licence.js';
import registerAttachments from './routes/attachments.js';
import registerStock from './routes/stock.js';
import registerMedicines from './routes/medicines.js';
import registerAssistant from './routes/assistant.js';

// Which copy of the app this is. Worth answering plainly: replacing the files
// and still seeing the old screens almost always means a different copy is the
// one running.
const VERSION = JSON.parse(fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')).version;

const router = new Router();
for (const register of [
  registerAuth, registerUsers, registerSettings, registerPatients, registerAppointments,
  registerProcedures, registerClinical, registerInvoices, registerPayments,
  registerExpenses, registerReports, registerMessages, registerNetwork, registerSync,
  registerLicence, registerAttachments, registerStock, registerMedicines,
  registerAssistant,
]) register(router);

/** Endpoints that must answer even when the clinic is read-only. */
const ALWAYS_ALLOWED = new Set([
  '/api/auth/login', '/api/auth/logout', '/api/licence',
  '/api/sync/pull', '/api/sync/push', '/api/sync/register',
]);

router.get('/api/health', async (ctx) => {
  json(ctx.res, 200, { ok: true, version: VERSION, time: new Date().toISOString() });
}, { public: true });

export async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (!url.pathname.startsWith('/api/')) {
    return serveStatic(req, res, url.pathname);
  }

  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME] || null;
  const user = token ? await userFromToken(token) : null;

  // The session slides forward while a device is in use; the cookie has to
  // slide with it or the browser throws away a session the server still holds.
  if (user?.renewedUntil) {
    res.setHeader('Set-Cookie', sessionCookie(token, user.renewedUntil));
  }

  // Most of the API is same-origin on purpose. The three endpoints devices use
  // to pair and exchange records are the exception: a phone running its own
  // copy is a different origin by definition. They carry no cookies — a device
  // proves itself with a pairing code and then a token — so opening them up
  // grants nothing a stolen cookie could use.
  const matched = router.match(req.method === 'OPTIONS' ? 'POST' : req.method, url.pathname);
  if (matched?.route.options.cors) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Clinic-Request');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') {
    // A browser asking permission before the real request.
    res.writeHead(matched?.route.options.cors ? 204 : 405);
    return res.end();
  }
  if (!matched) return json(res, 404, { error: 'No such endpoint' });

  // An unlicensed clinic is read-only, never locked: every record stays
  // visible, searchable and printable, and only new writing is refused. A
  // dentist mid-appointment is not somebody to hold to ransom over a renewal.
  //
  // Signing in, reading the licence and entering a new key have to keep working
  // — otherwise there would be no way back — and so does syncing, so a device
  // that has been paid for is not cut off from records it already holds.
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !ALWAYS_ALLOWED.has(url.pathname)) {
    const licence = await licenceState();
    if (!licence.writable) {
      return json(res, 402, {
        error: licence.status === 'trial-over'
          ? 'The free trial has ended. Enter a licence key in Settings to carry on '
            + 'adding records — everything already here stays readable.'
          : 'This copy is read-only until a licence key is entered in Settings. '
            + 'Everything already here stays readable.',
        licence: licence.status,
      });
    }
  }

  // Cookie auth + state change means CSRF is possible, so every mutating call
  // must carry a header a cross-site form cannot set.
  //
  // X-Clinic-Request is the canonical one. X-Requested-With is still accepted
  // because Android's WebView injects its own value into that header, which
  // would otherwise make every write from the phone app fail with a 403.
  const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  const vouched = req.headers['x-clinic-request'] === '1'
    || req.headers['x-requested-with'] === 'clinic-app';
  if (mutating && !vouched) {
    return json(res, 403, { error: 'Missing X-Clinic-Request header' });
  }

  const ctx = {
    req,
    res,
    user,
    token,
    tokenHash: token ? await sha256Hex(token) : null,
    params: matched.params,
    query: url.searchParams,
    body: await readBody(req),
  };
  return matched.route.handler(ctx);
}

function onRequest(req, res) {
  const started = Date.now();
  res.on('finish', () => {
    if (process.env.QUIET === '1') return;
    console.log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms`);
  });

  Promise.resolve()
    .then(() => handle(req, res))
    .catch((err) => {
      if (res.headersSent) return;
      if (err instanceof HttpError) {
        return json(res, err.status, { error: err.message, details: err.details });
      }
      console.error('[error]', err);
      json(res, 500, { error: 'Something went wrong on the server' });
    });
}

export async function createServer() {
  installNodeCrypto();
  installNodeDriver();
  loadLicencePublicKey();
  // The trial runs from first use, not from when the zip was downloaded.
  startTrial();
  await ensureFirstAdmin();
  purgeExpiredSessions();
  return http.createServer(onRequest);
}

/**
 * The seller's public key, if this build has one.
 *
 * A build without it enforces nothing, which is the right behaviour for
 * somebody running their own copy from source.
 */
function loadLicencePublicKey() {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'licence-public.txt');
  try {
    setLicencePublicKey(fs.readFileSync(file, 'utf8').trim());
  } catch {
    setLicencePublicKey(null);
  }
}

/**
 * A brand-new database has nobody in it. Rather than ship a hard-coded default
 * password, generate one, print it once, and require a change at first login.
 */
async function ensureFirstAdmin() {
  const count = q.get('SELECT COUNT(*) AS n FROM users').n;
  if (count > 0) return;
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(6).toString('base64url');
  const email = process.env.ADMIN_EMAIL || 'admin@clinic.local';
  const now = new Date().toISOString();
  insert('users', {
    name: 'Clinic Administrator',
    email,
    password_hash: await hashPassword(password),
    role: 'admin',
    color: '#2f7d8c',
    active: 1,
    created_at: now,
    updated_at: now,
  });
  console.log('\n' + '='.repeat(56));
  console.log('  First run — an administrator account was created:');
  console.log(`    email:    ${email}`);
  console.log(`    password: ${password}`);
  console.log('  Change this password after you sign in.');
  console.log('='.repeat(56) + '\n');
}

// pathToFileURL handles spaces, accents and Windows drive letters; building the
// URL by hand silently fails to match whenever the path needs escaping, and the
// server then exits without starting or printing anything.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const server = await createServer();
  server.listen(config.port, config.host, () => {
    console.log(`Smile Clinic is running at http://localhost:${config.port}`);
  });
  // Expired sessions are swept hourly; unref so it never holds the process open.
  setInterval(purgeExpiredSessions, 3600_000).unref();
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => { server.close(() => process.exit(0)); });
  }
}
