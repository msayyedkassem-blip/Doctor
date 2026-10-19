import { t } from './i18n.js';
/**
 * Whether this copy of the app carries its own database or talks to a clinic
 * server over the network.
 *
 * Local is the right answer whenever there is no server to talk to: the app
 * opened from a file, or bundled inside the Android app. It can also be turned
 * on deliberately, which is how the phone keeps working when the clinic
 * computer is off.
 */
const KEY = 'clinic.mode';

function stored() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

export function isLocalMode() {
  const override = new URLSearchParams(location.search).get('local');
  if (override === '1') return true;
  if (override === '0') return false;

  const choice = stored();
  if (choice === 'local') return true;
  if (choice === 'server') return false;

  // No server can have served a file:// page or the Android app's own assets.
  return location.protocol === 'file:'
    || location.hostname === 'appassets.androidplatform.net';
}

export function setMode(mode) {
  try { localStorage.setItem(KEY, mode); } catch { /* ignore */ }
}

export const describeMode = () => (isLocalMode()
  ? t('Running on this device')
  : t('Connected to {host}', { host: location.host }));
