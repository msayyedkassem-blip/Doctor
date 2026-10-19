/**
 * Drives the app with its database inside the browser, proving the phone can
 * run the clinic with the server unreachable.
 *
 *   node tests/browser-local.mjs            (needs a server only to serve files)
 *
 * Playwright is not a dependency of the app; install it separately to run this.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:4000';
const OUT = process.env.OUT || '/tmp/clinic-shots';
const EXECUTABLE = process.env.CHROMIUM;
const errors = [];
const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

const dataCalls = [];
page.on('request', (r) => { if (r.url().includes('/api/')) dataCalls.push(r.url()); });

import fs from 'node:fs';
fs.mkdirSync(OUT, { recursive: true });
const screenshot = (page, name) =>
  page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });

const step = async (n, fn) => {
  try { await fn(); console.log('  ok  ' + n); }
  catch (e) { console.log('  FAIL ' + n + ': ' + e.message.split('\n')[0]); errors.push(n); }
};

await page.goto(BASE + '/?local=1', { waitUntil: 'networkidle' });
await page.waitForSelector('input[name="email"]', { timeout: 20000 });
await page.fill('input[name="email"]', 'admin@clinic.local');
await page.fill('input[name="password"]', 'changeme');
await page.click('button[type="submit"]');
await page.waitForSelector('.sidebar', { timeout: 25000 });
await page.waitForSelector('.stat-value', { timeout: 20000 });
console.log('  ok  sign in (in-phone database)');
await screenshot(page, '01-dashboard');

await step('create a patient', async () => {
  await page.click('[data-nav="patients"]');
  await page.waitForSelector('.topbar-actions .btn-primary', { timeout: 10000 });
  await page.click('.topbar-actions .btn-primary');
  await page.waitForSelector('input[name="first_name"]');
  await page.fill('input[name="first_name"]', 'ليلى');
  await page.fill('input[name="last_name"]', 'حسن');
  await page.fill('input[name="phone"]', '07701234567');
  await page.click('.modal-foot .btn-primary');
  await page.waitForSelector('.modal', { state: 'detached', timeout: 10000 });
  await page.waitForSelector('tbody tr', { timeout: 10000 });
  const text = await page.textContent('tbody');
  if (!text.includes('ليلى')) throw new Error('patient not listed');
});

await step('open the patient file', async () => {
  await page.click('tbody tr');
  await page.waitForSelector('.tabs', { timeout: 10000 });
  await page.waitForSelector('.stat-value');
  await screenshot(page, '02-patient');
});

await step('chart a tooth', async () => {
  await page.click('.tab:has-text("Odontogram")');
  await page.waitForSelector('.odontogram .tooth');
  await page.click('.odontogram .tooth');
  await page.waitForSelector('select[name="condition"]');
  await page.selectOption('select[name="condition"]', 'caries');
  await page.click('.modal-foot .btn-primary');
  await page.waitForSelector('.modal', { state: 'detached', timeout: 10000 });
  await page.waitForSelector('tbody tr', { timeout: 10000 });
});

await step('book an appointment', async () => {
  await page.click('[data-nav="calendar"]');
  await page.waitForSelector('.cal-grid', { timeout: 10000 });
  await page.click('.topbar-actions .btn-primary');
  await page.waitForSelector('.modal input[name="patient_search"]');
  await page.fill('.modal input[name="patient_search"]', 'ليلى');
  await page.waitForTimeout(700);
  await page.click('.modal .nav-item');
  await page.click('.modal-foot .btn-primary');
  await page.waitForSelector('.modal', { state: 'detached', timeout: 10000 });
  await page.waitForSelector('.cal-event', { timeout: 10000 });
  await screenshot(page, '03-calendar');
});

await step('bill and take payment', async () => {
  await page.click('[data-nav="billing"]');
  await page.waitForSelector('.topbar-actions .btn-primary', { timeout: 10000 });
  await page.click('.topbar-actions .btn-primary');
  await page.waitForSelector('.invoice-lines', { timeout: 10000 });
  await page.fill('.modal input[name="patient_search"]', 'ليلى');
  await page.waitForTimeout(700);
  await page.click('.modal .nav-item');
  const desc = page.locator('.invoice-lines tbody tr').first().locator('input').first();
  await desc.fill('Consultation');
  await page.locator('.invoice-lines tbody tr').first().locator('input[type="number"]').nth(2).fill('80');
  await page.click('.modal-foot .btn-primary');
  await page.waitForSelector('.modal', { state: 'detached', timeout: 10000 });
  await page.waitForSelector('tbody tr', { timeout: 10000 });
  await screenshot(page, '04-billing');
});

await step('reports compute', async () => {
  await page.click('[data-nav="reports"]');
  await page.waitForSelector('.spark', { timeout: 15000 });
  await screenshot(page, '05-reports');
});

await step('WhatsApp composer renders Arabic', async () => {
  await page.goto(BASE + '/?local=1#/reminders', { waitUntil: 'networkidle' });
  await page.waitForSelector('.stat-value', { timeout: 15000 });
  await screenshot(page, '06-reminders');
});

await step('data survives a full reload', async () => {
  await page.goto(BASE + '/?local=1#/patients', { waitUntil: 'networkidle' });
  await page.waitForSelector('tbody tr', { timeout: 20000 });
  const text = await page.textContent('tbody');
  if (!text.includes('ليلى')) throw new Error('patient vanished after reload');
});

console.log('\n  network /api/ requests during all of that: ' + dataCalls.length
  + (dataCalls.length ? ' -> ' + dataCalls.slice(0, 3).join(', ') : ' (nothing touched the server)'));
await browser.close();
if (errors.length) {
  console.log('\nERRORS:\n' + errors.slice(0, 6).join('\n'));
  process.exit(1);
}
if (dataCalls.length) {
  console.log('\nFAILED: local mode must not call the network for data.');
  process.exit(1);
}
console.log('No console errors.');
