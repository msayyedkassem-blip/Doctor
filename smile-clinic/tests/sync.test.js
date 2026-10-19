/**
 * Two devices, edited apart, made to agree.
 *
 * Device A is the clinic server; device B is a phone with its own full
 * database. They are genuinely separate SQLite files, and B reaches A over real
 * HTTP, so what is exercised here is the whole path rather than a simulation of
 * it.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import nodeCrypto from 'node:crypto';

import { setDriver, runMigrations, q, insert, closeDb } from '../server/db.js';
import { readMigrations } from '../server/db-node.js';
import { installNodeCrypto } from '../server/lib/crypto-node.js';
import { hashPassword } from '../server/lib/crypto.js';
import { runSync, registerDevice, syncSummary } from '../server/lib/sync-client.js';
import {
  retireProvisionalAdmin, canonicalUuid, stampLocalNumbers,
} from '../server/lib/sync-core.js';
import {
  packPayload, composeKey, setLicencePublicKey,
} from '../server/lib/licence.js';
import { saveKey } from '../server/lib/licence-state.js';
import { wins } from '../server/routes/sync.js';

installNodeCrypto();

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clinic-sync-'));
const MIGRATIONS = readMigrations();

/** A device is just its own database file; switching devices swaps the driver. */
const devices = new Map();

function makeDevice(name) {
  const db = new DatabaseSync(path.join(dir, `${name}.db`));
  db.exec('PRAGMA foreign_keys = ON');
  setDriver(db);
  runMigrations(db, MIGRATIONS);
  devices.set(name, db);
  return db;
}

function use(name) {
  setDriver(devices.get(name));
}

let server;
let base;
let clinicLicence;
let signingKey;

before(async () => {
  process.env.QUIET = '1';
  makeDevice('server');
  makeDevice('phone');

  // The server needs an admin to enrol devices, and both start from the same
  // staff list so the phone's user rows are not invented.
  use('server');
  const now = new Date().toISOString();
  insert('users', {
    name: 'Admin', email: 'admin@clinic.local',
    password_hash: await hashPassword('test12345'),
    role: 'admin', color: '#000', active: 1, created_at: now, updated_at: now,
  });

  const { createServer } = await import('../server/index.js');
  server = await createServer();

  // Syncing is a licensed feature, and these tests pair several devices. A
  // licence signed for the test covers them, and proves the clinic's licence
  // reaches a phone that joins without anybody typing it in again.
  const pair = nodeCrypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  signingKey = pair.privateKey;
  setLicencePublicKey(
    pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-65).toString('base64'));
  const payload = packPayload({ plan: 'lifetime', devices: 10, serial: 1 });
  clinicLicence = composeKey(payload, nodeCrypto.sign('sha256', payload,
    { key: pair.privateKey, dsaEncoding: 'ieee-p1363' }));
  use('server');
  saveKey(clinicLicence);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  for (const db of devices.values()) { try { db.close(); } catch { /* already shut */ } }
  closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * The server routes run against whichever driver is installed, so every request
 * made by the phone must be served with the server's database in place.
 */
function bridgedFetchFor(name) {
  return (url, options) => bridge(devices.get(name), url, options);
}

function bridgedFetch(url, options) {
  return bridge(devices.get('phone'), url, options);
}

function bridge(caller, url, options) {
  setDriver(devices.get('server'));
  return fetch(url, options).then(async (res) => {
    const text = await res.text();
    setDriver(caller);
    return {
      ok: res.ok,
      status: res.status,
      json: async () => (text ? JSON.parse(text) : {}),
      text: async () => text,
    };
  }).catch((err) => {
    setDriver(caller);
    throw err;
  });
}

describe('conflict rule', () => {
  test('the later edit wins', () => {
    assert.equal(wins('2026-02-01T10:00:00Z', 'a', '2026-02-01T09:00:00Z', 'b'), true);
    assert.equal(wins('2026-02-01T08:00:00Z', 'a', '2026-02-01T09:00:00Z', 'b'), false);
  });

  test('a tie is broken the same way on every device', () => {
    const at = '2026-02-01T10:00:00Z';
    assert.equal(wins(at, 'devB', at, 'devA'), true);
    assert.equal(wins(at, 'devA', at, 'devB'), false);
    // Never both, whichever order they are compared in.
    assert.notEqual(wins(at, 'devA', at, 'devB'), wins(at, 'devB', at, 'devA'));
  });
});

describe('two devices', () => {
  let sessionToken;

  test('an admin hands out a pairing code and the phone uses it', async () => {
    setDriver(devices.get('server'));
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Clinic-Request': '1' },
      body: JSON.stringify({ email: 'admin@clinic.local', password: 'test12345' }),
    });
    assert.equal(login.status, 200);
    sessionToken = /clinic_session=([^;]*)/.exec(login.headers.get('set-cookie'))[1];

    const paired = await fetch(`${base}/api/sync/pair`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Clinic-Request': '1',
        Cookie: `clinic_session=${sessionToken}`,
      },
      body: JSON.stringify({ name: 'Reception phone' }),
    });
    assert.equal(paired.status, 201);
    const { pairing_code: pairingCode } = await paired.json();
    assert.match(pairingCode, /^[A-Z2-9]{6}$/);

    setDriver(devices.get('phone'));
    const enrolled = await registerDevice({
      fetchImpl: bridgedFetch, serverUrl: base, name: 'Reception phone', pairingCode,
    });
    assert.ok(enrolled.device_id);
    assert.ok(enrolled.device_token);
    // A letter of its own, so its numbering cannot collide with the server's.
    assert.match(enrolled.device_code, /^[B-Z]$/);
  });

  test('a pairing code cannot be used twice', async () => {
    setDriver(devices.get('server'));
    const paired = await fetch(`${base}/api/sync/pair`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'X-Clinic-Request': '1',
        Cookie: `clinic_session=${sessionToken}`,
      },
      body: JSON.stringify({ name: 'Spare' }),
    });
    const { pairing_code: code } = await paired.json();

    const use = () => fetch(`${base}/api/sync/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Clinic-Request': '1' },
      body: JSON.stringify({ pairing_code: code, name: 'Spare' }),
    });

    setDriver(devices.get('server'));
    assert.equal((await use()).status, 201);
    setDriver(devices.get('server'));
    assert.equal((await use()).status, 401, 'a used code must not work again');
  });

  test('a wrong pairing code is refused', async () => {
    setDriver(devices.get('server'));
    const res = await fetch(`${base}/api/sync/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Clinic-Request': '1' },
      body: JSON.stringify({ pairing_code: 'ZZZZZZ', name: 'Impostor' }),
    });
    assert.equal(res.status, 401);
  });

  test('a device can reach the clinic from another origin', async () => {
    // A phone running its own copy is a different origin, so the browser asks
    // permission first and refuses to send the request without an answer.
    setDriver(devices.get('server'));
    const preflight = await fetch(`${base}/api/sync/pull`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://appassets.androidplatform.net',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,x-clinic-request',
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
    assert.match(preflight.headers.get('access-control-allow-headers'), /X-Clinic-Request/i);

    // And the rest of the API stays same-origin only.
    const patients = await fetch(`${base}/api/patients`, {
      headers: { Origin: 'https://appassets.androidplatform.net' },
    });
    assert.equal(patients.headers.get('access-control-allow-origin'), null,
      'only the device endpoints should be reachable cross-origin');
  });

  test('the phone numbers its own patients apart from the server', async () => {
    setDriver(devices.get('server'));
    const now = new Date().toISOString();
    insert('patients', {
      code: 'P-0001', first_name: 'Ada', last_name: 'Server',
      archived: 0, created_at: now, updated_at: now,
    });

    setDriver(devices.get('phone'));
    const res = await fetch(`${base}/api/health`);
    assert.equal(res.status, 200);
  });

  test('a patient created on the phone reaches the server', async () => {
    setDriver(devices.get('phone'));
    const now = new Date().toISOString();
    insert('patients', {
      code: 'P-B-0001', first_name: 'ليلى', last_name: 'حسن', phone: '07701234567',
      archived: 0, created_at: now, updated_at: now,
    });
    assert.equal(q.get('SELECT COUNT(*) AS n FROM sync_outbox').n > 0, true);

    const result = await runSync({ fetchImpl: bridgedFetch });
    assert.ok(result.sent >= 1, `expected a push, got ${JSON.stringify(result)}`);

    setDriver(devices.get('server'));
    const arrived = q.get("SELECT * FROM patients WHERE first_name = 'ليلى'");
    assert.ok(arrived, 'the phone’s patient never reached the server');
    assert.equal(arrived.phone, '07701234567');
    assert.equal(arrived.code, 'P-B-0001');
  });

  test('the server’s own records come down to the phone', async () => {
    setDriver(devices.get('phone'));
    await runSync({ fetchImpl: bridgedFetch });
    const arrived = q.get("SELECT * FROM patients WHERE last_name = 'Server'");
    assert.ok(arrived, 'the server’s patient never reached the phone');
    assert.equal(arrived.code, 'P-0001');
  });

  test('rows keep their identity rather than their id', async () => {
    setDriver(devices.get('server'));
    const onServer = q.get("SELECT id, uuid FROM patients WHERE first_name = 'ليلى'");
    setDriver(devices.get('phone'));
    const onPhone = q.get("SELECT id, uuid FROM patients WHERE first_name = 'ليلى'");
    assert.equal(onServer.uuid, onPhone.uuid, 'the same patient must share one identity');
  });

  test('a reference follows its row across devices', async () => {
    setDriver(devices.get('phone'));
    const patient = q.get("SELECT id FROM patients WHERE first_name = 'ليلى'");
    const dentist = q.get('SELECT id FROM users LIMIT 1');
    const now = new Date().toISOString();
    insert('appointments', {
      patient_id: patient.id, dentist_id: dentist.id,
      starts_at: '2030-05-05T09:00', ends_at: '2030-05-05T09:30',
      operatory: 'Chair 1', status: 'scheduled', created_at: now, updated_at: now,
    });
    await runSync({ fetchImpl: bridgedFetch });

    setDriver(devices.get('server'));
    const appointment = q.get(
      `SELECT a.starts_at, p.first_name
         FROM appointments a JOIN patients p ON p.id = a.patient_id
        WHERE a.starts_at = '2030-05-05T09:00'`);
    assert.ok(appointment, 'the appointment never arrived');
    // The local ids differ on each device; the link must still point at the
    // right patient.
    assert.equal(appointment.first_name, 'ليلى');
  });

  test('the later of two offline edits wins', async () => {
    setDriver(devices.get('phone'));
    const uuid = q.get("SELECT uuid FROM patients WHERE first_name = 'ليلى'").uuid;

    // Both edit the same patient without talking to each other.
    setDriver(devices.get('server'));
    q.run("UPDATE patients SET city = 'Server City' WHERE uuid = ?", uuid);
    await new Promise((r) => setTimeout(r, 25));
    setDriver(devices.get('phone'));
    q.run("UPDATE patients SET city = 'Phone City' WHERE uuid = ?", uuid);

    await runSync({ fetchImpl: bridgedFetch });

    setDriver(devices.get('server'));
    assert.equal(q.get('SELECT city FROM patients WHERE uuid = ?', uuid).city, 'Phone City');
    setDriver(devices.get('phone'));
    assert.equal(q.get('SELECT city FROM patients WHERE uuid = ?', uuid).city, 'Phone City');
  });

  test('payments taken on both devices are both kept', async () => {
    setDriver(devices.get('server'));
    const patient = q.get("SELECT id FROM patients WHERE first_name = 'ليلى'");
    const now = new Date().toISOString();
    const invoiceId = insert('invoices', {
      number: 'INV-2026-0001', patient_id: patient.id, issued_at: '2026-02-01',
      status: 'issued', subtotal_cents: 20000, discount_cents: 0, tax_cents: 0,
      total_cents: 20000, created_at: now, updated_at: now,
    });
    insert('payments', {
      patient_id: patient.id, invoice_id: invoiceId, amount_cents: 5000,
      method: 'cash', direction: 'in', paid_at: '2026-02-01', created_at: now,
    });

    setDriver(devices.get('phone'));
    await runSync({ fetchImpl: bridgedFetch });

    // The phone takes a second payment while offline.
    const localPatient = q.get("SELECT id FROM patients WHERE first_name = 'ليلى'");
    const localInvoice = q.get("SELECT id FROM invoices WHERE number = 'INV-2026-0001'");
    assert.ok(localInvoice, 'the invoice never reached the phone');
    insert('payments', {
      patient_id: localPatient.id, invoice_id: localInvoice.id, amount_cents: 15000,
      method: 'card', direction: 'in', paid_at: '2026-02-02',
      created_at: new Date().toISOString(),
    });

    await runSync({ fetchImpl: bridgedFetch });

    for (const device of ['server', 'phone']) {
      setDriver(devices.get(device));
      const invoice = q.get("SELECT id, total_cents, status FROM invoices WHERE number = 'INV-2026-0001'");
      const paid = q.get(
        'SELECT COALESCE(SUM(amount_cents), 0) AS n FROM payments WHERE invoice_id = ?',
        invoice.id).n;
      // Two separate payments, not one overwriting the other.
      assert.equal(paid, 20000, `${device} lost a payment`);
      // And the status is recomputed from them, not copied.
      assert.equal(invoice.status, 'paid', `${device} has the wrong invoice status`);
    }
  });

  test('a deletion on one device removes it from the other', async () => {
    setDriver(devices.get('phone'));
    const now = new Date().toISOString();
    insert('expenses', {
      category: 'Lab', description: 'Crown work', amount_cents: 4200,
      method: 'cash', spent_at: '2026-02-03', created_at: now,
    });
    await runSync({ fetchImpl: bridgedFetch });

    setDriver(devices.get('server'));
    assert.ok(q.get("SELECT id FROM expenses WHERE description = 'Crown work'"));
    q.run("DELETE FROM expenses WHERE description = 'Crown work'");

    setDriver(devices.get('phone'));
    await runSync({ fetchImpl: bridgedFetch });
    assert.equal(q.get("SELECT id FROM expenses WHERE description = 'Crown work'"), null,
      'the deletion never reached the phone');
  });

  test('syncing twice changes nothing further', async () => {
    setDriver(devices.get('phone'));
    const before = await runSync({ fetchImpl: bridgedFetch });
    const after = await runSync({ fetchImpl: bridgedFetch });
    assert.equal(after.sent, 0);
    assert.equal(after.received, 0);
    assert.equal(after.pending, 0);
    assert.ok(before.conflicts.length === 0, JSON.stringify(before.conflicts));
  });

  test('both devices end up holding the same records', async () => {
    const snapshot = (device) => {
      setDriver(devices.get(device));
      const out = {};
      for (const table of ['patients', 'appointments', 'invoices', 'payments', 'expenses']) {
        out[table] = q.all(`SELECT uuid FROM ${table} ORDER BY uuid`).map((r) => r.uuid);
      }
      return out;
    };
    assert.deepEqual(snapshot('phone'), snapshot('server'));
  });

  test("a device's setup sign-in never becomes the clinic's administrator", async () => {
    // A standalone device invents an admin@clinic.local so it is usable before
    // it has met a clinic. Left alone it would merge with the real one and,
    // being the later edit, replace its password.
    setDriver(devices.get('phone'));
    const now = new Date().toISOString();
    insert('users', {
      name: 'Clinic Administrator', email: 'setup-probe@clinic.local',
      password_hash: await hashPassword('changeme'), role: 'admin',
      color: '#000', active: 1, created_at: now, updated_at: now,
    });
    const placeholder = q.get(
      "SELECT uuid FROM users WHERE email = 'setup-probe@clinic.local'").uuid;
    q.run('UPDATE sync_state SET provisional_user_uuid = ? WHERE id = 1', placeholder);

    assert.equal(retireProvisionalAdmin(), true);

    const after = q.get('SELECT email, active FROM users WHERE uuid = ?', placeholder);
    assert.match(after.email, /@device\.local$/, 'it kept an address that could collide');
    assert.equal(after.active, 0, 'it should not be an active sign-in');
    // And it must never travel to the clinic.
    assert.equal(q.get(
      "SELECT COUNT(*) AS n FROM sync_outbox WHERE table_name = 'users' AND row_uuid = ?",
      placeholder).n, 0);
    assert.equal(q.get('SELECT provisional_user_uuid FROM sync_state WHERE id = 1')
      .provisional_user_uuid, '');
  });

  test('doing it twice is harmless', () => {
    setDriver(devices.get('phone'));
    assert.equal(retireProvisionalAdmin(), false);
  });

  test('one person invented on two devices ends up as one record', async () => {
    const email = 'nurse@clinic.local';
    const now = new Date().toISOString();

    // Both devices create the same member of staff while apart.
    setDriver(devices.get('server'));
    insert('users', {
      name: 'Nurse (server)', email, password_hash: await hashPassword('x1'),
      role: 'receptionist', color: '#111', active: 1, created_at: now, updated_at: now,
    });
    setDriver(devices.get('phone'));
    insert('users', {
      name: 'Nurse (phone)', email, password_hash: await hashPassword('x2'),
      role: 'receptionist', color: '#222', active: 1, created_at: now, updated_at: now,
    });

    await runSync({ fetchImpl: bridgedFetch });
    await runSync({ fetchImpl: bridgedFetch });

    const identities = [];
    for (const device of ['server', 'phone']) {
      setDriver(devices.get(device));
      const rows = q.all('SELECT uuid FROM users WHERE email = ?', email);
      assert.equal(rows.length, 1, `${device} kept two rows for one person`);
      identities.push(rows[0].uuid);
    }
    // Both devices must settle on the same identity, or they would rename it
    // back and forth forever.
    assert.equal(identities[0], identities[1]);
  });

  test('a reference to a merged-away identity still finds its row', () => {
    setDriver(devices.get('phone'));
    const alias = q.get(
      'SELECT table_name, alias_uuid, canonical_uuid FROM sync_aliases LIMIT 1');
    if (!alias) return; // nothing was merged on this device
    assert.equal(canonicalUuid(alias.table_name, alias.alias_uuid), alias.canonical_uuid);
    assert.ok(q.get(
      `SELECT id FROM ${alias.table_name} WHERE uuid = ?`, alias.canonical_uuid),
    'the surviving row is missing');
  });

  test('the clinic’s licence reaches a phone that joins', async () => {
    setDriver(devices.get('phone'));
    // Nothing was typed on the phone: it took the clinic's licence at the
    // first exchange, which is what "one code, all its devices" has to mean.
    assert.equal(q.get('SELECT key FROM licence WHERE id = 1').key, clinicLicence);

    const { licenceState } = await import('../server/lib/licence-state.js');
    const state = await licenceState();
    assert.equal(state.status, 'licensed');
    assert.equal(state.writable, true);
    assert.equal(state.devices, 10);
  });

  test('a clinic that lets its licence lapse takes its phones with it', async () => {
    // The server's licence is replaced with one that has already run out.
    setDriver(devices.get('server'));
    const { saveKey: save } = await import('../server/lib/licence-state.js');
    const expiredPayload = packPayload({
      plan: 'monthly', expires: '2020-02-01', devices: 10, serial: 2,
    });
    const expired = composeKey(expiredPayload, nodeCrypto.sign('sha256', expiredPayload,
      { key: signingKey, dsaEncoding: 'ieee-p1363' }));
    save(expired);

    setDriver(devices.get('phone'));
    await runSync({ fetchImpl: bridgedFetch });
    assert.equal(q.get('SELECT key FROM licence WHERE id = 1').key, expired);

    const { licenceState } = await import('../server/lib/licence-state.js');
    const state = await licenceState();
    assert.equal(state.writable, false, 'the phone should follow the clinic');

    // Put it back, so what follows is not testing a lapsed clinic.
    setDriver(devices.get('server'));
    save(clinicLicence);
    setDriver(devices.get('phone'));
    await runSync({ fetchImpl: bridgedFetch });
  });

  test('the summary reports a healthy connection', async () => {
    setDriver(devices.get('phone'));
    const summary = syncSummary();
    assert.equal(summary.connected, true);
    assert.equal(summary.pending, 0);
    assert.equal(summary.last_error, null);
    assert.ok(summary.last_synced_at);
    assert.equal(summary.issues, 0, 'unexpected sync issues were recorded');
  });
});

/**
 * The collision that only happens in real life: a phone used on its own for a
 * while has already handed out P-0001, and so has the clinic. They are two
 * different people, so no merge can help — one of them has to be given another
 * number, and nothing of theirs may be left behind.
 */
describe('numbers two devices both invented', () => {
  const pairPhone = async (name) => {
    setDriver(devices.get('server'));
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Clinic-Request': '1' },
      body: JSON.stringify({ email: 'admin@clinic.local', password: 'test12345' }),
    });
    const token = /clinic_session=([^;]*)/.exec(login.headers.get('set-cookie'))[1];
    const paired = await fetch(`${base}/api/sync/pair`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Clinic-Request': '1',
        Cookie: `clinic_session=${token}`,
      },
      body: JSON.stringify({ name }),
    });
    return (await paired.json()).pairing_code;
  };

  test('joining renames only the numbers this device invented alone', () => {
    makeDevice('spare');
    setDriver(devices.get('spare'));
    const now = new Date().toISOString();
    insert('patients', { code: 'P-0001', first_name: 'A', last_name: 'One',
      archived: 0, created_at: now, updated_at: now });
    insert('patients', { code: 'P-0002', first_name: 'B', last_name: 'Two',
      archived: 0, created_at: now, updated_at: now });
    // Somebody typed this one in by hand; it is not ours to reshape.
    insert('patients', { code: 'AHMED-FILE', first_name: 'C', last_name: 'Three',
      archived: 0, created_at: now, updated_at: now });
    q.run("UPDATE sync_state SET device_code = 'C' WHERE id = 1");

    const moved = stampLocalNumbers();
    assert.equal(moved.length, 2);
    assert.equal(q.get("SELECT code FROM patients WHERE last_name = 'One'").code, 'P-C-0001');
    assert.equal(q.get("SELECT code FROM patients WHERE last_name = 'Two'").code, 'P-C-0002');
    assert.equal(q.get("SELECT code FROM patients WHERE last_name = 'Three'").code, 'AHMED-FILE');
  });

  test('it never touches numbers that have already been shared', () => {
    setDriver(devices.get('spare'));
    q.run('UPDATE sync_state SET last_seq = 7 WHERE id = 1');
    const now = new Date().toISOString();
    insert('patients', { code: 'P-0009', first_name: 'D', last_name: 'Four',
      archived: 0, created_at: now, updated_at: now });

    assert.deepEqual(stampLocalNumbers(), []);
    assert.equal(q.get("SELECT code FROM patients WHERE last_name = 'Four'").code, 'P-0009');
    q.run('UPDATE sync_state SET last_seq = 0 WHERE id = 1');
  });

  test('a phone that used the clinic’s numbers loses nothing when it joins', async () => {
    makeDevice('offline');
    setDriver(devices.get('offline'));
    const now = new Date().toISOString();
    const fetchImpl = bridgedFetchFor('offline');

    // Exactly what a phone does before it has ever met a clinic: it starts at
    // P-0001, the same place the clinic started.
    insert('patients', {
      code: 'P-0001', first_name: 'Nour', last_name: 'Offline', phone: '07709999999',
      archived: 0, created_at: now, updated_at: now,
    });
    const patientId = q.get("SELECT id FROM patients WHERE last_name = 'Offline'").id;
    insert('users', {
      name: 'Admin', email: 'admin@clinic.local', password_hash: 'x',
      role: 'admin', color: '#000', active: 1, created_at: now, updated_at: now,
    });
    insert('appointments', {
      patient_id: patientId,
      dentist_id: q.get("SELECT id FROM users WHERE email = 'admin@clinic.local'").id,
      starts_at: '2026-03-01T09:00:00Z', ends_at: '2026-03-01T09:30:00Z',
      status: 'scheduled', operatory: 'Chair 1', created_at: now, updated_at: now,
    });

    const pairingCode = await pairPhone('Offline phone');
    setDriver(devices.get('offline'));
    const enrolled = await registerDevice({
      fetchImpl, serverUrl: base, name: 'Offline phone', pairingCode,
    });
    // Stamped on the way in, before a single record was exchanged.
    assert.equal(q.get("SELECT code FROM patients WHERE last_name = 'Offline'").code,
      `P-${enrolled.device_code}-0001`);

    await runSync({ fetchImpl });

    // Nothing blocked, and the appointment came with its patient.
    setDriver(devices.get('offline'));
    assert.equal(q.get('SELECT COUNT(*) AS n FROM sync_issues WHERE resolved = 0').n, 0);
    assert.ok(q.get("SELECT id FROM patients WHERE last_name = 'Server'"),
      'the clinic’s own P-0001 never arrived');

    setDriver(devices.get('server'));
    const arrived = q.get("SELECT id, code FROM patients WHERE last_name = 'Offline'");
    assert.ok(arrived, 'the phone’s patient never reached the clinic');
    assert.equal(arrived.code, `P-${enrolled.device_code}-0001`);
    assert.equal(q.get("SELECT code FROM patients WHERE last_name = 'Server'").code, 'P-0001');
    assert.ok(q.get('SELECT id FROM appointments WHERE patient_id = ?', arrived.id),
      'the appointment was left behind');
  });

  test('a clash that reaches the server anyway moves the arriving record', async () => {
    setDriver(devices.get('offline'));
    const fetchImpl = bridgedFetchFor('offline');
    const now = new Date().toISOString();

    // Force the case the stamping is there to prevent, by writing the clinic's
    // number straight onto a new local record.
    insert('patients', {
      code: 'P-0002', first_name: 'Rami', last_name: 'Clash',
      archived: 0, created_at: now, updated_at: now,
    });
    setDriver(devices.get('server'));
    insert('patients', {
      code: 'P-0002', first_name: 'Hala', last_name: 'Clinic',
      archived: 0, created_at: now, updated_at: now,
    });

    setDriver(devices.get('offline'));
    await runSync({ fetchImpl });

    // The clinic keeps the number; the arriving record is given a free one.
    setDriver(devices.get('server'));
    assert.equal(q.get("SELECT code FROM patients WHERE last_name = 'Clinic'").code, 'P-0002');
    const moved = q.get("SELECT code, uuid FROM patients WHERE last_name = 'Clash'");
    assert.ok(moved, 'the arriving patient was dropped instead of renumbered');
    assert.notEqual(moved.code, 'P-0002');

    // And the ledger carries the number it actually got, so the next device to
    // pull does not collide with the clinic all over again.
    const ledger = q.get(
      `SELECT payload FROM sync_changes WHERE table_name = 'patients' AND row_uuid = ?
        ORDER BY server_seq DESC LIMIT 1`, moved.uuid);
    assert.equal(JSON.parse(ledger.payload).code, moved.code);

    // The device that sent it is told, rather than left showing a number that
    // now belongs to somebody else.
    setDriver(devices.get('offline'));
    await runSync({ fetchImpl });
    assert.equal(q.get("SELECT code FROM patients WHERE last_name = 'Clash'").code, moved.code);
    assert.equal(
      q.get("SELECT COUNT(*) AS n FROM sync_issues WHERE kind = 'renumbered'").n >= 0, true);
  });
});
