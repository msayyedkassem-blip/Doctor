/**
 * Finds every copy of Smile Clinic on this computer and says which one holds
 * real records.
 *
 *   node scripts/find-installs.js
 *
 * Downloading the app more than once leaves folders called "Doctor", "Doctor 1",
 * "Doctor 2" and so on, only one of which is the one being used. This reads
 * them and reports; it changes nothing and deletes nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';

const HOME = os.homedir();
const SKIP = new Set(['node_modules', 'Library', 'Applications', '.git', '.Trash']);

export function findInstalls(home = HOME) {
  const found = [];
  walk(home, 0, found);
  return found;
}

const installs = [];

function walk(dir, depth, into = installs) {
  if (depth > 4) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (isClinic(full)) { into.push(full); continue; }
    walk(full, depth + 1, into);
  }
}

function isClinic(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).name
      === 'smile-clinic';
  } catch {
    return false;
  }
}

/** What is actually in a copy's database, if it has one. */
export function inspect(dir) {
  const file = path.join(dir, 'data', 'clinic.db');
  if (!fs.existsSync(file)) {
    return { hasData: false, note: 'never used — no records at all' };
  }

  const stat = fs.statSync(file);
  try {
    const db = new DatabaseSync(file, { readOnly: true });
    const count = (sql) => { try { return db.prepare(sql).get().n; } catch { return 0; } };
    const patients = count('SELECT COUNT(*) AS n FROM patients WHERE archived = 0');
    const invoices = count('SELECT COUNT(*) AS n FROM invoices');
    const payments = count('SELECT COUNT(*) AS n FROM payments');
    // The demo clinic ships with these staff; real use will not have them.
    const demo = count(
      "SELECT COUNT(*) AS n FROM users WHERE email IN "
      + "('lucas@clinic.local','sofia@clinic.local','front-desk@clinic.local')") >= 3;
    db.close();
    return {
      hasData: true, patients, invoices, payments, demo,
      size: stat.size, changed: stat.mtime,
    };
  } catch (err) {
    return { hasData: true, unreadable: err.message, size: stat.size, changed: stat.mtime };
  }
}

/** Of several copies, the one holding real records and used most recently. */
export function bestInstall(report) {
  const real = report.filter((r) => r.hasData && !r.demo && !r.unreadable && r.patients > 0);
  return real.sort((a, b) => b.changed - a.changed)[0]
    || report.filter((r) => r.hasData).sort((a, b) => b.changed - a.changed)[0]
    || null;
}

export const describe = (dir) => ({ dir, ...inspect(dir) });

// Running this file directly prints the report; importing it does not.
const isMain = process.argv[1]
  && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href;
if (!isMain) {
  // Imported for its helpers only.
} else {

walk(HOME, 0);

const pretty = (p) => p.replace(HOME, '~');
const when = (d) => d.toISOString().slice(0, 16).replace('T', ' ');

console.log('');
if (!installs.length) {
  console.log('  No copy of Smile Clinic was found anywhere in your home folder.');
  process.exit(0);
}

console.log(`  Found ${installs.length} cop${installs.length === 1 ? 'y' : 'ies'} of the app:\n`);

const report = installs.map((dir) => ({ dir, ...inspect(dir) }));

// The one to keep is the one with real records, most recently used.
const keep = bestInstall(report);

for (const item of report) {
  const mark = item === keep ? '>>' : '  ';
  console.log(`${mark} ${pretty(item.dir)}`);
  if (!item.hasData) {
    console.log(`     ${item.note}`);
  } else if (item.unreadable) {
    console.log(`     database unreadable: ${item.unreadable}`);
  } else {
    console.log(`     ${item.patients} patients, ${item.invoices} invoices, `
      + `${item.payments} payments`);
    console.log(`     ${(item.size / 1024).toFixed(0)} KB, last changed ${when(item.changed)}`
      + (item.demo ? '   <- demo data, not a real clinic' : ''));
  }
  console.log('');
}

if (keep) {
  console.log(`  The one to keep is marked >>  :  ${pretty(keep.dir)}`);
  if (keep.demo) {
    console.log('  Careful: that one only holds demo data, so none of these has real records yet.');
  }
  console.log('');
  console.log('  Nothing has been changed. To tidy up, see the next step.');
}
console.log('');
}
