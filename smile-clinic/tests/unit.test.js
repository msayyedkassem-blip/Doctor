import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { lineTotal, invoiceTotals, taxOn, sumCents, netPaid, statusFromBalance } from '../server/lib/money.js';
import { hashPassword, verifyPassword, needsRehash, can, permissionsFor } from '../server/lib/auth.js';
import { installNodeCrypto } from '../server/lib/crypto-node.js';

installNodeCrypto();
import { str, int, money, oneOf, date, datetime, email, tooth, surfaces, isValidTooth } from '../server/lib/validate.js';
import { addMinutes, overlaps } from '../server/routes/appointments.js';
import { Router } from '../server/lib/http.js';

describe('money', () => {
  test('line totals subtract the discount and never go negative', () => {
    assert.equal(lineTotal({ quantity: 1, unit_price_cents: 11000, discount_cents: 0 }), 11000);
    assert.equal(lineTotal({ quantity: 3, unit_price_cents: 5000, discount_cents: 2500 }), 12500);
    assert.equal(lineTotal({ quantity: 1, unit_price_cents: 1000, discount_cents: 9999 }), 0);
  });

  test('tax is computed from basis points', () => {
    assert.equal(taxOn(10000, 2100), 2100);
    assert.equal(taxOn(10000, 0), 0);
    assert.equal(taxOn(3333, 2100), 700); // rounds to the nearest cent
  });

  test('invoice totals apply a whole-invoice discount before tax', () => {
    const items = [
      { line_total_cents: 10000, tax_rate_bp: 1000 },
      { line_total_cents: 5000, tax_rate_bp: 0 },
    ];
    const plain = invoiceTotals(items, 0);
    assert.deepEqual(plain, {
      subtotal_cents: 15000, discount_cents: 0, tax_cents: 1000, total_cents: 16000,
    });

    // A 3000 discount on a 15000 subtotal leaves 80% of each line taxable.
    const discounted = invoiceTotals(items, 3000);
    assert.equal(discounted.subtotal_cents, 15000);
    assert.equal(discounted.discount_cents, 3000);
    assert.equal(discounted.tax_cents, 800);
    assert.equal(discounted.total_cents, 12800);
  });

  test('a discount larger than the subtotal is clamped', () => {
    const totals = invoiceTotals([{ line_total_cents: 5000, tax_rate_bp: 0 }], 99999);
    assert.equal(totals.discount_cents, 5000);
    assert.equal(totals.total_cents, 0);
  });

  test('totals of an empty invoice are all zero', () => {
    assert.deepEqual(invoiceTotals([], 0), {
      subtotal_cents: 0, discount_cents: 0, tax_cents: 0, total_cents: 0,
    });
  });

  test('refunds reduce the net paid', () => {
    assert.equal(netPaid([
      { amount_cents: 10000, direction: 'in' },
      { amount_cents: 2500, direction: 'refund' },
    ]), 7500);
    assert.equal(sumCents([100, 250, -50]), 300);
  });

  test('invoice status follows the balance', () => {
    assert.equal(statusFromBalance(10000, 0, 'issued'), 'issued');
    assert.equal(statusFromBalance(10000, 4000, 'issued'), 'partial');
    assert.equal(statusFromBalance(10000, 10000, 'partial'), 'paid');
    assert.equal(statusFromBalance(10000, 12000, 'issued'), 'paid');
    // Drafts and voids are never recomputed from payments.
    assert.equal(statusFromBalance(10000, 10000, 'void'), 'void');
    assert.equal(statusFromBalance(10000, 10000, 'draft'), 'draft');
  });
});

describe('passwords and permissions', () => {
  test('a hash verifies only against its own password', async () => {
    const hash = await hashPassword('correct horse battery');
    // PBKDF2, not scrypt: WebCrypto has no scrypt, and a phone must be able to
    // check the same hash the server wrote.
    assert.ok(hash.startsWith('pbkdf2$'));
    assert.equal(await verifyPassword('correct horse battery', hash), true);
    assert.equal(await verifyPassword('wrong password', hash), false);
  });

  test('the same password hashes differently every time', async () => {
    assert.notEqual(await hashPassword('abc12345'), await hashPassword('abc12345'));
  });

  test('hashes written before the change still verify on the server', async () => {
    // A real scrypt hash of "demo1234" from the previous format.
    const legacy = 'scrypt$16384$8$1$' + '00'.repeat(16) + '$'
      + Buffer.from(
        (await import('node:crypto')).scryptSync(
          'demo1234', Buffer.alloc(16), 64, { N: 16384, r: 8, p: 1 },
        ),
      ).toString('hex');
    assert.equal(await verifyPassword('demo1234', legacy), true);
    assert.equal(await verifyPassword('wrong', legacy), false);
    // …and it is flagged for replacement, because a phone cannot check it.
    assert.equal(needsRehash(legacy), true);
    assert.equal(needsRehash(await hashPassword('x')), false);
  });

  test('malformed stored hashes are rejected, not thrown on', async () => {
    assert.equal(await verifyPassword('x', 'not-a-hash'), false);
    assert.equal(await verifyPassword('x', ''), false);
    assert.equal(await verifyPassword('x', null), false);
    assert.equal(await verifyPassword('x', 'pbkdf2$notanumber$zz$zz'), false);
  });

  test('roles grant only what they should', () => {
    const admin = { role: 'admin' };
    const dentist = { role: 'dentist' };
    const reception = { role: 'receptionist' };
    const accountant = { role: 'accountant' };

    assert.equal(can(admin, 'settings:write'), true);
    assert.equal(can(admin, 'anything:at-all'), true);

    assert.equal(can(dentist, 'clinical:write'), true);
    assert.equal(can(dentist, 'invoices:write'), false);
    assert.equal(can(dentist, 'users:write'), false);

    assert.equal(can(reception, 'payments:write'), true);
    assert.equal(can(reception, 'clinical:write'), false);
    assert.equal(can(reception, 'settings:write'), false);

    assert.equal(can(accountant, 'expenses:write'), true);
    assert.equal(can(accountant, 'patients:write'), false);

    assert.equal(can(null, 'patients:read'), false);
    assert.equal(can({ role: 'nobody' }, 'patients:read'), false);
  });

  test('every role has a permission list', () => {
    for (const role of ['admin', 'dentist', 'receptionist', 'accountant']) {
      assert.ok(permissionsFor(role).length > 0, role);
    }
  });
});

describe('validation', () => {
  test('required strings are enforced and trimmed', () => {
    assert.equal(str({ a: '  hi  ' }, 'a'), 'hi');
    assert.equal(str({}, 'a'), null);
    assert.throws(() => str({}, 'a', { required: true }), /"a" is required/);
    assert.throws(() => str({ a: 'x'.repeat(600) }, 'a'), /at most/);
  });

  test('amounts convert to integer cents', () => {
    assert.equal(money({ a: '10.50' }, 'a'), 1050);
    assert.equal(money({ a: 0.1 }, 'a'), 10);
    assert.equal(money({ a: '0.005' }, 'a'), 1); // rounds, never truncates to a float
    assert.equal(money({}, 'a', { fallback: 0 }), 0);
    assert.throws(() => money({ a: '-5' }, 'a'), /cannot be negative/);
    assert.throws(() => money({ a: 'abc' }, 'a'), /must be an amount/);
  });

  test('integers reject decimals and honour bounds', () => {
    assert.equal(int({ a: '7' }, 'a'), 7);
    assert.throws(() => int({ a: '7.5' }, 'a'), /whole number/);
    assert.throws(() => int({ a: 3 }, 'a', { min: 5 }), /at least 5/);
    assert.throws(() => int({ a: 30 }, 'a', { max: 10 }), /at most 10/);
  });

  test('enumerations reject unknown values', () => {
    assert.equal(oneOf({ a: 'cash' }, 'a', ['cash', 'card']), 'cash');
    assert.throws(() => oneOf({ a: 'bitcoin' }, 'a', ['cash', 'card']), /must be one of/);
  });

  test('dates and times are shape-checked', () => {
    assert.equal(date({ a: '2026-02-28' }, 'a'), '2026-02-28');
    assert.throws(() => date({ a: '28/02/2026' }, 'a'), /YYYY-MM-DD/);
    assert.equal(datetime({ a: '2026-02-28 14:30' }, 'a'), '2026-02-28T14:30');
    assert.equal(datetime({ a: '2026-02-28T14:30:00' }, 'a'), '2026-02-28T14:30');
    assert.throws(() => datetime({ a: '2026-02-28' }, 'a'), /YYYY-MM-DDTHH:MM/);
  });

  test('emails are normalised to lower case', () => {
    assert.equal(email({ a: 'Person@Clinic.LOCAL' }, 'a'), 'person@clinic.local');
    assert.throws(() => email({ a: 'not-an-email' }, 'a'), /valid email/);
  });

  test('FDI tooth numbers are validated', () => {
    assert.equal(isValidTooth(11), true);
    assert.equal(isValidTooth(48), true);
    assert.equal(isValidTooth(55), true);  // primary dentition
    assert.equal(isValidTooth(19), false); // no ninth tooth in a quadrant
    assert.equal(isValidTooth(56), false); // primary quadrants stop at 5
    assert.equal(isValidTooth(91), false);
    assert.equal(tooth({ t: '16' }, 't'), 16);
    assert.throws(() => tooth({ t: '99' }, 't'), /valid FDI tooth/);
  });

  test('surfaces are de-duplicated and upper-cased', () => {
    assert.equal(surfaces({ s: 'mod' }, 's'), 'MOD');
    assert.equal(surfaces({ s: 'M-O-M' }, 's'), 'MO');
    assert.throws(() => surfaces({ s: 'XZ' }, 's'), /unknown surface/);
  });
});

describe('scheduling maths', () => {
  test('minutes are added across the hour and across midnight', () => {
    assert.equal(addMinutes('2026-03-01T09:00', 45), '2026-03-01T09:45');
    assert.equal(addMinutes('2026-03-01T09:30', 45), '2026-03-01T10:15');
    assert.equal(addMinutes('2026-03-01T23:30', 60), '2026-03-02T00:30');
    assert.equal(addMinutes('2026-02-28T23:00', 120), '2026-03-01T01:00');
  });

  test('overlap is exclusive at the boundaries', () => {
    const a = ['2026-03-01T09:00', '2026-03-01T10:00'];
    assert.equal(overlaps(...a, '2026-03-01T09:30', '2026-03-01T10:30'), true);
    assert.equal(overlaps(...a, '2026-03-01T10:00', '2026-03-01T11:00'), false);
    assert.equal(overlaps(...a, '2026-03-01T08:00', '2026-03-01T09:00'), false);
    assert.equal(overlaps(...a, '2026-03-01T09:15', '2026-03-01T09:45'), true);
  });
});

describe('router', () => {
  test('matches paths and extracts parameters', () => {
    const router = new Router();
    const handler = () => {};
    router.get('/api/patients/:id', handler);
    router.post('/api/patients', handler);

    assert.equal(router.match('GET', '/api/nope'), null);
    assert.deepEqual(router.match('GET', '/api/patients/42').params, { id: '42' });
    assert.ok(router.match('POST', '/api/patients'));
    assert.throws(() => router.match('DELETE', '/api/patients/42'), /not allowed/);
  });
});

/**
 * The Windows launchers only work if they arrive with CRLF line endings, and
 * the way they stop working is the worst kind: the window opens, closes again,
 * and says nothing at all. Git's `eol=crlf` is not enough on its own — it is
 * applied on checkout, and `git archive`, which builds the delivery zip,
 * ignores it — so the bytes in the repository are the thing to check.
 */
describe('the Windows launchers', () => {
  const dir = new URL('../windows/', import.meta.url);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.cmd')) : [];

  test('there are launchers to check', () => {
    assert.ok(files.length >= 3, 'the windows folder should hold the .cmd launchers');
  });

  for (const name of files) {
    test(`${name} has Windows line endings`, () => {
      const text = fs.readFileSync(new URL(name, dir), 'utf8');
      const lines = text.split('\n').slice(0, -1);
      const unterminated = lines.filter((line) => !line.endsWith('\r'));
      assert.equal(unterminated.length, 0,
        `${unterminated.length} line(s) end with a bare newline: ${unterminated[0]}`);
    });
  }
});
