/**
 * Puts one working copy of the clinic in one place, and makes it start itself.
 *
 *   node scripts/tidy-up.js
 *
 * Downloading the app repeatedly leaves "Doctor", "Doctor 1", "Doctor 2" — only
 * one of which holds the real records. This backs up every database it can find
 * first, then assembles a single tidy copy from the newest code and the real
 * records, and sets it to start at login.
 *
 * It never deletes anything. The old folders are listed at the end so they can
 * be dragged to the Trash by hand, once everything is confirmed working.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync, backup } from 'node:sqlite';
import { findInstalls, describe, bestInstall } from './find-installs.js';
import { stopRunning, waitForHealth } from './running.js';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOME = os.homedir();
const TARGET = process.env.CLINIC_HOME || path.join(HOME, 'Smile Clinic');
const BACKUPS = path.join(HOME, 'Smile Clinic Backups');

const pretty = (p) => p.replace(HOME, '~');
const say = (line = '') => console.log(line);

say();
say('  Tidying up the clinic app');
say('  ' + '-'.repeat(40));
say();

// ---- 1. what is out there --------------------------------------------------
// The search only looks under the home folder, so a copy unzipped somewhere
// else would be missed — including, absurdly, the one this is running from.
const dirs = findInstalls();
if (!dirs.some((dir) => path.resolve(dir) === path.resolve(HERE))) dirs.push(HERE);
const report = dirs.map(describe);
say(`  Found ${report.length} cop${report.length === 1 ? 'y' : 'ies'}.`);

// ---- 2. back every database up before touching anything --------------------
fs.mkdirSync(BACKUPS, { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
let saved = 0;

for (const item of report) {
  if (!item.hasData) continue;
  const source = path.join(item.dir, 'data', 'clinic.db');
  const label = path.basename(item.dir).replace(/\s+/g, '-');
  const destination = path.join(BACKUPS, `${label}-${stamp}.db`);
  try {
    const db = new DatabaseSync(source, { readOnly: true });
    try { await backup(db, destination); } finally { db.close(); }
    saved += 1;
    say(`  Backed up ${pretty(item.dir)}`);
  } catch (err) {
    say(`  Could not back up ${pretty(item.dir)}: ${err.message}`);
  }
}
say(`  ${saved} backup${saved === 1 ? '' : 's'} saved in ${pretty(BACKUPS)}`);
say();

// ---- 3. which records are the real ones ------------------------------------
const keep = bestInstall(report);
if (keep && keep.demo) {
  say('  Careful: the only records found are the demo ones, so the tidy copy');
  say('  will start empty. That is the right thing for a real clinic.');
  say();
}

// ---- 4. stop whatever is already serving ------------------------------------
// Node reads its files once, at startup. Copying new ones under a clinic that
// is already running changes nothing on screen, which is exactly what "I
// replaced the files and it looks the same" is.
if (process.platform === 'darwin') {
  // A login item would restart the old copy the moment it is killed.
  try {
    execFileSync('launchctl', ['bootout', `gui/${process.getuid()}/com.smileclinic.server`],
      { stdio: 'pipe' });
  } catch { /* not installed as a service, or not running */ }
}
if (await stopRunning()) say('  Stopped the clinic that was already running.');

// ---- 5. assemble one tidy copy ---------------------------------------------
if (path.resolve(TARGET) === path.resolve(HERE)) {
  say('  This copy is already the tidy one. Leaving it where it is.');
} else {
  fs.mkdirSync(TARGET, { recursive: true });
  for (const entry of fs.readdirSync(HERE)) {
    if (['data', 'node_modules', '.git', 'logs', 'backups'].includes(entry)) continue;
    fs.cpSync(path.join(HERE, entry), path.join(TARGET, entry), { recursive: true });
  }
  say(`  Newest app files copied to ${pretty(TARGET)}`);

  if (keep && keep.hasData && !keep.demo) {
    fs.mkdirSync(path.join(TARGET, 'data'), { recursive: true });
    const from = path.join(keep.dir, 'data', 'clinic.db');
    const to = path.join(TARGET, 'data', 'clinic.db');
    if (path.resolve(from) !== path.resolve(to)) {
      fs.copyFileSync(from, to);
      say(`  Real records brought across: ${keep.patients} patients`
        + ` from ${pretty(keep.dir)}`);
    }
  } else {
    say('  No real records to bring across — this copy starts fresh.');
  }
}
say();

// ---- 6. make it open by itself ---------------------------------------------
// Double-clicking this is how the clinic gets opened from now on, so it has to
// say what is wrong rather than flash a window and disappear.
const macLauncher = `#!/bin/bash
cd "${TARGET}" || {
  echo "The clinic folder has moved or been deleted:"
  echo "  ${TARGET}"
  read -n 1 -s -p "Press any key to close."
  exit 1
}

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed on this Mac."
  echo "Get it from https://nodejs.org, then double-click this again."
  read -n 1 -s -p "Press any key to close."
  exit 1
fi

mkdir -p logs
# Start it only if it is not already running.
if ! curl -fsS http://localhost:4000/api/health >/dev/null 2>&1; then
  node --no-warnings server/index.js >> logs/clinic.log 2>&1 &
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    sleep 1
    curl -fsS http://localhost:4000/api/health >/dev/null 2>&1 && break
  done
fi

if curl -fsS http://localhost:4000/api/health >/dev/null 2>&1; then
  open http://localhost:4000
else
  echo "The clinic did not start. The end of the log:"
  tail -20 logs/clinic.log
  read -n 1 -s -p "Press any key to close."
fi
`;

// On Windows the Desktop file is a one-line hand-off to the real launcher in
// windows/, so there is only one script to fix if it ever needs fixing. CRLF
// because a .cmd file with Unix line endings closes without a word.
const windowsLauncher = [
  '@echo off',
  `cd /d "${TARGET}" || exit /b 1`,
  'call "windows\\Start Smile Clinic.cmd"',
  '',
].join('\r\n');

const onWindows = process.platform === 'win32';
const launcher = path.join(
  HOME, 'Desktop', onWindows ? 'Smile Clinic.cmd' : 'Smile Clinic.command');
try {
  fs.mkdirSync(path.dirname(launcher), { recursive: true });
  fs.writeFileSync(launcher, onWindows ? windowsLauncher : macLauncher);
  if (!onWindows) fs.chmodSync(launcher, 0o755);
  say(`  Created a double-click launcher: ${pretty(launcher)}`);
} catch (err) {
  // Not worth stopping for: the app still starts by itself, and stopping here
  // would leave the clinic shut down with nothing put back.
  say(`  Could not put a launcher on the Desktop: ${err.message}`);
}

if (process.platform === 'darwin') {
  try {
    execFileSync('bash', [path.join(TARGET, 'scripts', 'install-mac.sh')], {
      stdio: 'pipe', cwd: TARGET,
    });
    say('  Set to start automatically every time you log in.');
  } catch (err) {
    say(`  Could not set it to start automatically: ${String(err.message).split('\n')[0]}`);
    say('  The launcher on your Desktop still works.');
  }
} else if (onWindows) {
  // Not done without being asked: putting something in a person's Startup
  // folder behind their back is not ours to decide.
  say('  To have it start by itself, double-click "Run at startup" in the');
  say(`  windows folder inside ${pretty(TARGET)}.`);
}

// ---- 7. prove the new one is the one running --------------------------------
const expected = JSON.parse(
  fs.readFileSync(path.join(TARGET, 'package.json'), 'utf8')).version;
const running = await waitForHealth(Number(process.env.PORT || 4000), 10);
say();
if (running === expected) {
  say(`  Running version ${running}. The app shows it in the bottom-left corner,`);
  say('  so you can always tell which copy you are looking at.');
} else if (running) {
  say(`  Careful: something else is answering on port ${process.env.PORT || 4000} —`);
  say(`  it reports version ${running}, not ${expected}. Close it and try again.`);
} else {
  say('  The clinic has not answered yet. Double-click the Desktop launcher.');
}

// ---- 8. what is now safe to remove -----------------------------------------
say();
say('  ' + '-'.repeat(40));
say('  Done. Everything below is now a spare copy, and every database has');
say(`  been backed up to ${pretty(BACKUPS)}.`);
say();
say('  Once you have opened the app and seen your records, these can go');
say('  in the Trash:');
say();
for (const item of report) {
  if (path.resolve(item.dir) === path.resolve(TARGET)) continue;
  say(`      ${pretty(item.dir)}`);
}
say();
say(`  Keep this one:  ${pretty(TARGET)}`);
say();
