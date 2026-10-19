/**
 * Fills the database with a realistic demo clinic so every screen has
 * something to show. Run with `npm run seed`, or `npm run reset` to wipe
 * the database first.
 */
import fs from 'node:fs';
import { q, insert, tx, closeDb } from './db.js';
import { installNodeDriver } from './db-node.js';
import { installNodeCrypto } from './lib/crypto-node.js';
import { dbPath } from './config.js';
import { hashPassword } from './lib/auth.js';
import { lineTotal, invoiceTotals } from './lib/money.js';
import { DEFAULT_SETTINGS } from './routes/settings.js';

const RESET = process.argv.includes('--reset');
const now = () => new Date().toISOString();
const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const shift = (days) => { const d = new Date(today); d.setDate(d.getDate() + days); return d; };
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const between = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

if (RESET) {
  const file = dbPath();
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(file + suffix)) fs.unlinkSync(file + suffix);
  }
  console.log('[seed] removed the existing database');
}

installNodeCrypto();
installNodeDriver();

if (q.get('SELECT COUNT(*) AS n FROM patients').n > 0 && !RESET) {
  console.log('[seed] the database already has patients — use `npm run reset` to start over');
  closeDb();
  process.exit(0);
}

const SETTINGS = {
  clinic_name: 'Smile Dental Clinic',
  clinic_address: '14 Riverside Avenue, Springfield',
  clinic_phone: '+1 555 0100',
  clinic_email: 'front-desk@smile.clinic',
  currency: 'USD',
  currency_symbol: '$',
  default_tax_rate_bp: '0',
  operatories: 'Chair 1,Chair 2,Chair 3',
};

const USERS = [
  ['Dr. Amina Rahman', 'admin@clinic.local', 'admin', '#2f7d8c', 'demo1234'],
  ['Dr. Lucas Moreau', 'lucas@clinic.local', 'dentist', '#7a5cc4', 'demo1234'],
  ['Dr. Sofia Castillo', 'sofia@clinic.local', 'dentist', '#c4645c', 'demo1234'],
  ['Nadia Haddad', 'front-desk@clinic.local', 'receptionist', '#3f8f5d', 'demo1234'],
  ['Peter Nguyen', 'accounts@clinic.local', 'accountant', '#b07d2b', 'demo1234'],
];

const PROCEDURES = [
  ['EXAM', 'Comprehensive oral examination', 'Diagnostic', 6000, 30, 0],
  ['XRAY1', 'Periapical radiograph', 'Diagnostic', 3500, 15, 1],
  ['PANO', 'Panoramic radiograph', 'Diagnostic', 9000, 20, 0],
  ['CLEAN', 'Scaling and polishing', 'Preventive', 8500, 45, 0],
  ['PERIO', 'Deep periodontal cleaning (per quadrant)', 'Preventive', 14000, 60, 0],
  ['FLUOR', 'Fluoride application', 'Preventive', 3000, 15, 0],
  ['SEAL', 'Fissure sealant', 'Preventive', 4500, 20, 1],
  ['FILL1', 'Composite filling — one surface', 'Restorative', 11000, 40, 1],
  ['FILL2', 'Composite filling — two surfaces', 'Restorative', 14500, 50, 1],
  ['FILL3', 'Composite filling — three surfaces', 'Restorative', 18000, 60, 1],
  ['CROWN', 'Porcelain crown', 'Prosthetics', 62000, 90, 1],
  ['BRIDGE', 'Three-unit bridge', 'Prosthetics', 165000, 120, 1],
  ['VENEER', 'Porcelain veneer', 'Cosmetic', 68000, 90, 1],
  ['WHITE', 'In-office whitening', 'Cosmetic', 32000, 60, 0],
  ['RCT1', 'Root canal — anterior', 'Endodontics', 48000, 90, 1],
  ['RCT3', 'Root canal — molar', 'Endodontics', 72000, 120, 1],
  ['EXT', 'Simple extraction', 'Surgery', 15000, 40, 1],
  ['EXTS', 'Surgical extraction', 'Surgery', 32000, 60, 1],
  ['IMPL', 'Dental implant placement', 'Surgery', 185000, 120, 1],
  ['DENT', 'Complete denture (per arch)', 'Prosthetics', 145000, 90, 0],
  ['NIGHT', 'Night guard', 'Appliances', 38000, 45, 0],
  ['EMERG', 'Emergency pain relief visit', 'General', 9000, 30, 0],
];

const FIRST = ['Maria', 'James', 'Fatima', 'Liam', 'Yuki', 'Omar', 'Elena', 'Noah', 'Aisha',
  'Ethan', 'Sara', 'Daniel', 'Leila', 'Marcus', 'Priya', 'Tomas', 'Hannah', 'Kofi',
  'Isabel', 'Viktor', 'Amara', 'Jonas', 'Ines', 'Rafael', 'Chloe', 'Mehmet', 'Grace',
  'Andres', 'Nour', 'Felix'];
const LAST = ['Silva', 'Okafor', 'Haddad', 'Nakamura', 'Kowalski', 'Dubois', 'Rossi', 'Ahmed',
  'Petrova', 'Johnson', 'Garcia', 'Lindqvist', 'Mensah', 'Novak', 'Chen', 'Bauer',
  'Moreau', 'Ivanov', 'Santos', 'Hassan'];
const CITIES = ['Springfield', 'Riverton', 'Oakdale', 'Fairview', 'Brookside'];
const INSURERS = ['', '', 'DentaCare', 'HealthFirst', 'Meridian Dental', 'Unity Health'];
const ALLERGIES = ['', '', '', 'Penicillin', 'Latex', 'Ibuprofen', 'Local anaesthetic (articaine)'];
const CONDITIONS = ['caries', 'filled', 'crown', 'root_canal', 'missing', 'implant', 'sealant'];
const EXPENSE_ITEMS = [
  ['Supplies', 'Composite resin kit', 'DentSupply Co', 24000],
  ['Supplies', 'Disposable gloves (10 boxes)', 'MedMart', 8500],
  ['Supplies', 'Impression material', 'DentSupply Co', 16500],
  ['Lab', 'Crown fabrication — Ceramco Lab', 'Ceramco Lab', 42000],
  ['Lab', 'Denture fabrication', 'Ceramco Lab', 68000],
  ['Rent', 'Clinic rent', 'Riverside Properties', 320000],
  ['Utilities', 'Electricity and water', 'City Utilities', 41000],
  ['Utilities', 'Internet and phone', 'Telecom Plus', 9500],
  ['Salaries', 'Staff payroll', '', 890000],
  ['Equipment', 'Autoclave servicing', 'SteriTech', 55000],
  ['Equipment', 'Handpiece replacement', 'DentSupply Co', 78000],
  ['Marketing', 'Local listing and social ads', 'AdReach', 22000],
  ['Taxes', 'Quarterly business tax', 'Revenue Office', 240000],
];

console.log('[seed] building the demo clinic...');

// Hashing is async, but tx() is not: do it up front and hand the results in.
const demoHash = await hashPassword('demo1234');
const userHashes = USERS.map(() => demoHash);

tx(() => {
  for (const [key, value] of Object.entries({ ...DEFAULT_SETTINGS, ...SETTINGS })) {
    q.run(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, value, now(),
    );
  }

  const userIds = USERS.map(([name, email, role, color], index) => insert('users', {
    name, email, role, color,
    password_hash: userHashes[index],
    active: 1, created_at: now(), updated_at: now(),
  }));
  const dentistIds = [userIds[0], userIds[1], userIds[2]];
  const frontDesk = userIds[3];

  const procedureIds = PROCEDURES.map(([code, name, category, price, duration, toothSpecific]) =>
    insert('procedures', {
      code, name, category,
      default_price_cents: price,
      default_duration_min: duration,
      tax_rate_bp: 0,
      tooth_specific: toothSpecific,
      active: 1, created_at: now(), updated_at: now(),
    }));
  const procedureById = new Map(PROCEDURES.map(([code], i) => [code, procedureIds[i]]));
  const priceOf = new Map(PROCEDURES.map(([code, , , price], i) => [procedureIds[i], price]));
  const durationOf = new Map(PROCEDURES.map(([, , , , duration], i) => [procedureIds[i], duration]));
  const nameOf = new Map(PROCEDURES.map(([, name], i) => [procedureIds[i], name]));

  // ---- Patients -------------------------------------------------------
  const patientIds = [];
  for (let i = 0; i < 42; i += 1) {
    const first = pick(FIRST);
    const last = pick(LAST);
    const birthYear = between(1950, 2015);
    const created = shift(-between(10, 900));
    patientIds.push(insert('patients', {
      code: `P-${String(i + 1).padStart(4, '0')}`,
      first_name: first,
      last_name: last,
      dob: `${birthYear}-${String(between(1, 12)).padStart(2, '0')}-${String(between(1, 28)).padStart(2, '0')}`,
      gender: pick(['female', 'male', 'other']),
      phone: `+1 555 ${String(between(1000, 9999))}`,
      email: `${first}.${last}${i}`.toLowerCase() + '@example.com',
      address: `${between(1, 200)} ${pick(['Maple', 'Oak', 'Cedar', 'Pine', 'Elm'])} Street`,
      city: pick(CITIES),
      national_id: `ID${between(100000, 999999)}`,
      insurance_provider: pick(INSURERS),
      insurance_number: pick(INSURERS) ? `POL-${between(10000, 99999)}` : '',
      allergies: pick(ALLERGIES),
      medical_notes: pick(['', '', 'Hypertension, on medication.', 'Type 2 diabetes.',
        'Anxious patient — prefers morning visits.', 'Pregnant, second trimester.']),
      referral_source: pick(['Walk-in', 'Google', 'Referral', 'Insurance list', 'Returning']),
      archived: 0,
      created_at: created.toISOString(),
      updated_at: created.toISOString(),
    }));
  }

  // ---- Odontogram -----------------------------------------------------
  for (const patientId of patientIds) {
    const charted = between(0, 6);
    const teeth = new Set();
    for (let i = 0; i < charted; i += 1) {
      const quadrant = between(1, 4);
      const position = between(1, 8);
      teeth.add(quadrant * 10 + position);
    }
    for (const tooth of teeth) {
      insert('tooth_chart', {
        patient_id: patientId,
        tooth,
        condition: pick(CONDITIONS),
        surfaces: pick(['', 'O', 'MO', 'MOD', 'B', 'DL']),
        note: '',
        updated_by: pick(dentistIds),
        updated_at: now(),
      });
    }
  }

  // ---- Appointments, treatments, invoices, payments --------------------
  const operatories = SETTINGS.operatories.split(',');
  let appointmentCount = 0;

  for (let dayOffset = -120; dayOffset <= 21; dayOffset += 1) {
    const day = shift(dayOffset);
    const weekday = day.getDay();
    // Closed on Sundays — except today, so a fresh demo always has a live day.
    if (weekday === 0 && dayOffset !== 0) continue;
    const slotsToday = dayOffset === 0 ? between(6, 10)
      : weekday === 6 ? between(2, 5) : between(4, 11);

    const taken = new Map();
    for (let s = 0; s < slotsToday; s += 1) {
      const dentistId = pick(dentistIds);
      const procedureId = pick(procedureIds);
      const duration = durationOf.get(procedureId);
      const patientId = pick(patientIds);

      // Find a free start time for this practitioner.
      let startMinutes = null;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const candidate = between(8 * 60, 18 * 60 - duration);
        const rounded = candidate - (candidate % 15);
        const busy = (taken.get(dentistId) || []).some(
          ([bs, be]) => rounded < be && rounded + duration > bs);
        if (!busy) { startMinutes = rounded; break; }
      }
      if (startMinutes === null) continue;
      taken.set(dentistId, [...(taken.get(dentistId) || []), [startMinutes, startMinutes + duration]]);

      const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      const startsAt = `${iso(day)}T${hhmm(startMinutes)}`;
      const endsAt = `${iso(day)}T${hhmm(startMinutes + duration)}`;

      let status;
      if (dayOffset > 0) status = pick(['scheduled', 'scheduled', 'confirmed']);
      else if (dayOffset === 0) status = pick(['confirmed', 'arrived', 'completed', 'scheduled']);
      else status = pick(['completed', 'completed', 'completed', 'completed',
        'completed', 'cancelled', 'no_show']);

      const appointmentId = insert('appointments', {
        patient_id: patientId,
        dentist_id: dentistId,
        procedure_id: procedureId,
        starts_at: startsAt,
        ends_at: endsAt,
        operatory: pick(operatories),
        reason: nameOf.get(procedureId),
        status,
        notes: '',
        cancel_reason: status === 'cancelled' ? pick(['Patient rescheduled', 'Illness', 'No reason given']) : null,
        created_by: frontDesk,
        created_at: shift(dayOffset - between(1, 20)).toISOString(),
        updated_at: now(),
      });
      appointmentCount += 1;

      if (status !== 'completed') continue;

      // Completed visit: record the treatment, invoice it, and usually collect.
      const price = priceOf.get(procedureId);
      const discount = Math.random() < 0.15 ? Math.round(price * 0.1) : 0;
      const toothSpecific = PROCEDURES[procedureIds.indexOf(procedureId)][5];
      const treatmentId = insert('treatments', {
        patient_id: patientId,
        procedure_id: procedureId,
        appointment_id: appointmentId,
        dentist_id: dentistId,
        tooth: toothSpecific ? between(1, 4) * 10 + between(1, 8) : null,
        surfaces: toothSpecific ? pick(['', 'O', 'MO', 'MOD']) : '',
        status: 'completed',
        price_cents: price,
        discount_cents: discount,
        notes: '',
        planned_at: iso(day),
        completed_at: iso(day),
        invoiced: 1,
        created_at: day.toISOString(),
        updated_at: day.toISOString(),
      });

      const item = {
        treatment_id: treatmentId,
        procedure_id: procedureId,
        description: nameOf.get(procedureId),
        tooth: null,
        quantity: 1,
        unit_price_cents: price,
        discount_cents: discount,
        tax_rate_bp: 0,
        line_total_cents: lineTotal({ quantity: 1, unit_price_cents: price, discount_cents: discount }),
      };
      const totals = invoiceTotals([item], 0);
      const year = iso(day).slice(0, 4);
      const seq = q.get(
        `SELECT COUNT(*) AS n FROM invoices WHERE number LIKE ?`, `INV-${year}-%`).n + 1;

      const invoiceId = insert('invoices', {
        number: `INV-${year}-${String(seq).padStart(4, '0')}`,
        patient_id: patientId,
        issued_at: iso(day),
        due_at: iso(shift(dayOffset + 30)),
        status: 'issued',
        ...totals,
        notes: null,
        created_by: frontDesk,
        created_at: day.toISOString(),
        updated_at: day.toISOString(),
      });
      insert('invoice_items', { ...item, invoice_id: invoiceId, position: 0 });

      // 70% paid in full, 15% part-paid, 15% still outstanding.
      const roll = Math.random();
      if (roll < 0.70) {
        insert('payments', {
          patient_id: patientId,
          invoice_id: invoiceId,
          amount_cents: totals.total_cents,
          method: pick(['cash', 'card', 'card', 'transfer', 'insurance']),
          direction: 'in',
          reference: '',
          paid_at: iso(day),
          notes: '',
          created_by: frontDesk,
          created_at: day.toISOString(),
        });
        q.run(`UPDATE invoices SET status = 'paid' WHERE id = ?`, invoiceId);
      } else if (roll < 0.85) {
        const part = Math.round(totals.total_cents * 0.5);
        insert('payments', {
          patient_id: patientId,
          invoice_id: invoiceId,
          amount_cents: part,
          method: pick(['cash', 'card', 'transfer']),
          direction: 'in',
          reference: '',
          paid_at: iso(day),
          notes: 'Part payment',
          created_by: frontDesk,
          created_at: day.toISOString(),
        });
        q.run(`UPDATE invoices SET status = 'partial' WHERE id = ?`, invoiceId);
      }
    }
  }

  // ---- Planned (not yet done) treatment, so the plan view has content ---
  for (const patientId of patientIds.slice(0, 18)) {
    const count = between(1, 3);
    for (let i = 0; i < count; i += 1) {
      const procedureId = pick(procedureIds);
      insert('treatments', {
        patient_id: patientId,
        procedure_id: procedureId,
        appointment_id: null,
        dentist_id: pick(dentistIds),
        tooth: Math.random() < 0.6 ? between(1, 4) * 10 + between(1, 8) : null,
        surfaces: '',
        status: 'planned',
        price_cents: priceOf.get(procedureId),
        discount_cents: 0,
        notes: 'Discussed with the patient at the last visit.',
        planned_at: iso(shift(-between(1, 60))),
        completed_at: null,
        invoiced: 0,
        created_at: now(),
        updated_at: now(),
      });
    }
  }

  // ---- Expenses --------------------------------------------------------
  for (let monthsAgo = 4; monthsAgo >= 0; monthsAgo -= 1) {
    const base = new Date(today.getFullYear(), today.getMonth() - monthsAgo, 1);
    if (base > today) continue;
    for (const [category, description, vendor, amount] of EXPENSE_ITEMS) {
      const monthly = ['Rent', 'Salaries', 'Utilities'].includes(category);
      if (!monthly && Math.random() < 0.4) continue;
      const dayOfMonth = monthly ? between(1, 5) : between(1, 28);
      const spentAt = new Date(base.getFullYear(), base.getMonth(), dayOfMonth);
      if (spentAt > today) continue;
      insert('expenses', {
        category,
        description,
        vendor,
        amount_cents: Math.round(amount * (0.9 + Math.random() * 0.2)),
        method: pick(['transfer', 'card', 'cash']),
        reference: '',
        spent_at: iso(spentAt),
        notes: '',
        created_by: userIds[4],
        created_at: spentAt.toISOString(),
      });
    }
  }

  console.log(`[seed] ${patientIds.length} patients, ${appointmentCount} appointments`);
});

const counts = {
  users: q.get('SELECT COUNT(*) AS n FROM users').n,
  patients: q.get('SELECT COUNT(*) AS n FROM patients').n,
  appointments: q.get('SELECT COUNT(*) AS n FROM appointments').n,
  treatments: q.get('SELECT COUNT(*) AS n FROM treatments').n,
  invoices: q.get('SELECT COUNT(*) AS n FROM invoices').n,
  payments: q.get('SELECT COUNT(*) AS n FROM payments').n,
  expenses: q.get('SELECT COUNT(*) AS n FROM expenses').n,
};
console.log('[seed] done:', counts);
console.log('\nSign in with any of these (password: demo1234):');
for (const [name, email, role] of USERS) console.log(`  ${email.padEnd(26)} ${role.padEnd(13)} ${name}`);
console.log('');
closeDb();
