/**
 * What syncs, and how the tables point at each other.
 *
 * Local row ids differ on every device, so a row travels identified by its
 * uuid, and any column pointing at another row travels as that row's uuid too.
 * The order here is the order changes must be applied: a parent before anything
 * that references it.
 */
export const SYNC_TABLES = [
  { table: 'users', fks: {} },
  { table: 'patients', fks: {} },
  { table: 'procedures', fks: {} },
  { table: 'appointments',
    fks: { patient_id: 'patients', dentist_id: 'users', procedure_id: 'procedures',
      created_by: 'users' } },
  { table: 'tooth_chart', fks: { patient_id: 'patients', updated_by: 'users' } },
  { table: 'treatments',
    fks: { patient_id: 'patients', procedure_id: 'procedures',
      appointment_id: 'appointments', dentist_id: 'users' } },
  { table: 'invoices', fks: { patient_id: 'patients', created_by: 'users' } },
  { table: 'invoice_items',
    fks: { invoice_id: 'invoices', treatment_id: 'treatments', procedure_id: 'procedures' } },
  { table: 'payments',
    fks: { patient_id: 'patients', invoice_id: 'invoices', created_by: 'users' } },
  { table: 'expenses', fks: { created_by: 'users' } },
  { table: 'attachments', fks: { patient_id: 'patients', created_by: 'users' } },
  { table: 'stock_items', fks: {} },
  { table: 'stock_moves', fks: { item_id: 'stock_items', created_by: 'users' } },
  { table: 'medicines', fks: {} },
  { table: 'prescriptions', fks: { patient_id: 'patients', created_by: 'users' } },
  { table: 'prescription_items',
    fks: { prescription_id: 'prescriptions', medicine_id: 'medicines' } },
  { table: 'message_templates', fks: {} },
  { table: 'messages',
    fks: { patient_id: 'patients', appointment_id: 'appointments',
      invoice_id: 'invoices', created_by: 'users' } },
];

export const TABLE_NAMES = SYNC_TABLES.map((t) => t.table);

export const fksFor = (table) => SYNC_TABLES.find((t) => t.table === table)?.fks || {};

export const isSyncable = (table) => TABLE_NAMES.includes(table);

/**
 * Columns that must stay unique across the whole clinic, not just one device.
 * Two devices inventing the same patient file number is the one collision that
 * cannot be merged away, so it is reported rather than silently resolved.
 */
/**
 * Columns that identify the thing itself. Two devices with the same staff email
 * mean one member of staff, so the rows are merged under one identity rather
 * than fought over.
 */
export const MERGE_ON = {
  users: ['email'],
  procedures: ['code'],
  message_templates: ['key'],
};

/**
 * Columns that must be unique clinic-wide but are only labels the software
 * invented. Two devices reaching P-0007 for different people cannot be merged
 * away, so it is reported for a human instead.
 */
export const UNIQUE_COLUMNS = {
  patients: ['code'],
  invoices: ['number'],
};

/** Columns never sent: a local id means nothing anywhere else. */
export const LOCAL_ONLY = ['id'];
