/**
 * Licence keys, and the read-only rule they switch on.
 *
 * The signing here is real: a key is minted with a private key generated for
 * the test and checked by the same code the app ships, so a change that makes
 * genuine keys fail — or forged ones pass — shows up here.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import { setDriver, runMigrations, q, closeDb } from '../server/db.js';
import { readMigrations } from '../server/db-node.js';
import { installNodeCrypto } from '../server/lib/crypto-node.js';
import {
  packPayload, unpackPayload, composeKey, splitKey, encode32, decode32,
  readKey, setLicencePublicKey, format, toDay, fromDay,
} from '../server/lib/licence.js';
import { licenceState, startTrial, saveKey, ratchetToday } from '../server/lib/licence-state.js';

installNodeCrypto();

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clinic-licence-'));
let privateKey;
let publicRaw;

/** Mints exactly the way scripts/licence.js does. */
function mint({ plan = 'yearly', expires = '2099-01-01', devices = 3, serial = 1 } = {}) {
  const payload = packPayload({ plan, expires, devices, serial });
  const signature = crypto.sign('sha256', payload,
    { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return composeKey(payload, signature);
}

before(() => {
  const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  privateKey = pair.privateKey;
  publicRaw = pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-65)
    .toString('base64');
  setLicencePublicKey(publicRaw);

  const db = new DatabaseSync(path.join(dir, 'clinic.db'));
  db.exec('PRAGMA foreign_keys = ON');
  setDriver(db);
  runMigrations(db, readMigrations());
});

after(() => {
  closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('the code itself', () => {
  test('survives being written down and typed back', () => {
    const bytes = new Uint8Array(80).map((_, i) => (i * 37 + 11) & 255);
    const back = decode32(encode32(bytes));
    assert.deepEqual([...back], [...bytes]);
  });

  test('the letters people confuse are read as what was meant', () => {
    const bytes = new Uint8Array([0, 1, 2, 3, 4]);
    const text = encode32(bytes);
    // O for zero, I and L for one, U for V: the substitutions a person makes
    // reading a code off a screen or hearing it over the phone.
    const mistyped = text.replace(/0/g, 'O').replace(/1/g, 'I').replace(/V/g, 'U');
    assert.deepEqual([...decode32(mistyped)], [...bytes]);
  });

  test('dashes and spaces are noise', () => {
    const key = mint();
    assert.deepEqual([...splitKey(key).payload], [...splitKey(key.replace(/-/g, ' ')).payload]);
    assert.deepEqual([...splitKey(key).payload],
      [...splitKey(key.replace(/-/g, '').toLowerCase()).payload]);
  });

  test('is grouped so it can be read aloud', () => {
    assert.equal(format('ABCDEFGHIJ'), 'ABCDE-FGHIJ');
  });

  test('carries what was bought and nothing about who bought it', () => {
    const payload = packPayload({
      plan: 'monthly', expires: '2027-03-01', devices: 6, serial: 4242,
    });
    assert.equal(payload.length, 16);
    assert.deepEqual(unpackPayload(payload),
      { plan: 'monthly', devices: 6, expires: '2027-03-01', serial: 4242 });
  });

  test('a lifetime key has no expiry to pass', () => {
    const read = unpackPayload(packPayload({ plan: 'lifetime', devices: 2, serial: 9 }));
    assert.equal(read.expires, null);
    assert.equal(read.plan, 'lifetime');
  });

  test('dates survive the round trip to two bytes', () => {
    for (const iso of ['2020-01-01', '2026-09-14', '2099-12-31']) {
      assert.equal(fromDay(toDay(iso)), iso);
    }
  });

  test('refuses to make a key it could not honour', () => {
    assert.throws(() => packPayload({ plan: 'yearly', expires: '2027-01-01', devices: 0, serial: 1 }));
    assert.throws(() => packPayload({ plan: 'yearly', expires: '2027-01-01', devices: 300, serial: 1 }));
    assert.throws(() => packPayload({ plan: 'nonsense', expires: '2027-01-01', devices: 1, serial: 1 }));
  });

  test('is 128 characters, so it fits in a message', () => {
    assert.equal(mint().replace(/-/g, '').length, 128);
  });
});

describe('proving a code is genuine', () => {
  test('a minted key reads back as what was sold', async () => {
    const read = await readKey(mint({ plan: 'yearly', devices: 4, serial: 77 }));
    assert.equal(read.valid, true);
    assert.equal(read.plan, 'yearly');
    assert.equal(read.devices, 4);
    assert.equal(read.serial, 77);
  });

  test('a key signed by somebody else is refused', async () => {
    const other = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const payload = packPayload({ plan: 'lifetime', devices: 99, serial: 1 });
    const signature = crypto.sign('sha256', payload,
      { key: other.privateKey, dsaEncoding: 'ieee-p1363' });
    const read = await readKey(composeKey(payload, signature));
    assert.equal(read.valid, false);
    assert.match(read.reason, /not genuine/);
  });

  test('editing the payload to buy more invalidates it', async () => {
    const payload = packPayload({ plan: 'monthly', expires: '2027-01-01', devices: 1, serial: 5 });
    const signature = crypto.sign('sha256', payload,
      { key: privateKey, dsaEncoding: 'ieee-p1363' });
    // The greedy edit: same key, more devices, later expiry.
    const greedy = new Uint8Array(payload);
    greedy[3] = 200;
    const read = await readKey(composeKey(greedy, signature));
    assert.equal(read.valid, false);
    assert.match(read.reason, /not genuine/);
  });

  test('nonsense gets a sentence, not a crash', async () => {
    for (const rubbish of ['', 'hello', 'ABC-DEF', '!!!!!', null]) {
      const read = await readKey(rubbish);
      assert.equal(read.valid, false);
      assert.equal(typeof read.reason, 'string');
    }
  });
});

describe('what a clinic may do', () => {
  test('a fresh installation is on trial and can work', async () => {
    startTrial();
    const state = await licenceState();
    assert.equal(state.status, 'trial');
    assert.equal(state.writable, true);
    assert.ok(state.days_left > 25);
  });

  test('when the trial runs out it goes read-only, not dark', async () => {
    q.run("UPDATE licence SET trial_started = '2020-01-01', high_water = NULL WHERE id = 1");
    const state = await licenceState();
    assert.equal(state.status, 'trial-over');
    assert.equal(state.writable, false);
    // Still says what it was, so a screen can explain rather than just refuse.
    assert.equal(state.plan, 'trial');
  });

  test('a key brings it back', async () => {
    saveKey(mint({ plan: 'yearly', expires: '2099-01-01', devices: 5, serial: 12 }));
    const state = await licenceState();
    assert.equal(state.status, 'licensed');
    assert.equal(state.writable, true);
    assert.equal(state.devices, 5);
  });

  test('an expired subscription is read-only again', async () => {
    saveKey(mint({ plan: 'monthly', expires: '2020-02-01', devices: 5, serial: 13 }));
    const state = await licenceState();
    assert.equal(state.status, 'expired');
    assert.equal(state.writable, false);
  });

  test('winding the clock back does not buy another month', async () => {
    // The clinic has been running; the furthest date it has seen is recorded.
    q.run("UPDATE licence SET high_water = '2030-06-01' WHERE id = 1");
    saveKey(mint({ plan: 'monthly', expires: '2030-01-01', devices: 2, serial: 14 }));

    const state = await licenceState();
    assert.equal(state.status, 'expired',
      'a licence that expired before the furthest date seen must stay expired');
    assert.equal(state.writable, false);
    // And the watermark is never dragged backwards by a later look.
    assert.equal(ratchetToday(), '2030-06-01');
  });

  test('a build with no public key enforces nothing', async () => {
    setLicencePublicKey(null);
    const state = await licenceState();
    assert.equal(state.status, 'unlicensed-build');
    assert.equal(state.writable, true);
    setLicencePublicKey(publicRaw);
  });
});
