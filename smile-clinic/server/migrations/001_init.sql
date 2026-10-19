-- Smile Clinic — initial schema.
-- All monetary values are stored as integer minor units (cents) to avoid
-- floating point drift. All timestamps are ISO-8601 strings in clinic-local
-- time for appointments (naive, no offset) and UTC for audit/system fields.

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','dentist','receptionist','accountant')),
  color         TEXT NOT NULL DEFAULT '#2f7d8c',
  phone         TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen  TEXT NOT NULL,
  user_agent TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE patients (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  code               TEXT NOT NULL UNIQUE,
  first_name         TEXT NOT NULL,
  last_name          TEXT NOT NULL,
  dob                TEXT,
  gender             TEXT,
  phone              TEXT,
  email              TEXT,
  address            TEXT,
  city               TEXT,
  national_id        TEXT,
  insurance_provider TEXT,
  insurance_number   TEXT,
  allergies          TEXT,
  medical_notes      TEXT,
  referral_source    TEXT,
  archived           INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX idx_patients_name ON patients(last_name, first_name);
CREATE INDEX idx_patients_phone ON patients(phone);
CREATE INDEX idx_patients_archived ON patients(archived);

CREATE TABLE procedures (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  code                 TEXT NOT NULL UNIQUE,
  name                 TEXT NOT NULL,
  category             TEXT NOT NULL DEFAULT 'General',
  default_price_cents  INTEGER NOT NULL DEFAULT 0,
  default_duration_min INTEGER NOT NULL DEFAULT 30,
  tax_rate_bp          INTEGER NOT NULL DEFAULT 0,
  tooth_specific       INTEGER NOT NULL DEFAULT 0,
  active               INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
CREATE INDEX idx_procedures_active ON procedures(active, category);

CREATE TABLE appointments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id   INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  dentist_id   INTEGER NOT NULL REFERENCES users(id),
  procedure_id INTEGER REFERENCES procedures(id),
  starts_at    TEXT NOT NULL,
  ends_at      TEXT NOT NULL,
  operatory    TEXT NOT NULL DEFAULT 'Chair 1',
  reason       TEXT,
  status       TEXT NOT NULL DEFAULT 'scheduled'
               CHECK (status IN ('scheduled','confirmed','arrived','completed','cancelled','no_show')),
  notes        TEXT,
  cancel_reason TEXT,
  created_by   INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX idx_appt_range ON appointments(starts_at, ends_at);
CREATE INDEX idx_appt_dentist ON appointments(dentist_id, starts_at);
CREATE INDEX idx_appt_patient ON appointments(patient_id, starts_at);
CREATE INDEX idx_appt_status ON appointments(status);

-- Odontogram: one row per charted tooth per patient.
CREATE TABLE tooth_chart (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  tooth      INTEGER NOT NULL,
  condition  TEXT NOT NULL DEFAULT 'healthy'
             CHECK (condition IN ('healthy','caries','filled','crown','bridge','implant',
                                  'root_canal','missing','extraction_needed','sealant','veneer')),
  surfaces   TEXT NOT NULL DEFAULT '',
  note       TEXT,
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL,
  UNIQUE (patient_id, tooth)
);

-- Treatment plan / performed work. Drives production figures and invoicing.
CREATE TABLE treatments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id     INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  procedure_id   INTEGER NOT NULL REFERENCES procedures(id),
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  dentist_id     INTEGER REFERENCES users(id),
  tooth          INTEGER,
  surfaces       TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'planned'
                 CHECK (status IN ('planned','in_progress','completed','cancelled')),
  price_cents    INTEGER NOT NULL DEFAULT 0,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  notes          TEXT,
  planned_at     TEXT,
  completed_at   TEXT,
  invoiced       INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX idx_treat_patient ON treatments(patient_id, status);
CREATE INDEX idx_treat_invoiced ON treatments(invoiced, status);

CREATE TABLE invoices (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  number         TEXT NOT NULL UNIQUE,
  patient_id     INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  issued_at      TEXT NOT NULL,
  due_at         TEXT,
  status         TEXT NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft','issued','partial','paid','void')),
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  tax_cents      INTEGER NOT NULL DEFAULT 0,
  total_cents    INTEGER NOT NULL DEFAULT 0,
  notes          TEXT,
  void_reason    TEXT,
  created_by     INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX idx_inv_patient ON invoices(patient_id, issued_at);
CREATE INDEX idx_inv_status ON invoices(status, issued_at);

CREATE TABLE invoice_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id      INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  treatment_id    INTEGER REFERENCES treatments(id) ON DELETE SET NULL,
  procedure_id    INTEGER REFERENCES procedures(id),
  description     TEXT NOT NULL,
  tooth           INTEGER,
  quantity        INTEGER NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL DEFAULT 0,
  discount_cents  INTEGER NOT NULL DEFAULT 0,
  tax_rate_bp     INTEGER NOT NULL DEFAULT 0,
  line_total_cents INTEGER NOT NULL DEFAULT 0,
  position        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_items_invoice ON invoice_items(invoice_id, position);

CREATE TABLE payments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id   INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  invoice_id   INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  amount_cents INTEGER NOT NULL,
  method       TEXT NOT NULL DEFAULT 'cash'
               CHECK (method IN ('cash','card','transfer','insurance','cheque','online','other')),
  direction    TEXT NOT NULL DEFAULT 'in' CHECK (direction IN ('in','refund')),
  reference    TEXT,
  paid_at      TEXT NOT NULL,
  notes        TEXT,
  created_by   INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_pay_patient ON payments(patient_id, paid_at);
CREATE INDEX idx_pay_invoice ON payments(invoice_id);
CREATE INDEX idx_pay_date ON payments(paid_at);

CREATE TABLE expenses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  category     TEXT NOT NULL DEFAULT 'Supplies',
  description  TEXT NOT NULL,
  vendor       TEXT,
  amount_cents INTEGER NOT NULL,
  method       TEXT NOT NULL DEFAULT 'cash'
               CHECK (method IN ('cash','card','transfer','cheque','online','other')),
  reference    TEXT,
  spent_at     TEXT NOT NULL,
  notes        TEXT,
  created_by   INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_exp_date ON expenses(spent_at);
CREATE INDEX idx_exp_category ON expenses(category);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id),
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  TEXT,
  details    TEXT,
  at         TEXT NOT NULL
);
CREATE INDEX idx_audit_at ON audit_log(at);
CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id);
