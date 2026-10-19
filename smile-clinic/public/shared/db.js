/**
 * Database access, independent of where it runs.
 *
 * The same route code has to work in two very different places: on Node, where
 * SQLite is a built-in module and migrations are files on disk, and inside a
 * phone, where SQLite is WebAssembly and migrations arrive over fetch. Both
 * install a driver here; nothing above this file knows the difference.
 *
 * A driver must provide:
 *   prepare(sql) -> { all(...p), get(...p), run(...p) }
 *   exec(sql)
 *   close()
 */

let driver = null;

export function setDriver(next) {
  driver = next;
}

export function hasDriver() {
  return driver !== null;
}

export function getDb() {
  if (!driver) {
    throw new Error(
      'No database driver installed. Call installNodeDriver() on the server, '
      + 'or installBrowserDriver() in the app.',
    );
  }
  return driver;
}

/**
 * Applies any migration not yet recorded, in name order, each in its own
 * transaction so a failure leaves the database on the last good version.
 * `migrations` is [{ name, sql }] — read from disk or fetched, it makes no
 * difference here.
 */
export function runMigrations(conn, migrations) {
  conn.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);

  const applied = new Set(
    conn.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name),
  );

  const pending = [...migrations].sort((a, b) => a.name.localeCompare(b.name));
  for (const migration of pending) {
    if (applied.has(migration.name)) continue;
    conn.exec('BEGIN');
    try {
      conn.exec(migration.sql);
      conn.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)')
        .run(migration.name, new Date().toISOString());
      conn.exec('COMMIT');
      console.log(`[db] applied migration ${migration.name}`);
    } catch (err) {
      conn.exec('ROLLBACK');
      throw new Error(`Migration ${migration.name} failed: ${err.message}`);
    }
  }
}

/** Runs `fn` inside a transaction, rolling back on any thrown error. */
export function tx(fn) {
  const conn = getDb();
  conn.exec('BEGIN');
  try {
    const out = fn(conn);
    conn.exec('COMMIT');
    return out;
  } catch (err) {
    try { conn.exec('ROLLBACK'); } catch { /* connection already unwound */ }
    throw err;
  }
}

export const q = {
  all(sql, ...params) { return getDb().prepare(sql).all(...params); },
  get(sql, ...params) { return getDb().prepare(sql).get(...params) ?? null; },
  run(sql, ...params) { return getDb().prepare(sql).run(...params); },
};

/** Insert and return the new row id. */
export function insert(table, data) {
  const keys = Object.keys(data);
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
  const info = getDb().prepare(sql).run(...keys.map((k) => data[k]));
  return Number(info.lastInsertRowid);
}

/** Update by primary key; returns the number of affected rows. */
export function update(table, id, data) {
  const keys = Object.keys(data);
  if (!keys.length) return 0;
  const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`;
  const info = getDb().prepare(sql).run(...keys.map((k) => data[k]), id);
  return Number(info.changes);
}

export function closeDb() {
  if (!driver) return;
  // Tolerate a connection something else already closed, so shutting down
  // twice is not an error.
  try { driver.close(); } catch { /* already closed */ }
  driver = null;
}
