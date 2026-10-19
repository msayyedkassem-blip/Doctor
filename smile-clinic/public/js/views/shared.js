import { t } from '../i18n.js';
/** Dialogs reused across the schedule, the patient file and billing. */
import { api } from '../api.js';
import {
  state, el, field, input, select, modal, closeModal, onSubmit, toast, money, can,
  todayISO, APPOINTMENT_STATUSES, PAYMENT_METHODS, TOOTH_CONDITIONS,
} from '../ui.js';

export const dentistOptions = () => state.users
  .filter((u) => ['dentist', 'admin'].includes(u.role))
  .map((u) => ({ value: u.id, label: u.name }));

export const procedureOptions = (includeBlank = true) => [
  ...(includeBlank ? [{ value: '', label: t('— none —') }] : []),
  ...state.procedures.map((p) => ({
    value: p.id,
    label: `${p.code} · ${p.name} · ${money(p.default_price_cents)}`,
  })),
];

export const operatoryOptions = () => (state.settings.operatories || 'Chair 1')
  .split(',').map((c) => ({ value: c.trim(), label: c.trim() }));

/**
 * Async patient search box. Calls `onPick(patient)` when one is chosen.
 * Used wherever a screen needs to attach something to a patient.
 */
export function patientPicker({ value, onPick, placeholder = 'Search name, phone or file number…' }) {
  const box = el('div', { style: { position: 'relative' } });
  const search = input('patient_search', { placeholder, autocomplete: 'off' });
  const hidden = el('input', { type: 'hidden', name: 'patient_id', value: value?.id || '' });
  const results = el('div', {
    class: 'card',
    style: { position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30,
      marginTop: '4px', display: 'none', maxHeight: '260px', overflowY: 'auto' },
  });

  if (value) search.value = `${value.first_name} ${value.last_name} (${value.code})`;

  let timer = null;
  search.addEventListener('input', () => {
    hidden.value = '';
    clearTimeout(timer);
    const term = search.value.trim();
    if (term.length < 2) { results.style.display = 'none'; return; }
    timer = setTimeout(async () => {
      const { patients } = await api.patients({ q: term, limit: 8 });
      results.replaceChildren();
      if (!patients.length) {
        results.append(el('div', { class: 'card-body small faint', text: t('No matching patient') }));
      }
      for (const p of patients) {
        results.append(el('button', {
          type: 'button',
          class: 'nav-item',
          style: { borderRadius: 0 },
          onClick: () => {
            hidden.value = p.id;
            search.value = `${p.first_name} ${p.last_name} (${p.code})`;
            results.style.display = 'none';
            if (onPick) onPick(p);
          },
        }, [
          el('span', {}, `${p.first_name} ${p.last_name}`),
          el('span', { class: 'right small faint', text: p.code }),
        ]));
      }
      results.style.display = 'block';
    }, 220);
  });
  search.addEventListener('blur', () => setTimeout(() => { results.style.display = 'none'; }, 180));

  box.append(search, hidden, results);
  return box;
}

/** Create or edit an appointment. `preset` seeds the form from a calendar click. */
export function appointmentDialog({ appointment, preset = {}, patient, onSaved }) {
  const editing = Boolean(appointment);
  const start = appointment?.starts_at || preset.starts_at || `${todayISO()}T09:00`;
  const duration = appointment
    ? minutesBetween(appointment.starts_at, appointment.ends_at)
    : (preset.duration_min || 30);

  const fixedPatient = patient || (appointment
    ? { id: appointment.patient_id, first_name: appointment.patient_name?.split(' ')[0] || '',
      last_name: appointment.patient_name?.split(' ').slice(1).join(' ') || '',
      code: appointment.patient_code }
    : null);

  const durationInput = input('duration_min', { type: 'number', min: 5, step: 5, value: duration });
  const procedureSelect = select('procedure_id', procedureOptions(), appointment?.procedure_id || preset.procedure_id || '');
  procedureSelect.addEventListener('change', () => {
    const chosen = state.procedures.find((p) => String(p.id) === procedureSelect.value);
    if (chosen) durationInput.value = chosen.default_duration_min;
  });

  const form = el('form', {}, [
    fixedPatient && (editing || patient)
      ? field('Patient', el('div', { class: 'card', style: { padding: '9px 12px' } }, [
        el('span', { class: 'strong', text: `${fixedPatient.first_name} ${fixedPatient.last_name}` }),
        el('span', { class: 'small faint', text: ` · ${fixedPatient.code || ''}` }),
        el('input', { type: 'hidden', name: 'patient_id', value: fixedPatient.id }),
      ]))
      : field('Patient', patientPicker({})),
    el('div', { class: 'field-row' }, [
      field('Practitioner', select('dentist_id', dentistOptions(),
        appointment?.dentist_id || preset.dentist_id || state.users.find((u) => u.role === 'dentist')?.id)),
      field('Chair', select('operatory', operatoryOptions(),
        appointment?.operatory || preset.operatory)),
    ]),
    field('Procedure', procedureSelect),
    el('div', { class: 'field-row-3' }, [
      field('Date', input('date', { type: 'date', value: start.slice(0, 10), required: true })),
      field('Time', input('time', { type: 'time', value: start.slice(11, 16), required: true })),
      field('Minutes', durationInput),
    ]),
    field('Reason', input('reason', { value: appointment?.reason || '', maxlength: 300,
      placeholder: t('e.g. Upper right molar pain') })),
    editing ? field('Status', select('status', APPOINTMENT_STATUSES, appointment.status)) : null,
    field('Notes', el('textarea', { name: 'notes' }, appointment?.notes || '')),
  ]);

  const submit = el('button', { class: 'btn btn-primary', type: 'submit',
    text: editing ? 'Save changes' : 'Book appointment' });
  form.append(el('div', { style: { display: 'none' } }, submit));

  onSubmit(form, async (data) => {
    if (!data.patient_id) throw new Error('Please choose a patient');
    const body = {
      patient_id: Number(data.patient_id),
      dentist_id: Number(data.dentist_id),
      procedure_id: data.procedure_id ? Number(data.procedure_id) : null,
      starts_at: `${data.date}T${data.time}`,
      duration_min: Number(data.duration_min) || 30,
      operatory: data.operatory,
      reason: data.reason,
      notes: data.notes,
      status: data.status || undefined,
    };
    try {
      if (editing) await api.updateAppointment(appointment.id, body);
      else await api.createAppointment(body);
    } catch (err) {
      // A clash is a question, not a dead end: offer to book anyway.
      if (err.status === 409) {
        return overrideClash(err.message, async () => {
          if (editing) await api.updateAppointment(appointment.id, { ...body, force: '1' });
          else await api.createAppointment({ ...body, force: '1' });
          closeModal();
          toast(t('Appointment booked (double-booked)'), 'success');
          if (onSaved) await onSaved();
        });
      }
      throw err;
    }
    closeModal();
    toast(editing ? 'Appointment updated' : 'Appointment booked', 'success');
    if (onSaved) await onSaved();
  });

  modal({
    title: editing ? 'Edit appointment' : 'New appointment',
    body: form,
    footer: [
      editing && can('appointments:delete')
        ? el('button', {
          class: 'btn btn-danger', text: t('Delete'),
          onClick: async () => {
            await api.deleteAppointment(appointment.id);
            closeModal();
            toast(t('Appointment deleted'));
            if (onSaved) await onSaved();
          },
        })
        : null,
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn', text: t('Cancel'), onClick: () => closeModal() }),
      el('button', {
        class: 'btn btn-primary',
        text: editing ? 'Save changes' : 'Book appointment',
        onClick: () => form.requestSubmit(submit),
      }),
    ],
  });
}

function overrideClash(message, onForce) {
  const backdropBody = el('div', {}, [
    el('p', { text: message }),
    el('p', { class: 'small faint', text: t('You can book it anyway if this is intentional.') }),
  ]);
  modal({
    title: t('That time is taken'),
    body: backdropBody,
    footer: [
      el('button', { class: 'btn', text: t('Pick another time'), onClick: () => closeModal() }),
      el('button', { class: 'btn btn-primary', text: t('Book anyway'), onClick: onForce }),
    ],
  });
}

/** Record a payment (or a refund) against an invoice or straight to an account. */
export function paymentDialog({ invoice, patient, onSaved }) {
  const owing = invoice ? invoice.total_cents - (invoice.paid_cents || 0) : 0;
  const form = el('form', {}, [
    invoice
      ? field('Invoice', el('div', { class: 'card', style: { padding: '9px 12px' } }, [
        el('span', { class: 'mono', text: invoice.number }),
        el('span', { class: 'right strong', text: t('{amount} due', { amount: money(owing) }) }),
      ]))
      : field('Patient', patient
        ? el('div', { class: 'card', style: { padding: '9px 12px' } }, [
          el('span', { text: `${patient.first_name} ${patient.last_name}` }),
          el('input', { type: 'hidden', name: 'patient_id', value: patient.id }),
        ])
        : patientPicker({})),
    el('div', { class: 'field-row' }, [
      field('Amount', input('amount', {
        type: 'number', step: '0.01', min: '0.01', required: true,
        value: owing > 0 ? (owing / 100).toFixed(2) : '',
      })),
      field('Method', select('method', PAYMENT_METHODS, 'cash')),
    ]),
    el('div', { class: 'field-row' }, [
      field('Date', input('paid_at', { type: 'date', value: todayISO(), required: true })),
      field('Reference', input('reference', { placeholder: t('Receipt or transaction no.') })),
    ]),
    invoice ? field('Type', select('direction', [
      { value: 'in', label: t('Payment received') },
      { value: 'refund', label: t('Refund to patient') },
    ], 'in')) : null,
    field('Notes', input('notes', { maxlength: 300 })),
  ]);

  onSubmit(form, async (data) => {
    await api.createPayment({
      invoice_id: invoice?.id,
      patient_id: data.patient_id ? Number(data.patient_id) : undefined,
      amount: Number(data.amount),
      method: data.method,
      direction: data.direction || 'in',
      paid_at: data.paid_at,
      reference: data.reference,
      notes: data.notes,
    });
    closeModal();
    toast(t('Payment recorded'), 'success');
    if (onSaved) await onSaved();
  });

  modal({
    title: t('Record payment'),
    body: form,
    footer: [
      el('button', { class: 'btn', text: t('Cancel'), onClick: () => closeModal() }),
      el('button', { class: 'btn btn-primary', text: t('Save payment'),
        onClick: () => form.requestSubmit() }),
    ],
  });
}

/** Add or edit a planned/completed treatment on a patient's chart. */
export function treatmentDialog({ patientId, treatment, tooth, onSaved }) {
  const editing = Boolean(treatment);
  const priceInput = input('price', {
    type: 'number', step: '0.01', min: '0',
    value: treatment ? (treatment.price_cents / 100).toFixed(2) : '',
  });
  const procedureSelect = select('procedure_id', procedureOptions(false),
    treatment?.procedure_id || state.procedures[0]?.id);
  const syncPrice = () => {
    const chosen = state.procedures.find((p) => String(p.id) === procedureSelect.value);
    if (chosen) priceInput.value = (chosen.default_price_cents / 100).toFixed(2);
  };
  procedureSelect.addEventListener('change', syncPrice);
  if (!editing) syncPrice();

  const form = el('form', {}, [
    field('Procedure', procedureSelect),
    el('div', { class: 'field-row-3' }, [
      field('Tooth (FDI)', input('tooth', {
        type: 'number', min: 11, max: 85,
        value: treatment?.tooth ?? tooth ?? '', placeholder: 'e.g. 16',
      })),
      field('Surfaces', input('surfaces', {
        value: treatment?.surfaces || '', placeholder: t('MOD'), maxlength: 8,
      })),
      field('Status', select('status', [
        { value: 'planned', label: t('Planned') },
        { value: 'in_progress', label: t('In progress') },
        { value: 'completed', label: t('Completed') },
        { value: 'cancelled', label: t('Cancelled') },
      ], treatment?.status || 'planned')),
    ]),
    el('div', { class: 'field-row-3' }, [
      field('Price', priceInput),
      field('Discount', input('discount', {
        type: 'number', step: '0.01', min: '0',
        value: treatment ? (treatment.discount_cents / 100).toFixed(2) : '0.00',
      })),
      field('Practitioner', select('dentist_id', dentistOptions(),
        treatment?.dentist_id || state.user.id)),
    ]),
    field('Notes', el('textarea', { name: 'notes' }, treatment?.notes || '')),
  ]);

  onSubmit(form, async (data) => {
    const body = {
      patient_id: patientId,
      procedure_id: Number(data.procedure_id),
      tooth: data.tooth ? Number(data.tooth) : null,
      surfaces: data.surfaces,
      status: data.status,
      price: Number(data.price),
      discount: Number(data.discount || 0),
      dentist_id: Number(data.dentist_id),
      notes: data.notes,
    };
    if (editing) await api.updateTreatment(treatment.id, body);
    else await api.createTreatment(body);
    closeModal();
    toast(editing ? 'Treatment updated' : 'Treatment added', 'success');
    if (onSaved) await onSaved();
  });

  modal({
    title: editing ? 'Edit treatment' : 'Add treatment',
    body: form,
    footer: [
      el('button', { class: 'btn', text: t('Cancel'), onClick: () => closeModal() }),
      el('button', { class: 'btn btn-primary', text: t('Save'), onClick: () => form.requestSubmit() }),
    ],
  });
}

/** Set the condition recorded on one tooth. */
export function toothDialog({ patientId, tooth, current, onSaved }) {
  const form = el('form', {}, [
    field('Condition', select('condition', TOOTH_CONDITIONS, current?.condition || 'healthy')),
    field('Surfaces', input('surfaces', {
      value: current?.surfaces || '', placeholder: 'M, O, D, B, L', maxlength: 8,
    }), 'Mesial, Occlusal, Distal, Buccal, Lingual — e.g. MOD'),
    field('Note', input('note', { value: current?.note || '', maxlength: 300 })),
  ]);

  onSubmit(form, async (data) => {
    await api.setTooth(patientId, tooth, data);
    closeModal();
    if (onSaved) await onSaved();
  });

  modal({
    title: t('Tooth {n}', { n: tooth }),
    body: form,
    footer: [
      el('button', { class: 'btn', text: t('Cancel'), onClick: () => closeModal() }),
      el('button', { class: 'btn btn-primary', text: t('Save'), onClick: () => form.requestSubmit() }),
      el('div', { class: 'spacer' }),
      el('button', {
        class: 'btn btn-sm', text: t('Add treatment'),
        onClick: () => { closeModal(); treatmentDialog({ patientId, tooth, onSaved }); },
      }),
    ],
  });
}

export function minutesBetween(start, end) {
  const toMinutes = (s) => Number(s.slice(11, 13)) * 60 + Number(s.slice(14, 16));
  const days = (Date.parse(`${end.slice(0, 10)}T00:00:00Z`) -
    Date.parse(`${start.slice(0, 10)}T00:00:00Z`)) / 86400000;
  return toMinutes(end) - toMinutes(start) + days * 1440;
}
