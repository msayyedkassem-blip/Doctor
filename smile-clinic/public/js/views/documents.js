/**
 * The two pieces of paper a dental patient leaves with: a prescription, and
 * their record.
 *
 * Both are printed by the browser rather than built into a PDF here. That is
 * not a shortcut — it is the only way the same code produces a file on a Mac,
 * on Windows and inside the phone, with no library to install and nothing to
 * keep up to date. Every browser's print dialogue offers "Save as PDF", which
 * is what the clinic actually wants.
 */
import { api } from '../api.js';
import {
  state, el, clear, money, table, modal, closeModal, field, input, select,
  toast, can, fmtDate, fmtDateTime, age, loading, confirmDialog,
  TOOTH_CONDITIONS, methodLabel,
} from '../ui.js';
import { t, isRTL } from '../i18n.js';
import { toothDrawing } from './tooth.js';

const clinic = () => state.settings || {};

/** The block at the top of anything the clinic hands over. */
function letterhead(title, subtitle) {
  const s = clinic();
  return el('div', { class: 'doc-head' }, [
    el('div', {}, [
      el('div', { class: 'doc-clinic', text: s.clinic_name || 'Smile Clinic' }),
      el('div', { class: 'doc-contact' }, [
        s.clinic_address, s.clinic_phone, s.clinic_email,
      ].filter(Boolean).join(' · ')),
      s.clinic_tax_id
        ? el('div', { class: 'doc-contact', text: `${t('Tax / registration number')}: ${s.clinic_tax_id}` })
        : null,
    ]),
    el('div', { class: 'doc-title' }, [
      el('div', { class: 'strong', text: title }),
      subtitle ? el('div', { class: 'doc-contact', text: subtitle }) : null,
    ]),
  ]);
}

const patientLine = (p) => [
  `${p.first_name} ${p.last_name}`,
  p.code,
  p.date_of_birth ? `${age(p.date_of_birth)} ${t('yrs')}` : null,
  p.phone,
].filter(Boolean).join(' · ');

// ---------------------------------------------------------------- prescribing

/**
 * Writing a prescription.
 *
 * Choosing a medicine fills the dose, frequency and duration from the clinic's
 * list, and every one of them stays editable — a list is a starting point, not
 * a decision. Whatever is on screen at the moment it is saved is what is
 * stored, so the paper and the record can never drift apart.
 */
export async function prescribeDialog(patient, onSaved) {
  const { medicines } = await api.medicines();
  const lines = [];
  const list = el('div', { class: 'stack' });
  const notes = input('notes', { placeholder: t('Anything else the patient should know') });

  const allergyWarning = patient.allergies
    ? el('p', { class: 'alert-chip', text: `⚠ ${t('Allergies: {list}', { list: patient.allergies })}` })
    : null;

  const addLine = (medicine) => {
    const row = {
      medicine_id: medicine?.id || null,
      name: medicine?.name || '',
      form: medicine?.form || '',
      strength: medicine?.strength || '',
    };
    const name = input('name', { value: medicine
      ? [medicine.name, medicine.strength].filter(Boolean).join(' ') : '', required: true });
    const dose = input('dose', { value: medicine?.dose || '', placeholder: t('1 tablet') });
    const frequency = input('frequency', { value: medicine?.frequency || '',
      placeholder: t('3 times a day') });
    const duration = input('duration', { value: medicine?.duration || '',
      placeholder: t('5 days') });
    const instructions = input('instructions', { value: medicine?.instructions || '',
      placeholder: t('After food') });

    const card = el('div', { class: 'card' }, [
      el('div', { class: 'card-body' }, [
        medicine?.caution
          ? el('p', { class: 'alert-chip', text: `⚠ ${t(medicine.caution)}` })
          : null,
        field('Medicine', name),
        el('div', { class: 'field-row-3' }, [
          field('Dose', dose),
          field('How often', frequency),
          field('For how long', duration),
        ]),
        field('Instructions', instructions),
        el('div', { class: 'row' }, [
          el('button', {
            class: 'btn btn-sm btn-danger right', type: 'button', text: t('Remove'),
            onClick: () => {
              lines.splice(lines.indexOf(entry), 1);
              card.remove();
            },
          }),
        ]),
      ]),
    ]);

    const entry = {
      card,
      read: () => ({
        ...row,
        name: name.value,
        dose: dose.value,
        frequency: frequency.value,
        duration: duration.value,
        instructions: instructions.value,
      }),
    };
    lines.push(entry);
    list.append(card);
  };

  const picker = select('medicine',
    [{ value: '', label: t('Choose from the clinic list…') }]
      .concat(medicines.map((m) => ({
        value: String(m.id),
        label: [m.name, m.strength].filter(Boolean).join(' ')
          + (m.category ? ` — ${t(m.category)}` : ''),
      }))),
    '');
  picker.addEventListener('change', () => {
    const chosen = medicines.find((m) => String(m.id) === picker.value);
    if (chosen) addLine(chosen);
    picker.value = '';
  });

  modal({
    title: t('Prescription for {name}', { name: `${patient.first_name} ${patient.last_name}` }),
    width: 'xwide',
    body: el('div', { class: 'stack' }, [
      allergyWarning,
      medicines.length
        ? field('Add a medicine', picker)
        : el('p', { class: 'small muted', text: t('The clinic medicine list is empty. '
          + 'An administrator can fill it from Settings → Medicines.') }),
      el('div', { class: 'row' }, [
        el('button', {
          class: 'btn btn-sm', type: 'button', text: t('+ Write one by hand'),
          onClick: () => addLine(null),
        }),
      ]),
      list,
      field('Notes', notes),
    ]),
    footer: [
      el('button', { class: 'btn', text: t('Cancel'), onClick: () => closeModal() }),
      el('button', {
        class: 'btn btn-primary',
        text: t('Save and print'),
        onClick: async (event) => {
          const items = lines.map((l) => l.read()).filter((l) => l.name.trim());
          if (!items.length) return toast(t('Add at least one medicine'), 'error');
          event.target.disabled = true;
          try {
            await api.addPrescription(patient.id, { items, notes: notes.value });
            closeModal();
            toast(t('Prescription saved'), 'success');
            await onSaved();
            // Straight to the paper: the patient is still in the chair.
            const { prescriptions } = await api.prescriptions(patient.id);
            if (prescriptions[0]) printPrescription(patient, prescriptions[0]);
          } catch (err) {
            event.target.disabled = false;
            toast(t(err.message), 'error');
          }
        },
      }),
    ],
  });
}

/** The prescription as the patient and the pharmacy will read it. */
export function printPrescription(patient, prescription) {
  modal({
    title: t('Prescription'),
    width: 'xwide',
    body: el('div', { class: 'doc' }, [
      letterhead(t('Prescription'), fmtDate(prescription.issued_on)),
      el('div', { class: 'doc-patient' }, [
        el('div', {}, [el('span', { class: 'doc-label', text: `${t('Patient')}: ` }),
          el('span', { class: 'strong' }, patientLine(patient))]),
        patient.allergies
          ? el('div', { class: 'doc-allergy',
            text: `⚠ ${t('Allergies: {list}', { list: patient.allergies })}` })
          : null,
      ]),
      el('ol', { class: 'doc-rx' }, prescription.items.map((item) => el('li', {}, [
        el('div', { class: 'strong', text: item.name }),
        el('div', { class: 'doc-sig', text: [
          item.dose, item.frequency, item.duration,
        ].filter(Boolean).join(' · ') }),
        item.instructions ? el('div', { class: 'doc-sig', text: item.instructions }) : null,
      ]))),
      prescription.notes ? el('p', { class: 'doc-notes', text: prescription.notes }) : null,
      el('div', { class: 'doc-sign' }, [
        el('div', {}, [
          el('div', { class: 'doc-label', text: t('Prescribed by') }),
          el('div', { class: 'strong', text: prescription.prescriber || state.user?.name || '' }),
        ]),
        el('div', { class: 'doc-signature' }, [
          el('div', { class: 'doc-rule' }),
          el('div', { class: 'doc-label', text: t('Signature and stamp') }),
        ]),
      ]),
    ]),
    footer: [
      el('button', { class: 'btn btn-primary', text: t('🖶 Print or save as PDF'),
        onClick: () => window.print() }),
      el('button', { class: 'btn', text: t('Close'), onClick: () => closeModal() }),
    ],
  });
}

// ------------------------------------------------------------- patient record

/**
 * Everything on one patient, as a document.
 *
 * Deliberately the whole file rather than a summary: this is what gets handed
 * to the patient when they move clinic, to a specialist on referral, or to an
 * insurer, and leaving something out of any of those is worse than printing a
 * page too many.
 */
export async function printRecord(patientId) {
  const host = el('div', { class: 'doc' }, [loading()]);
  modal({
    title: t('Patient record'),
    width: 'xwide',
    body: host,
    footer: [
      el('button', { class: 'btn btn-primary', text: t('🖶 Print or save as PDF'),
        onClick: () => window.print() }),
      el('button', { class: 'btn', text: t('Close'), onClick: () => closeModal() }),
    ],
  });

  const [data, images, scripts] = await Promise.all([
    api.patientSummary(patientId),
    api.attachments(patientId).catch(() => ({ attachments: [] })),
    api.prescriptions(patientId).catch(() => ({ prescriptions: [] })),
  ]);

  const p = data.patient;
  const charted = (data.chart || []).filter((row) => row.condition !== 'healthy');
  const conditionLabel = (value) =>
    t(TOOTH_CONDITIONS.find((c) => c.value === value)?.label || value);

  const section = (title, body, count) => el('section', { class: 'doc-section' }, [
    el('h3', {}, count === undefined ? title : `${title} (${count})`),
    body,
  ]);

  clear(host).append(
    letterhead(t('Patient record'), t('Printed {date}', { date: fmtDate(new Date().toISOString()) })),

    el('div', { class: 'doc-patient' }, [
      el('div', { class: 'doc-grid' }, [
        pair(t('Name'), `${p.first_name} ${p.last_name}`),
        pair(t('File number'), p.code),
        pair(t('Date of birth'), p.date_of_birth
          ? `${fmtDate(p.date_of_birth)} (${age(p.date_of_birth)} ${t('yrs')})` : '—'),
        pair(t('Gender'), p.gender ? t(p.gender) : '—'),
        pair(t('Phone'), p.phone || '—'),
        pair(t('Email'), p.email || '—'),
        pair(t('Address'), [p.address, p.city].filter(Boolean).join(', ') || '—'),
        pair(t('ID number'), p.id_number || '—'),
        pair(t('Insurance'), [p.insurance, p.insurance_number].filter(Boolean).join(' · ') || '—'),
        pair(t('Patient since'), fmtDate(p.created_at)),
      ]),
      p.allergies
        ? el('div', { class: 'doc-allergy',
          text: `⚠ ${t('Allergies: {list}', { list: p.allergies })}` })
        : null,
      p.medical_notes
        ? el('div', { class: 'doc-notes' }, [
          el('span', { class: 'doc-label', text: `${t('Medical notes')}: ` }),
          el('span', {}, p.medical_notes),
        ])
        : null,
    ]),

    // The chart as a drawing, not a list of numbers: it is the one part of a
    // dental record that a dentist reads at a glance.
    section(t('Odontogram'), el('div', {}, [
      el('div', { class: 'doc-arches' }, [
        el('div', { class: 'doc-arch' }, archRow([18, 17, 16, 15, 14, 13, 12, 11], charted)
          .concat(archRow([21, 22, 23, 24, 25, 26, 27, 28], charted))),
        el('div', { class: 'doc-arch' }, archRow([48, 47, 46, 45, 44, 43, 42, 41], charted)
          .concat(archRow([31, 32, 33, 34, 35, 36, 37, 38], charted))),
      ]),
      charted.length
        ? table([
          { title: t('Tooth'), render: (row) => String(row.tooth) },
          { title: t('Condition'), render: (row) => conditionLabel(row.condition) },
          { title: t('Surfaces'), render: (row) => row.surfaces || '—' },
          { title: t('Note'), render: (row) => row.note || '—' },
          { title: t('Updated'), render: (row) => fmtDate(row.updated_at) },
        ], charted.slice().sort((a, b) => a.tooth - b.tooth))
        : el('p', { class: 'doc-empty', text: t('Nothing charted.') }),
    ])),

    section(t('Treatments'), (data.treatments || []).length
      ? table([
        { title: t('Date'), render: (row) => fmtDate(row.performed_on || row.created_at) },
        { title: t('Procedure'), render: (row) => row.procedure_name || '—' },
        { title: t('Tooth'), render: (row) => (row.tooth ? String(row.tooth) : '—') },
        { title: t('By'), render: (row) => row.dentist_name || '—' },
        { title: t('Status'), render: (row) => t(row.status) },
        { title: t('Fee'), class: 'num', render: (row) => money(row.price_cents) },
      ], data.treatments)
      : el('p', { class: 'doc-empty', text: t('No treatments recorded.') }),
    (data.treatments || []).length),

    section(t('Visits'), (data.appointments || []).length
      ? table([
        { title: t('When'), render: (row) => fmtDateTime(row.starts_at) },
        { title: t('With'), render: (row) => row.dentist_name || '—' },
        { title: t('Reason'), render: (row) => row.reason || row.procedure_name || '—' },
        { title: t('Status'), render: (row) => t(row.status) },
      ], data.appointments)
      : el('p', { class: 'doc-empty', text: t('No visits recorded.') }),
    (data.appointments || []).length),

    section(t('Prescriptions'), scripts.prescriptions.length
      ? el('div', { class: 'stack' }, scripts.prescriptions.map((rx) => el('div', { class: 'doc-rx-block' }, [
        el('div', { class: 'doc-label' },
          `${fmtDate(rx.issued_on)} · ${rx.prescriber || ''}`),
        el('ol', { class: 'doc-rx' }, rx.items.map((item) => el('li', {}, [
          el('span', { class: 'strong', text: item.name }),
          el('span', { class: 'doc-sig', text: ` ${[item.dose, item.frequency, item.duration]
            .filter(Boolean).join(' · ')}` }),
        ]))),
      ])))
      : el('p', { class: 'doc-empty', text: t('None prescribed.') }),
    scripts.prescriptions.length),

    section(t('X-rays and photos'), images.attachments.length
      ? el('div', { class: 'doc-images' }, images.attachments.map((item) => el('figure', {}, [
        item.thumb
          ? el('img', { src: `data:image/jpeg;base64,${item.thumb}`, alt: item.caption || '' })
          : null,
        el('figcaption', { text: [
          t(item.kind === 'xray' ? 'X-ray' : 'Photo'),
          item.tooth ? t('Tooth {n}', { n: item.tooth }) : null,
          fmtDate(item.taken_on || item.created_at),
          item.caption,
        ].filter(Boolean).join(' · ') }),
      ])))
      : el('p', { class: 'doc-empty', text: t('No images.') }),
    images.attachments.length),

    section(t('Billing'), (data.invoices || []).length
      ? el('div', {}, [
        table([
          { title: t('Invoice'), render: (row) => row.number },
          { title: t('Issued'), render: (row) => fmtDate(row.issued_at) },
          { title: t('Status'), render: (row) => t(row.status) },
          { title: t('Total'), class: 'num', render: (row) => money(row.total_cents) },
          { title: t('Paid'), class: 'num', render: (row) => money(row.paid_cents || 0) },
        ], data.invoices),
        el('div', { class: 'doc-total' }, [
          el('span', { text: t('Outstanding balance {amount}',
            { amount: money(p.balance_cents || 0) }) }),
        ]),
      ])
      : el('p', { class: 'doc-empty', text: t('No invoices.') }),
    (data.invoices || []).length),

    (data.payments || []).length
      ? section(t('Payments'), table([
        { title: t('Date'), render: (row) => fmtDate(row.paid_at || row.created_at) },
        { title: t('Method'), render: (row) => methodLabel(row.method) },
        { title: t('Reference'), render: (row) => row.reference || '—' },
        { title: t('Amount'), class: 'num', render: (row) => money(row.amount_cents) },
      ], data.payments), data.payments.length)
      : null,

    el('p', { class: 'doc-foot', text: t('{clinic} · printed {date} · this record is '
      + 'confidential and intended only for the patient named above.',
    { clinic: clinic().clinic_name || 'Smile Clinic', date: fmtDate(new Date().toISOString()) }) }),
  );
}

const pair = (label, value) => el('div', { class: 'doc-pair' }, [
  el('span', { class: 'doc-label', text: label }),
  el('span', { text: String(value ?? '—') }),
]);

/** A row of teeth with their numbers, small enough for paper. */
function archRow(numbers, charted) {
  const byTooth = new Map(charted.map((row) => [row.tooth, row]));
  // Printed left to right as the page runs, which in Arabic is the other way.
  const order = isRTL() ? [...numbers].reverse() : numbers;
  return order.map((number) => {
    const entry = byTooth.get(number);
    return el('div', { class: 'doc-tooth', dataset: { condition: entry?.condition || 'healthy' } }, [
      toothDrawing(number, entry?.condition || 'healthy', { surfaces: entry?.surfaces || '' }),
      el('div', { class: 'doc-tooth-num', text: String(number) }),
    ]);
  });
}

// --------------------------------------------------------------- patient tab

/** The patient file's own list of prescriptions, with the button to write one. */
export async function prescriptionsCard(patient, rerender) {
  const { prescriptions } = await api.prescriptions(patient.id);
  const editable = can('clinical:write');

  return el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', { text: t('Prescriptions') }),
      editable
        ? el('button', {
          class: 'btn btn-primary btn-sm', text: t('+ Write a prescription'),
          onClick: () => prescribeDialog(patient, rerender),
        })
        : null,
    ]),
    el('div', { class: 'card-body flush' }, table([
      { title: t('Date'), class: 'nowrap', render: (rx) => fmtDate(rx.issued_on) },
      { title: t('Medicines'), render: (rx) => el('div', {}, rx.items.map((item) =>
        el('div', { class: 'small' }, `${item.name} — ${[item.dose, item.frequency, item.duration]
          .filter(Boolean).join(' · ')}`))) },
      { title: t('Prescribed by'), render: (rx) => rx.prescriber || '—' },
      { title: '', class: 'num', render: (rx) => el('div', { class: 'row' }, [
        el('button', {
          class: 'btn btn-sm', text: t('🖶 Print'),
          onClick: (event) => { event.stopPropagation(); printPrescription(patient, rx); },
        }),
        editable
          ? el('button', {
            class: 'btn btn-sm btn-danger', text: t('Delete'),
            onClick: (event) => {
              event.stopPropagation();
              confirmDialog({
                title: t('Delete this prescription?'),
                message: t('It is removed from the record on every device.'),
                confirmLabel: t('Delete'),
                danger: true,
                onConfirm: async () => {
                  await api.deletePrescription(rx.id);
                  toast(t('Prescription deleted'));
                  await rerender();
                },
              });
            },
          })
          : null,
      ]) },
    ], prescriptions, { empty: t('Nothing prescribed yet.') })),
  ]);
}
