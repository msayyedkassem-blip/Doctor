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

export async function installBrowserDriver({ name = 'clinic', file = '/clinic.db' } = {}) {
  sqlite3 = await initSqlite();

  // opfs-sahpool persists to real storage without needing cross-origin
  // isolation, which a plain http:// page on a clinic network cannot have.
  const pool = await sqlite3.installOpfsSAHPoolVfs({ name });
  db = new pool.OpfsSAHPoolDb(file);

  db.exec('PRAGMA foreign_keys = ON');

  const driver = {
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

  setDriver(driver);
  runMigrations(driver, MIGRATIONS);
  return driver;
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
