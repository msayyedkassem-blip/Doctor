-- The store cupboard: what the clinic keeps, and what is running out.
--
-- Two tables rather than one. `stock_items` is what a thing is and how much of
-- it there should be; `stock_moves` is every change to the count, with a
-- reason. Without the second a number that looks wrong can only be argued
-- about — with it, you can see who took what and when, which is the whole
-- reason a clinic counts its materials.
CREATE TABLE stock_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  category     TEXT NOT NULL DEFAULT 'General',
  -- What one of it is: a box, a syringe, a millilitre.
  unit         TEXT NOT NULL DEFAULT 'piece',
  quantity     REAL NOT NULL DEFAULT 0,
  -- Below this, the item is listed as needing reordering.
  min_quantity REAL NOT NULL DEFAULT 0,
  unit_cost_cents INTEGER NOT NULL DEFAULT 0,
  supplier     TEXT,
  barcode      TEXT,
  expires_on   TEXT,
  notes        TEXT,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  uuid         TEXT,
  deleted      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_stock_items_active ON stock_items(active, category);
CREATE UNIQUE INDEX idx_stock_items_uuid ON stock_items(uuid);

CREATE TABLE stock_moves (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id    INTEGER NOT NULL REFERENCES stock_items(id) ON DELETE CASCADE,
  -- Positive for a delivery, negative for use or waste.
  change     REAL NOT NULL,
  reason     TEXT NOT NULL DEFAULT 'used'
             CHECK (reason IN ('received', 'used', 'wasted', 'expired', 'counted')),
  note       TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  uuid       TEXT,
  deleted    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_stock_moves_item ON stock_moves(item_id, created_at);
CREATE UNIQUE INDEX idx_stock_moves_uuid ON stock_moves(uuid);

CREATE TRIGGER stock_items_uuid AFTER INSERT ON stock_items
WHEN NEW.uuid IS NULL
BEGIN
  UPDATE stock_items SET uuid = lower(hex(randomblob(16))) WHERE id = NEW.id;
END;
CREATE TRIGGER stock_items_sync_insert AFTER INSERT ON stock_items
WHEN NEW.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('stock_items', NEW.uuid, 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER stock_items_sync_update AFTER UPDATE ON stock_items
WHEN NEW.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('stock_items', NEW.uuid, 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER stock_items_sync_delete AFTER DELETE ON stock_items
WHEN OLD.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('stock_items', OLD.uuid, 'delete', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER stock_moves_uuid AFTER INSERT ON stock_moves
WHEN NEW.uuid IS NULL
BEGIN
  UPDATE stock_moves SET uuid = lower(hex(randomblob(16))) WHERE id = NEW.id;
END;
CREATE TRIGGER stock_moves_sync_insert AFTER INSERT ON stock_moves
WHEN NEW.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('stock_moves', NEW.uuid, 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER stock_moves_sync_update AFTER UPDATE ON stock_moves
WHEN NEW.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('stock_moves', NEW.uuid, 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER stock_moves_sync_delete AFTER DELETE ON stock_moves
WHEN OLD.uuid IS NOT NULL AND (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_outbox (table_name, row_uuid, op, changed_at)
  VALUES ('stock_moves', OLD.uuid, 'delete', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
