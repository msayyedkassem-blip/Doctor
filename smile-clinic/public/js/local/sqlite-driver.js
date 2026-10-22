/**
 * Presents SQLite-in-WebAssembly through the same small interface the Node
 * driver offers, so every route file works unchanged inside a phone.
 *
 * Must run in a Web Worker: the OPFS sync access handles that make the
 * database persist do not exist on the main thread.
 */
import initSqlite from '../../vendor/sqlite3.mjs';
import { setDriver, runMigrations } from '../../shared/db.js';
import { MIGRATIONS } from './migrations.js';

let sqlite3 = null;
let db = null;
// Held on to so a backup can be put back: replacing the database means
// handing the bytes to the pool that owns the file, not to the connection.
let pool = null;
let dbFile = '/clinic.db';

/**
 * The storage this database lives in can only be held by one copy of the app
 * at a time, and the previous holder does not always let go the instant it is
 * closed — an app updated over itself, a tab left open, a phone that killed
 * the app in the background and reopened it. The browser reports that as
 * "Access Handles cannot be created...", which tells a dentist nothing.
 *
 * Almost every case clears itself within a couple of seconds, so wait for it
 * rather than greeting them with a dead end. Only once waiting has plainly
 * failed is anything said, and what is said is what to do about it.
 */
const LOCK_WAIT_MS = [200, 400, 800, 1200, 1600, 2000];

function isLockedOut(err) {
  return /Access Handle|NoModificationAllowed|another open/i.test(
    `${err?.name || ''} ${err?.message || ''}`);
}

async function openPool(name, file) {
  let last;
  for (let attempt = 0; attempt <= LOCK_WAIT_MS.length; attempt += 1) {
    try {
      pool = await sqlite3.installOpfsSAHPoolVfs({ name });
      return new pool.OpfsSAHPoolDb(file);
    } catch (err) {
      last = err;
      if (!isLockedOut(err) || attempt === LOCK_WAIT_MS.length) break;
      await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_MS[attempt]));
    }
  }
  if (isLockedOut(last)) {
    throw new Error('Another copy of this app is still holding the records. '
      + 'Close the app completely — swipe it away in the list of open apps — '
      + 'and open it again. Nothing has been lost.');
  }
  throw last;
}

export async function installBrowserDriver({ name = 'clinic', file = '/clinic.db' } = {}) {
  sqlite3 = await initSqlite();

  // opfs-sahpool persists to real storage without needing cross-origin
  // isolation, which a plain http:// page on a clinic network cannot have.
  dbFile = file;
  db = await openPool(name, file);

  db.exec('PRAGMA foreign_keys = ON');

  const driver = driverFor();
  setDriver(driver);
  runMigrations(driver, MIGRATIONS);
  return driver;
}

/**
 * The driver reads `db` each time rather than closing over it, so replacing
 * the database — restoring a backup — does not leave the app talking to a
 * connection that has been shut.
 */
function driverFor() {
  return {
    prepare(sql) {
      return {
        all(...params) {
          const rows = [];
          db.exec({ sql, bind: bindable(params), rowMode: 'object',
            callback: (row) => rows.push(row) });
          return rows;
        },
        get(...params) {
          let found;
          db.exec({ sql, bind: bindable(params), rowMode: 'object',
            callback: (row) => { if (found === undefined) found = row; } });
          return found;
        },
        run(...params) {
          db.exec({ sql, bind: bindable(params) });
          return {
            changes: db.changes(),
            lastInsertRowid: sqlite3.capi.sqlite3_last_insert_rowid(db.pointer),
          };
        },
      };
    },
    exec(sql) { db.exec(sql); },
    close() { db.close(); db = null; },
  };
}

/** sqlite-wasm wants the bind argument omitted entirely when there is nothing. */
function bindable(params) {
  return params.length ? params : undefined;
}

/** The whole database as bytes — used for backups and for handing to a server. */
export function exportDatabase() {
  if (!db) throw new Error('No database open');
  return sqlite3.capi.sqlite3_js_db_export(db.pointer);
}

export function databaseSize() {
  if (!db) return 0;
  return db.selectValue('PRAGMA page_count') * db.selectValue('PRAGMA page_size');
}

/** The first sixteen bytes every SQLite file starts with. */
const MAGIC = 'SQLite format 3\0';

function looksLikeSqlite(bytes) {
  if (!bytes || bytes.length < 512) return false;
  return [...MAGIC].every((c, i) => bytes[i] === c.charCodeAt(0));
}

/**
 * Replaces the whole database with a backup file.
 *
 * The current records are exported first and put back if anything goes wrong,
 * because the one unacceptable outcome here is a clinic that pressed Restore
 * and ended up with neither database.
 */
export async function importDatabase(bytes) {
  if (!pool || !db) throw new Error('No database open');
  const image = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!looksLikeSqlite(image)) {
    throw new Error('That file is not a Smile Clinic backup.');
  }

  const safety = exportDatabase();
  const restore = async (data) => {
    await pool.importDb(dbFile, data);
    db = new pool.OpfsSAHPoolDb(dbFile);
    db.exec('PRAGMA foreign_keys = ON');
  };

  db.close();
  db = null;
  try {
    await restore(image);
    // Prove it is really one of ours before letting the app carry on with it.
    const tables = [];
    db.exec({ sql: "SELECT name FROM sqlite_master WHERE type = 'table'",
      rowMode: 'object', callback: (row) => tables.push(row.name) });
    for (const needed of ['patients', 'users', 'schema_migrations']) {
      if (!tables.includes(needed)) throw new Error(`no ${needed} table`);
    }
  } catch (err) {
    try { if (db) db.close(); } catch { /* already shut */ }
    db = null;
    await restore(safety);
    setDriver(driverFor());
    throw new Error(`That backup could not be opened (${err.message}). `
      + 'Nothing was changed.');
  }

  const driver = driverFor();
  setDriver(driver);
  // A backup from an older version is still worth restoring; it just needs
  // the migrations it has not seen.
  runMigrations(driver, MIGRATIONS);
  return {
    patients: db.selectValue('SELECT COUNT(*) FROM patients'),
    users: db.selectValue('SELECT COUNT(*) FROM users'),
  };
}
