/**
 * Makes a backup file the clinic's records.
 *
 *   node scripts/restore.js ~/Downloads/clinic-backup-2026-10-22.db
 *
 * Written for the case it is named after: somebody starts on a phone, works on
 * it for weeks, and only later sets up the computer that is going to be the
 * clinic. Their phone's backup file is the real clinic, and this is how it
 * becomes one — rather than the phone joining an empty computer and the empty
 * computer being the thing everybody then syncs to.
 *
 * It also restores an ordinary backup over a damaged database, which is the
 * other half of the promise the app makes when it says "back this up".
 *
 * Nothing is deleted: whatever was there is kept beside it with a timestamp.
 */
import { DatabaseSync, backup } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { dbPath, config } from '../server/config.js';
import { readMigrations } from '../server/db-node.js';
import { runMigrations } from '../server/db.js';
import { TABLE_NAMES } from '../server/lib/sync-schema.js';

const say = (line = '') => console.log(line);
const die = (line) => { console.error(`\n  ${line}\n`); process.exit(1); };

const source = process.argv[2];
const force = process.argv.includes('--force');

if (!source || source.startsWith('--')) {
  die('Give it the backup file to restore:\n'
    + '    npm run restore -- ~/Downloads/clinic-backup-2026-10-22.db');
}
if (!fs.existsSync(source)) die(`There is no file at ${source}`);

// ---- 1. unpack, if it arrived compressed ----------------------------------
const work = path.join(config.dataDir, '.restore-staging.db');
fs.mkdirSync(config.dataDir, { recursive: true });
if (source.endsWith('.gz')) {
  fs.writeFileSync(work, zlib.gunzipSync(fs.readFileSync(source)));
} else {
  fs.copyFileSync(source, work);
}

// ---- 2. is it actually one of ours? --------------------------------------
// A wrong file here would replace a clinic's records with nothing, so this is
// checked before anything is moved, not after.
let incoming;
try {
  const db = new DatabaseSync(work, { readOnly: true });
  try {
    const tables = new Set(db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
    const missing = ['patients', 'users', 'schema_migrations', 'sync_state']
      .filter((name) => !tables.has(name));
    if (missing.length) {
      die(`That file is not a Smile Clinic backup — it has no ${missing.join(', ')}.`);
    }
    incoming = {
      patients: db.prepare('SELECT COUNT(*) AS n FROM patients').get().n,
      users: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
      migrations: db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n,
    };
  } finally {
    db.close();
  }
} catch (err) {
  fs.rmSync(work, { force: true });
  die(`That file could not be read as a database: ${err.message}`);
}

say();
say('  Restoring the clinic');
say('  ' + '-'.repeat(40));
say();
say(`  From:     ${source}`);
say(`  Contains: ${incoming.patients} patient(s), ${incoming.users} staff account(s)`);

// ---- 3. never overwrite real records by accident -------------------------
const target = dbPath();
if (fs.existsSync(target)) {
  let existing = 0;
  try {
    const db = new DatabaseSync(target, { readOnly: true });
    try { existing = db.prepare('SELECT COUNT(*) AS n FROM patients').get().n; }
    finally { db.close(); }
  } catch { /* unreadable, which is a reason to restore */ }

  if (existing > 0 && !force) {
    fs.rmSync(work, { force: true });
    say();
    die(`There are already ${existing} patient(s) here.\n`
      + '  Restoring would set them aside and put the backup in their place.\n'
      + '  If that is what you want, run it again with --force:\n'
      + `      npm run restore -- "${source}" --force`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const kept = `${target}.replaced-${stamp}`;
  const db = new DatabaseSync(target, { readOnly: true });
  try { await backup(db, kept); } finally { db.close(); }
  say(`  Set aside: ${kept} (${existing} patient(s))`);
}

fs.renameSync(work, target);

// ---- 4. bring the schema up to date --------------------------------------
// A backup from an older version is still worth restoring; it just needs the
// migrations it has not seen.
const conn = new DatabaseSync(target);
conn.exec('PRAGMA foreign_keys = ON');
runMigrations(conn, readMigrations());

// ---- 5. this is a clinic now, not a device that joined one ---------------
const state = conn.prepare('SELECT * FROM sync_state WHERE id = 1').get();
if (state?.device_token) {
  say('  This backup came from a device that had joined a clinic. Clearing the');
  say('  connection, so it is not treated as that clinic’s phone.');
}
conn.exec(`UPDATE sync_state SET server_url = '', device_id = '', device_code = '',
  device_token = '', last_seq = 0, last_synced_at = NULL, last_error = NULL
  WHERE id = 1`);
// Its own ledger, its own list of joined devices: both belong to whatever
// clinic this database used to talk to, not to this one.
conn.exec('DELETE FROM sync_devices');
conn.exec('DELETE FROM sync_changes');
conn.exec('DELETE FROM sync_issues');

// ---- 6. make sure the first device to join gets everything ---------------
// Devices receive what is in the ledger, and the ledger is filled from the
// outbox. Rather than trust whatever the outbox happens to hold after its
// travels, every live row is queued again — so the first phone to join
// receives the whole clinic, not the part that happened to still be pending.
conn.exec('DELETE FROM sync_outbox');
let queued = 0;
conn.exec('BEGIN');
try {
  for (const table of TABLE_NAMES) {
    const { changes } = conn.prepare(
      `INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
       SELECT ?, uuid, 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')
         FROM ${table} WHERE uuid IS NOT NULL`).run(table);
    queued += Number(changes);
  }
  conn.exec('COMMIT');
} catch (err) {
  conn.exec('ROLLBACK');
  conn.close();
  die(`Could not prepare the records for syncing: ${err.message}`);
}

// ---- 7. somebody has to be able to sign in -------------------------------
// A phone used on its own has one account, and joining a clinic stood it down.
// If this database has no active administrator left, that account is the only
// way back in, so it is reinstated rather than left dead with the records
// locked behind it.
const admin = conn.prepare(
  "SELECT COUNT(*) AS n FROM users WHERE active = 1 AND role = 'admin'").get().n;
let reinstated = null;
if (!admin) {
  const setup = conn.prepare(
    `SELECT id, email FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`).get();
  if (setup) {
    conn.prepare('UPDATE users SET active = 1, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), setup.id);
    reinstated = setup.email;
  }
}

const final = {
  patients: conn.prepare('SELECT COUNT(*) AS n FROM patients').get().n,
  invoices: conn.prepare('SELECT COUNT(*) AS n FROM invoices').get().n,
  images: conn.prepare('SELECT COUNT(*) AS n FROM attachments').get().n,
};
conn.close();

say();
say(`  Restored to ${target}`);
say(`  ${final.patients} patient(s), ${final.invoices} invoice(s), ${final.images} image(s)`);
say(`  ${queued} record(s) queued, so the first device to join receives everything.`);
if (reinstated) {
  say();
  say(`  There was no active administrator, so ${reinstated} was switched back on.`);
  say('  Sign in with the password that account already had, and change it.');
}
say();
say('  Start the clinic, then join the phones to this computer.');
say();
