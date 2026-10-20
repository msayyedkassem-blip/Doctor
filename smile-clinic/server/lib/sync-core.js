/**
 * Turning rows into something another device can understand, and back.
 *
 * Two devices agree on nothing except uuids: their row ids, and therefore every
 * foreign key, are private to each database. A row therefore travels with its
 * own uuid and with each of its references expressed as the uuid of the row it
 * points at. Applying a change translates those back into whatever the local
 * ids happen to be.
 *
 * Runs unchanged on a server and inside a phone.
 */
import { q, getDb, tx } from '../db.js';
import {
  SYNC_TABLES, fksFor, isSyncable, LOCAL_ONLY, UNIQUE_COLUMNS, MERGE_ON,
} from './sync-schema.js';

const columnCache = new Map();

function columnsOf(table) {
  if (!columnCache.has(table)) {
    columnCache.set(table, q.all(`PRAGMA table_info(${table})`).map((c) => c.name));
  }
  return columnCache.get(table);
}

/** Runs `fn` with change-recording turned off, so applying is not mistaken for editing. */
export function whileApplying(fn) {
  const conn = getDb();
  conn.exec('UPDATE sync_control SET applying = 1 WHERE id = 1');
  try {
    return fn();
  } finally {
    conn.exec('UPDATE sync_control SET applying = 0 WHERE id = 1');
  }
}

/** A row as it should travel: no local id, references carried as uuids. */
export function serializeRow(table, row) {
  const fks = fksFor(table);
  const payload = {};
  for (const [column, value] of Object.entries(row)) {
    if (LOCAL_ONLY.includes(column)) continue;
    if (column in fks) continue; // sent as a uuid below
    payload[column] = value;
  }
  for (const [column, parent] of Object.entries(fks)) {
    const localId = row[column];
    payload[`${column}__uuid`] = localId
      ? (q.get(`SELECT uuid FROM ${parent} WHERE id = ?`, localId)?.uuid ?? null)
      : null;
  }
  return payload;
}

/**
 * Applies one incoming change. Returns what happened, so a caller can retry a
 * change that arrived before the row it points at.
 */
export function applyChange(change, options = {}) {
  const { table_name: table, op, payload } = change;
  if (!isSyncable(table)) return { status: 'skipped', reason: 'unknown table' };

  const uuid = canonicalUuid(table, change.row_uuid);
  const existing = q.get(`SELECT id FROM ${table} WHERE uuid = ?`, uuid);

  if (op === 'delete') {
    if (existing) q.run(`DELETE FROM ${table} WHERE uuid = ?`, uuid);
    return { status: 'applied' };
  }

  const data = { ...(payload || {}) };
  const fks = fksFor(table);

  // Translate every reference into this database's own ids.
  for (const [column, parent] of Object.entries(fks)) {
    const parentUuid = data[`${column}__uuid`];
    delete data[`${column}__uuid`];
    if (!parentUuid) { data[column] = null; continue; }
    const parentRow = q.get(
      `SELECT id FROM ${parent} WHERE uuid = ?`, canonicalUuid(parent, parentUuid));
    if (!parentRow) {
      // The row it points at has not arrived yet; the caller retries later.
      return { status: 'deferred', reason: `waiting for ${parent} ${parentUuid.slice(0, 8)}` };
    }
    data[column] = parentRow.id;
  }

  // Ignore anything this database does not have a column for, so an older
  // device is not broken by a newer one's extra fields.
  const known = new Set(columnsOf(table));
  for (const column of Object.keys(data)) {
    if (!known.has(column) || LOCAL_ONLY.includes(column)) delete data[column];
  }
  // Two devices naming the same thing is not a clash: one staff email means
  // one person, however many devices invented a row for them. Merging settles
  // which identity survives, and the change is applied to that row.
  const identity = adoptIdentity(table, data, uuid) || uuid;
  data.uuid = identity;

  const clash = findUniqueClash(table, data, identity);
  if (clash) {
    const moved = settleClash(table, data, identity, clash, change, options);
    if (!moved) return { status: 'conflict', reason: clashMessage(clash) };
    options.renumbered?.push(moved);
  }

  // Ask again under the surviving identity: a merge may have just decided the
  // row already here is the one to update.
  const present = q.get(`SELECT id FROM ${table} WHERE uuid = ?`, identity);

  const columns = Object.keys(data);
  if (present) {
    q.run(
      `UPDATE ${table} SET ${columns.map((c) => `${c} = ?`).join(', ')} WHERE uuid = ?`,
      ...columns.map((c) => data[c]), identity,
    );
  } else {
    q.run(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      ...columns.map((c) => data[c]),
    );
  }
  return { status: 'applied' };
}

/**
 * Decides which of two records keeps a number they both claim, and moves the
 * other to a free one.
 *
 * The clinic server owns the shared numbering, so there the arriving record
 * gives way; on a device the record already in the shared ledger is the one
 * everybody else can already see, so the local record gives way. Since a device
 * sends before it receives, only one side of any pair ever has to move, and the
 * correction travels back as an ordinary edit.
 *
 * Returns what moved, or null if no free number could be found at all.
 */
function settleClash(table, data, identity, clash, change, options) {
  const { column, value, otherUuid } = clash;
  const now = new Date().toISOString();
  const ours = () => syncState()?.device_code || 'X';

  if (options.preferLocal) {
    // The number belongs to whoever sent it, so it reads like the rest of that
    // device's numbering rather than like this one's.
    const theirs = options.letter || options.letterFor?.(change) || ours();
    const to = freeNumber(table, column, value, theirs);
    if (!to) return null;
    data[column] = to;
    if (columnsOf(table).includes('updated_at')) data.updated_at = now;
    return { table, uuid: identity, column, from: value, to, side: 'arriving' };
  }

  const to = freeNumber(table, column, value, ours());
  if (!to) return null;
  const stamp = columnsOf(table).includes('updated_at') ? ', updated_at = ?' : '';
  q.run(
    `UPDATE ${table} SET ${column} = ?${stamp} WHERE uuid = ?`,
    ...(stamp ? [to, now, otherUuid] : [to, otherUuid]),
  );
  return { table, uuid: otherUuid, column, from: value, to, side: 'local' };
}

/**
 * Where a column names the thing itself — a staff email, a procedure code — a
 * local row holding that value is the same record under another identity, not a
 * rival. Taking on the incoming identity merges the two, and every local
 * reference keeps pointing at the same row.
 */
function adoptIdentity(table, data, uuid) {
  let identity = null;
  for (const column of MERGE_ON[table] || []) {
    if (data[column] === undefined || data[column] === null) continue;
    const twin = q.get(
      `SELECT uuid FROM ${table} WHERE ${column} = ? AND uuid != ?`, data[column], uuid);
    if (!twin) continue;
    if (q.get(`SELECT 1 AS x FROM ${table} WHERE uuid = ?`, uuid)) continue;

    // Every device must pick the same winner or they would rename the row back
    // and forth forever, so the choice is made by the identities themselves.
    const canonical = uuid < twin.uuid ? uuid : twin.uuid;
    const retired = canonical === uuid ? twin.uuid : uuid;

    if (twin.uuid !== canonical) {
      q.run(`UPDATE ${table} SET uuid = ? WHERE uuid = ?`, canonical, twin.uuid);
    }
    rememberAlias(table, retired, canonical);
    identity = canonical;
  }
  return identity;
}

function rememberAlias(table, alias, canonical) {
  if (alias === canonical) return;
  q.run(
    `INSERT INTO sync_aliases (table_name, alias_uuid, canonical_uuid)
     VALUES (?, ?, ?)
     ON CONFLICT(table_name, alias_uuid) DO UPDATE SET canonical_uuid = excluded.canonical_uuid`,
    table, alias, canonical,
  );
}

/**
 * The identity a row ended up with. A change recorded before two records were
 * merged still names the identity that lost, and must still find its row.
 */
export function canonicalUuid(table, uuid) {
  if (!uuid) return uuid;
  const alias = q.get(
    'SELECT canonical_uuid FROM sync_aliases WHERE table_name = ? AND alias_uuid = ?',
    table, uuid);
  return alias ? alias.canonical_uuid : uuid;
}

/**
 * Detects a value that must be unique clinic-wide already belonging to a
 * different row — two devices having invented the same patient file number,
 * say. Unlike a merge this is not two names for one thing: they really are two
 * different people who were each handed P-0001 while nobody could see the
 * other. One of them has to move.
 */
function findUniqueClash(table, data, uuid) {
  for (const column of UNIQUE_COLUMNS[table] || []) {
    if (data[column] === undefined || data[column] === null) continue;
    const other = q.get(
      `SELECT uuid FROM ${table} WHERE ${column} = ? AND uuid != ?`, data[column], uuid,
    );
    if (other) return { column, value: data[column], otherUuid: other.uuid };
  }
  return null;
}

const clashMessage = (clash) =>
  `${clash.column} "${clash.value}" is already used by another record`;

/**
 * Takes a generated number apart: "INV-2026-B-0007" is the seventh invoice of
 * 2026 issued by device B. The device letter is what keeps two devices from
 * both reaching the same number, so it is the piece that matters here.
 *
 * Returns null for anything hand-typed, which is left exactly as it is.
 */
function splitNumber(value) {
  const match = /^(.*-)(\d+)$/.exec(String(value));
  if (!match) return null;
  // A trailing "B-" is a device letter; "2026-" is not, and neither is the
  // lone "P-" of a number made before this device had a letter at all.
  const withoutLetter = match[1].replace(/[A-Z]+-$/, '');
  const hasLetter = withoutLetter !== match[1] && withoutLetter.endsWith('-');
  return {
    stem: hasLetter ? withoutLetter : match[1],
    letter: hasLetter ? match[1].slice(withoutLetter.length, -1) : '',
    width: match[2].length,
  };
}

/**
 * A number in the same shape that nothing else is using, carrying `letter` so
 * it cannot collide with another device's run. Numbers keep the form the rest
 * of the app expects — P-B-0007, not P-0001-b — because that form is what the
 * next-number search reads back.
 */
function freeNumber(table, column, value, letter) {
  const taken = (candidate) =>
    q.get(`SELECT 1 AS x FROM ${table} WHERE ${column} = ?`, candidate);
  const parts = splitNumber(value);

  if (parts) {
    const stem = `${parts.stem}${letter}-`;
    // Carry on from this device's own run rather than reusing a number it has
    // already given out and later deleted.
    const last = q.get(
      `SELECT ${column} AS v FROM ${table} WHERE ${column} GLOB ?
        ORDER BY LENGTH(${column}) DESC, ${column} DESC LIMIT 1`, `${stem}[0-9]*`);
    let n = last ? Number(String(last.v).slice(stem.length)) : 0;
    if (!Number.isFinite(n)) n = 0;
    for (let i = 0; i < 10000; i += 1) {
      n += 1;
      const candidate = `${stem}${String(n).padStart(parts.width, '0')}`;
      if (!taken(candidate)) return candidate;
    }
  }

  // Hand-typed: keep what somebody wrote and add the least that frees it.
  for (let i = 1; i < 1000; i += 1) {
    const candidate = i === 1 ? `${value}-${letter}` : `${value}-${letter}${i}`;
    if (!taken(candidate)) return candidate;
  }
  return null;
}

/**
 * Moves this device's own records out of the way of a clinic it is about to
 * join for the first time.
 *
 * A phone used on its own numbers its patients P-0001, P-0002 — and so does the
 * clinic. Joining would put every one of those pairs in collision, and each
 * blocked patient takes their appointments, invoices and payments with them.
 * Stamping this device's letter on before a single record is exchanged means
 * the collision never happens.
 */
export function stampLocalNumbers() {
  const state = syncState();
  const letter = state?.device_code || '';
  // Only ever on the way in: after the first exchange these numbers are shared,
  // and renumbering them would be rewriting the clinic's records.
  if (!letter || (state.last_seq || 0) > 0) return [];

  const moved = [];
  for (const [table, columns] of Object.entries(UNIQUE_COLUMNS)) {
    for (const column of columns) {
      const rows = q.all(`SELECT uuid, ${column} AS v FROM ${table} WHERE ${column} IS NOT NULL`);
      for (const row of rows) {
        const parts = splitNumber(row.v);
        if (!parts || parts.letter) continue; // hand-typed, or already stamped
        const to = freeNumber(table, column, row.v, letter);
        if (!to || to === row.v) continue;
        q.run(`UPDATE ${table} SET ${column} = ? WHERE uuid = ?`, to, row.uuid);
        moved.push({ table, uuid: row.uuid, column, from: row.v, to });
      }
    }
  }
  return moved;
}

/**
 * Applies a batch, retrying anything that arrived out of order. Returns counts
 * and whatever could not be applied at all.
 */
export function applyChanges(changes, {
  reportDeferred = true, preferLocal = false, letter = '',
} = {}) {
  const result = { applied: 0, deleted: 0, conflicts: [], deferred: [], renumbered: [] };
  const options = {
    preferLocal,
    letter,
    renumbered: result.renumbered,
    // A record that has to move takes the letter of whichever device made it,
    // so its new number reads like every other number that device issues.
    letterFor: (change) => (change.origin_device
      ? q.get('SELECT code FROM sync_devices WHERE id = ?', change.origin_device)?.code
      : null) || '',
  };

  whileApplying(() => {
    let pending = [...changes];
    // Parents before children, so most references resolve on the first pass.
    const order = new Map(SYNC_TABLES.map((t, index) => [t.table, index]));
    pending.sort((a, b) => (order.get(a.table_name) ?? 99) - (order.get(b.table_name) ?? 99));

    for (let pass = 0; pass < 3 && pending.length; pass += 1) {
      const stillPending = [];
      for (const change of pending) {
        const outcome = applyChange(change, options);
        if (outcome.status === 'applied') {
          if (change.op === 'delete') result.deleted += 1;
          else result.applied += 1;
        } else if (outcome.status === 'deferred') {
          // Keep what it is waiting for, so an unresolved one can say so.
          stillPending.push({ ...change, waiting_for: outcome.reason });
        } else if (outcome.status === 'conflict') {
          result.conflicts.push({ ...change, reason: outcome.reason });
        }
      }
      if (stillPending.length === pending.length) break; // no progress; stop
      pending = stillPending;
    }
    result.deferred = pending;
  });

  // Touching the moved rows again with change-recording back on is what makes
  // the new number travel: whichever side gave way, the other devices learn
  // about it as an ordinary edit on the next exchange.
  announceRenumbered(result.renumbered);

  // A change can legitimately arrive before the row it points at: the ledger is
  // ordered by when things were last touched, not by what depends on what. Only
  // the caller knows whether more batches are still coming.
  recordIssues([
    ...result.conflicts,
    ...(reportDeferred
      ? result.deferred.map((c) => ({
        ...c,
        reason: c.waiting_for
          ? `never arrived: ${c.waiting_for.replace(/^waiting for /, '')}`
          : 'references a record that never arrived',
      }))
      : []),
  ]);
  recordIssues(result.renumbered.map((move) => ({
    table_name: move.table,
    row_uuid: move.uuid,
    kind: 'renumbered',
    reason: `${move.from} was already in use here, so this record is now ${move.to}`,
  })));

  if (result.applied || result.deleted) recomputeDerived();
  return result;
}

/** Re-saves each moved row so the correction is recorded and sent on. */
function announceRenumbered(moves) {
  const now = new Date().toISOString();
  for (const move of moves) {
    const stamp = columnsOf(move.table).includes('updated_at') ? ', updated_at = ?' : '';
    q.run(
      `UPDATE ${move.table} SET ${move.column} = ?${stamp} WHERE uuid = ?`,
      ...(stamp ? [move.to, now, move.uuid] : [move.to, move.uuid]),
    );
  }
}

function recordIssues(issues) {
  const now = new Date().toISOString();
  for (const issue of issues) {
    q.run(
      `INSERT INTO sync_issues (table_name, row_uuid, reason, detail, noticed_at, kind)
       VALUES (?, ?, ?, ?, ?, ?)`,
      issue.table_name, issue.row_uuid, issue.reason,
      JSON.stringify(issue.payload ?? null), now, issue.kind || 'blocked',
    );
  }
}

/**
 * Some values are conclusions, not facts: an invoice's status follows from its
 * payments. When payments arrive from two devices, the total is only right once
 * both are here, so it is recomputed rather than synced.
 */
export function recomputeDerived() {
  whileApplying(() => {
    const invoices = q.all(
      `SELECT i.id, i.total_cents, i.status,
              COALESCE((SELECT SUM(CASE WHEN direction = 'refund' THEN -amount_cents
                                        ELSE amount_cents END)
                          FROM payments WHERE invoice_id = i.id), 0) AS paid
         FROM invoices i WHERE i.status NOT IN ('void','draft')`);
    for (const invoice of invoices) {
      const status = invoice.paid <= 0 ? 'issued'
        : invoice.paid >= invoice.total_cents ? 'paid' : 'partial';
      if (status !== invoice.status) {
        q.run('UPDATE invoices SET status = ? WHERE id = ?', status, invoice.id);
      }
    }
  });
}

/**
 * The local changes waiting to go out, newest state per row. The outbox is an
 * append-only log, so a row edited five times is sent once.
 */
/**
 * How much one push may carry.
 *
 * Rows used to be small enough that a count was the only limit worth having.
 * An x-ray is not: two hundred of them in one request is tens of megabytes,
 * which a phone on clinic Wi-Fi will not finish. The batch therefore stops on
 * whichever limit comes first — but always carries at least one change, or a
 * single large row could never move at all.
 */
const BATCH_BYTES = 2_000_000;

export function collectOutbox(limit = 500) {
  const entries = q.all(
    `SELECT MAX(id) AS id, table_name, row_uuid,
            MAX(changed_at) AS changed_at
       FROM sync_outbox GROUP BY table_name, row_uuid
      ORDER BY id LIMIT ?`, limit);

  const changes = [];
  let bytes = 0;
  for (const entry of entries) {
    const row = q.get(`SELECT * FROM ${entry.table_name} WHERE uuid = ?`, entry.row_uuid);

    // Gone from the table means deleted, whatever the log last said.
    const op = row ? 'upsert' : 'delete';
    const payload = row ? serializeRow(entry.table_name, row) : null;
    const size = payload ? JSON.stringify(payload).length : 0;
    if (changes.length && bytes + size > BATCH_BYTES) break;
    bytes += size;

    changes.push({
      table_name: entry.table_name,
      row_uuid: entry.row_uuid,
      op,
      changed_at: entry.changed_at,
      payload,
      outbox_id: entry.id,
    });
  }
  return changes;
}

/** Forgets outbox entries that have been accepted, leaving anything newer. */
export function clearOutbox(changes) {
  tx(() => {
    for (const change of changes) {
      q.run(
        `DELETE FROM sync_outbox
          WHERE table_name = ? AND row_uuid = ? AND id <= ?`,
        change.table_name, change.row_uuid, change.outbox_id,
      );
    }
  });
}

export function syncState() {
  return q.get('SELECT * FROM sync_state WHERE id = 1');
}

export function saveSyncState(values) {
  const columns = Object.keys(values);
  if (!columns.length) return;
  q.run(
    `UPDATE sync_state SET ${columns.map((c) => `${c} = ?`).join(', ')} WHERE id = 1`,
    ...columns.map((c) => values[c]),
  );
}

export function pendingCount() {
  return q.get(
    'SELECT COUNT(*) AS n FROM (SELECT 1 FROM sync_outbox GROUP BY table_name, row_uuid)',
  ).n;
}

/**
 * This device's short code, blank on the first one. Generated numbers carry it
 * so two devices cannot invent the same patient file or invoice number.
 */
export function deviceCode() {
  try {
    return q.get('SELECT device_code FROM sync_state WHERE id = 1')?.device_code || '';
  } catch {
    // Before the sync migration has run there is no such table.
    return '';
  }
}

/**
 * Stands down the sign-in a standalone device invented for itself.
 *
 * That account exists only so the app is usable before it has met a clinic. It
 * shares the obvious email, so left alone it would be merged with the clinic's
 * real administrator — and since merging takes the later edit, a phone joining
 * a clinic would silently overwrite the real administrator's password with
 * "changeme". It is renamed out of the way and never sent.
 */
export function retireProvisionalAdmin() {
  const state = syncState();
  const uuid = state?.provisional_user_uuid;
  if (!uuid) return false;

  const user = q.get('SELECT id, email FROM users WHERE uuid = ?', uuid);
  if (!user) {
    saveSyncState({ provisional_user_uuid: '' });
    return false;
  }

  const code = state.device_code || 'local';
  whileApplying(() => {
    q.run(
      `UPDATE users SET email = ?, name = ?, active = 0, updated_at = ? WHERE id = ?`,
      `setup-${code}@device.local`, 'Setup account (this device)',
      new Date().toISOString(), user.id,
    );
  });
  // Never send it: the clinic has no use for another device's setup account.
  q.run('DELETE FROM sync_outbox WHERE table_name = ? AND row_uuid = ?', 'users', uuid);
  saveSyncState({ provisional_user_uuid: '' });
  return true;
}
