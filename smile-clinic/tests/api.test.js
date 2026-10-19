/**
 * End-to-end tests over real HTTP against a throwaway database, so the
 * routing, auth, RBAC and money rules are exercised exactly as in production.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import nodeCrypto from 'node:crypto';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clinic-test-'));
process.env.DATA_DIR = dir;
process.env.DB_FILE = path.join(dir, 'test.db');
process.env.ADMIN_EMAIL = 'admin@test.local';
process.env.ADMIN_PASSWORD = 'test12345';
process.env.QUIET = '1';

const { createServer } = await import('../server/index.js');
const { closeDb } = await import('../server/db.js');

let base;
let server;
const jars = new Map();

before(async () => {
  server = await createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Minimal cookie-jar-aware request helper, one jar per named session. */
async function call(method, url, body, { as = 'admin', csrf = true } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (csrf) headers['X-Clinic-Request'] = '1';
  if (jars.get(as)) headers.Cookie = jars.get(as);

  const res = await fetch(base + url, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) jars.set(as, setCookie.split(';')[0]);

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json, text };
}

const get = (url, opts) => call('GET', url, undefined, opts);
const post = (url, body, opts) => call('POST', url, body, opts);
const put = (url, body, opts) => call('PUT', url, body, opts);
const patch = (url, body, opts) => call('PATCH', url, body, opts);
const del = (url, opts) => call('DELETE', url, undefined, opts);

const login = (email, password, as) =>
  post('/api/auth/login', { email, password }, { as });

describe('health and auth', () => {
  test('health needs no session', async () => {
    const res = await get('/api/health', { as: 'anon' });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  });

  test('the API refuses anonymous reads', async () => {
    assert.equal((await get('/api/patients', { as: 'anon' })).status, 401);
  });

  test('a bad password is rejected with a generic message', async () => {
    const res = await login('admin@test.local', 'wrong', 'bad');
    assert.equal(res.status, 401);
    assert.match(res.body.error, /incorrect/);
  });

  test('the first-run admin can sign in', async () => {
    const res = await login('admin@test.local', 'test12345', 'admin');
    assert.equal(res.status, 200);
    assert.equal(res.body.user.role, 'admin');
    assert.deepEqual(res.body.permissions, ['*']);
  });

  test('writes without the anti-CSRF header are blocked', async () => {
    const res = await post('/api/patients',
      { first_name: 'A', last_name: 'B' }, { csrf: false });
    assert.equal(res.status, 403);
    assert.match(res.body.error, /X-Clinic-Request/);
  });

  test('the older header is still accepted, for the Android WebView', async () => {
    // An incomplete body: a 400 proves the CSRF gate let it through, without
    // creating a patient and shifting the file-number sequence.
    const res = await fetch(`${base}/api/patients`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'clinic-app',
        Cookie: jars.get('admin'),
      },
      body: JSON.stringify({ first_name: 'NoSurname' }),
    });
    assert.equal(res.status, 400);
  });

  test('a WebView-style X-Requested-With alone is NOT enough', async () => {
    // Android injects the package name here, so it must not count as proof.
    const res = await fetch(`${base}/api/patients`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'com.smileclinic.app',
        Cookie: jars.get('admin'),
      },
      body: JSON.stringify({ first_name: 'NoSurname' }),
    });
    // 403, not 400: rejected before the body was even looked at.
    assert.equal(res.status, 403);
  });

  test('unknown endpoints 404 and wrong methods 405', async () => {
    assert.equal((await get('/api/nothing-here')).status, 404);
    assert.equal((await del('/api/health')).status, 405);
  });
});

describe('patients', () => {
  let patientId;

  test('creating a patient assigns a sequential file number', async () => {
    const res = await post('/api/patients', {
      first_name: 'Ada', last_name: 'Lovelace', phone: '555-0101',
      dob: '1985-12-10', allergies: 'Penicillin',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.patient.code, 'P-0001');
    patientId = res.body.patient.id;

    const second = await post('/api/patients', { first_name: 'Alan', last_name: 'Turing' });
    assert.equal(second.body.patient.code, 'P-0002');
  });

  test('a missing required field is a 400 naming the field', async () => {
    const res = await post('/api/patients', { first_name: 'NoSurname' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /"last_name" is required/);
  });

  test('an invalid email is rejected', async () => {
    const res = await post('/api/patients',
      { first_name: 'A', last_name: 'B', email: 'nope' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /valid email/);
  });

  test('search matches across name, phone and file number', async () => {
    assert.equal((await get('/api/patients?q=Lovelace')).body.total, 1);
    assert.equal((await get('/api/patients?q=555-0101')).body.total, 1);
    assert.equal((await get('/api/patients?q=P-0002')).body.total, 1);
    assert.equal((await get('/api/patients?q=zzzz')).body.total, 0);
    assert.equal((await get('/api/patients?q=Ada%20Love')).body.total, 1);
  });

  test('deleting archives instead of destroying history', async () => {
    const { body } = await post('/api/patients', { first_name: 'Temp', last_name: 'Person' });
    assert.equal((await del(`/api/patients/${body.patient.id}`)).status, 200);
    const still = await get(`/api/patients/${body.patient.id}`);
    assert.equal(still.status, 200);
    assert.equal(still.body.patient.archived, 1);
    const active = await get('/api/patients?q=Temp');
    assert.equal(active.body.total, 0);
    assert.equal((await get('/api/patients?q=Temp&archived=1')).body.total, 1);
  });

  test('a missing patient is a 404', async () => {
    assert.equal((await get('/api/patients/99999')).status, 404);
  });

  test('the summary endpoint returns every section of the file', async () => {
    const res = await get(`/api/patients/${patientId}/summary`);
    assert.equal(res.status, 200);
    for (const key of ['patient', 'appointments', 'treatments', 'invoices', 'payments', 'chart', 'stats']) {
      assert.ok(key in res.body, `missing ${key}`);
    }
  });
});

describe('appointments', () => {
  let patientId;
  let appointmentId;

  before(async () => {
    patientId = (await get('/api/patients?q=Lovelace')).body.patients[0].id;
  });

  test('an appointment can be booked and gets an end time from its duration', async () => {
    const res = await post('/api/appointments', {
      patient_id: patientId, dentist_id: 1,
      starts_at: '2030-06-03T09:00', duration_min: 45, operatory: 'Chair 1',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.appointment.ends_at, '2030-06-03T09:45');
    assert.equal(res.body.appointment.status, 'scheduled');
    appointmentId = res.body.appointment.id;
  });

  test('double-booking the same practitioner is a 409', async () => {
    const res = await post('/api/appointments', {
      patient_id: patientId, dentist_id: 1,
      starts_at: '2030-06-03T09:30', duration_min: 30, operatory: 'Chair 2',
    });
    assert.equal(res.status, 409);
    assert.ok(res.body.details.clashes.length >= 1);
  });

  test('a clash can be overridden deliberately', async () => {
    const res = await post('/api/appointments', {
      patient_id: patientId, dentist_id: 1,
      starts_at: '2030-06-03T09:30', duration_min: 30, operatory: 'Chair 2', force: '1',
    });
    assert.equal(res.status, 201);
    await del(`/api/appointments/${res.body.appointment.id}`);
  });

  test('booking back-to-back is allowed', async () => {
    const res = await post('/api/appointments', {
      patient_id: patientId, dentist_id: 1,
      starts_at: '2030-06-03T09:45', duration_min: 15, operatory: 'Chair 1',
    });
    assert.equal(res.status, 201);
    await del(`/api/appointments/${res.body.appointment.id}`);
  });

  test('an appointment that ends before it starts is rejected', async () => {
    const res = await post('/api/appointments', {
      patient_id: patientId, dentist_id: 1,
      starts_at: '2030-06-04T10:00', ends_at: '2030-06-04T09:00',
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /end after it starts/);
  });

  test('booking for an unknown patient is a 404', async () => {
    const res = await post('/api/appointments', {
      patient_id: 99999, dentist_id: 1, starts_at: '2030-06-05T10:00',
    });
    assert.equal(res.status, 404);
  });

  test('status moves through the desk workflow', async () => {
    for (const status of ['confirmed', 'arrived', 'completed']) {
      const res = await patch(`/api/appointments/${appointmentId}/status`, { status });
      assert.equal(res.status, 200);
      assert.equal(res.body.appointment.status, status);
    }
  });

  test('cancelling requires a reason', async () => {
    const created = await post('/api/appointments', {
      patient_id: patientId, dentist_id: 1, starts_at: '2030-07-01T11:00',
    });
    const id = created.body.appointment.id;
    assert.equal((await patch(`/api/appointments/${id}/status`, { status: 'cancelled' })).status, 400);
    const ok = await patch(`/api/appointments/${id}/status`,
      { status: 'cancelled', cancel_reason: 'Patient rescheduled' });
    assert.equal(ok.body.appointment.cancel_reason, 'Patient rescheduled');
  });

  test('a cancelled slot frees up again', async () => {
    const res = await post('/api/appointments', {
      patient_id: patientId, dentist_id: 1, starts_at: '2030-07-01T11:00', duration_min: 30,
    });
    assert.equal(res.status, 201);
  });

  test('availability reports free and busy slots', async () => {
    const res = await get('/api/appointments/availability?date=2030-06-03&dentist_id=1&duration=30');
    assert.equal(res.status, 200);
    assert.ok(res.body.slots.length > 0);
    assert.equal(res.body.slots.find((s) => s.start === '2030-06-03T09:00').free, false);
    assert.equal(res.body.slots.find((s) => s.start === '2030-06-03T15:00').free, true);
  });
});

describe('clinical records', () => {
  let patientId;

  before(async () => {
    patientId = (await get('/api/patients?q=Lovelace')).body.patients[0].id;
  });

  test('charting a tooth is idempotent per tooth', async () => {
    const first = await put(`/api/patients/${patientId}/chart/16`,
      { condition: 'caries', surfaces: 'mo' });
    assert.equal(first.status, 200);
    assert.equal(first.body.tooth.surfaces, 'MO');

    await put(`/api/patients/${patientId}/chart/16`, { condition: 'filled', surfaces: 'MOD' });
    const chart = await get(`/api/patients/${patientId}/chart`);
    const entries = chart.body.chart.filter((t) => t.tooth === 16);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].condition, 'filled');
  });

  test('an impossible tooth number is rejected', async () => {
    assert.equal((await put(`/api/patients/${patientId}/chart/99`, { condition: 'caries' })).status, 400);
  });

  test('an unknown condition is rejected', async () => {
    assert.equal((await put(`/api/patients/${patientId}/chart/16`, { condition: 'sparkly' })).status, 400);
  });

  test('a treatment defaults its price from the procedure catalogue', async () => {
    const procedure = (await post('/api/procedures', {
      code: 'TFILL', name: 'Test filling', category: 'Restorative',
      default_price: '120.00', default_duration_min: 40,
    })).body.procedure;

    const res = await post('/api/treatments', {
      patient_id: patientId, procedure_id: procedure.id, tooth: 16, status: 'completed',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.treatment.price_cents, 12000);
    assert.equal(res.body.treatment.completed_at.length, 10);
  });

  test('a discount larger than the price is rejected', async () => {
    const procedureId = (await get('/api/procedures')).body.procedures[0].id;
    const res = await post('/api/treatments', {
      patient_id: patientId, procedure_id: procedureId, price: '50.00', discount: '90.00',
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /discount cannot be larger/);
  });
});

describe('invoicing and payments', () => {
  let patientId;
  let invoiceId;

  before(async () => {
    patientId = (await get('/api/patients?q=Lovelace')).body.patients[0].id;
  });

  test('completed treatments can be billed in one step', async () => {
    const res = await post(`/api/patients/${patientId}/invoice-pending`, {});
    assert.equal(res.status, 201);
    assert.match(res.body.invoice.number, /^INV-\d{4}-0001$/);
    assert.equal(res.body.invoice.total_cents, 12000);
    invoiceId = res.body.invoice.id;
  });

  test('billed treatments are not offered twice', async () => {
    const res = await post(`/api/patients/${patientId}/invoice-pending`, {});
    assert.equal(res.status, 400);
    assert.match(res.body.error, /no completed, uninvoiced/);
  });

  test('an invoiced treatment cannot be edited', async () => {
    const treatments = (await get(`/api/treatments?patient_id=${patientId}`)).body.treatments;
    const invoiced = treatments.find((t) => t.invoiced);
    const res = await put(`/api/treatments/${invoiced.id}`, {
      patient_id: patientId, procedure_id: invoiced.procedure_id, price: '1.00',
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /already on an invoice/);
  });

  test('overpaying an invoice is refused', async () => {
    const res = await post('/api/payments', { invoice_id: invoiceId, amount: '500.00' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /more than the invoice still owes/);
  });

  test('a part payment moves the invoice to partial', async () => {
    const res = await post('/api/payments',
      { invoice_id: invoiceId, amount: '50.00', method: 'card' });
    assert.equal(res.status, 201);
    const invoice = (await get(`/api/invoices/${invoiceId}`)).body.invoice;
    assert.equal(invoice.status, 'partial');
    assert.equal(invoice.paid_cents, 5000);
  });

  test('settling the balance marks it paid', async () => {
    await post('/api/payments', { invoice_id: invoiceId, amount: '70.00', method: 'cash' });
    const invoice = (await get(`/api/invoices/${invoiceId}`)).body.invoice;
    assert.equal(invoice.status, 'paid');
    assert.equal(invoice.paid_cents, 12000);
  });

  test('an invoice with payments cannot be voided', async () => {
    const res = await post(`/api/invoices/${invoiceId}/void`, { reason: 'mistake' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Refund the payments/);
  });

  test('a refund reopens the invoice and then it can be voided', async () => {
    const refund = await post('/api/payments', {
      invoice_id: invoiceId, amount: '120.00', direction: 'refund', method: 'cash',
    });
    assert.equal(refund.status, 201);
    const afterRefund = (await get(`/api/invoices/${invoiceId}`)).body.invoice;
    assert.equal(afterRefund.paid_cents, 0);
    assert.equal(afterRefund.status, 'issued');

    const voided = await post(`/api/invoices/${invoiceId}/void`, { reason: 'Billed in error' });
    assert.equal(voided.status, 200);
    assert.equal(voided.body.invoice.status, 'void');

    // Voiding releases the treatment so it can be billed again.
    const treatments = (await get(`/api/treatments?patient_id=${patientId}&uninvoiced=1`)).body.treatments;
    assert.ok(treatments.some((t) => t.status === 'completed'));
  });

  test('refunding more than was paid is refused', async () => {
    const res = await post('/api/payments', {
      invoice_id: invoiceId, amount: '10.00', direction: 'refund',
    });
    assert.equal(res.status, 400);
  });

  test('a manual invoice computes its own totals with tax', async () => {
    const res = await post('/api/invoices', {
      patient_id: patientId,
      items: [
        { description: 'Consultation', quantity: 1, unit_price: '80.00', tax_rate_bp: 1000 },
        { description: 'X-ray', quantity: 2, unit_price: '35.00', discount: '10.00' },
      ],
      discount: '0',
    });
    assert.equal(res.status, 201);
    const invoice = res.body.invoice;
    assert.equal(invoice.subtotal_cents, 8000 + 6000);
    assert.equal(invoice.tax_cents, 800);
    assert.equal(invoice.total_cents, 14800);
  });

  test('an invoice needs at least one line', async () => {
    const res = await post('/api/invoices', { patient_id: patientId, items: [] });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /at least one line/);
  });

  test('a draft cannot take payment until it is issued', async () => {
    const draft = (await post('/api/invoices', {
      patient_id: patientId, status: 'draft',
      items: [{ description: 'Night guard', unit_price: '200.00' }],
    })).body.invoice;

    const tooEarly = await post('/api/payments', { invoice_id: draft.id, amount: '10.00' });
    assert.equal(tooEarly.status, 400);
    assert.match(tooEarly.body.error, /Issue the invoice/);

    assert.equal((await post(`/api/invoices/${draft.id}/issue`, {})).body.invoice.status, 'issued');
    assert.equal((await post('/api/payments', { invoice_id: draft.id, amount: '10.00' })).status, 201);
  });

  test('a payment can be taken on account without an invoice', async () => {
    const res = await post('/api/payments',
      { patient_id: patientId, amount: '25.00', method: 'cash' });
    assert.equal(res.status, 201);
    assert.equal(res.body.payment.invoice_id, null);
  });

  test('a zero or negative payment is refused', async () => {
    assert.equal((await post('/api/payments', { patient_id: patientId, amount: '0' })).status, 400);
    assert.equal((await post('/api/payments', { patient_id: patientId, amount: '-5' })).status, 400);
  });

  test('the patient balance reflects issued invoices minus payments', async () => {
    const { patient } = (await get(`/api/patients/${patientId}`)).body;
    const invoices = (await get(`/api/invoices?patient_id=${patientId}`)).body;
    const expected = invoices.invoices
      .filter((i) => !['draft', 'void'].includes(i.status))
      .reduce((sum, i) => sum + i.total_cents, 0)
      - (await get(`/api/payments?patient_id=${patientId}`)).body.total_cents;
    assert.equal(patient.balance_cents, expected);
  });
});

describe('expenses and reports', () => {
  test('an expense is recorded and totalled', async () => {
    const res = await post('/api/expenses', {
      category: 'Lab', description: 'Crown fabrication', amount: '210.00', method: 'transfer',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.expense.amount_cents, 21000);
    const list = await get('/api/expenses');
    assert.ok(list.body.total_cents >= 21000);
  });

  test('a zero expense is refused', async () => {
    assert.equal((await post('/api/expenses', { description: 'Nothing', amount: '0' })).status, 400);
  });

  test('the dashboard returns KPIs and a 30-day series', async () => {
    const res = await get('/api/dashboard');
    assert.equal(res.status, 200);
    assert.equal(res.body.revenue_series.length, 30);
    for (const key of ['collected_today_cents', 'outstanding_cents', 'patients_total']) {
      assert.equal(typeof res.body.kpis[key], 'number', key);
    }
  });

  test('the financial report reconciles collections against expenses', async () => {
    const res = await get('/api/reports/financial?from=2000-01-01&to=2100-01-01');
    assert.equal(res.status, 200);
    const s = res.body.summary;
    assert.equal(s.net_cents, s.collected_cents - s.expenses_cents);
    assert.equal(s.collected_cents, s.gross_collected_cents - s.refunds_cents);
  });

  test('an inverted date range is rejected', async () => {
    const res = await get('/api/reports/financial?from=2026-12-01&to=2026-01-01');
    assert.equal(res.status, 400);
  });

  test('receivables age the outstanding invoices', async () => {
    const res = await get('/api/reports/receivables');
    assert.equal(res.status, 200);
    const summed = res.body.invoices.reduce((sum, i) => sum + i.balance_cents, 0);
    assert.equal(summed, res.body.total_cents);
    const buckets = Object.values(res.body.aging).reduce((a, b) => a + b, 0);
    assert.equal(buckets, res.body.total_cents);
  });

  test('CSV export returns a header row and an attachment name', async () => {
    const res = await fetch(
      `${base}/api/reports/export/payments?from=2000-01-01&to=2100-01-01`,
      { headers: { Cookie: jars.get('admin') } },
    );
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /attachment; filename="payments-/);
    const csv = await res.text();
    assert.match(csv.split('\n')[0], /^date,patient_code,patient,invoice/);
  });

  test('an unknown export kind is a 400', async () => {
    assert.equal((await get('/api/reports/export/secrets')).status, 400);
  });
});

describe('roles', () => {
  before(async () => {
    for (const [email, role] of [
      ['desk@test.local', 'receptionist'],
      ['dds@test.local', 'dentist'],
      ['books@test.local', 'accountant'],
    ]) {
      await post('/api/users', { name: role, email, role, password: 'test12345' });
      await login(email, 'test12345', role);
    }
  });

  test('a receptionist runs the desk but not the clinic', async () => {
    const as = { as: 'receptionist' };
    assert.equal((await get('/api/patients', as)).status, 200);
    assert.equal((await post('/api/patients',
      { first_name: 'Desk', last_name: 'Made' }, as)).status, 201);
    assert.equal((await put('/api/patients/1/chart/21', { condition: 'caries' }, as)).status, 403);
    assert.equal((await put('/api/settings', { clinic_name: 'Nope' }, as)).status, 403);
    assert.equal((await post('/api/users',
      { name: 'x', email: 'x@y.z', role: 'admin', password: 'test12345' }, as)).status, 403);
  });

  test('a dentist charts but does not bill', async () => {
    const as = { as: 'dentist' };
    assert.equal((await put('/api/patients/1/chart/21', { condition: 'caries' }, as)).status, 200);
    assert.equal((await get('/api/invoices', as)).status, 200);
    assert.equal((await post('/api/invoices',
      { patient_id: 1, items: [{ description: 'x', unit_price: '1' }] }, as)).status, 403);
  });

  test('an accountant handles money but not patient records', async () => {
    const as = { as: 'accountant' };
    assert.equal((await get('/api/reports/financial', as)).status, 200);
    assert.equal((await post('/api/expenses',
      { description: 'Gloves', amount: '30.00' }, as)).status, 201);
    assert.equal((await post('/api/patients',
      { first_name: 'No', last_name: 'Way' }, as)).status, 403);
  });

  test('the last active administrator cannot be demoted', async () => {
    const res = await put('/api/users/1', {
      name: 'Clinic Administrator', email: 'admin@test.local', role: 'receptionist',
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /last active administrator/);
  });

  test('a duplicate email is a 409', async () => {
    const res = await post('/api/users',
      { name: 'Clone', email: 'desk@test.local', role: 'dentist', password: 'test12345' });
    assert.equal(res.status, 409);
  });

  test('a short password is refused', async () => {
    const res = await post('/api/users',
      { name: 'Short', email: 'short@test.local', role: 'dentist', password: 'abc' });
    assert.equal(res.status, 400);
  });

  test('disabling a user kills their session', async () => {
    const user = (await get('/api/users')).body.users.find((u) => u.email === 'books@test.local');
    await put(`/api/users/${user.id}`, {
      name: user.name, email: user.email, role: user.role, active: false,
    });
    assert.equal((await get('/api/patients', { as: 'accountant' })).status, 401);
  });

  test('signing out invalidates the cookie', async () => {
    await login('desk@test.local', 'test12345', 'bye');
    assert.equal((await get('/api/auth/me', { as: 'bye' })).status, 200);
    await post('/api/auth/logout', {}, { as: 'bye' });
    assert.equal((await get('/api/auth/me', { as: 'bye' })).status, 401);
  });
});

describe('settings', () => {
  test('defaults are returned before anything is saved', async () => {
    const res = await get('/api/settings');
    assert.equal(res.status, 200);
    assert.ok(res.body.settings.currency);
    assert.ok(res.body.settings.operatories);
  });

  test('only known keys are stored', async () => {
    const res = await put('/api/settings',
      { clinic_name: 'Test Clinic', evil_key: 'dropped' });
    assert.equal(res.body.settings.clinic_name, 'Test Clinic');
    assert.equal('evil_key' in res.body.settings, false);
  });

  test('the invoice prefix flows into new invoice numbers', async () => {
    await put('/api/settings', { invoice_prefix: 'BILL' });
    const patientId = (await get('/api/patients?q=Lovelace')).body.patients[0].id;
    const res = await post('/api/invoices', {
      patient_id: patientId, items: [{ description: 'Check-up', unit_price: '40.00' }],
    });
    assert.match(res.body.invoice.number, /^BILL-\d{4}-0001$/);
  });
});

describe('static files', () => {
  test('the app shell is served', async () => {
    const res = await fetch(base + '/');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(await res.text(), /Smile Clinic/);
  });

  test('unknown paths fall back to the SPA shell', async () => {
    const res = await fetch(base + '/patients/1');
    assert.equal(res.status, 200);
    assert.match(await res.text(), /<div id="app">/);
  });

  test('path traversal out of /public is refused', async () => {
    const res = await fetch(base + '/../server/config.js');
    assert.ok([200, 404].includes(res.status));
    assert.ok(!(await res.text()).includes('sessionDays'));
  });
});

describe('whatsapp messaging', () => {
  let patientId;
  let appointmentId;

  before(async () => {
    await put('/api/settings', { whatsapp_country_code: '964', clinic_name: 'Test Clinic' });
    const created = await post('/api/patients',
      { first_name: 'Layla', last_name: 'Hassan', phone: '07701234567' });
    patientId = created.body.patient.id;
    const appt = await post('/api/appointments', {
      patient_id: patientId, dentist_id: 1, starts_at: '2030-08-05T10:30', duration_min: 30,
    });
    appointmentId = appt.body.appointment.id;
  });

  test('built-in Arabic templates ship with the database', async () => {
    const res = await get('/api/messages/templates');
    assert.equal(res.status, 200);
    assert.ok(res.body.templates.length >= 8);
    const reminder = res.body.templates.find((t) => t.key === 'appointment_reminder');
    assert.ok(/[؀-ۿ]/.test(reminder.body_ar), 'Arabic body missing');
    assert.ok(reminder.placeholders.includes('patient_name'));
  });

  test('the API token is never sent to the browser', async () => {
    await put('/api/settings', { whatsapp_token: 'super-secret-token' });
    const templates = await get('/api/messages/templates');
    assert.equal('token' in templates.body.settings, false);
    assert.equal(templates.body.settings.token_set, true);

    const settings = await get('/api/settings');
    assert.equal('whatsapp_token' in settings.body.settings, false);
    assert.equal(settings.body.settings.whatsapp_token_set, '1');
    assert.equal(JSON.stringify(settings.body).includes('super-secret-token'), false);
    await put('/api/settings', { whatsapp_token: '' });
  });

  test('a preview renders the appointment into Arabic', async () => {
    const res = await post('/api/messages/preview', {
      template_key: 'appointment_reminder', appointment_id: appointmentId,
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.body.includes('Layla Hassan'));
    assert.ok(/[؀-ۿ]/.test(res.body.body));
    assert.ok(res.body.body.includes('Test Clinic'));
    assert.equal(res.body.phone_ok, true);
    assert.equal(res.body.phone, '9647701234567');
    assert.ok(res.body.link.startsWith('https://wa.me/9647701234567?text='));
  });

  test('English is rendered when asked for', async () => {
    const res = await post('/api/messages/preview', {
      template_key: 'appointment_reminder', appointment_id: appointmentId, language: 'en',
    });
    assert.match(res.body.body, /^Hello Layla Hassan/);
  });

  test('a patient with no usable number is refused, with the reason', async () => {
    const noPhone = await post('/api/patients', { first_name: 'No', last_name: 'Phone' });
    const res = await post('/api/messages/preview', {
      template_key: 'balance_reminder', patient_id: noPhone.body.patient.id,
    });
    assert.equal(res.body.phone_ok, false);
    assert.match(res.body.phone_error, /no phone number/);
    assert.equal(res.body.link, null);

    const send = await post('/api/messages/send', {
      template_key: 'balance_reminder', patient_id: noPhone.body.patient.id,
    });
    assert.equal(send.status, 400);
  });

  test('link mode logs as "opened", never as "sent"', async () => {
    const res = await post('/api/messages/send', {
      template_key: 'appointment_reminder', appointment_id: appointmentId,
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.message.mode, 'link');
    assert.equal(res.body.message.status, 'opened');
    assert.ok(res.body.link.startsWith('https://wa.me/'));
  });

  test('cloud mode falls back to link when it is not configured', async () => {
    const res = await post('/api/messages/send', {
      template_key: 'appointment_reminder', appointment_id: appointmentId, mode: 'cloud',
    });
    assert.equal(res.body.mode, 'link');
  });

  test('an edited body is what actually gets sent', async () => {
    const res = await post('/api/messages/send', {
      template_key: 'appointment_reminder',
      appointment_id: appointmentId,
      body: 'نص معدّل يدوياً',
    });
    assert.equal(res.body.message.body, 'نص معدّل يدوياً');
  });

  test('the message log is per patient', async () => {
    const res = await get(`/api/messages?patient_id=${patientId}`);
    assert.ok(res.body.messages.length >= 3);
    assert.ok(res.body.messages.every((m) => m.patient_id === patientId));
    assert.ok(res.body.messages[0].sent_by_name);
  });

  test('due reminders show who has already been messaged', async () => {
    const res = await get('/api/messages/due-reminders?date=2030-08-05');
    assert.equal(res.status, 200);
    const row = res.body.appointments.find((a) => a.appointment_id === appointmentId);
    assert.ok(row, 'appointment missing from the reminder list');
    assert.equal(row.reminded, true);
    assert.equal(row.phone_ok, true);
  });

  test('an unknown template is a 404', async () => {
    const res = await post('/api/messages/preview',
      { template_key: 'does_not_exist', patient_id: patientId });
    assert.equal(res.status, 404);
  });

  test('templates can be edited and the change is used immediately', async () => {
    const saved = await put('/api/messages/templates/balance_reminder', {
      name: 'Outstanding balance reminder',
      body_ar: 'عزيزي {{patient_name}}، المبلغ المستحق هو {{balance}}.',
      body_en: 'Dear {{patient_name}}, you owe {{balance}}.',
    });
    assert.equal(saved.status, 200);
    const preview = await post('/api/messages/preview',
      { template_key: 'balance_reminder', patient_id: patientId });
    assert.match(preview.body.body, /^عزيزي Layla Hassan، المبلغ المستحق هو/);
  });

  test('a built-in template cannot be deleted, only switched off', async () => {
    const res = await del('/api/messages/templates/balance_reminder');
    assert.equal(res.status, 400);
    assert.match(res.body.error, /built-in/i);
  });

  test('custom templates can be added and removed', async () => {
    const created = await post('/api/messages/templates', {
      key: 'recall_due', name: 'Recall due', category: 'general', context: 'patient',
      body_ar: 'مرحباً {{patient_name}}، حان موعد الفحص الدوري.',
    });
    assert.equal(created.status, 201);
    assert.equal((await del('/api/messages/templates/recall_due')).status, 200);
  });

  test('staff can send but only an admin rewrites the templates', async () => {
    const as = { as: 'receptionist' };
    assert.equal((await post('/api/messages/send',
      { template_key: 'appointment_reminder', appointment_id: appointmentId }, as)).status, 201);
    assert.equal((await put('/api/messages/templates/appointment_reminder',
      { name: 'x', body_ar: 'x' }, as)).status, 403);
    assert.equal((await post('/api/messages/templates',
      { key: 'sneaky', name: 'x', body_ar: 'x' }, as)).status, 403);
  });

  test('the network endpoint explains itself even when it finds nothing', async () => {
    const res = await get('/api/network');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.addresses));
    assert.ok(Array.isArray(res.body.rejected));
    // The diagnostic fields are what let the UI say why, instead of guessing.
    assert.ok(Array.isArray(res.body.interfaces_seen));
    assert.match(res.body.local, /^http:\/\/localhost:\d+$/);
    assert.ok(res.body.port);
    for (const address of res.body.addresses) {
      assert.match(address.url, /^http:\/\/\d+\.\d+\.\d+\.\d+:\d+$/);
      assert.ok(address.label);
      assert.ok(['lan', 'public', 'self-assigned'].includes(address.kind), address.kind);
    }
  });
});

describe('installable app assets', () => {
  test('the manifest is served with the right type', async () => {
    const res = await fetch(base + '/manifest.webmanifest');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /manifest\+json/);
    const manifest = await res.json();
    assert.equal(manifest.name, 'Smile Clinic');
    assert.equal(manifest.display, 'standalone');
    assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'));
  });

  test('the service worker and icons are reachable', async () => {
    assert.equal((await fetch(base + '/sw.js')).status, 200);
    for (const icon of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png']) {
      const res = await fetch(`${base}/icons/${icon}`);
      assert.equal(res.status, 200, icon);
      assert.match(res.headers.get('content-type'), /image\/png/);
    }
  });

  test('the service worker never caches API responses', async () => {
    const source = await (await fetch(base + '/sw.js')).text();
    assert.ok(source.includes("url.pathname.startsWith('/api/')"),
      'service worker must exclude /api from caching');
  });
});

/**
 * The commercial gate. What matters is not that it blocks — anything can block
 * — but exactly what it blocks: a clinic that has stopped paying must still be
 * able to open, search and print every record it has.
 */
describe('licensing', () => {
  let signing;
  let publicRaw;

  const mint = async ({ plan = 'yearly', expires = '2099-01-01', devices = 3, serial = 1 }) => {
    const { packPayload, composeKey } = await import('../server/lib/licence.js');
    const payload = packPayload({ plan, expires, devices, serial });
    return composeKey(payload, nodeCrypto.sign('sha256', payload,
      { key: signing, dsaEncoding: 'ieee-p1363' }));
  };

  before(async () => {
    await login('admin@test.local', 'test12345', 'admin');
    const { setLicencePublicKey } = await import('../server/lib/licence.js');
    const pair = nodeCrypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    signing = pair.privateKey;
    publicRaw = pair.publicKey.export({ type: 'spki', format: 'der' })
      .subarray(-65).toString('base64');
    setLicencePublicKey(publicRaw);
  });

  after(async () => {
    // Leave the clinic licensed, so a later suite is not gated by accident.
    await post('/api/licence', { key: await mint({ devices: 9 }) });
  });

  test('a trial says how long is left', async () => {
    const res = await get('/api/licence');
    assert.equal(res.status, 200);
    assert.equal(res.body.writable, true);
    assert.ok(res.body.days_left > 0);
  });

  test('an expired clinic can still read everything', async () => {
    // Set straight in the database: the activation endpoint refuses an expired
    // key outright, which is itself the right behaviour and tested below.
    const { saveKey } = await import('../server/lib/licence-state.js');
    saveKey(await mint({ plan: 'monthly', expires: '2020-02-01', serial: 3 }));

    for (const url of ['/api/patients?limit=5', '/api/invoices', '/api/reports/financial',
      '/api/appointments?from=2026-01-01&to=2026-12-31', '/api/dashboard']) {
      const res = await get(url);
      assert.equal(res.status, 200, `${url} should still be readable`);
    }
  });

  test('but cannot write anything new', async () => {
    const res = await post('/api/patients', { first_name: 'Gated', last_name: 'Out' });
    assert.equal(res.status, 402);
    assert.match(res.body.error, /read-only|trial has ended/);
    // And says so in a way a screen can act on, not just prose.
    assert.equal(res.body.licence, 'expired');
  });

  test('signing in and entering a key still work when expired', async () => {
    const signin = await post('/api/auth/login',
      { email: 'admin@test.local', password: 'test12345' }, { as: 'admin' });
    assert.equal(signin.status, 200, 'a locked-out clinic must still be able to sign in');

    const activate = await post('/api/licence', { key: await mint({ devices: 4 }) });
    assert.equal(activate.status, 200);
    assert.equal(activate.body.writable, true);
  });

  test('writing works again straight afterwards', async () => {
    const res = await post('/api/patients', { first_name: 'Licensed', last_name: 'Again' });
    assert.equal(res.status, 201);
  });

  test('an already-expired key is refused at the door', async () => {
    const res = await post('/api/licence',
      { key: await mint({ plan: 'monthly', expires: '2020-02-01', serial: 4 }) });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /expired on 2020-02-01/);
  });

  test('a forged key is refused', async () => {
    const other = nodeCrypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const { packPayload, composeKey } = await import('../server/lib/licence.js');
    const payload = packPayload({ plan: 'lifetime', devices: 250, serial: 1 });
    const forged = composeKey(payload, nodeCrypto.sign('sha256', payload,
      { key: other.privateKey, dsaEncoding: 'ieee-p1363' }));

    const res = await post('/api/licence', { key: forged });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /not genuine/);
  });

  test('a receptionist cannot enter a key', async () => {
    await login('desk@test.local', 'test12345', 'receptionist');
    const res = await post('/api/licence', { key: await mint({}) }, { as: 'receptionist' });
    assert.equal(res.status, 403);
    // But can see why the clinic is read-only, rather than guessing.
    const status = await get('/api/licence', { as: 'receptionist' });
    assert.equal(status.status, 200);
  });

  test('pairing stops at the number of devices bought', async () => {
    await post('/api/licence', { key: await mint({ devices: 2, serial: 5 }) });
    // Two devices means this computer and one more.
    const first = await post('/api/sync/pair', { name: 'First phone' });
    assert.equal(first.status, 201);
    const second = await post('/api/sync/pair', { name: 'Second phone' });
    assert.equal(second.status, 201,
      'an unclaimed code is not a device yet');

    // Claim one, and the allowance is used up.
    const { pairing_code: code } = first.body;
    const claimed = await post('/api/sync/register',
      { name: 'First phone', pairing_code: code });
    assert.equal(claimed.status, 201);

    const third = await post('/api/sync/pair', { name: 'Third phone' });
    assert.equal(third.status, 400);
    assert.match(third.body.error, /covers 2 devices/);
  });
});

/**
 * One account, many devices.
 *
 * A clinic runs on a phone at the chair, a tablet at reception and a computer
 * in the office, often signed in as the same person. Everything here is about
 * that staying true without anyone having to think about it.
 */
describe('signing in on several devices', () => {
  before(async () => {
    await login('admin@test.local', 'test12345', 'admin');
  });

  test('signing in on a second device does not sign out the first', async () => {
    await login('admin@test.local', 'test12345', 'phone');
    await login('admin@test.local', 'test12345', 'tablet');

    // All three jars are live at once; none of them was invalidated.
    for (const as of ['admin', 'phone', 'tablet']) {
      const res = await get('/api/auth/me', { as });
      assert.equal(res.status, 200, `the ${as} session should still work`);
      assert.equal(res.body.user.email, 'admin@test.local');
    }
  });

  test('each device is listed, and the one asking is marked', async () => {
    const res = await get('/api/auth/devices', { as: 'phone' });
    assert.equal(res.status, 200);
    assert.ok(res.body.devices.length >= 3, 'every signed-in device is listed');
    assert.equal(res.body.devices.filter((d) => d.current).length, 1,
      'exactly one row is the device doing the asking');
  });

  test('a device in daily use is never signed out from under it', async () => {
    // Wind one session back so only a day of its window is left, as if the
    // phone had been in use for a month.
    const { q: db } = await import('../server/db.js');
    const before = await get('/api/auth/devices', { as: 'tablet' });
    const mine = before.body.devices.find((d) => d.current);
    const nearly = new Date(Date.now() + 86400_000).toISOString();
    db.run('UPDATE sessions SET expires_at = ? WHERE token_hash = ?', nearly, mine.id);

    // Simply using the app has to push the window out again.
    const used = await get('/api/patients?limit=1', { as: 'tablet' });
    assert.equal(used.status, 200);

    const after = await get('/api/auth/devices', { as: 'tablet' });
    const renewed = after.body.devices.find((d) => d.current);
    assert.ok(Date.parse(renewed.expires_at) > Date.parse(nearly) + 86400_000,
      'using the app should move the expiry weeks out, not leave it a day away');
  });

  test('a lost device can be cut off without touching the others', async () => {
    const list = await get('/api/auth/devices', { as: 'admin' });
    const other = list.body.devices.find((d) => !d.current);
    assert.ok(other, 'there is another device to sign out');

    const removed = await del(`/api/auth/devices/${other.id}`, { as: 'admin' });
    assert.equal(removed.status, 200);

    // The device doing the signing-out carries on untouched.
    assert.equal((await get('/api/auth/me', { as: 'admin' })).status, 200);
    const left = await get('/api/auth/devices', { as: 'admin' });
    assert.ok(!left.body.devices.some((d) => d.id === other.id),
      'the signed-out device is gone from the list');
  });

  test('one account cannot sign another out', async () => {
    await login('desk@test.local', 'test12345', 'receptionist');
    const mine = await get('/api/auth/devices', { as: 'admin' });
    const target = mine.body.devices[0].id;

    const res = await del(`/api/auth/devices/${target}`, { as: 'receptionist' });
    // Scoped by user_id, so it reports success having deleted nothing rather
    // than revealing whether somebody else's session id exists.
    assert.equal(res.status, 200);
    assert.equal((await get('/api/auth/me', { as: 'admin' })).status, 200,
      "another user's session must survive");
  });

  test('changing the password still signs the other devices out', async () => {
    await login('admin@test.local', 'test12345', 'laptop');
    const res = await post('/api/auth/password',
      { current_password: 'test12345', new_password: 'test12345' }, { as: 'laptop' });
    assert.equal(res.status, 200);
    // The device that made the change keeps working; the rest do not.
    assert.equal((await get('/api/auth/me', { as: 'laptop' })).status, 200);
    assert.equal((await get('/api/auth/me', { as: 'phone' })).status, 401);
  });
});

/**
 * X-rays and photographs.
 *
 * The image is stored in the row, so the thing worth guarding is that a list
 * never carries the full images — a patient with forty x-rays must still open
 * — and that nothing but an image gets in.
 */
describe('x-rays and photos', () => {
  // A one-pixel JPEG is enough: what is tested is the handling, not the image.
  const PIXEL = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsL'
    + 'DBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QA'
    + 'FAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
  let patientId;
  let imageId;

  before(async () => {
    await login('admin@test.local', 'test12345', 'admin');
    const made = await post('/api/patients', { first_name: 'Imaging', last_name: 'Test' });
    patientId = made.body.patient.id;
  });

  test('an image is stored against the patient', async () => {
    const res = await post(`/api/patients/${patientId}/attachments`, {
      data: `data:image/jpeg;base64,${PIXEL}`,
      thumb: `data:image/jpeg;base64,${PIXEL}`,
      mime: 'image/jpeg',
      kind: 'xray',
      tooth: 16,
      caption: 'Periapical',
      width: 1, height: 1,
    });
    assert.equal(res.status, 201);
    imageId = res.body.attachment.id;
    assert.equal(res.body.attachment.kind, 'xray');
    assert.equal(res.body.attachment.tooth, 16);
    // The decoded weight, not the base64 it arrived as.
    assert.ok(res.body.attachment.bytes > 0);
    assert.ok(res.body.attachment.bytes < PIXEL.length);
  });

  test('the list carries thumbnails but never the full images', async () => {
    const res = await get(`/api/patients/${patientId}/attachments`);
    assert.equal(res.status, 200);
    const [item] = res.body.attachments;
    assert.ok(item.thumb, 'a thumbnail is needed to draw the grid');
    assert.equal(item.data, undefined, 'the full image must not be in the list');
  });

  test('the full image is fetched one at a time', async () => {
    const res = await get(`/api/attachments/${imageId}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.attachment.data, PIXEL);
  });

  test('a data: prefix is accepted and stripped', async () => {
    const res = await get(`/api/attachments/${imageId}`);
    assert.ok(!res.body.attachment.data.startsWith('data:'));
  });

  test('only images get in', async () => {
    const notAnImage = await post(`/api/patients/${patientId}/attachments`,
      { data: 'this is not base64 !!', mime: 'image/jpeg' });
    assert.equal(notAnImage.status, 400);

    const wrongType = await post(`/api/patients/${patientId}/attachments`,
      { data: PIXEL, mime: 'application/pdf' });
    assert.equal(wrongType.status, 400);
    assert.match(wrongType.body.error, /JPEG, PNG and WebP/);

    const wrongKind = await post(`/api/patients/${patientId}/attachments`,
      { data: PIXEL, mime: 'image/jpeg', kind: 'scan' });
    assert.equal(wrongKind.status, 400);
  });

  test('an image too large to move is refused with a sentence', async () => {
    const huge = 'A'.repeat(6_200_000);
    const res = await post(`/api/patients/${patientId}/attachments`,
      { data: huge, mime: 'image/jpeg' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /too large/);
  });

  test('the caption and tooth can be corrected afterwards', async () => {
    const res = await patch(`/api/attachments/${imageId}`,
      { caption: 'Periapical, upper right', tooth: 17, kind: 'photo' });
    assert.equal(res.status, 200);
    assert.equal(res.body.attachment.caption, 'Periapical, upper right');
    assert.equal(res.body.attachment.tooth, 17);
    assert.equal(res.body.attachment.kind, 'photo');
  });

  test('a receptionist cannot add or delete clinical images', async () => {
    await login('desk@test.local', 'test12345', 'receptionist');
    const added = await post(`/api/patients/${patientId}/attachments`,
      { data: PIXEL, mime: 'image/jpeg' }, { as: 'receptionist' });
    assert.equal(added.status, 403);
    const removed = await del(`/api/attachments/${imageId}`, { as: 'receptionist' });
    assert.equal(removed.status, 403);
  });

  test('deleting one leaves the rest', async () => {
    const second = await post(`/api/patients/${patientId}/attachments`,
      { data: PIXEL, mime: 'image/jpeg', kind: 'photo' });
    assert.equal(second.status, 201);

    assert.equal((await del(`/api/attachments/${imageId}`)).status, 200);
    const left = await get(`/api/patients/${patientId}/attachments`);
    assert.equal(left.body.attachments.length, 1);
    assert.equal(left.body.attachments[0].id, second.body.attachment.id);
  });
});

/**
 * The store cupboard.
 *
 * The count is derived from movements, never written directly, so the tests
 * are mostly about that: what a delivery, a use and a recount each do to it.
 */
describe('stock', () => {
  let itemId;

  before(async () => {
    await login('admin@test.local', 'test12345', 'admin');
  });

  test('an item starts with the count it was given, as a movement', async () => {
    const res = await post('/api/stock', {
      name: 'Nitrile gloves, large', category: 'Consumables', unit: 'box',
      quantity: 4, min_quantity: 6, unit_cost_cents: 1100, supplier: 'DentalDepot',
    });
    assert.equal(res.status, 201);
    itemId = res.body.item.id;
    assert.equal(res.body.item.quantity, 4);

    const detail = await get(`/api/stock/${itemId}`);
    assert.equal(detail.body.moves.length, 1);
    assert.equal(detail.body.moves[0].reason, 'counted');
    assert.equal(detail.body.moves[0].change, 4);
  });

  test('below the reorder level it is listed as running out', async () => {
    const res = await get('/api/stock?low=1');
    assert.ok(res.body.items.some((i) => i.id === itemId),
      'four boxes against a minimum of six is running out');
    assert.ok(res.body.summary.low >= 1);
  });

  test('a delivery adds, a use takes away', async () => {
    const received = await post(`/api/stock/${itemId}/move`,
      { reason: 'received', amount: 10, note: 'Delivery' });
    assert.equal(received.status, 200);
    assert.equal(received.body.item.quantity, 14);
    assert.equal(received.body.item.low, 0, 'fourteen against six is no longer low');

    // Use is always a subtraction, whichever sign it was sent with.
    const used = await post(`/api/stock/${itemId}/move`, { reason: 'used', amount: 2 });
    assert.equal(used.body.item.quantity, 12);
    const alsoUsed = await post(`/api/stock/${itemId}/move`, { reason: 'used', amount: -3 });
    assert.equal(alsoUsed.body.item.quantity, 9);
  });

  test('a recount records the difference, not the number', async () => {
    const res = await post(`/api/stock/${itemId}/move`, { reason: 'counted', amount: 5 });
    assert.equal(res.body.item.quantity, 5);
    const detail = await get(`/api/stock/${itemId}`);
    // Nine on the books, five on the shelf: the movement is the four missing.
    assert.equal(detail.body.moves[0].change, -4);
    assert.equal(detail.body.moves[0].reason, 'counted');
  });

  test('you cannot take out more than there is', async () => {
    const res = await post(`/api/stock/${itemId}/move`, { reason: 'used', amount: 500 });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /not that much/);
  });

  test('a change of nothing is refused rather than logged', async () => {
    const res = await post(`/api/stock/${itemId}/move`, { reason: 'used', amount: 0 });
    assert.equal(res.status, 400);
  });

  test('quantities may be fractional', async () => {
    const made = await post('/api/stock',
      { name: 'Articaine', unit: 'ml', quantity: 2.5, min_quantity: 1 });
    assert.equal(made.body.item.quantity, 2.5);
    const used = await post(`/api/stock/${made.body.item.id}/move`,
      { reason: 'used', amount: 0.7 });
    assert.equal(used.body.item.quantity, 1.8);
  });

  test('the shopping list says how much to buy, grouped by supplier', async () => {
    const res = await get('/api/stock/shopping-list');
    assert.equal(res.status, 200);
    const gloves = res.body.items.find((i) => i.id === itemId);
    assert.ok(gloves, 'five boxes against a minimum of six is on the list');
    // Enough to get back to the minimum, never less than one.
    assert.equal(gloves.suggested, 1);
  });

  test('retiring keeps the history', async () => {
    assert.equal((await del(`/api/stock/${itemId}`)).status, 200);
    const listed = await get('/api/stock');
    assert.ok(!listed.body.items.some((i) => i.id === itemId));
    const all = await get('/api/stock?all=1');
    assert.ok(all.body.items.some((i) => i.id === itemId), 'it is retired, not deleted');
    const detail = await get(`/api/stock/${itemId}`);
    assert.ok(detail.body.moves.length > 1, 'what was used is still recorded');
  });

  test('an accountant can look but not touch', async () => {
    // Its own account rather than one an earlier suite may have changed.
    await post('/api/users', {
      name: 'Stock accountant', email: 'stock-books@test.local',
      role: 'accountant', password: 'test12345',
    });
    await login('stock-books@test.local', 'test12345', 'accountant');
    assert.equal((await get('/api/stock', { as: 'accountant' })).status, 200);
    const res = await post('/api/stock', { name: 'Nope' }, { as: 'accountant' });
    assert.equal(res.status, 403);
  });
});
