-- Sync: give every row a global identity and record what changes here.
--
-- Local row ids differ on each device, so rows are identified by a uuid that
-- SQLite generates itself on insert — including for raw SQL, which a trigger
-- or application code could miss.

-- One row, flipped while remote changes are being applied, so that applying
-- them does not look like local edits and echo straight back.
CREATE TABLE sync_control (
  id       INTEGER PRIMARY KEY CHECK (id = 1),
  applying INTEGER NOT NULL DEFAULT 0
);
INSERT INTO sync_control (id, applying) VALUES (1, 0);

-- Local changes waiting to be sent. Append-only; trimmed once accepted.
CREATE TABLE sync_outbox (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  row_uuid   TEXT NOT NULL,
  op         TEXT NOT NULL CHECK (op IN ('upsert','delete')),
  changed_at TEXT NOT NULL
);
CREATE INDEX idx_outbox_row ON sync_outbox(table_name, row_uuid);

-- What this device knows about the shared server.
CREATE TABLE sync_state (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  server_url     TEXT NOT NULL DEFAULT '',
  device_id      TEXT NOT NULL DEFAULT '',
  device_code    TEXT NOT NULL DEFAULT '',
  device_token   TEXT NOT NULL DEFAULT '',
  last_seq       INTEGER NOT NULL DEFAULT 0,
  last_synced_at TEXT,
  last_error     TEXT,
  -- The sign-in a standalone device invents for itself before it has any real
  -- staff. It must never be mistaken for a clinic account when joining one.
  provisional_user_uuid TEXT NOT NULL DEFAULT ''
);
INSERT INTO sync_state (id) VALUES (1);

-- When two devices independently created a row for the same thing, one identity
-- wins and the other is remembered here. Changes recorded before the merge
-- still name the old identity, and without this they would point at nothing.
CREATE TABLE sync_aliases (
  table_name     TEXT NOT NULL,
  alias_uuid     TEXT NOT NULL,
  canonical_uuid TEXT NOT NULL,
  PRIMARY KEY (table_name, alias_uuid)
);

-- Rows that could not be merged, kept for a human to look at.
CREATE TABLE sync_issues (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  row_uuid   TEXT NOT NULL,
  reason     TEXT NOT NULL,
  detail     TEXT,
  noticed_at TEXT NOT NULL,
  resolved   INTEGER NOT NULL DEFAULT 0
);

-- The shared ledger. Only the server writes server_seq; it is what devices
-- page through, and being server-assigned it needs no agreement on clocks.
CREATE TABLE sync_changes (
  server_seq INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  row_uuid   TEXT NOT NULL,
  op         TEXT NOT NULL CHECK (op IN ('upsert','delete')),
  changed_at TEXT NOT NULL,
  device_id  TEXT NOT NULL DEFAULT '',
  payload    TEXT
);
CREATE INDEX idx_changes_row ON sync_changes(table_name, row_uuid);

-- Devices allowed to sync, each with a short code that keeps the numbers
-- they generate from colliding with another device’s.
CREATE TABLE sync_devices (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  code         TEXT NOT NULL UNIQUE,
  token_hash   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT,
  revoked      INTEGER NOT NULL DEFAULT 0
);

-- ---- users -------------------------------------------------------
ALTER TABLE users ADD COLUMN uuid TEXT;
UPDATE users SET uuid = lower(hex(randomblob(16))) WHERE uuid IS NULL;
CREATE UNIQUE INDEX idx_users_uuid ON users(uuid);
ALTER TABLE users ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER users_uuid AFTER INSERT ON users
WHEN NEW.uuid IS NULL
BEGIN
  UPDATE users SET uuid = lower(hex(randomblob(16))) WHERE id = NEW.id;
END;

CREATE TRIGGER users_sync_insert AFTER INSERT ON users
WHEN NEW.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('users', NEW.uuid, 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER users_sync_update AFTER UPDATE ON users
WHEN NEW.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('users', NEW.uuid, 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER users_sync_delete AFTER DELETE ON users
WHEN OLD.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('users', OLD.uuid, 'delete', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

-- ---- patients ----------------------------------------------------
ALTER TABLE patients ADD COLUMN uuid TEXT;
UPDATE patients SET uuid = lower(hex(randomblob(16))) WHERE uuid IS NULL;
CREATE UNIQUE INDEX idx_patients_uuid ON patients(uuid);
ALTER TABLE patients ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER patients_uuid AFTER INSERT ON patients
WHEN NEW.uuid IS NULL
BEGIN
  UPDATE patients SET uuid = lower(hex(randomblob(16))) WHERE id = NEW.id;
END;

CREATE TRIGGER patients_sync_insert AFTER INSERT ON patients
WHEN NEW.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('patients', NEW.uuid, 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER patients_sync_update AFTER UPDATE ON patients
WHEN NEW.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('patients', NEW.uuid, 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER patients_sync_delete AFTER DELETE ON patients
WHEN OLD.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('patients', OLD.uuid, 'delete', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

-- ---- procedures --------------------------------------------------
ALTER TABLE procedures ADD COLUMN uuid TEXT;
UPDATE procedures SET uuid = lower(hex(randomblob(16))) WHERE uuid IS NULL;
CREATE UNIQUE INDEX idx_procedures_uuid ON procedures(uuid);
ALTER TABLE procedures ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER procedures_uuid AFTER INSERT ON procedures
WHEN NEW.uuid IS NULL
BEGIN
  UPDATE procedures SET uuid = lower(hex(randomblob(16))) WHERE id = NEW.id;
END;

CREATE TRIGGER procedures_sync_insert AFTER INSERT ON procedures
WHEN NEW.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('procedures', NEW.uuid, 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER procedures_sync_update AFTER UPDATE ON procedures
WHEN NEW.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('procedures', NEW.uuid, 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER procedures_sync_delete AFTER DELETE ON procedures
WHEN OLD.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('procedures', OLD.uuid, 'delete', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

-- ---- appointments ------------------------------------------------
ALTER TABLE appointments ADD COLUMN uuid TEXT;
UPDATE appointments SET uuid = lower(hex(randomblob(16))) WHERE uuid IS NULL;
CREATE UNIQUE INDEX idx_appointments_uuid ON appointments(uuid);
ALTER TABLE appointments ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER appointments_uuid AFTER INSERT ON appointments
WHEN NEW.uuid IS NULL
BEGIN
  UPDATE appointments SET uuid = lower(hex(randomblob(16))) WHERE id = NEW.id;
END;

CREATE TRIGGER appointments_sync_insert AFTER INSERT ON appointments
WHEN NEW.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('appointments', NEW.uuid, 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER appointments_sync_update AFTER UPDATE ON appointments
WHEN NEW.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('appointments', NEW.uuid, 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER appointments_sync_delete AFTER DELETE ON appointments
WHEN OLD.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('appointments', OLD.uuid, 'delete', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

-- ---- tooth_chart -------------------------------------------------
ALTER TABLE tooth_chart ADD COLUMN uuid TEXT;
UPDATE tooth_chart SET uuid = lower(hex(randomblob(16))) WHERE uuid IS NULL;
CREATE UNIQUE INDEX idx_tooth_chart_uuid ON tooth_chart(uuid);
ALTER TABLE tooth_chart ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER tooth_chart_uuid AFTER INSERT ON tooth_chart
WHEN NEW.uuid IS NULL
BEGIN
  UPDATE tooth_chart SET uuid = lower(hex(randomblob(16))) WHERE id = NEW.id;
END;

CREATE TRIGGER tooth_chart_sync_insert AFTER INSERT ON tooth_chart
WHEN NEW.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('tooth_chart', NEW.uuid, 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER tooth_chart_sync_update AFTER UPDATE ON tooth_chart
WHEN NEW.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('tooth_chart', NEW.uuid, 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER tooth_chart_sync_delete AFTER DELETE ON tooth_chart
WHEN OLD.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('tooth_chart', OLD.uuid, 'delete', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

-- ---- treatments --------------------------------------------------
ALTER TABLE treatments ADD COLUMN uuid TEXT;
UPDATE treatments SET uuid = lower(hex(randomblob(16))) WHERE uuid IS NULL;
CREATE UNIQUE INDEX idx_treatments_uuid ON treatments(uuid);
ALTER TABLE treatments ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER treatments_uuid AFTER INSERT ON treatments
WHEN NEW.uuid IS NULL
BEGIN
  UPDATE treatments SET uuid = lower(hex(randomblob(16))) WHERE id = NEW.id;
END;

CREATE TRIGGER treatments_sync_insert AFTER INSERT ON treatments
WHEN NEW.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('treatments', NEW.uuid, 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER treatments_sync_update AFTER UPDATE ON treatments
WHEN NEW.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('treatments', NEW.uuid, 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER treatments_sync_delete AFTER DELETE ON treatments
WHEN OLD.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('treatments', OLD.uuid, 'delete', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

-- ---- invoices ----------------------------------------------------
ALTER TABLE invoices ADD COLUMN uuid TEXT;
UPDATE invoices SET uuid = lower(hex(randomblob(16))) WHERE uuid IS NULL;
CREATE UNIQUE INDEX idx_invoices_uuid ON invoices(uuid);
ALTER TABLE invoices ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER invoices_uuid AFTER INSERT ON invoices
WHEN NEW.uuid IS NULL
BEGIN
  UPDATE invoices SET uuid = lower(hex(randomblob(16))) WHERE id = NEW.id;
END;

CREATE TRIGGER invoices_sync_insert AFTER INSERT ON invoices
WHEN NEW.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('invoices', NEW.uuid, 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER invoices_sync_update AFTER UPDATE ON invoices
WHEN NEW.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('invoices', NEW.uuid, 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER invoices_sync_delete AFTER DELETE ON invoices
WHEN OLD.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('invoices', OLD.uuid, 'delete', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

-- ---- invoice_items -----------------------------------------------
ALTER TABLE invoice_items ADD COLUMN uuid TEXT;
UPDATE invoice_items SET uuid = lower(hex(randomblob(16))) WHERE uuid IS NULL;
CREATE UNIQUE INDEX idx_invoice_items_uuid ON invoice_items(uuid);
ALTER TABLE invoice_items ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER invoice_items_uuid AFTER INSERT ON invoice_items
WHEN NEW.uuid IS NULL
BEGIN
  UPDATE invoice_items SET uuid = lower(hex(randomblob(16))) WHERE id = NEW.id;
END;

CREATE TRIGGER invoice_items_sync_insert AFTER INSERT ON invoice_items
WHEN NEW.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('invoice_items', NEW.uuid, 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER invoice_items_sync_update AFTER UPDATE ON invoice_items
WHEN NEW.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('invoice_items', NEW.uuid, 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER invoice_items_sync_delete AFTER DELETE ON invoice_items
WHEN OLD.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('invoice_items', OLD.uuid, 'delete', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

-- ---- payments ----------------------------------------------------
ALTER TABLE payments ADD COLUMN uuid TEXT;
UPDATE payments SET uuid = lower(hex(randomblob(16))) WHERE uuid IS NULL;
CREATE UNIQUE INDEX idx_payments_uuid ON payments(uuid);
ALTER TABLE payments ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER payments_uuid AFTER INSERT ON payments
WHEN NEW.uuid IS NULL
BEGIN
  UPDATE payments SET uuid = lower(hex(randomblob(16))) WHERE id = NEW.id;
END;

CREATE TRIGGER payments_sync_insert AFTER INSERT ON payments
WHEN NEW.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('payments', NEW.uuid, 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER payments_sync_update AFTER UPDATE ON payments
WHEN NEW.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('payments', NEW.uuid, 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER payments_sync_delete AFTER DELETE ON payments
WHEN OLD.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('payments', OLD.uuid, 'delete', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

-- ---- expenses ----------------------------------------------------
ALTER TABLE expenses ADD COLUMN uuid TEXT;
UPDATE expenses SET uuid = lower(hex(randomblob(16))) WHERE uuid IS NULL;
CREATE UNIQUE INDEX idx_expenses_uuid ON expenses(uuid);
ALTER TABLE expenses ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER expenses_uuid AFTER INSERT ON expenses
WHEN NEW.uuid IS NULL
BEGIN
  UPDATE expenses SET uuid = lower(hex(randomblob(16))) WHERE id = NEW.id;
END;

CREATE TRIGGER expenses_sync_insert AFTER INSERT ON expenses
WHEN NEW.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('expenses', NEW.uuid, 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER expenses_sync_update AFTER UPDATE ON expenses
WHEN NEW.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('expenses', NEW.uuid, 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER expenses_sync_delete AFTER DELETE ON expenses
WHEN OLD.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('expenses', OLD.uuid, 'delete', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

-- ---- message_templates -------------------------------------------
ALTER TABLE message_templates ADD COLUMN uuid TEXT;
UPDATE message_templates SET uuid = lower(hex(randomblob(16))) WHERE uuid IS NULL;
CREATE UNIQUE INDEX idx_message_templates_uuid ON message_templates(uuid);
ALTER TABLE message_templates ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER message_templates_uuid AFTER INSERT ON message_templates
WHEN NEW.uuid IS NULL
BEGIN
  UPDATE message_templates SET uuid = lower(hex(randomblob(16))) WHERE id = NEW.id;
END;

CREATE TRIGGER message_templates_sync_insert AFTER INSERT ON message_templates
WHEN NEW.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('message_templates', NEW.uuid, 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER message_templates_sync_update AFTER UPDATE ON message_templates
WHEN NEW.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('message_templates', NEW.uuid, 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER message_templates_sync_delete AFTER DELETE ON message_templates
WHEN OLD.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('message_templates', OLD.uuid, 'delete', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

-- ---- messages ----------------------------------------------------
ALTER TABLE messages ADD COLUMN uuid TEXT;
UPDATE messages SET uuid = lower(hex(randomblob(16))) WHERE uuid IS NULL;
CREATE UNIQUE INDEX idx_messages_uuid ON messages(uuid);
ALTER TABLE messages ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER messages_uuid AFTER INSERT ON messages
WHEN NEW.uuid IS NULL
BEGIN
  UPDATE messages SET uuid = lower(hex(randomblob(16))) WHERE id = NEW.id;
END;

CREATE TRIGGER messages_sync_insert AFTER INSERT ON messages
WHEN NEW.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('messages', NEW.uuid, 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER messages_sync_update AFTER UPDATE ON messages
WHEN NEW.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('messages', NEW.uuid, 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER messages_sync_delete AFTER DELETE ON messages
WHEN OLD.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('messages', OLD.uuid, 'delete', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

