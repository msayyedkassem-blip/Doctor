/**
 * The Node side of the database: SQLite from the standard library, migrations
 * read off disk. Installing this is the first thing any server entry point does.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { setDriver, runMigrations, hasDriver, getDb } from './db.js';
import { dbPath, MIGRATIONS_DIR } from './config.js';

export function installNodeDriver() {
  if (hasDriver()) return getDb();

  const file = dbPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');

  setDriver(db);
  runMigrations(db, readMigrations());
  return db;
}

export function readMigrations() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({
      name,
      sql: fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8'),
    }));
}
