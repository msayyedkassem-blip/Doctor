-- Joining a device by pairing code rather than by a signed-in session.
--
-- A phone running its own copy is a different origin from the clinic server, so
-- the browser never sends it the administrator's cookie and forbids the page
-- from setting one. A short code the administrator reads out is both simpler
-- and the way pairing a device is normally done.

ALTER TABLE sync_devices ADD COLUMN pairing_code TEXT;
ALTER TABLE sync_devices ADD COLUMN pairing_expires_at TEXT;
-- Devices enrolled before this change are already paired.
ALTER TABLE sync_devices ADD COLUMN paired INTEGER NOT NULL DEFAULT 1;

CREATE INDEX idx_devices_pairing ON sync_devices(pairing_code);
