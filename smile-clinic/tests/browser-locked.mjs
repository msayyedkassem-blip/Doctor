/**
 * Two copies of the app, one database.
 *
 * The storage a phone keeps its records in can only be held by one copy at a
 * time. A second one — a reload that starts before the last one let go, an app
 * updated over itself, a tab left open — used to be met with "Failed to execute
 * 'createSyncAccessHandle' on 'FileSystemFileHandle'", which says nothing to
 * anybody and looks exactly like the records are gone.
 *
 * What it must do instead: wait, because the lock almost always clears within
 * a second or two, and if it genuinely does not, say what to do about it.
 *
 *   node tests/serve-public.mjs 4101
 *   BASE=http://localhost:4101 node tests/browser-locked.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:4101';
const browser = await chromium.launch(
  process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
// One context: two pages sharing an origin, which is what two copies of the
// app on one phone amount to.
const context = await browser.newContext({ serviceWorkers: 'block' });
const fails = [];
const note = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };

const signIn = async (page) => {
  await page.waitForSelector('input[name="email"]', { timeout: 30000 });
  await page.fill('input[name="email"]', 'admin@clinic.local');
  await page.fill('input[name="password"]', 'changeme');
  await page.click('button[type="submit"]');
  await page.waitForSelector('.sidebar', { timeout: 40000 });
};

const first = await context.newPage({ viewport: { width: 412, height: 915 } });
await first.goto(`${BASE}/?local=1`, { waitUntil: 'networkidle' });
await signIn(first);
note(true, 'the first copy opened the records');

// A second copy, while the first is still holding everything.
const second = await context.newPage({ viewport: { width: 412, height: 915 } });
await second.goto(`${BASE}/?local=1`, { waitUntil: 'domcontentloaded' });
await second.waitForTimeout(9000);

const shown = await second.textContent('body');
note(!/createSyncAccessHandle|FileSystemFileHandle/.test(shown),
  'the second copy never shows the browser’s own wording');

const waited = /Another copy of this app is still holding the records/.test(shown);
const gotIn = Boolean(await second.$('input[name="email"]')) || Boolean(await second.$('.sidebar'));
note(waited || gotIn,
  waited ? 'it says which app to close, and that nothing is lost'
    : 'it waited for the lock and opened the records itself');

if (waited) {
  note(/Nothing has been lost/.test(shown), 'it says the records are safe');
  note(Boolean(await second.$('button')), 'and offers a way to try again');

  // Close the one holding the lock; trying again must then work.
  await first.close();
  await second.click('button:has-text("Try again")');
  await second.waitForSelector('input[name="email"], .sidebar', { timeout: 40000 })
    .then(() => note(true, 'once the other copy is closed, it opens'))
    .catch(() => note(false, 'it stayed stuck after the other copy closed'));
}

// Whichever way it went, the records must still be there — once whichever
// copy is holding them has been closed, which is the whole point.
for (const page of context.pages()) await page.close().catch(() => {});
const check = await context.newPage();
await check.goto(`${BASE}/?local=1`, { waitUntil: 'domcontentloaded' });
await check.waitForSelector('input[name="email"], .sidebar', { timeout: 60000 })
  .then(() => note(true, 'the records open again afterwards'))
  .catch(() => note(false, 'the database was left unopenable'));

await browser.close();
console.log(fails.length ? `\n${fails.length} failure(s):\n` + fails.map((f) => '  - ' + f).join('\n') : '\nall good');
process.exit(fails.length ? 1 : 0);
