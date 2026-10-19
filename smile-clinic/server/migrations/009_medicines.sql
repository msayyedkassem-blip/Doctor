-- The medicines a dental clinic actually prescribes, and what was given to
-- whom.
--
-- `medicines` is the clinic's list — editable, because formularies differ by
-- country and by what the pharmacy downstairs stocks. A prescription copies
-- the text it needs rather than pointing at the list, so correcting a dose on
-- the list never rewrites what a patient was already told to take.
CREATE TABLE medicines (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  name_ar     TEXT,
  -- What it is, for someone who knows the generic but not the brand.
  generic     TEXT,
  category    TEXT NOT NULL DEFAULT 'Other',
  form        TEXT NOT NULL DEFAULT 'tablet',
  strength    TEXT,
  -- What gets filled in by default when it is chosen; all still editable.
  dose        TEXT,
  frequency   TEXT,
  duration    TEXT,
  instructions TEXT,
  -- Shown as a warning when it is chosen, not buried in notes.
  caution     TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  uuid        TEXT,
  deleted     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_medicines_active ON medicines(active, category);
CREATE UNIQUE INDEX idx_medicines_uuid ON medicines(uuid);

CREATE TABLE prescriptions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  issued_on  TEXT NOT NULL,
  notes      TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  uuid       TEXT,
  deleted    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_prescriptions_patient ON prescriptions(patient_id, issued_on);
CREATE UNIQUE INDEX idx_prescriptions_uuid ON prescriptions(uuid);

CREATE TABLE prescription_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  prescription_id INTEGER NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  medicine_id     INTEGER REFERENCES medicines(id),
  -- Copied at the moment of prescribing, so the paper and the record agree
  -- for ever after.
  name            TEXT NOT NULL,
  form            TEXT,
  strength        TEXT,
  dose            TEXT,
  frequency       TEXT,
  duration        TEXT,
  instructions    TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  uuid            TEXT,
  deleted         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_prescription_items ON prescription_items(prescription_id);
CREATE UNIQUE INDEX idx_prescription_items_uuid ON prescription_items(uuid);

CREATE TRIGGER medicines_uuid AFTER INSERT ON medicines
WHEN NEW.uuid IS NULL
BEGIN
  UPDATE medicines SET uuid = lower(hex(randomblob(16))) WHERE id = NEW.id;
END;
CREATE TRIGGER medicines_sync_insert AFTER INSERT ON medicines
WHEN NEW.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('medicines', NEW.uuid, 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER medicines_sync_update AFTER UPDATE ON medicines
WHEN NEW.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('medicines', NEW.uuid, 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER medicines_sync_delete AFTER DELETE ON medicines
WHEN OLD.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('medicines', OLD.uuid, 'delete', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER prescriptions_uuid AFTER INSERT ON prescriptions
WHEN NEW.uuid IS NULL
BEGIN
  UPDATE prescriptions SET uuid = lower(hex(randomblob(16))) WHERE id = NEW.id;
END;
CREATE TRIGGER prescriptions_sync_insert AFTER INSERT ON prescriptions
WHEN NEW.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('prescriptions', NEW.uuid, 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER prescriptions_sync_update AFTER UPDATE ON prescriptions
WHEN NEW.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('prescriptions', NEW.uuid, 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER prescriptions_sync_delete AFTER DELETE ON prescriptions
WHEN OLD.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('prescriptions', OLD.uuid, 'delete', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER prescription_items_uuid AFTER INSERT ON prescription_items
WHEN NEW.uuid IS NULL
BEGIN
  UPDATE prescription_items SET uuid = lower(hex(randomblob(16))) WHERE id = NEW.id;
END;
CREATE TRIGGER prescription_items_sync_insert AFTER INSERT ON prescription_items
WHEN NEW.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('prescription_items', NEW.uuid, 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER prescription_items_sync_update AFTER UPDATE ON prescription_items
WHEN NEW.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('prescription_items', NEW.uuid, 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER prescription_items_sync_delete AFTER DELETE ON prescription_items
WHEN OLD.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('prescription_items', OLD.uuid, 'delete', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
