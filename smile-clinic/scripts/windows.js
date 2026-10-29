/**
 * Everything the Windows double-click files actually do.
 *
 *   node scripts/windows.js start          start it and open the browser
 *   node scripts/windows.js serve          start it and say nothing (used at login)
 *   node scripts/windows.js autostart on|off|status
 *
 * The batch files are three lines each on purpose. Batch is a bad language to
 * be subtle in — quoting, line continuation and error codes all behave in ways
 * that are hard to get right without a Windows machine to try them on — and
 * none of it can be tested. This can.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { whatIsRunning, waitForHealth } from './running.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = () => Number(process.env.PORT || 4000);
const say = (line = '') => console.log(line);

/**
 * Not a failure: it means there is something on screen worth reading, and the
 * batch file should hold the window open. Batch can only test "errorlevel 1 or
 * more", so anything non-zero keeps it up.
 */
export const SHOW_AND_WAIT = 10;

const LOG = (root = ROOT) => path.join(root, 'logs', 'clinic.log');

/** How much of the log is already there, so we can read only what we add. */
function logSize(root = ROOT) {
  try { return fs.statSync(LOG(root)).size; } catch { return 0; }
}

/**
 * The password a brand new clinic prints once, and only once.
 *
 * Started from a double-click the server has no terminal to print to, so this
 * goes to the log and nobody ever sees it — leaving somebody at a sign-in
 * screen with credentials they were never told. Whatever the server wrote
 * while starting is read back out and put in front of them.
 */
export function firstRunNotice(from, root = ROOT) {
  let added = '';
  try {
    const handle = fs.openSync(LOG(root), 'r');
    try {
      const size = fs.fstatSync(handle).size;
      if (size <= from) return null;
      const buffer = Buffer.alloc(size - from);
      fs.readSync(handle, buffer, 0, buffer.length, from);
      added = buffer.toString('utf8');
    } finally {
      fs.closeSync(handle);
    }
  } catch {
    return null;
  }
  if (!/First run/.test(added)) return null;
  const lines = added.split(/\r?\n/);
  const start = lines.findIndex((l) => /First run/.test(l));
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && /^=+$/.test(l.trim()));
  return lines.slice(start, end < 0 ? start + 6 : end + 1)
    .filter((l) => !/^=+$/.test(l.trim())).join('\n');
}

/** Where Windows keeps the things it runs when somebody logs in. */
export function startupFolder(env = process.env) {
  const appData = env.APPDATA;
  if (!appData) return null;
  return path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
}

export const STARTUP_FILE = 'Smile Clinic.cmd';

/**
 * A .cmd in the Startup folder rather than a shortcut.
 *
 * A .lnk has to be built through a COM object from PowerShell, which means
 * quoting a path inside a quoted string inside a batch line — three ways to
 * get it wrong, and it broke on the apostrophe in a name like O'Brien. Windows
 * runs a .cmd in that folder perfectly well, and this one is a file anybody
 * can open and read.
 */
export function startupScript(root = ROOT) {
  return [
    '@echo off',
    'rem  Starts Smile Clinic when this computer is switched on.',
    'rem  Created by "Run at startup". Delete it, or double-click',
    'rem  "Stop running at startup", to stop it happening.',
    `cd /d "${root}" || exit /b 1`,
    'node --no-warnings scripts\\windows.js serve',
    '',
  ].join('\r\n');
}

export function autostartPath(env = process.env) {
  const folder = startupFolder(env);
  return folder ? path.join(folder, STARTUP_FILE) : null;
}

export function enableAutostart({ env = process.env, root = ROOT } = {}) {
  const target = autostartPath(env);
  if (!target) throw new Error('Windows did not say where its Startup folder is.');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, startupScript(root));
  return target;
}

export function disableAutostart({ env = process.env } = {}) {
  const target = autostartPath(env);
  if (!target || !fs.existsSync(target)) return null;
  fs.unlinkSync(target);
  return target;
}

export function autostartState({ env = process.env } = {}) {
  const target = autostartPath(env);
  return { path: target, enabled: Boolean(target && fs.existsSync(target)) };
}

/**
 * Starts the server as its own process, with no console window of its own.
 *
 * The old version opened a minimised command prompt, which is a window a
 * clinic can close by accident and take the clinic down with it.
 */
export function startServer({ root = ROOT, port = PORT() } = {}) {
  const logs = path.join(root, 'logs');
  fs.mkdirSync(logs, { recursive: true });
  const log = fs.openSync(path.join(logs, 'clinic.log'), 'a');
  const child = spawn(process.execPath, ['--no-warnings', path.join(root, 'server', 'index.js')], {
    cwd: root,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', log, log],
    env: { ...process.env, PORT: String(port) },
  });
  child.unref();
  return child.pid;
}

/** Opens the clinic in whatever the person uses to browse. */
export function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      // `start` is a shell builtin, and the empty "" is the window title —
      // without it a quoted url would be taken as the title and nothing opens.
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
    return true;
  } catch {
    return false;
  }
}

async function run(command, argument) {
  const port = PORT();
  const url = `http://localhost:${port}`;

  if (command === 'start' || command === 'serve') {
    const already = await whatIsRunning(port);
    let firstRun = null;
    if (!already) {
      say();
      say('  Starting the clinic...');
      const logWas = logSize();
      startServer({ port });
      const version = await waitForHealth(port, 30);
      if (!version) {
        say();
        say('  The clinic did not start. The end of the log:');
        say();
        try {
          const log = fs.readFileSync(path.join(ROOT, 'logs', 'clinic.log'), 'utf8');
          say(log.split('\n').slice(-20).join('\n'));
        } catch {
          say('  (there is no log file, so it did not get far enough to write one)');
        }
        return 1;
      }
      say(`  The clinic is running — version ${version}.`);
      firstRun = firstRunNotice(logWas);
    } else {
      say();
      say(`  The clinic is already running — version ${already.version}.`);
    }

    if (command === 'start') openBrowser(url);
    say();
    say(`  Open it at ${url}`);
    say('  On a phone, use the address shown in Settings → Clinic.');
    say();

    if (firstRun && command === 'start') {
      say('  ' + '='.repeat(56));
      for (const line of firstRun.split('\n')) say('  ' + line.trim());
      say('  ' + '='.repeat(56));
      say();
      say('  Write that password down before closing this window. It is also');
      say(`  in ${LOG()}, and it is never shown again.`);
      say();
      return SHOW_AND_WAIT;
    }
    return 0;
  }

  if (command === 'autostart') {
    if (argument === 'on') {
      const target = enableAutostart();
      say();
      say('  Done. The clinic will start by itself when this computer does.');
      say(`  (${target})`);
      say();
      say('  To undo it, double-click "Stop running at startup".');
      say();
      return 0;
    }
    if (argument === 'off') {
      const removed = disableAutostart();
      say();
      say(removed
        ? '  The clinic will no longer start by itself.'
        : '  It was not set to start by itself.');
      say('  You can still open it with "Start Smile Clinic".');
      say();
      return 0;
    }
    const state = autostartState();
    say(state.enabled ? 'Starts automatically.' : 'Does not start automatically.');
    return state.enabled ? 0 : 1;
  }

  say('Usage: node scripts/windows.js start|serve|autostart on|off|status');
  return 2;
}

// Only when run directly, so the functions above can be tested.
const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  process.exit(await run(process.argv[2] || 'start', process.argv[3]));
}
