/**
 * What the licence means for this installation, right now.
 *
 * The rule the whole app hangs on: an unlicensed clinic is *read-only*, never
 * locked. Every record stays visible, searchable and printable; nothing new can
 * be written. Holding a clinic's patient records hostage over a renewal is how
 * software gets ripped out and spoken badly of, and a dentist mid-appointment
 * is not a person to take hostage.
 */
import { q } from '../db.js';
import { readKey, today, hasLicencePublicKey } from './licence.js';

export const TRIAL_DAYS = 30;

const row = () => {
  try {
    return q.get('SELECT * FROM licence WHERE id = 1');
  } catch {
    return null; // before the migration has run
  }
};

/**
 * The date, as this installation is willing to believe it.
 *
 * Only ever moves forward. Winding the clock back is the obvious way to keep an
 * expired subscription alive, and the fix costs one column.
 */
export function ratchetToday() {
  const now = today();
  const current = row();
  if (!current) return now;
  const seen = current.high_water;
  if (!seen || now > seen) {
    q.run('UPDATE licence SET high_water = ? WHERE id = 1', now);
    return now;
  }
  return seen;
}

/** Starts the trial the first time the app is used, not when it was unzipped. */
export function startTrial() {
  const current = row();
  if (!current || current.trial_started) return;
  q.run('UPDATE licence SET trial_started = ? WHERE id = 1', today());
}

const addDays = (iso, days) => {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/**
 * Everything a screen or a gate needs to know, in one shape.
 *
 * `writable` is the only field that decides anything; the rest is for saying
 * why.
 */
export async function licenceState() {
  const current = row();
  const now = ratchetToday();

  // A build with no public key compiled in is somebody's own copy, not a sold
  // one. It has nothing to enforce.
  if (!hasLicencePublicKey()) {
    return { status: 'unlicensed-build', writable: true, devices: 255, plan: null };
  }

  if (current?.key) {
    const read = await readKey(current.key);
    if (read.valid) {
      const expired = read.expires && now > read.expires;
      return {
        status: expired ? 'expired' : 'licensed',
        writable: !expired,
        plan: read.plan,
        devices: read.devices,
        expires: read.expires,
        serial: read.serial,
        activated_at: current.activated_at,
        days_left: read.expires ? daysBetween(now, read.expires) : null,
      };
    }
    // A key that no longer reads is worth saying out loud rather than
    // silently treating the clinic as if it had never paid.
    return { status: 'invalid', writable: false, reason: read.reason, devices: 1, plan: null };
  }

  const started = current?.trial_started;
  if (!started) return { status: 'no-licence', writable: false, devices: 1, plan: null };

  const ends = addDays(started, TRIAL_DAYS);
  const left = daysBetween(now, ends);
  return {
    status: left > 0 ? 'trial' : 'trial-over',
    writable: left > 0,
    plan: 'trial',
    devices: 2,
    expires: ends,
    days_left: Math.max(0, left),
    trial_started: started,
  };
}

function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

/** Records a key that has already been checked. */
export function saveKey(key) {
  q.run('UPDATE licence SET key = ?, activated_at = ? WHERE id = 1',
    key, new Date().toISOString());
}

export function storedKey() {
  return row()?.key || '';
}
