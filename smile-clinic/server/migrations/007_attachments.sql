-- X-rays and clinical photographs, kept with the patient they belong to.
--
-- The image lives in the row as base64 text rather than a file on disk or a
-- BLOB. Three reasons, in order of weight:
--
--   * the app runs inside a phone with no filesystem, on SQLite compiled to
--     WebAssembly, and a path on a clinic computer means nothing there;
--   * one database file stays one backup — an x-ray that lives beside the
--     database is an x-ray somebody forgets to copy;
--   * syncing carries rows as JSON, and text crosses that unchanged.
--
-- The cost is about a third more storage than the raw bytes, paid back by
-- downscaling on the way in: a phone camera's 4 MB photograph is stored at
-- around 250 KB, which is more than a diagnosis needs.
CREATE TABLE attachments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'photo' CHECK (kind IN ('xray', 'photo')),
  caption    TEXT,
  -- Which tooth it shows, when it shows one. FDI, same as the odontogram.
  tooth      INTEGER,
  taken_on   TEXT,
  mime       TEXT NOT NULL DEFAULT 'image/jpeg',
  width      INTEGER,
  height     INTEGER,
  bytes      INTEGER NOT NULL DEFAULT 0,
  data       TEXT NOT NULL,
  -- A few kilobytes, so a grid of twenty is one small response rather than
  -- twenty large ones. Built on the device that captured the image.
  thumb      TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  uuid       TEXT,
  deleted    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_attachments_patient ON attachments(patient_id, taken_on);
CREATE UNIQUE INDEX idx_attachments_uuid ON attachments(uuid);

CREATE TRIGGER attachments_uuid AFTER INSERT ON attachments
WHEN NEW.uuid IS NULL
BEGIN
  UPDATE attachments SET uuid = lower(hex(randomblob(16))) WHERE id = NEW.id;
END;

CREATE TRIGGER attachments_sync_insert AFTER INSERT ON attachments
WHEN NEW.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('attachments', NEW.uuid, 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER attachments_sync_update AFTER UPDATE ON attachments
WHEN NEW.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('attachments', NEW.uuid, 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER attachments_sync_delete AFTER DELETE ON attachments
WHEN OLD.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('attachments', OLD.uuid, 'delete', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
