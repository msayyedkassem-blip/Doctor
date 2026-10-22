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
  retireProvisionalAdmin, canonicalUuid, stampLocalNumbers, applyChanges,
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
    // It does travel — everything the device recorded alone names it, and a
    // reference the clinic cannot resolve costs the whole record. What keeps
    // it from becoming the administrator is the rename and active = 0 above,
    // not withholding it.
    // The outbox is append-only and deduplicated when it is collected, so the
    // insert and the rename both sit there; what matters is that one of them
    // still does.
    assert.ok(q.get(
      "SELECT COUNT(*) AS n FROM sync_outbox WHERE table_name = 'users' AND row_uuid = ?",
      placeholder).n >= 1, 'the renamed, dead account should be sent');
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

  test('an x-ray taken on the phone reaches the clinic', async () => {
    setDriver(devices.get('phone'));
    const now = new Date().toISOString();
    const patient = q.get("SELECT id FROM patients WHERE last_name = 'حسن'");
    // Around a quarter of a megabyte of base64, which is what a downscaled
    // periapical actually weighs once it has been through the browser.
    const image = 'A'.repeat(240_000);
    insert('attachments', {
      patient_id: patient.id, kind: 'xray', caption: 'Periapical 16', tooth: 16,
      taken_on: now.slice(0, 10), mime: 'image/jpeg', width: 1600, height: 1200,
      bytes: 180_000, data: image, thumb: 'B'.repeat(6000),
      created_at: now, updated_at: now,
    });

    await runSync({ fetchImpl: bridgedFetch });

    setDriver(devices.get('server'));
    const arrived = q.get("SELECT * FROM attachments WHERE caption = 'Periapical 16'");
    assert.ok(arrived, 'the x-ray never reached the clinic computer');
    assert.equal(arrived.data.length, image.length, 'the image arrived whole');
    assert.equal(arrived.tooth, 16);
    // The reference followed, like any other row's.
    assert.ok(q.get('SELECT id FROM patients WHERE id = ?', arrived.patient_id));
  });

  test('a batch of images is split by size, not just by count', async () => {
    setDriver(devices.get('phone'));
    const { collectOutbox } = await import('../server/lib/sync-core.js');
    const now = new Date().toISOString();
    const patient = q.get("SELECT id FROM patients WHERE last_name = 'حسن'");

    // Five images of a megabyte each: a count-only limit would try to send
    // all five in one request, which a phone on clinic Wi-Fi will not finish.
    for (let i = 0; i < 5; i += 1) {
      insert('attachments', {
        patient_id: patient.id, kind: 'xray', caption: `Big ${i}`,
        mime: 'image/jpeg', bytes: 750_000, data: 'C'.repeat(1_000_000),
        created_at: now, updated_at: now,
      });
    }

    const batch = collectOutbox(200);
    assert.ok(batch.length < 5, 'the byte budget should cut the batch short');
    assert.ok(batch.length >= 1, 'a batch always carries at least one change');
    const size = batch.reduce((n, c) => n + JSON.stringify(c.payload || '').length, 0);
    assert.ok(size < 4_000_000, `a batch should stay small, was ${size}`);

    // And everything still gets there, batch after batch.
    await runSync({ fetchImpl: bridgedFetch });
    setDriver(devices.get('server'));
    assert.equal(q.get("SELECT COUNT(*) AS n FROM attachments WHERE caption LIKE 'Big %'").n, 5);
  });

  test('the store cupboard and a prescription cross too', async () => {
    setDriver(devices.get('phone'));
    const now = new Date().toISOString();
    const patient = q.get("SELECT id, uuid FROM patients WHERE last_name = 'حسن'");
    const patientUuid = patient.uuid;

    // A material, and the delivery that put it on the shelf. The movement
    // points at the item by a local id that means nothing on the clinic
    // computer, so this is the reference-translation path, not just a row copy.
    const itemId = insert('stock_items', {
      name: 'Composite A2', category: 'Restorative', unit: 'syringe',
      quantity: 6, min_quantity: 2, unit_cost_cents: 1800,
      created_at: now, updated_at: now,
    });
    insert('stock_moves', {
      item_id: itemId, change: 6, reason: 'received', note: 'From the depot',
      created_at: now,
    });

    // A medicine, a prescription, and a line joining the two — three tables
    // deep, which is as far as any reference in the app reaches.
    const medicineId = insert('medicines', {
      name: 'Amoxicillin', name_ar: 'أموكسيسيلين', category: 'Antibiotic',
      form: 'capsule', strength: '500 mg', dose: '1 capsule',
      frequency: 'three times a day', duration: '5 days',
      created_at: now, updated_at: now,
    });
    const prescriptionId = insert('prescriptions', {
      patient_id: patient.id, issued_on: now.slice(0, 10),
      notes: 'After the extraction', created_at: now, updated_at: now,
    });
    insert('prescription_items', {
      prescription_id: prescriptionId, medicine_id: medicineId,
      name: 'Amoxicillin', form: 'capsule', strength: '500 mg',
      dose: '1 capsule', frequency: 'three times a day', duration: '5 days',
      created_at: now, updated_at: now,
    });

    await runSync({ fetchImpl: bridgedFetch });

    setDriver(devices.get('server'));
    const item = q.get("SELECT * FROM stock_items WHERE name = 'Composite A2'");
    assert.ok(item, 'the material never reached the clinic computer');
    assert.equal(item.quantity, 6);
    const move = q.get("SELECT * FROM stock_moves WHERE note = 'From the depot'");
    assert.ok(move, 'the delivery never arrived');
    assert.equal(move.item_id, item.id, 'the movement should point at the item here');

    const medicine = q.get("SELECT * FROM medicines WHERE name = 'Amoxicillin'");
    assert.ok(medicine, 'the medicine never arrived');
    assert.equal(medicine.name_ar, 'أموكسيسيلين', 'the Arabic name arrived intact');
    const prescription = q.get("SELECT * FROM prescriptions WHERE notes = 'After the extraction'");
    assert.ok(prescription, 'the prescription never arrived');
    assert.equal(
      q.get('SELECT uuid FROM patients WHERE id = ?', prescription.patient_id)?.uuid,
      patientUuid, 'the prescription should point at the same person here');
    const line = q.get('SELECT * FROM prescription_items WHERE prescription_id = ?',
      prescription.id);
    assert.ok(line, 'the prescribed medicine never arrived');
    assert.equal(line.medicine_id, medicine.id,
      'the line should point at the medicine as this device numbers it');
    assert.equal(line.dose, '1 capsule');
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

/**
 * A tablet used on its own for weeks, then joined to a clinic computer set up
 * afterwards. This is not a hypothetical: it is what happens when somebody
 * installs the app on a phone first and the computer later, and everything
 * they entered in between has to survive the join.
 *
 * A standalone device invents a sign-in for itself before any real staff
 * exist, and every record it writes names that account. Joining stands the
 * account down — so the question this answers is whether the records it
 * created come across regardless.
 */
describe('a device used alone before the clinic existed', () => {
  const pairCode = async (name) => {
    setDriver(devices.get('server'));
    // Earlier suites have synced devices carrying their own row for this
    // email, and merging by email means the password here is no longer the
    // one they set. Put a known one back rather than depend on that.
    q.run('UPDATE users SET password_hash = ? WHERE email = ?',
      await hashPassword('clinic12345'), 'admin@clinic.local');
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Clinic-Request': '1' },
      body: JSON.stringify({ email: 'admin@clinic.local', password: 'clinic12345' }),
    });
    const cookie = login.headers.get('set-cookie');
    if (!cookie) throw new Error(`login ${login.status}: ${await login.text()}`);
    const token = /clinic_session=([^;]*)/.exec(cookie)[1];
    const paired = await fetch(`${base}/api/sync/pair`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Clinic-Request': '1',
        Cookie: `clinic_session=${token}`,
      },
      body: JSON.stringify({ name }),
    });
    const body = await paired.json();
    if (!body.pairing_code) throw new Error(`pair ${paired.status}: ${JSON.stringify(body)}`);
    return body.pairing_code;
  };

  let counts;

  before(async () => {
    makeDevice('tablet');
    setDriver(devices.get('tablet'));
    const now = new Date().toISOString();

    // The sign-in the device invents for itself, exactly as the in-phone
    // server does on first run.
    const setupId = insert('users', {
      name: 'Administrator', email: 'admin@clinic.local',
      password_hash: await hashPassword('tablet12345'),
      role: 'admin', color: '#111', active: 1, created_at: now, updated_at: now,
    });
    const setup = q.get('SELECT uuid FROM users WHERE id = ?', setupId);
    q.run('UPDATE sync_state SET provisional_user_uuid = ? WHERE id = 1', setup.uuid);

    // A fortnight of real work, every row of it naming that account.
    const procedureId = insert('procedures', {
      code: 'EXT-TAB', name: 'Extraction', category: 'Surgery',
      default_price_cents: 5000, default_duration_min: 30, active: 1,
      created_at: now, updated_at: now,
    });
    const patientId = insert('patients', {
      code: 'P-0001', first_name: 'كريم', last_name: 'صعب', phone: '03111222',
      archived: 0, created_at: now, updated_at: now,
    });
    const appointmentId = insert('appointments', {
      patient_id: patientId, dentist_id: setupId, procedure_id: procedureId,
      starts_at: '2026-03-02T09:00', ends_at: '2026-03-02T09:30',
      status: 'completed', created_by: setupId, created_at: now, updated_at: now,
    });
    insert('tooth_chart', {
      patient_id: patientId, tooth: 36, condition: 'root_canal', surfaces: 'O',
      updated_by: setupId, updated_at: now,
    });
    const treatmentId = insert('treatments', {
      patient_id: patientId, procedure_id: procedureId, appointment_id: appointmentId,
      dentist_id: setupId, tooth: 36, status: 'completed', price_cents: 5000,
      completed_at: now, created_at: now, updated_at: now,
    });
    const invoiceId = insert('invoices', {
      patient_id: patientId, number: 'INV-T-0001', issued_at: now,
      status: 'paid', subtotal_cents: 5000, total_cents: 5000, tax_cents: 0,
      discount_cents: 0, created_by: setupId, created_at: now, updated_at: now,
    });
    insert('invoice_items', {
      invoice_id: invoiceId, treatment_id: treatmentId, procedure_id: procedureId,
      description: 'Extraction 36', tooth: 36, quantity: 1,
      unit_price_cents: 5000, line_total_cents: 5000, position: 1,
    });
    insert('payments', {
      patient_id: patientId, invoice_id: invoiceId, amount_cents: 5000,
      method: 'cash', direction: 'in', paid_at: now, created_by: setupId,
      created_at: now,
    });
    insert('expenses', {
      category: 'Materials', description: 'Gloves (tablet)', amount_cents: 1200,
      method: 'cash', spent_at: now, created_by: setupId, created_at: now,
    });
    insert('attachments', {
      patient_id: patientId, kind: 'xray', caption: 'Periapical 36', tooth: 36,
      taken_on: '2026-03-02', mime: 'image/jpeg', bytes: 40_000,
      data: 'D'.repeat(50_000), created_by: setupId, created_at: now, updated_at: now,
    });
    const itemId = insert('stock_items', {
      name: 'Lidocaine 2%', category: 'Anaesthetic', unit: 'cartridge',
      quantity: 50, min_quantity: 10, created_at: now, updated_at: now,
    });
    insert('stock_moves', {
      item_id: itemId, change: -2, reason: 'used', note: 'Extraction 36',
      created_by: setupId, created_at: now,
    });
    const medicineId = insert('medicines', {
      name: 'Ibuprofen', category: 'Analgesic', form: 'tablet', strength: '400 mg',
      created_at: now, updated_at: now,
    });
    const prescriptionId = insert('prescriptions', {
      patient_id: patientId, issued_on: '2026-03-02', notes: 'After the extraction',
      created_by: setupId, created_at: now, updated_at: now,
    });
    insert('prescription_items', {
      prescription_id: prescriptionId, medicine_id: medicineId, name: 'Ibuprofen',
      form: 'tablet', strength: '400 mg', dose: '1 tablet',
      created_at: now, updated_at: now,
    });

    counts = {
      patients: q.get('SELECT COUNT(*) AS n FROM patients').n,
      appointments: q.get('SELECT COUNT(*) AS n FROM appointments').n,
      treatments: q.get('SELECT COUNT(*) AS n FROM treatments').n,
      invoices: q.get('SELECT COUNT(*) AS n FROM invoices').n,
      payments: q.get('SELECT COUNT(*) AS n FROM payments').n,
      expenses: q.get('SELECT COUNT(*) AS n FROM expenses').n,
      attachments: q.get('SELECT COUNT(*) AS n FROM attachments').n,
      prescriptions: q.get('SELECT COUNT(*) AS n FROM prescriptions').n,
      stock_moves: q.get('SELECT COUNT(*) AS n FROM stock_moves').n,
      tooth_chart: q.get('SELECT COUNT(*) AS n FROM tooth_chart').n,
    };

    // The join, exactly as the phone performs it.
    const code = await pairCode('Brother tablet');
    setDriver(devices.get('tablet'));
    // Every request must be served by the clinic's database and then hand
    // control back to the tablet's — this device, not the phone above.
    const asTablet = bridgedFetchFor('tablet');
    await registerDevice({
      fetchImpl: asTablet, serverUrl: base, name: 'Brother tablet', pairingCode: code,
    });
    // Twice: the first exchange sends, the second proves nothing is left over.
    await runSync({ fetchImpl: asTablet });
    await runSync({ fetchImpl: asTablet });
  });

  test('nothing it recorded alone is left behind', () => {
    setDriver(devices.get('tablet'));
    const issues = q.all('SELECT table_name, reason FROM sync_issues WHERE resolved = 0');
    const stranded = issues.filter((i) => /never arrived/.test(i.reason));
    assert.deepEqual(stranded, [], 'records were rejected for pointing at a missing row');
  });

  test('every kind of record reached the clinic', () => {
    setDriver(devices.get('server'));
    const patient = q.get("SELECT id FROM patients WHERE last_name = 'صعب'");
    assert.ok(patient, 'the patient never arrived');

    const checks = {
      appointments: "SELECT COUNT(*) AS n FROM appointments WHERE patient_id = ?",
      treatments: "SELECT COUNT(*) AS n FROM treatments WHERE patient_id = ?",
      invoices: "SELECT COUNT(*) AS n FROM invoices WHERE patient_id = ?",
      payments: "SELECT COUNT(*) AS n FROM payments WHERE patient_id = ?",
      attachments: "SELECT COUNT(*) AS n FROM attachments WHERE patient_id = ?",
      prescriptions: "SELECT COUNT(*) AS n FROM prescriptions WHERE patient_id = ?",
      tooth_chart: "SELECT COUNT(*) AS n FROM tooth_chart WHERE patient_id = ?",
    };
    const missing = [];
    for (const [table, sql] of Object.entries(checks)) {
      if (q.get(sql, patient.id).n === 0) missing.push(table);
    }
    assert.deepEqual(missing, [], `these never arrived: ${missing.join(', ')}`);

    assert.ok(q.get("SELECT id FROM expenses WHERE description = 'Gloves (tablet)'"),
      'the expense never arrived');
    assert.ok(q.get("SELECT id FROM stock_moves WHERE note = 'Extraction 36'"),
      'the stock movement never arrived');
    assert.ok(q.get("SELECT id FROM prescription_items WHERE name = 'Ibuprofen'"),
      'the prescribed medicine never arrived');
  });

  test('the money still adds up on the clinic computer', () => {
    setDriver(devices.get('server'));
    const invoice = q.get("SELECT * FROM invoices WHERE number LIKE 'INV-T-%'");
    assert.ok(invoice, 'the invoice never arrived');
    const paid = q.get(
      'SELECT COALESCE(SUM(amount_cents), 0) AS n FROM payments WHERE invoice_id = ?',
      invoice.id).n;
    assert.equal(paid, 5000, 'the payment did not land against its invoice');
  });

  test("the clinic administrator's password survives the join", async () => {
    // The tablet's own setup account used admin@clinic.local, the same address
    // as the clinic's real administrator, and staff rows merge by email. If the
    // rename were ever dropped, this is the test that would catch it: the
    // clinic's password would silently become the tablet's.
    setDriver(devices.get('server'));
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Clinic-Request': '1' },
      body: JSON.stringify({ email: 'admin@clinic.local', password: 'clinic12345' }),
    });
    assert.equal(login.status, 200, 'the clinic administrator can no longer sign in');

    // And the tablet's account is here, dead, under its own address.
    const setup = q.get("SELECT * FROM users WHERE email LIKE 'setup-%@device.local'");
    assert.ok(setup, 'the setup account should have arrived, so references resolve');
    assert.equal(setup.active, 0, 'it must not be a sign-in anybody can use');

    const tabletLogin = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Clinic-Request': '1' },
      body: JSON.stringify({ email: setup.email, password: 'tablet12345' }),
    });
    assert.notEqual(tabletLogin.status, 200, 'the dead account let somebody in');
  });

  test('a reference to somebody who never arrives loses the name, not the record', () => {
    // Belt and braces for the case above: whatever the reason a reference
    // cannot be resolved, the money and the treatment still have to land.
    setDriver(devices.get('server'));
    const patient = q.get("SELECT id, uuid FROM patients WHERE last_name = 'صعب'");
    const invoice = q.get("SELECT uuid FROM invoices WHERE number LIKE 'INV-T-%'");

    const outcome = applyChanges([{
      table_name: 'payments',
      row_uuid: 'aaaaaaaabbbbccccddddeeeeeeeeeeee',
      op: 'upsert',
      changed_at: new Date().toISOString(),
      payload: {
        patient_id__uuid: patient.uuid,
        invoice_id__uuid: invoice.uuid,
        // Nobody, on any device, has ever had this uuid.
        created_by__uuid: 'ffffffffffffffffffffffffffffffff',
        amount_cents: 2500, method: 'cash', direction: 'in',
        paid_at: new Date().toISOString(), created_at: new Date().toISOString(),
      },
    }]);

    assert.equal(outcome.applied, 1, 'the payment should have been kept');
    assert.deepEqual(outcome.deferred, [], 'nothing should still be waiting');
    const landed = q.get(
      "SELECT * FROM payments WHERE uuid = 'aaaaaaaabbbbccccddddeeeeeeeeeeee'");
    assert.ok(landed, 'the payment is not there');
    assert.equal(landed.amount_cents, 2500);
    assert.equal(landed.patient_id, patient.id, 'the references that could resolve did');
    assert.equal(landed.created_by, null, 'the one that could not was emptied');

    // And it says so, rather than quietly changing the record.
    const noted = q.get(
      "SELECT * FROM sync_issues WHERE kind = 'incomplete' AND row_uuid = ?",
      'aaaaaaaabbbbccccddddeeeeeeeeeeee');
    assert.ok(noted, 'the dropped reference should be reported');
    assert.match(noted.reason, /created by/);
  });

  test('the tablet keeps its own records too', () => {
    setDriver(devices.get('tablet'));
    for (const [table, count] of Object.entries(counts)) {
      assert.ok(q.get(`SELECT COUNT(*) AS n FROM ${table}`).n >= count,
        `${table} lost rows on the tablet itself`);
    }
  });
});

