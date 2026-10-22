/**
 * The device half of syncing: send what changed here, then take what changed
 * elsewhere. Runs inside a phone and in tests alike; the only thing it is
 * handed from outside is how to make an HTTP request.
 *
 * Push first, then pull. That order matters: pushing first means the server has
 * already judged this device's edits by the time their consequences come back,
 * so a device never applies a stale version of a row it just changed.
 */
import { q } from '../db.js';
import {
  collectOutbox, clearOutbox, applyChanges, syncState, saveSyncState, pendingCount,
  retireProvisionalAdmin, stampLocalNumbers,
} from './sync-core.js';

const BATCH = 200;

export async function registerDevice({ fetchImpl = fetch, serverUrl, name, pairingCode }) {
  const base = String(serverUrl).replace(/\/+$/, '');

  let res;
  try {
    res = await fetchImpl(`${base}/api/sync/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Clinic-Request': '1' },
      body: JSON.stringify({ name, pairing_code: pairingCode }),
    });
  } catch {
    // fetch only ever says "failed", so say something a person can act on.
    throw new Error(
      `Could not reach ${base}. Check the clinic computer is switched on, that `
      + 'this phone is on the same Wi-Fi, and that the address is the one shown '
      + 'by "npm run address".',
    );
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Could not enrol this device (${res.status})`);

  saveSyncState({
    server_url: base,
    device_id: body.device_id,
    device_code: body.device_code,
    device_token: body.device_token,
  });

  // Before a single change is exchanged, make sure this device's own setup
  // sign-in cannot be mistaken for the clinic's administrator, and move the
  // numbers it invented while alone out of the clinic's way. Both are cheap
  // here and impossible to undo cleanly afterwards.
  const retired = retireProvisionalAdmin();
  const renumbered = stampLocalNumbers();
  return { ...body, retired_setup_account: retired, renumbered };
}

/**
 * One full exchange. Returns what moved, so the screen can say something
 * truthful rather than just "done".
 */
export async function runSync({ fetchImpl = fetch, onProgress = () => {} } = {}) {
  const state = syncState();
  if (!state?.server_url || !state.device_token) {
    throw new Error('This device is not connected to a clinic server yet.');
  }

  const post = async (path, payload) => {
    let res;
    try {
      res = await fetchImpl(`${state.server_url}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Clinic-Request': '1' },
        body: JSON.stringify({ ...payload, device_token: state.device_token }),
      });
    } catch {
      throw new Error(
        `Could not reach ${state.server_url}. The clinic computer may be off, or `
        + 'this phone may be on a different network.',
      );
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Sync failed (${res.status})`);
    return body;
  };

  const summary = { sent: 0, received: 0, deleted: 0, superseded: 0, conflicts: [] };

  try {
    // ---- send ----------------------------------------------------------
    for (;;) {
      const outgoing = collectOutbox(BATCH);
      if (!outgoing.length) break;
      onProgress({ phase: 'sending', count: outgoing.length });

      const result = await post('/api/sync/push', {
        changes: outgoing.map(({ outbox_id: _ignored, ...change }) => change),
      });

      summary.sent += result.accepted;
      summary.superseded += result.superseded;
      summary.conflicts.push(...(result.conflicts || []));

      // Clear everything sent: a superseded change is decided, not pending, and
      // keeping it would push the same losing edit forever.
      clearOutbox(outgoing);
      // No early exit on a short batch: the collector stops on a byte budget
      // too, so a short batch usually means one big x-ray, not an empty queue.
    }

    // ---- receive -------------------------------------------------------
    let since = syncState().last_seq;
    // A row can arrive before the row it points at, because the ledger is
    // ordered by when things were last touched. Those are carried into the next
    // batch rather than given up on.
    let carried = [];

    for (;;) {
      const result = await post('/api/sync/pull', { since, limit: BATCH });
      // Whatever the clinic is licensed for, this device is licensed for.
      if (result.licence !== undefined) adoptLicence(result.licence);
      if (!result.changes.length) { since = result.next_seq; break; }

      onProgress({ phase: 'receiving', count: result.changes.length });
      const usable = result.changes.filter((change) => !supersededLocally(change));
      const applied = applyChanges([...carried, ...usable], { reportDeferred: false });

      summary.received += applied.applied;
      summary.deleted += applied.deleted;
      summary.conflicts.push(...applied.conflicts.map((c) => ({
        table_name: c.table_name, row_uuid: c.row_uuid, reason: c.reason,
      })));
      carried = applied.deferred;

      since = result.next_seq;
      saveSyncState({ last_seq: since });
      if (!result.has_more) break;
    }

    // Anything still waiting on a row that never came is a real problem now.
    if (carried.length) {
      const last = applyChanges(carried, { reportDeferred: true });
      summary.received += last.applied;
      summary.deleted += last.deleted;
      summary.conflicts.push(...last.conflicts.map((c) => ({
        table_name: c.table_name, row_uuid: c.row_uuid, reason: c.reason,
      })));
    }

    saveSyncState({
      last_seq: since,
      last_synced_at: new Date().toISOString(),
      last_error: null,
    });
  } catch (err) {
    saveSyncState({ last_error: err.message });
    throw err;
  }

  return { ...summary, pending: pendingCount() };
}

/**
 * True when this device has an unsent edit to the same row that is newer than
 * the one arriving. Ours has not been judged yet, so it must not be trampled
 * before it gets its turn.
 */
function supersededLocally(change) {
  const mine = q.get(
    `SELECT MAX(changed_at) AS changed_at FROM sync_outbox
      WHERE table_name = ? AND row_uuid = ?`,
    change.table_name, change.row_uuid);
  return Boolean(mine?.changed_at) && mine.changed_at > change.changed_at;
}

export function syncSummary() {
  const state = syncState();
  return {
    connected: Boolean(state?.server_url && state.device_token),
    server_url: state?.server_url || '',
    device_code: state?.device_code || '',
    last_synced_at: state?.last_synced_at || null,
    last_error: state?.last_error || null,
    pending: pendingCount(),
    issues: q.get(
      "SELECT COUNT(*) AS n FROM sync_issues WHERE resolved = 0 AND kind = 'blocked'").n,
    renumbered: q.get(
      "SELECT COUNT(*) AS n FROM sync_issues WHERE resolved = 0 AND kind = 'renumbered'").n,
    incomplete: q.get(
      "SELECT COUNT(*) AS n FROM sync_issues WHERE resolved = 0 AND kind = 'incomplete'").n,
  };
}

/**
 * Takes on the clinic's licence key.
 *
 * Kept deliberately blunt: the server's answer replaces whatever this device
 * held, so a clinic that lets its subscription lapse sees every device follow,
 * and one that renews sees them all follow back with nothing to re-enter.
 */
function adoptLicence(key) {
  try {
    const current = q.get('SELECT key FROM licence WHERE id = 1')?.key || '';
    if (current === key) return;
    q.run('UPDATE licence SET key = ?, activated_at = ? WHERE id = 1',
      key, new Date().toISOString());
  } catch {
    // Older database, before licensing. Nothing to carry.
  }
}
