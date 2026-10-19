/**
 * A phone joining a clinic server across two real origins.
 *
 * Every other sync test serves the app from the same origin as the server, and
 * that hides three things a real phone runs straight into: the browser will not
 * send a request cross-origin without CORS headers, it will not let a page set
 * a Cookie header at all, and an app served over https cannot reach a clinic
 * server over plain http. Paired devices exist because of all three.
 *
 * Playwright is not a dependency of the app; install it separately to run this.
 *
 *   npm run seed
 *   DATA_DIR=... PORT=4100 npm start                  # the clinic computer
 *   node tests/serve-public.mjs 4101                  # the phone, elsewhere
 *   SERVER=http://localhost:4100 PHONE=http://localhost:4101 \
 *     node tests/browser-cross-origin.mjs
 */
import { chromium } from 'playwright';

const SERVER = process.env.SERVER || 'http://localhost:4100';
const PHONE = process.env.PHONE || 'http://localhost:4101';
const OUT = process.env.OUT || '/tmp/clinic-cross-origin';
import fs from 'node:fs';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch(
  process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const fails = [];
const note = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };

// ---- 1. the clinic computer: an admin asks for a pairing code -------------
const clinic = await browser.newPage({ viewport: { width: 1440, height: 950 } });
clinic.on('pageerror', (e) => fails.push('clinic pageerror: ' + e.message));
await clinic.goto(SERVER + '/', { waitUntil: 'networkidle' });
await clinic.fill('input[name="email"]', 'admin@clinic.local');
await clinic.fill('input[name="password"]', 'demo1234');
await clinic.click('button[type="submit"]');
await clinic.waitForSelector('.sidebar', { timeout: 20000 });
note(true, 'clinic: sign in');

await clinic.click('[data-nav="settings"]');
await clinic.waitForSelector('.tabs', { timeout: 10000 });
await clinic.click('.tab:has-text("Devices")');
await clinic.waitForSelector('button:has-text("Add a device")', { timeout: 10000 });
await clinic.click('button:has-text("Add a device")');
await clinic.waitForSelector('.modal .mono.strong', { timeout: 10000 });
const code = (await clinic.textContent('.modal .mono.strong')).trim();
note(/^[0-9A-Z]{6}$/.test(code), `clinic: pairing code issued (${code})`);
await clinic.screenshot({ path: `${OUT}/01-pairing-code.png`, fullPage: true });
await clinic.click('.modal-foot .btn-primary, .modal button:has-text("Done")');

// ---- 2. the phone: a different origin entirely ----------------------------
const phone = await browser.newPage({ viewport: { width: 412, height: 915 } });
const consoleErrors = [];
phone.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
phone.on('pageerror', (e) => fails.push('phone pageerror: ' + e.message));
await phone.goto(PHONE + '/?local=1', { waitUntil: 'networkidle' });
await phone.waitForSelector('input[name="email"]', { timeout: 20000 });
await phone.fill('input[name="email"]', 'admin@clinic.local');
await phone.fill('input[name="password"]', 'changeme');
await phone.click('button[type="submit"]');
await phone.waitForSelector('.sidebar', { timeout: 30000 });
// At phone width the sidebar is a drawer behind the hamburger, so open it first.
const phoneNav = async (name) => {
  const toggle = await phone.$('.menu-toggle');
  if (toggle && await toggle.isVisible()) await toggle.click();
  await phone.click(`[data-nav="${name}"]`);
  await phone.waitForTimeout(400);
};

note(true, 'phone: sign in to its own database');

// Something of its own, so we can prove the exchange goes both ways.
await phoneNav('patients');
await phone.waitForSelector('.topbar-actions .btn-primary', { timeout: 10000 });
await phone.click('.topbar-actions .btn-primary');
await phone.waitForSelector('input[name="first_name"]');
for (const [name, value] of [['first_name', 'مريم'], ['last_name', 'الهاشمي'], ['phone', '07705550000']]) {
  const field = phone.locator(`input[name="${name}"]`);
  await field.click();
  await field.fill(value);
  if ((await field.inputValue()) !== value) throw new Error(`could not fill ${name}`);
}
await phone.click('.modal button:has-text("Create patient")');
try {
  await phone.waitForSelector('.modal', { state: 'detached', timeout: 15000 });
  note(true, 'phone: a patient created before joining');
} catch {
  await phone.screenshot({ path: `${OUT}/x-modal-stuck.png`, fullPage: true });
  const t = await phone.textContent('.modal').catch(() => '');
  note(false, 'phone: patient create stuck -> ' + t.replace(/\s+/g, ' ').slice(0, 300)
    + ' | console: ' + consoleErrors.slice(-3).join(' || '));
  await phone.keyboard.press('Escape');
}

// ---- 3. the join, across origins -----------------------------------------
await phoneNav('settings');
await phone.waitForSelector('input[name="sync_server"]', { timeout: 15000 });
const host = new URL(SERVER).host;
await phone.fill('input[name="sync_server"]', host);
await phone.fill('input[name="sync_code"]', code);
await phone.screenshot({ path: `${OUT}/02-join-form.png`, fullPage: true });
// Clear toasts left over from creating the patient, so the race below can only
// see the one the join itself raises.
await phone.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
await phone.click('button:has-text("Join this clinic")');

// Scope the wait to the sync card: the settings page already carries an
// unrelated "back this up" chip, and a stray toast would be read as success.
const card = phone.locator('.card:has-text("Keeping devices in step")');
const toastOrError = await Promise.race([
  phone.waitForSelector('.modal:has-text("Joined the clinic")', { timeout: 240000 })
    .then((h) => h.textContent()).then((t) => ({ ok: true, text: t.slice(0, 90) })),
  phone.waitForSelector('.toast-success, .toast.success', { timeout: 240000 })
    .then((h) => h.textContent()).then((t) => ({ ok: true, text: t })),
  card.locator('.alert-chip').first().waitFor({ timeout: 240000 })
    .then(() => card.locator('.alert-chip').first().textContent())
    .then((t) => ({ ok: false, text: t })),
]).catch((e) => ({ ok: false, text: 'nothing happened: ' + e.message }));
note(toastOrError.ok, `phone: join across origins -> ${toastOrError.text.trim()}`);
const issues = await phone.evaluate(async () => {
  const m = await import('/js/local/client.js');
  return m.localSyncIssues();
}).catch((e) => ({ error: e.message }));
console.log('  issues: ' + JSON.stringify(issues));
await phone.screenshot({ path: `${OUT}/03-after-join.png`, fullPage: true });

// ---- 4. did the records actually cross? ----------------------------------
if (toastOrError.ok) {
  // The setup sign-in is stood down on joining, so the app hands over to a
  // real clinic sign-in rather than silently dropping to a login screen.
  const handover = await phone.waitForSelector('.modal:has-text("Joined the clinic")', { timeout: 20000 })
    .then(() => true).catch(() => false);
  note(handover, 'phone: told to sign in again with a clinic account');
  if (handover) {
    await phone.click('.modal button:has-text("Sign in")');
    await phone.waitForSelector('input[name="email"]', { timeout: 30000 });
    await phone.fill('input[name="email"]', 'admin@clinic.local');
    await phone.fill('input[name="password"]', 'demo1234');
    await phone.click('button[type="submit"]');
    await phone.waitForSelector('.sidebar', { timeout: 40000 });
    note(true, 'phone: signed in with the clinic\u2019s own account');
  }
  await phoneNav('patients');
  await phone.waitForSelector('tbody tr', { timeout: 30000 }).catch(async () => {
    await phone.screenshot({ path: `${OUT}/x-patients.png`, fullPage: true });
    console.log('  page: ' + (await phone.textContent('.content')).replace(/\s+/g, ' ').slice(0, 400));
    console.log('  console: ' + consoleErrors.slice(-4).join(' || '));
  });
  const rows = await phone.$$eval('tbody tr', (r) => r.length).catch(() => 0);
  note(rows > 10, `phone: clinic patients arrived (${rows} rows on the first page)`);
  await phone.screenshot({ path: `${OUT}/04-phone-patients.png`, fullPage: true });

  await clinic.reload({ waitUntil: 'networkidle' });
  await clinic.click('[data-nav="patients"]');
  await clinic.waitForSelector('input[type="search"], input[name="q"]', { timeout: 15000 });
  await clinic.fill('input[type="search"], input[name="q"]', 'مريم');
  await clinic.waitForTimeout(1200);
  const clinicText = await clinic.textContent('tbody');
  note(clinicText.includes('مريم'), 'clinic: the phone’s patient arrived here too');
  await clinic.screenshot({ path: `${OUT}/05-clinic-has-phone-patient.png`, fullPage: true });
}

const cors = consoleErrors.filter((t) => /CORS|Access-Control|Mixed Content|Failed to fetch/i.test(t));
note(cors.length === 0, `phone: no CORS/fetch errors in the console${cors.length ? ' -> ' + cors[0] : ''}`);

await browser.close();
console.log(fails.length ? `\n${fails.length} failure(s):\n` + fails.map((f) => '  - ' + f).join('\n') : '\nall good');
process.exit(fails.length ? 1 : 0);
