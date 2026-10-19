import { t } from '../i18n.js';
import { api } from '../api.js';
import {
  el, clear, money, fmtDate, age, table, can, modal, closeModal, field,
  input, select, onSubmit, toast, loading,
} from '../ui.js';

const filters = { q: '', archived: false, page: 1 };

export default async function patients(ctx) {
  const listHost = el('div');

  const search = input('q', {
    placeholder: t('Search by name, phone, email or file number…'),
    value: filters.q, autocomplete: 'off',
  });
  let timer = null;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { filters.q = search.value.trim(); filters.page = 1; load(); }, 250);
  });

  ctx.setTitle('Patients', 'Every patient file in the clinic',
    can('patients:write')
      ? el('button', {
        class: 'btn btn-primary', text: t('+ New patient'),
        onClick: () => patientDialog({ onSaved: () => load() }),
      })
      : null);

  const toolbar = el('div', { class: 'row', style: { marginBottom: '14px' } }, [
    el('div', { class: 'search-input', style: { flex: 1, minWidth: '240px' } }, search),
    el('button', {
      class: `chip ${filters.archived ? 'active' : ''}`,
      text: t('Archived'),
      onClick: (event) => {
        filters.archived = !filters.archived;
        filters.page = 1;
        event.target.classList.toggle('active', filters.archived);
        load();
      },
    }),
  ]);

  async function load() {
    clear(listHost).append(loading());
    const data = await api.patients({
      q: filters.q, archived: filters.archived ? 1 : 0, page: filters.page, limit: 50,
    });
    const pages = Math.max(1, Math.ceil(data.total / data.limit));

    clear(listHost).append(el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [
        el('h2', { text: data.total === 1 ? t('1 patient')
          : t('{n} patients', { n: data.total }) }),
        pages > 1
          ? el('div', { class: 'row tight' }, [
            el('button', { class: 'btn btn-sm', text: '‹', disabled: filters.page <= 1,
              onClick: () => { filters.page -= 1; load(); } }),
            el('span', { class: 'small faint', text: t('Page {page} of {pages}', { page: data.page, pages }) }),
            el('button', { class: 'btn btn-sm', text: '›', disabled: filters.page >= pages,
              onClick: () => { filters.page += 1; load(); } }),
          ])
          : null,
      ]),
      el('div', { class: 'card-body flush' }, table([
        { title: t('File'), render: (p) => el('span', { class: 'mono small' }, p.code) },
        { title: t('Name'), render: (p) => el('div', {}, [
          el('div', { class: 'strong' }, `${p.first_name} ${p.last_name}`),
          p.allergies
            ? el('span', { class: 'alert-chip small' }, `⚠ ${p.allergies}`)
            : el('span', { class: 'small faint' }, p.city || ''),
        ]) },
        { title: t('Age'), class: 'num', render: (p) => (age(p.dob) ?? '—') },
        { title: t('Phone'), render: (p) => p.phone || '—' },
        { title: t('Insurance'), render: (p) =>
          el('span', { class: 'small' }, p.insurance_provider || '—') },
        { title: t('Balance'), class: 'num', render: (p) => el('span', {
          class: 'strong',
          style: { color: p.balance_cents > 0 ? 'var(--danger)' : 'var(--text-muted)' },
        }, p.balance_cents > 0 ? money(p.balance_cents) : '—') },
        { title: t('Added'), class: 'num', render: (p) =>
          el('span', { class: 'small faint' }, fmtDate(p.created_at)) },
      ], data.patients, {
        onRowClick: (p) => ctx.navigate(`#/patients/${p.id}`),
        empty: filters.q ? 'No patient matches that search.' : 'No patients yet.',
      })),
    ]));
  }

  await load();
  return el('div', {}, [toolbar, listHost]);
}

/** Shared create/edit form — also used from the patient file header. */
export function patientDialog({ patient, onSaved }) {
  const editing = Boolean(patient);
  const form = el('form', {}, [
    el('div', { class: 'field-row' }, [
      field('First name', input('first_name', { required: true, value: patient?.first_name || '' })),
      field('Last name', input('last_name', { required: true, value: patient?.last_name || '' })),
    ]),
    el('div', { class: 'field-row-3' }, [
      field('Date of birth', input('dob', { type: 'date', value: patient?.dob || '' })),
      field('Gender', select('gender', [
        { value: '', label: '—' },
        { value: 'female', label: t('Female') },
        { value: 'male', label: t('Male') },
        { value: 'other', label: t('Other') },
      ], patient?.gender || '')),
      field('File number', input('code', {
        value: patient?.code || '', disabled: true, placeholder: t('auto'),
      })),
    ]),
    el('div', { class: 'field-row' }, [
      field('Phone', input('phone', { value: patient?.phone || '' })),
      field('Email', input('email', { type: 'email', value: patient?.email || '' })),
    ]),
    el('div', { class: 'field-row' }, [
      field('Address', input('address', { value: patient?.address || '' })),
      field('City', input('city', { value: patient?.city || '' })),
    ]),
    el('div', { class: 'field-row-3' }, [
      field('ID number', input('national_id', { value: patient?.national_id || '' })),
      field('Insurance', input('insurance_provider', { value: patient?.insurance_provider || '' })),
      field('Policy no.', input('insurance_number', { value: patient?.insurance_number || '' })),
    ]),
    field('Allergies', input('allergies', {
      value: patient?.allergies || '', placeholder: t('e.g. Penicillin, latex'),
    }), 'Shown as a warning wherever this patient appears.'),
    field('Medical notes', el('textarea', { name: 'medical_notes' }, patient?.medical_notes || '')),
    field('Referred by', input('referral_source', { value: patient?.referral_source || '' })),
  ]);

  onSubmit(form, async (data) => {
    delete data.code;
    const saved = editing
      ? await api.updatePatient(patient.id, data)
      : await api.createPatient(data);
    closeModal();
    toast(editing ? 'Patient updated' : `Patient created (${saved.patient.code})`, 'success');
    if (onSaved) await onSaved(saved.patient);
  });

  modal({
    title: editing ? 'Edit patient' : 'New patient',
    body: form,
    width: 'wide',
    footer: [
      el('button', { class: 'btn', text: t('Cancel'), onClick: () => closeModal() }),
      el('button', { class: 'btn btn-primary', text: editing ? 'Save changes' : 'Create patient',
        onClick: () => form.requestSubmit() }),
    ],
  });
}
