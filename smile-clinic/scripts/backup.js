/**
 * Safe online backup of the clinic database, using SQLite's own backup API so
 * it is consistent even while the app is running and writing.
 *
 *   node scripts/backup.js [destination-directory]
 *
 * Keeps the 30 most recent backups. Suitable for cron:
 *   0 21 * * *  cd /opt/smile-clinic && node scripts/backup.js /mnt/backups
 */
import { DatabaseSync, backup } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { dbPath, ROOT } from '../server/config.js';

const KEEP = Number(process.env.BACKUP_KEEP || 30);
const source = dbPath();
const dest = process.argv[2] || path.join(ROOT, 'backups');

if (!fs.existsSync(source)) {
  console.error(`No database at ${source}`);
  process.exit(1);
}

fs.mkdirSync(dest, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const plain = path.join(dest, `clinic-${stamp}.db`);

const db = new DatabaseSync(source, { readOnly: true });
try {
  await backup(db, plain);
} finally {
  db.close();
}

await pipeline(
  fs.createReadStream(plain),
  zlib.createGzip({ level: 9 }),
  fs.createWriteStream(`${plain}.gz`),
);
fs.unlinkSync(plain);

const size = (fs.statSync(`${plain}.gz`).size / 1024).toFixed(0);
console.log(`Backed up to ${plain}.gz (${size} KB)`);

// Prune everything past the newest KEEP backups.
const old = fs.readdirSync(dest)
  .filter((name) => /^clinic-.*\.db\.gz$/.test(name))
  .sort()
  .reverse()
  .slice(KEEP);
for (const name of old) {
  fs.unlinkSync(path.join(dest, name));
  console.log(`Removed old backup ${name}`);
}
