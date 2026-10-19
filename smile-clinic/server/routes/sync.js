/**
 * The shared ledger every device syncs against.
 *
 * The server is not special beyond owning the sequence: it holds a full
 * database like every other device and its own edits enter the ledger through
 * the same outbox. What it alone does is assign `server_seq`, which is how
 * devices page through changes without any agreement about clocks.
 */
import { q, insert, tx } from '../db.js';
import { json } from '../lib/http.js';
import { requireAuth, requirePermission } from '../lib/auth.js';
import { randomToken, sha256Hex } from '../lib/crypto.js';
import { str, int } from '../lib/validate.js';
import { badRequest, unauthorized, forbidden } from '../lib/errors.js';
import { logAction } from '../lib/audit.js';
import {
  collectOutbox, clearOutbox, applyChanges, serializeRow,
} from '../lib/sync-core.js';
import { isSyncable } from '../lib/sync-schema.js';
import { licenceState, storedKey } from '../lib/licence-state.js';

const MAX_BATCH = 500;
const PAIRING_MINUTES = 15;

export default function register(router) {
  /**
   * Starts pairing. An administrator asks for a code here and reads it out to
   * whoever is holding the phone.
   */
  router.post('/api/sync/pair', async (ctx) => {
    requirePermission(ctx.user, 'sync:manage');

    // A licence says how many devices a clinic may run. Counted here, at the
    // one moment a new one is added, rather than by cutting off a device that
    // is already in use — a phone that stops syncing mid-appointment is worse
    // for the clinic than for us.
    const licence = await licenceState();
    const joined = q.get(
      'SELECT COUNT(*) AS n FROM sync_devices WHERE revoked = 0 AND paired = 1').n;
    // The clinic computer itself is one of them.
    if (joined + 1 >= licence.devices) {
      throw badRequest(`This licence covers ${licence.devices} device`
        + `${licence.devices === 1 ? '' : 's'}, including this computer, and they are `
        + 'all in use. Remove a device you no longer need, or ask for a licence '
        + 'covering more.');
    }

    const now = new Date();
    const expires = new Date(now.getTime() + PAIRING_MINUTES * 60000);
    const code = pairingCode();
    const id = `dev_${randomToken().slice(0, 16)}`;

    // Clear out codes nobody used, so the list does not fill with dead entries.
    q.run("DELETE FROM sync_devices WHERE paired = 0 AND pairing_expires_at < ?",
      now.toISOString());

    insert('sync_devices', {
      id,
      name: str(ctx.body, 'name', { max: 80 }) || 'New device',
      code: nextDeviceCode(),
      token_hash: '',
      paired: 0,
      pairing_code: code,
      pairing_expires_at: expires.toISOString(),
      created_at: now.toISOString(),
    });

    logAction(ctx.user, 'pair', 'sync_device', id);
    json(ctx.res, 201, {
      pairing_code: code,
      expires_at: expires.toISOString(),
      expires_in_minutes: PAIRING_MINUTES,
    });
  });

  /**
   * A device enrols itself with the code it was given. Deliberately needs no
   * session: the phone is a different origin, so no cookie of the clinic's ever
   * reaches it. The code is the proof, and it is single-use and short-lived.
   */
  router.post('/api/sync/register', async (ctx) => {
    const code = str(ctx.body, 'pairing_code', { max: 20 });
    if (!code) throw badRequest('Enter the pairing code shown on the clinic computer');

    const device = q.get(
      'SELECT * FROM sync_devices WHERE pairing_code = ? AND paired = 0',
      code.replace(/\s+/g, '').toUpperCase());
    if (!device) throw unauthorized('That pairing code is not valid');
    if (new Date(device.pairing_expires_at) < new Date()) {
      throw unauthorized('That pairing code has expired — ask for a new one');
    }

    const token = randomToken();
    const now = new Date().toISOString();
    q.run(
      `UPDATE sync_devices
          SET name = ?, token_hash = ?, paired = 1, pairing_code = NULL,
              pairing_expires_at = NULL, last_seen_at = ?
        WHERE id = ?`,
      str(ctx.body, 'name', { max: 80 }) || device.name,
      await sha256Hex(token), now, device.id,
    );

    logAction(null, 'register', 'sync_device', device.id);
    json(ctx.res, 201, {
      device_id: device.id,
      device_code: device.code,
      device_token: token,
      server_seq: currentSeq(),
    });
  }, { public: true, cors: true });

  router.get('/api/sync/devices', async (ctx) => {
    requirePermission(ctx.user, 'sync:manage');
    json(ctx.res, 200, {
      devices: q.all(
        `SELECT id, name, code, created_at, last_seen_at, revoked, paired,
                pairing_code, pairing_expires_at
           FROM sync_devices WHERE paired = 1 OR pairing_expires_at > ?
          ORDER BY created_at`, new Date().toISOString()),
      server_seq: currentSeq(),
      pending: q.get('SELECT COUNT(*) AS n FROM sync_outbox').n,
    });
  });

  router.delete('/api/sync/devices/:id', async (ctx) => {
    requirePermission(ctx.user, 'sync:manage');
    const device = q.get('SELECT * FROM sync_devices WHERE id = ?', ctx.params.id);
    if (!device) throw badRequest('No such device');
    q.run('UPDATE sync_devices SET revoked = 1 WHERE id = ?', device.id);
    logAction(ctx.user, 'revoke', 'sync_device', device.id);
    json(ctx.res, 200, { ok: true });
  });

  /**
   * Everything that happened after the caller's watermark. Its own changes come
   * back too, harmlessly: applying a change it already has is a no-op.
   */
  router.post('/api/sync/pull', async (ctx) => {
    const device = await authenticateDevice(ctx);
    flushServerOutbox();

    const since = int(ctx.body, 'since', { fallback: 0, min: 0 });
    const limit = Math.min(int(ctx.body, 'limit', { fallback: 200, min: 1 }), MAX_BATCH);

    const rows = q.all(
      `SELECT server_seq, table_name, row_uuid, op, changed_at, device_id, payload
         FROM sync_changes WHERE server_seq > ? ORDER BY server_seq LIMIT ?`,
      since, limit + 1,
    );
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    touchDevice(device.id);
    json(ctx.res, 200, {
      changes: page.map((row) => ({
        server_seq: row.server_seq,
        table_name: row.table_name,
        row_uuid: row.row_uuid,
        op: row.op,
        changed_at: row.changed_at,
        origin_device: row.device_id,
        payload: row.payload ? JSON.parse(row.payload) : null,
      })),
      next_seq: page.length ? page.at(-1).server_seq : since,
      has_more: hasMore,
      server_seq: currentSeq(),
      // The clinic's licence travels with its records. A phone that has joined
      // is covered by what the clinic bought, with nothing for its owner to
      // type in — and if the clinic stops paying, the phone finds out at the
      // next sync rather than staying licensed forever.
      licence: storedKey(),
    });
  }, { public: true, cors: true });

  /**
   * Accepts a device's changes. Where the same row changed in two places the
   * later edit wins, decided by when each was made and, if that ties, by device
   * id so every device reaches the same answer.
   */
  router.post('/api/sync/push', async (ctx) => {
    const device = await authenticateDevice(ctx);
    flushServerOutbox();

    const incoming = Array.isArray(ctx.body.changes) ? ctx.body.changes : [];
    if (incoming.length > MAX_BATCH) throw badRequest('Too many changes in one push');

    const accepted = [];
    const superseded = [];

    for (const change of incoming) {
      if (!isSyncable(change.table_name)) continue;
      if (!change.row_uuid || !change.changed_at) continue;

      const known = q.get(
        `SELECT changed_at, device_id FROM sync_changes
          WHERE table_name = ? AND row_uuid = ?
          ORDER BY server_seq DESC LIMIT 1`,
        change.table_name, change.row_uuid);

      if (known && !wins(change.changed_at, device.id, known.changed_at, known.device_id)) {
        superseded.push({ table_name: change.table_name, row_uuid: change.row_uuid });
        continue;
      }
      accepted.push({ ...change, device_id: device.id });
    }

    // The server owns the shared numbering, so a record arriving with a file or
    // invoice number the clinic has already given to somebody else is the one
    // that moves — and the ledger must carry the number it actually got, or the
    // next device to pull would collide with the clinic's record all over again.
    const outcome = applyChanges(accepted, { preferLocal: true, letter: device.code });
    for (const move of outcome.renumbered) {
      if (move.side !== 'arriving') continue;
      const change = accepted.find((c) => c.table_name === move.table
        && (c.row_uuid === move.uuid || c.payload?.uuid === move.uuid));
      if (change?.payload) change.payload[move.column] = move.to;
    }

    // Only what actually landed enters the ledger, so a device that pulls next
    // never learns about a change the server itself refused.
    const rejected = new Set([
      ...outcome.conflicts.map(keyOf),
      ...outcome.deferred.map(keyOf),
    ]);
    const landed = accepted.filter((c) => !rejected.has(keyOf(c)));

    tx(() => {
      for (const change of landed) {
        insert('sync_changes', {
          table_name: change.table_name,
          row_uuid: change.row_uuid,
          op: change.op,
          changed_at: change.changed_at,
          device_id: device.id,
          payload: change.payload ? JSON.stringify(change.payload) : null,
        });
      }
    });

    touchDevice(device.id);
    json(ctx.res, 200, {
      accepted: landed.length,
      superseded: superseded.length,
      conflicts: outcome.conflicts.map((c) => ({
        table_name: c.table_name, row_uuid: c.row_uuid, reason: c.reason,
      })),
      deferred: outcome.deferred.map((c) => ({
        table_name: c.table_name, row_uuid: c.row_uuid,
      })),
      server_seq: currentSeq(),
    });
  }, { public: true, cors: true });
}

/** Short, read-aloud friendly: no look-alike characters. */
function pairingCode() {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

const keyOf = (change) => `${change.table_name}/${change.row_uuid}`;

/**
 * Later wins. A tie is broken by device id rather than left to chance, so two
 * devices handed the same pair of edits always agree on the outcome.
 */
export function wins(changedAt, deviceId, otherChangedAt, otherDeviceId) {
  if (changedAt !== otherChangedAt) return changedAt > otherChangedAt;
  return String(deviceId) > String(otherDeviceId);
}

/**
 * Moves the server's own edits into the ledger, so devices can see them.
 *
 * Drains completely rather than a batch at a time: a device asking what it has
 * missed must be told about everything, not about the first five hundred things
 * and then be left to ask again.
 */
export function flushServerOutbox() {
  let moved = 0;
  for (let guard = 0; guard < 1000; guard += 1) {
    const pending = collectOutbox(MAX_BATCH);
    if (!pending.length) break;

    tx(() => {
      for (const change of pending) {
        insert('sync_changes', {
          table_name: change.table_name,
          row_uuid: change.row_uuid,
          op: change.op,
          changed_at: change.changed_at,
          device_id: '',
          payload: change.payload ? JSON.stringify(change.payload) : null,
        });
      }
    });
    clearOutbox(pending);
    moved += pending.length;
  }
  return moved;
}

function currentSeq() {
  return q.get('SELECT COALESCE(MAX(server_seq), 0) AS n FROM sync_changes').n;
}

async function authenticateDevice(ctx) {
  const token = str(ctx.body, 'device_token', { max: 200 })
    || (ctx.req.headers?.['x-device-token'] ?? null);
  if (!token) throw unauthorized('This device is not enrolled for syncing');

  const device = q.get(
    'SELECT * FROM sync_devices WHERE token_hash = ?', await sha256Hex(token));
  if (!device) throw unauthorized('This device is not enrolled for syncing');
  if (device.revoked) throw forbidden('This device has been removed from the clinic');
  return device;
}

function touchDevice(id) {
  q.run('UPDATE sync_devices SET last_seen_at = ? WHERE id = ?', new Date().toISOString(), id);
}

/**
 * A short code per device, used to keep generated numbers apart: two phones
 * both inventing patient P-0007 is the one clash merging cannot undo.
 */
function nextDeviceCode() {
  const used = new Set(q.all('SELECT code FROM sync_devices').map((r) => r.code));
  for (const letter of 'BCDEFGHJKLMNPQRSTUVWXYZ') {
    if (!used.has(letter)) return letter;
  }
  let n = 2;
  while (used.has(`D${n}`)) n += 1;
  return `D${n}`;
}
