/**
 * Backing up a phone and putting it back.
 *
 * The app tells a standalone device to keep a backup, because records only on
 * that device go when the device does. This is the other half of that promise,
 * and the path somebody takes when they started on a phone and set the clinic
 * computer up afterwards.
 *
 * Playwright is not a dependency of the app; install it separately to run this.
 *
 *   node tests/serve-public.mjs 4101
 *   BASE=http://localhost:4101 node tests/browser-restore.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:4101';
const OUT = process.env.OUT || '/tmp/restore-shots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch(
  process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: true });
const page = await context.newPage({ viewport: { width: 412, height: 915 } });
const fails = [];
page.on('pageerror', (e) => fails.push('pageerror: ' + e.message));
const note = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };

await page.goto(BASE + '/?local=1', { waitUntil: 'networkidle' });
await page.waitForSelector('input[name="email"]', { timeout: 30000 });
await page.fill('input[name="email"]', 'admin@clinic.local');
await page.fill('input[name="password"]', 'changeme');
await page.click('button[type="submit"]');
await page.waitForSelector('.sidebar', { timeout: 30000 });
note(true, 'phone: signed in to its own database');

const nav = async (name) => {
  const toggle = await page.$('.menu-toggle');
  if (toggle && await toggle.isVisible()) await toggle.click();
  await page.click(`[data-nav="${name}"]`);
  await page.waitForTimeout(400);
};

// A patient that exists at the moment of the backup.
const make = async (first, last) => {
  await nav('patients');
  await page.waitForSelector('.topbar-actions .btn-primary', { timeout: 15000 });
  await page.click('.topbar-actions .btn-primary');
  await page.waitForSelector('input[name="first_name"]');
  await page.fill('input[name="first_name"]', first);
  await page.fill('input[name="last_name"]', last);
  await page.click('.modal button:has-text("Create patient")');
  await page.waitForSelector('.modal', { state: 'detached', timeout: 20000 });
};

await make('Kept', 'Inbackup');
note(true, 'phone: a patient recorded before the backup');

// Save the backup.
await nav('settings');
await page.waitForSelector('button:has-text("Save a backup file")', { timeout: 20000 });
const download = await Promise.all([
  page.waitForEvent('download', { timeout: 60000 }),
  page.click('button:has-text("Save a backup file")'),
]).then(([d]) => d);
const file = `${OUT}/backup.db`;
await download.saveAs(file);
const size = fs.statSync(file).size;
note(size > 10000, `phone: backup saved (${(size / 1024).toFixed(0)} KB)`);

// Then something that happens AFTER the backup, which restoring must undo.
await make('Added', 'Afterwards');
note(true, 'phone: another patient recorded after the backup');

// Restore.
await nav('settings');
await page.waitForSelector('button:has-text("Restore a backup file")', { timeout: 20000 });
await page.setInputFiles('input[type="file"]', file);
await page.waitForSelector('.modal:has-text("Restore this backup")', { timeout: 15000 });
await page.screenshot({ path: `${OUT}/01-confirm.png`, fullPage: true });
await page.click('.modal button:has-text("Replace everything")');

// It signs out and reloads.
await page.waitForSelector('input[name="email"]', { timeout: 40000 });
note(true, 'phone: signed out after restoring, as it says it will');
await page.fill('input[name="email"]', 'admin@clinic.local');
await page.fill('input[name="password"]', 'changeme');
await page.click('button[type="submit"]');
await page.waitForSelector('.sidebar', { timeout: 30000 });

await nav('patients');
await page.waitForSelector('tbody tr', { timeout: 20000 }).catch(() => {});
const text = await page.textContent('tbody').catch(() => '');
note(text.includes('Inbackup'), 'phone: the patient in the backup is back');
note(!text.includes('Afterwards'),
  'phone: the one recorded after the backup is gone, as restoring means');
await page.screenshot({ path: `${OUT}/02-restored.png`, fullPage: true });

// A file that is not a database must change nothing.
const junk = `${OUT}/not-a-database.db`;
fs.writeFileSync(junk, 'this is not a database, not even slightly');
await nav('settings');
await page.waitForSelector('button:has-text("Restore a backup file")', { timeout: 20000 });
await page.setInputFiles('input[type="file"]', junk);
await page.waitForSelector('.modal:has-text("Restore this backup")', { timeout: 15000 });
await page.click('.modal button:has-text("Replace everything")');
await page.waitForTimeout(2500);
const refused = await page.textContent('body');
note(/not a Smile Clinic backup|could not be opened/.test(refused),
  'phone: a file that is not a backup is refused');
await nav('patients');
await page.waitForSelector('tbody tr', { timeout: 20000 }).catch(() => {});
const after = await page.textContent('tbody').catch(() => '');
note(after.includes('Inbackup'), 'phone: and the records are still there afterwards');

await browser.close();
console.log(fails.length ? `\n${fails.length} failure(s):\n` + fails.map((f) => '  - ' + f).join('\n') : '\nall good');
process.exit(fails.length ? 1 : 0);
