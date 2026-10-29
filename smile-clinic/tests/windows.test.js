/**
 * The Windows double-click files, minus the batch.
 *
 * Everything these cover used to live in .cmd files, where it could not be
 * run on anything but a Windows machine — and the version that shipped had a
 * line-continuation bug that would have left "Run at startup" doing nothing
 * at all. It lives in Node now so it can be checked here.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  startupFolder, autostartPath, enableAutostart, disableAutostart, autostartState,
  startupScript, firstRunNotice, STARTUP_FILE,
} from '../scripts/windows.js';

/** A stand-in for a Windows profile, wherever this happens to be running. */
function fakeWindows(name = 'Hiba') {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'clinic-win-'));
  return { env: { APPDATA: path.join(home, 'Users', name, 'AppData', 'Roaming') }, home };
}

describe('starting with Windows', () => {
  test('it looks in the folder Windows actually runs things from', () => {
    const { env } = fakeWindows();
    const folder = startupFolder(env);
    assert.match(folder.replace(/\\/g, '/'),
      /AppData\/Roaming\/Microsoft\/Windows\/Start Menu\/Programs\/Startup$/);
    assert.equal(path.basename(autostartPath(env)), STARTUP_FILE);
  });

  test('a profile Windows has not told us about is an error, not a crash', () => {
    assert.equal(startupFolder({}), null);
    assert.equal(autostartPath({}), null);
    assert.throws(() => enableAutostart({ env: {} }), /Startup folder/);
    assert.equal(autostartState({ env: {} }).enabled, false);
  });

  test('turning it on, off, and on again', () => {
    const { env } = fakeWindows();
    assert.equal(autostartState({ env }).enabled, false);

    const written = enableAutostart({ env, root: 'C:\\Users\\Hiba\\Documents\\Smile Clinic' });
    assert.ok(fs.existsSync(written), 'nothing was written to the Startup folder');
    assert.equal(autostartState({ env }).enabled, true);

    // Doing it twice is somebody double-clicking twice, not an error.
    enableAutostart({ env, root: 'C:\\Users\\Hiba\\Documents\\Smile Clinic' });
    assert.equal(autostartState({ env }).enabled, true);

    assert.equal(disableAutostart({ env }), written);
    assert.equal(autostartState({ env }).enabled, false);
    // And turning it off when it is already off says so rather than throwing.
    assert.equal(disableAutostart({ env }), null);
  });

  test('what it writes is a batch file Windows will run', () => {
    const root = 'C:\\Users\\Hiba\\Documents\\Smile Clinic';
    const script = startupScript(root);

    assert.match(script, /^@echo off/, 'it must not echo every line at login');
    assert.ok(script.includes(`cd /d "${root}"`),
      'it has to move to the clinic folder before anything else');
    assert.match(script, /scripts\\windows\.js serve/,
      'at login it starts the clinic quietly');
    assert.ok(!/windows\.js start\b/.test(script),
      'starting at login must not throw a browser window at somebody');

    // Batch needs Windows line endings, and every line must have them.
    const lines = script.split('\n').slice(0, -1);
    assert.deepEqual(lines.filter((l) => !l.endsWith('\r')), [],
      'a line without a carriage return makes the whole file misbehave');
  });

  test('a folder with a space or an apostrophe in it is still fine', () => {
    // The previous version built a PowerShell command by pasting the path into
    // a single-quoted string, so a name like O'Brien broke it.
    for (const root of [
      "C:\\Users\\O'Brien\\Documents\\Smile Clinic",
      'C:\\Users\\Dr Hiba\\My Documents\\Smile Clinic',
      'D:\\عيادة\\Smile Clinic',
    ]) {
      const script = startupScript(root);
      assert.ok(script.includes(`cd /d "${root}"`), `broke on ${root}`);
      // One cd line, so the path cannot have been split across lines.
      assert.equal(script.split('\r\n').filter((l) => l.startsWith('cd /d')).length, 1);
    }
  });
});

describe('the password a new clinic prints once', () => {
  // Started from a double-click there is no terminal, so the server's first-run
  // message goes to the log and nobody sees it — leaving somebody staring at a
  // sign-in screen with credentials they were never given.
  const withLog = (contents) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clinic-log-'));
    fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'logs', 'clinic.log'), contents);
    return root;
  };

  const BANNER = [
    '========================================================',
    '  First run — an administrator account was created:',
    '    email:    admin@clinic.local',
    '    password: kP3nQ7xR',
    '  Change this password after you sign in.',
    '========================================================',
    '',
    'Smile Clinic is running at http://localhost:4000',
  ].join('\n');

  test('it is found and handed back', () => {
    const root = withLog(BANNER);
    const notice = firstRunNotice(0, root);
    assert.ok(notice, 'the first-run message was not found');
    assert.match(notice, /password: kP3nQ7xR/);
    assert.match(notice, /admin@clinic\.local/);
    assert.ok(!notice.includes('===='), 'the rules around it are drawn here instead');
  });

  test('only what this start wrote counts', () => {
    // The clinic has been started a hundred times since; the banner from
    // months ago must not be waved at somebody as though it were new.
    const root = withLog(BANNER);
    const size = fs.statSync(path.join(root, 'logs', 'clinic.log')).size;
    fs.appendFileSync(path.join(root, 'logs', 'clinic.log'),
      '\nSmile Clinic is running at http://localhost:4000\n');
    assert.equal(firstRunNotice(size, root), null);
  });

  test('an ordinary start says nothing', () => {
    const root = withLog('Smile Clinic is running at http://localhost:4000\n');
    assert.equal(firstRunNotice(0, root), null);
  });

  test('no log at all is not a crash', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clinic-nolog-'));
    assert.equal(firstRunNotice(0, root), null);
  });
});

describe('the double-click files', () => {
  const dir = new URL('../windows/', import.meta.url);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.cmd'));

  test('the ones a clinic needs are all there', () => {
    for (const expected of [
      'Start Smile Clinic.cmd', 'Run at startup.cmd', 'Stop running at startup.cmd',
      'Back up the records.cmd', 'Restore from a backup.cmd',
    ]) {
      assert.ok(files.includes(expected), `${expected} is missing`);
    }
  });

  for (const name of files) {
    test(`${name} is a thin wrapper around tested code`, () => {
      const text = fs.readFileSync(new URL(name, dir), 'utf8');

      // The bug that shipped: joining lines with ^ pasted two quoted strings
      // together with nothing between them. Nothing here continues a line.
      assert.ok(!/\^\r?\n/.test(text),
        'line continuation in batch is how the last version broke');
      assert.ok(!/powershell/i.test(text) || /Get-Content/.test(text),
        'anything beyond reading a log belongs in Node, where it can be tested');

      // Every one must move to the clinic folder first — a .cmd run from
      // Explorer starts in whatever folder Explorer felt like.
      assert.match(text, /cd \/d "%~dp0\.\."/,
        'it must cd to the app folder, and %~dp0 already ends in a backslash');
      assert.match(text, /^@echo off/, 'it should not print itself');
    });
  }
});
