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

export async function installBrowserDriver({ name = 'clinic', file = '/clinic.db' } = {}) {
  sqlite3 = await initSqlite();

  // opfs-sahpool persists to real storage without needing cross-origin
  // isolation, which a plain http:// page on a clinic network cannot have.
  pool = await sqlite3.installOpfsSAHPoolVfs({ name });
  dbFile = file;
  db = new pool.OpfsSAHPoolDb(file);

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
