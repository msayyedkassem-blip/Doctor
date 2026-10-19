#!/usr/bin/env node
/**
 * The seller's side of licensing: make a signing key once, then mint codes.
 *
 *   npm run licence:setup                       once, on your own machine
 *   npm run licence -- --plan yearly --devices 3
 *   npm run licence -- --plan lifetime --devices 6 --serial 1042
 *   npm run licence:check -- <code>             read a code back
 *
 * The private key is written outside the project, to ~/.smile-clinic/, so it
 * can never be zipped up and shipped with the app by accident. Back it up: lose
 * it and every code you have ever sold still works, but you can never mint
 * another that the app will accept.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  packPayload, unpackPayload, composeKey, splitKey, PLANS, today, fromDay, toDay,
} from '../server/lib/licence.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOME = path.join(os.homedir(), '.smile-clinic');
const PRIVATE = path.join(HOME, 'licence-private.pem');
const PUBLIC_IN_APP = path.join(ROOT, 'server', 'licence-public.txt');
const LEDGER = path.join(HOME, 'licences.csv');

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const command = args.find((a) => !a.startsWith('--')) || 'mint';

// ---- setup -----------------------------------------------------------------
if (command === 'setup') {
  if (fs.existsSync(PRIVATE) && !args.includes('--force')) {
    console.error(`A signing key already exists at ${PRIVATE}.`);
    console.error('Replacing it would invalidate every code you have sold.');
    console.error('Add --force only if you are certain.');
    process.exit(1);
  }
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  fs.mkdirSync(HOME, { recursive: true, mode: 0o700 });
  fs.writeFileSync(PRIVATE, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  // The app needs only the 65-byte public point, which is short enough to read.
  const raw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-65);
  fs.writeFileSync(PUBLIC_IN_APP, `${raw.toString('base64')}\n`);
  console.log(`\n  Signing key written to ${PRIVATE}`);
  console.log('  Back that file up somewhere safe and never ship it.\n');
  console.log(`  Public key written to ${path.relative(ROOT, PUBLIC_IN_APP)}`);
  console.log('  That one belongs in the app — commit it and rebuild.\n');
  process.exit(0);
}

// ---- check -----------------------------------------------------------------
if (command === 'check') {
  const key = args.filter((a) => !a.startsWith('--') && a !== 'check').join('');
  if (!key) { console.error('Give me a code to read.'); process.exit(1); }
  try {
    const { payload } = splitKey(key);
    const read = unpackPayload(payload);
    console.log(JSON.stringify(read, null, 2));
    console.log('\n  (This reads the code. Whether it is genuine is decided by the'
      + ' signature, which only the app checks.)');
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  process.exit(0);
}

// ---- mint ------------------------------------------------------------------
if (!fs.existsSync(PRIVATE)) {
  console.error(`No signing key yet. Run:  npm run licence:setup`);
  process.exit(1);
}

const plan = flag('plan', 'yearly');
if (!PLANS.includes(plan) || plan === 'trial') {
  console.error(`--plan must be one of: ${PLANS.filter((p) => p !== 'trial').join(', ')}`);
  process.exit(1);
}
const devices = Number(flag('devices', '3'));
const serial = Number(flag('serial', String(nextSerial())));
const expires = flag('expires') || defaultExpiry(plan);

const payload = packPayload({ plan, expires, devices, serial });
const key = crypto.createPrivateKey(fs.readFileSync(PRIVATE));
// P-1363 is r||s, 64 flat bytes — what WebCrypto's verify expects.
const signature = crypto.sign('sha256', payload, { key, dsaEncoding: 'ieee-p1363' });
const code = composeKey(payload, signature);

const forWhom = flag('for', '');
fs.appendFileSync(LEDGER,
  `${new Date().toISOString()},${serial},${plan},${devices},${expires || 'never'},`
  + `"${forWhom.replace(/"/g, "'")}"\n`);

console.log(`\n  ${plan} · up to ${devices} device${devices === 1 ? '' : 's'}`
  + ` · ${expires ? `until ${expires}` : 'no expiry'} · serial ${serial}`);
if (forWhom) console.log(`  for ${forWhom}`);
console.log(`\n${code}\n`);
console.log(`  Recorded in ${LEDGER}\n`);

function defaultExpiry(name) {
  if (name === 'lifetime') return null;
  const date = new Date(`${today()}T00:00:00Z`);
  // A day's grace either side of a renewal is cheaper than an angry phone call.
  if (name === 'monthly') date.setUTCMonth(date.getUTCMonth() + 1);
  else date.setUTCFullYear(date.getUTCFullYear() + 1);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function nextSerial() {
  if (!fs.existsSync(LEDGER)) return 1;
  const used = fs.readFileSync(LEDGER, 'utf8').trim().split('\n')
    .map((line) => Number(line.split(',')[1])).filter(Number.isFinite);
  return used.length ? Math.max(...used) + 1 : 1;
}
