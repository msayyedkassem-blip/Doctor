-- What this clinic is licensed to do, and the clock it cannot wind back.
--
-- One row. The key itself is kept so it can be re-checked at every start and
-- shown to the customer; it is not a secret — it says only what was bought.
CREATE TABLE licence (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  key           TEXT NOT NULL DEFAULT '',
  activated_at  TEXT,
  -- The trial starts the first time the app runs, not when it was downloaded.
  trial_started TEXT,
  -- The furthest date this installation has ever seen. A subscription that
  -- expires can otherwise be extended forever by setting the computer's clock
  -- back, and a clinic computer's clock is not something we control.
  high_water    TEXT
);
INSERT INTO licence (id) VALUES (1);
