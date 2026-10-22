import { api } from '../api.js';
import {
  state, el, clear, money, table, can, modal, closeModal, field, input, select, onSubmit,
  toast, loading, avatar, confirmDialog,
} from '../ui.js';
import { refreshLookups } from '../app.js';
import { isLocalMode, describeMode } from '../mode.js';
import { fmtDate, fmtDateTime } from '../ui.js';
import { t, LANGUAGES, currentLanguage, setLanguage } from '../i18n.js';

let tab = 'clinic';

export default async function settings(ctx) {
  const host = el('div');
  ctx.setTitle('Settings', 'Clinic details, price list and staff accounts');

  const TABS = [
    { id: 'clinic', label: t('Clinic') },
    { id: 'procedures', label: t('Price list') },
    { id: 'medicines', label: t('Medicines'), permission: 'clinical:read' },
    { id: 'messages', label: t('WhatsApp'), permission: 'messages:read' },
    { id: 'sync', label: t('Devices'), permission: 'sync:manage' },
    { id: 'users', label: t('Staff'), permission: 'users:read' },
  ].filter((item) => !item.permission || can(item.permission));

  if (!TABS.some((item) => item.id === tab)) tab = 'clinic';

  const tabs = el('div', { class: 'tabs' }, TABS.map((item) => el('button', {
    class: `tab ${item.id === tab ? 'active' : ''}`,
    text: item.label,
    onClick: (event) => {
      tab = item.id;
      for (const node of tabs.children) node.classList.remove('active');
      event.target.classList.add('active');
      load();
    },
  })));

  async function load() {
    clear(host).append(loading());
    const render = { clinic: clinicTab, procedures: proceduresTab, medicines: medicinesTab,
      messages: messagesTab, sync: syncTab, users: usersTab }[tab];
    clear(host).append(await render(load));
  }

  await load();
  return el('div', {}, [tabs, host]);
}

// ---------- Clinic -------------------------------------------------------
async function clinicTab() {
  const { settings: s } = await api.settings();
  const editable = can('settings:write');

  const form = el('form', {}, [
    el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [el('h2', { text: t('Clinic details') })]),
      el('div', { class: 'card-body' }, [
        field('Clinic name', input('clinic_name', { value: s.clinic_name, disabled: !editable })),
        el('div', { class: 'field-row' }, [
          field('Phone', input('clinic_phone', { value: s.clinic_phone, disabled: !editable })),
          field('Email', input('clinic_email', { value: s.clinic_email, disabled: !editable })),
        ]),
        field('Address', input('clinic_address', { value: s.clinic_address, disabled: !editable })),
        field('Tax / registration number',
          input('clinic_tax_id', { value: s.clinic_tax_id, disabled: !editable })),
      ]),
    ]),
    el('div', { class: 'card mt' }, [
      el('div', { class: 'card-head' }, [el('h2', { text: t('Money') })]),
      el('div', { class: 'card-body' }, [
        el('div', { class: 'field-row-3' }, [
          field('Currency code', input('currency', { value: s.currency, disabled: !editable })),
          field('Symbol', input('currency_symbol', { value: s.currency_symbol, disabled: !editable })),
          field('Number format', input('locale', { value: s.locale, disabled: !editable }),
            'e.g. en-US, fr-FR'),
        ]),
        el('div', { class: 'field-row-3' }, [
          field('Default tax rate', input('default_tax_rate_bp', {
            type: 'number', min: 0, max: 10000, value: s.default_tax_rate_bp, disabled: !editable,
          }), 'In basis points — 2100 means 21%'),
          field('Invoice prefix', input('invoice_prefix', {
            value: s.invoice_prefix, disabled: !editable,
          }), 'Numbers look like PREFIX-2026-0001'),
          field('', el('div')),
        ]),
        field('Invoice footer text', input('invoice_terms', {
          value: s.invoice_terms, disabled: !editable,
        })),
      ]),
    ]),
    el('div', { class: 'card mt' }, [
      el('div', { class: 'card-head' }, [el('h2', { text: t('Schedule') })]),
      el('div', { class: 'card-body' }, [
        el('div', { class: 'field-row-3' }, [
          field('Day starts', input('day_start', { type: 'time', value: s.day_start, disabled: !editable })),
          field('Day ends', input('day_end', { type: 'time', value: s.day_end, disabled: !editable })),
          field('Slot size (min)', input('slot_minutes', {
            type: 'number', min: 5, max: 60, value: s.slot_minutes, disabled: !editable,
          })),
        ]),
        field('Chairs / operatories', input('operatories', {
          value: s.operatories, disabled: !editable,
        }), 'Comma separated'),
        field('Expense categories', input('expense_categories', {
          value: s.expense_categories, disabled: !editable,
        }), 'Comma separated'),
      ]),
    ]),
    editable
      ? el('div', { class: 'row mt' }, [
        el('button', { class: 'btn btn-primary', type: 'submit', text: t('Save settings') }),
      ])
      : el('p', { class: 'small faint mt', text: t('Only an administrator can change these.') }),
  ]);



  onSubmit(form, async (data) => {
    await api.saveSettings(data);
    await refreshLookups();
    toast(t('Settings saved'), 'success');
  });

  // Kept outside the form so its buttons can never submit the settings.
  return el('div', {}, [
    form, await licenceCard(), await assistantCard(), languageCard(),
    await devicesCard(),
    await storageCard(), await syncCard(), await connectCard(),
  ]);
}

/**
 * What this clinic has paid for, and how to enter a code.
 *
 * Shown whether or not anything is wrong: a clinic that is paid up should be
 * able to see when its licence runs out without having to ask.
 */
async function licenceCard() {
  let licence;
  try {
    licence = await api.licence();
  } catch {
    return el('span');
  }
  // A build with no key compiled in is somebody's own copy. Nothing to say.
  if (licence.status === 'unlicensed-build') return el('span');

  const body = [];
  const soon = licence.days_left !== null && licence.days_left !== undefined
    && licence.days_left <= 14;

  if (licence.status === 'licensed') {
    body.push(el('dl', { class: 'kv small' }, [
      el('dt', { text: t('Plan') }),
      el('dd', {}, t(PLAN_NAMES[licence.plan] || licence.plan)),
      el('dt', { text: t('Devices') }),
      el('dd', {}, t('{n} including this computer', { n: licence.devices })),
      el('dt', { text: t('Runs until') }),
      el('dd', {}, licence.expires ? fmtDate(licence.expires) : t('No expiry')),
      el('dt', { text: t('Licence number') }),
      el('dd', { class: 'mono' }, String(licence.serial)),
    ]));
    if (soon) {
      body.push(el('p', { class: 'alert-chip', text:
        t('⚠ {n} days left. Ask for a renewal code before it runs out.',
          { n: licence.days_left }) }));
    }
  } else if (licence.status === 'trial') {
    body.push(el('p', { text: t('Free trial — {n} days left of {total}.',
      { n: licence.days_left, total: licence.trial_days }) }));
    body.push(el('p', { class: 'small muted', text: t('When it ends, everything here '
      + 'stays readable and printable. Only adding and changing records stops.') }));
  } else {
    body.push(el('p', { class: 'alert-chip', text: licence.status === 'trial-over'
      ? t('⚠ The free trial has ended. This clinic is read-only until a code is entered.')
      : t('⚠ This clinic is read-only until a code is entered.') }));
    if (licence.reason) body.push(el('p', { class: 'small muted', text: t(licence.reason) }));
  }

  if (can('settings:write')) {
    const box = el('textarea', {
      name: 'licence_key', rows: 3, class: 'mono',
      placeholder: 'ABC12-DEF34-…',
      style: { width: '100%', letterSpacing: '1px' },
    });
    const status = el('div', { class: 'small', style: { marginTop: '8px' } });
    body.push(
      el('div', { class: 'field mt' }, [
        el('label', { text: licence.status === 'licensed'
          ? t('Enter a renewal code') : t('Enter your licence code') }),
        box,
      ]),
      el('div', { class: 'row' }, [
        el('button', {
          class: 'btn btn-primary', type: 'button', text: t('Activate'),
          onClick: async (event) => {
            const key = box.value.trim();
            if (!key) return toast(t('Paste the code you were sent'), 'error');
            event.target.disabled = true;
            status.replaceChildren(el('span', { class: 'faint', text: t('Checking…') }));
            try {
              await api.activateLicence(key);
              toast(t('Licence activated'), 'success');
              window.location.reload();
            } catch (err) {
              status.replaceChildren(el('span', { class: 'alert-chip', text: t(err.message) }));
              event.target.disabled = false;
            }
          },
        }),
      ]),
      status,
    );
  }

  return el('div', { class: 'card mt' }, [
    el('div', { class: 'card-head' }, [el('h2', { text: t('Licence') })]),
    el('div', { class: 'card-body' }, body),
  ]);
}

const PLAN_NAMES = {
  monthly: 'Monthly', yearly: 'Yearly', lifetime: 'One-off purchase', trial: 'Free trial',
};

/**
 * Everywhere this sign-in is currently open.
 *
 * The same account is meant to be used on the phone, the tablet and the front
 * desk at the same time. That only works if a lost phone can be cut off
 * without making everyone else change their password, which is what the list
 * is for.
 */
async function devicesCard() {
  let devices = [];
  try {
    ({ devices } = await api.myDevices());
  } catch {
    return el('span');
  }

  // confirmDialog hands its callback no event, so the card keeps a reference
  // to itself rather than trying to find one from a click that is long gone.
  const card = el('div', { class: 'card mt' }, []);
  const refresh = async () => card.replaceWith(await devicesCard());

  card.append(
    el('div', { class: 'card-head' }, [el('h2', { text: t('Where you are signed in') })]),
    el('div', { class: 'card-body' }, [
      el('p', { class: 'small muted', text: t('You can use this account on as many '
        + 'phones, tablets and computers as you like at the same time. If one is lost '
        + 'or no longer used, sign it out here \u2014 nobody else is affected.') }),
      el('div', { class: 'card-body flush mt' }, table([
        { title: t('Device'), render: (d) => el('div', {}, [
          el('span', { class: 'strong' }, t(d.device)),
          d.current ? el('span', { class: 'badge badge-success', text: t('this one') }) : null,
        ]) },
        { title: t('Signed in'), class: 'nowrap', render: (d) => fmtDate(d.created_at) },
        { title: t('Last used'), class: 'nowrap', render: (d) => fmtDateTime(d.last_seen) },
        { title: '', class: 'num', render: (d) => el('button', {
          class: 'btn btn-sm btn-danger',
          text: d.current ? t('Sign out') : t('Sign out that device'),
          onClick: () => confirmDialog({
            title: d.current ? t('Sign out of this device?')
              : t('Sign out {device}?', { device: t(d.device) }),
            message: t('That device will ask for the password again next time. '
              + 'Records on it are not touched.'),
            confirmLabel: t('Sign out'),
            danger: true,
            onConfirm: async () => {
              await api.signOutDevice(d.id);
              if (d.current) { window.location.reload(); return; }
              toast(t('Device signed out'));
              await refresh();
            },
          }),
        }) },
      ], devices, { empty: t('No other device is signed in.') })),
    ]),
  );
  return card;
}

/**
 * Language is a personal choice, not a clinic setting: the receptionist may
 * want Arabic on the same records the dentist reads in English. It is kept on
 * the device rather than synced.
 */
function languageCard() {
  return el('div', { class: 'card mt' }, [
    el('div', { class: 'card-head' }, [el('h2', { text: t('Language') })]),
    el('div', { class: 'card-body' }, [
      el('p', { class: 'small muted', text: t('This changes the language on this '
        + 'device only. Patient names, notes and messages are never translated.') }),
      el('div', { class: 'row mt' }, LANGUAGES.map((l) => el('button', {
        type: 'button',
        class: `btn${l.code === currentLanguage() ? ' btn-primary' : ''}`,
        text: l.name,
        onClick: () => setLanguage(l.code),
      }))),
    ]),
  ]);
}

/**
 * Turning the front desk assistant on.
 *
 * Off until somebody chooses it, and the screen says plainly what leaves the
 * clinic when they do. A practice should not discover afterwards that its
 * patients' names went to a company it had not heard of.
 */
async function assistantCard() {
  const { settings: s } = await api.settings();
  if (!can('settings:write')) return el('span');

  const enabled = input('assistant_enabled', { type: 'checkbox' });
  enabled.checked = Boolean(s.assistant_enabled);
  const key = input('assistant_key', {
    type: 'password', placeholder: s.assistant_key_set ? '••••••••••••' : 'sk-ant-…',
  });
  const model = input('assistant_model', { value: s.assistant_model || 'claude-opus-5-5' });

  return el('div', { class: 'card mt' }, [
    el('div', { class: 'card-head' }, [el('h2', { text: t('Front desk assistant') })]),
    el('div', { class: 'card-body' }, [
      el('p', { class: 'small muted', text: t('Helps write messages to patients. You paste '
        + 'what the patient sent, it writes a reply with the real appointment time and '
        + 'balance already in it, and you read and edit it before sending.') }),
      el('p', { class: 'alert-chip', text: t('⚠ This is the one part of the app that needs '
        + 'the internet. When you use it, the patient\u2019s first name, their next '
        + 'appointment and what they owe are sent to Anthropic to write the reply. '
        + 'Medical notes, the chart and images are never sent. It costs a small amount '
        + 'for each message.') }),
      el('div', { class: 'row mt' }, [
        enabled,
        el('label', { for: enabled.id || null, text: t('Turn the assistant on') }),
      ]),
      el('div', { class: 'field-row mt' }, [
        field('Assistant key', key, 'From console.anthropic.com. Kept on this computer '
          + 'and never shown again.'),
        field('Model', model, 'Leave as it is unless you have a reason to change it'),
      ]),
      el('div', { class: 'row mt' }, [
        el('button', {
          class: 'btn btn-primary', type: 'button', text: t('Save'),
          onClick: async (event) => {
            event.target.disabled = true;
            try {
              const body = {
                assistant_enabled: enabled.checked ? '1' : '',
                assistant_model: model.value,
              };
              // An empty box means "leave the key alone", not "delete it".
              if (key.value) body.assistant_key = key.value;
              await api.saveSettings(body);
              toast(t('Settings saved'), 'success');
            } catch (err) {
              toast(t(err.message), 'error');
            } finally {
              event.target.disabled = false;
            }
          },
        }),
      ]),
    ]),
  ]);
}

/**
 * The clinic's medicine list.
 *
 * Seeded with a dental starter set, then owned by the clinic: what is
 * licensed, available and stocked differs by country and by the pharmacy
 * downstairs, so every field is editable and nothing here is a rule.
 */
async function medicinesTab(reload) {
  const { medicines } = await api.medicines('all=1');
  const editable = can('procedures:write');

  return el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', { text: t('Medicines ({n})', { n: medicines.filter((m) => m.active).length }) }),
      editable
        ? el('div', { class: 'row' }, [
          medicines.length ? null : el('button', {
            class: 'btn btn-sm', text: t('Fill with the dental starter list'),
            onClick: async (event) => {
              event.target.disabled = true;
              const { added } = await api.seedMedicines();
              toast(t('{n} medicines added', { n: added }), 'success');
              await reload();
            },
          }),
          el('button', {
            class: 'btn btn-primary btn-sm', text: t('+ Add medicine'),
            onClick: () => medicineDialog({ onSaved: reload }),
          }),
        ].filter(Boolean))
        : null,
    ]),
    el('div', { class: 'card-body flush' }, table([
      { title: t('Medicine'), render: (m) => el('div', {}, [
        el('div', { class: m.active ? 'strong' : 'faint' },
          [m.name, m.strength].filter(Boolean).join(' ')),
        m.name_ar ? el('div', { class: 'small faint' }, m.name_ar) : null,
        !m.active ? el('span', { class: 'badge', text: t('Retired') }) : null,
      ]) },
      { title: t('Category'), render: (m) => el('span', { class: 'badge', text: t(m.category) }) },
      { title: t('Form'), render: (m) => t(m.form) },
      { title: t('Usual dose'), render: (m) =>
        [m.dose, m.frequency, m.duration].filter(Boolean).join(' · ') || '—' },
      { title: t('Caution'), render: (m) => (m.caution
        ? el('span', { class: 'small', style: { color: 'var(--danger)' } }, t(m.caution))
        : '—') },
    ], medicines, {
      onRowClick: editable ? (m) => medicineDialog({ medicine: m, onSaved: reload }) : null,
      empty: t('No medicines yet.'),
    })),
  ]);
}

function medicineDialog({ medicine, onSaved }) {
  const form = el('form', {}, [
    el('div', { class: 'field-row' }, [
      field('Name', input('name', { value: medicine?.name || '', required: true })),
      field('Name in Arabic', input('name_ar', { value: medicine?.name_ar || '' })),
    ]),
    el('div', { class: 'field-row-3' }, [
      field('Generic', input('generic', { value: medicine?.generic || '' })),
      field('Category', input('category', { value: medicine?.category || 'Other' })),
      field('Form', input('form', { value: medicine?.form || 'tablet' })),
    ]),
    el('div', { class: 'field-row-3' }, [
      field('Strength', input('strength', { value: medicine?.strength || '' })),
      field('Dose', input('dose', { value: medicine?.dose || '' })),
      field('How often', input('frequency', { value: medicine?.frequency || '' })),
    ]),
    el('div', { class: 'field-row' }, [
      field('For how long', input('duration', { value: medicine?.duration || '' })),
      field('Instructions', input('instructions', { value: medicine?.instructions || '' })),
    ]),
    field('Caution', input('caution', { value: medicine?.caution || '' }),
      'Shown as a warning whenever this medicine is chosen'),
  ]);

  onSubmit(form, async (values) => {
    if (medicine) await api.updateMedicine(medicine.id, values);
    else await api.addMedicine(values);
    closeModal();
    toast(t('Medicine saved'), 'success');
    await onSaved();
  });

  modal({
    title: t(medicine ? 'Edit medicine' : 'Add a medicine'),
    width: 'wide',
    body: form,
    footer: [
      medicine && medicine.active
        ? el('button', {
          class: 'btn btn-danger', text: t('Retire'),
          onClick: () => confirmDialog({
            title: t('Retire {name}?', { name: medicine.name }),
            message: t('It stops being offered when prescribing. '
              + 'Prescriptions already written are unchanged.'),
            confirmLabel: t('Retire'),
            danger: true,
            onConfirm: async () => {
              await api.retireMedicine(medicine.id);
              closeModal();
              toast(t('Medicine retired'));
              await onSaved();
            },
          }),
        })
        : null,
      el('button', { class: 'btn right', text: t('Cancel'), onClick: () => closeModal() }),
      el('button', { class: 'btn btn-primary', text: t('Save'),
        onClick: () => form.requestSubmit() }),
    ].filter(Boolean),
  });
}

// ---------- Price list ---------------------------------------------------
async function proceduresTab(reload) {
  const { procedures } = await api.procedures({ include_inactive: 1 });
  const editable = can('procedures:write');

  return el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', { text: t('Price list ({n} active)',
        { n: procedures.filter((p) => p.active).length }) }),
      editable
        ? el('button', {
          class: 'btn btn-primary btn-sm', text: t('+ Add procedure'),
          onClick: () => procedureDialog({ onSaved: reload }),
        })
        : null,
    ]),
    el('div', { class: 'card-body flush' }, table([
      { title: t('Code'), render: (p) => el('span', { class: 'mono' }, p.code) },
      { title: t('Procedure'), render: (p) => el('div', {}, [
        el('div', { class: p.active ? '' : 'faint' }, p.name),
        !p.active ? el('span', { class: 'badge', text: t('Retired') }) : null,
      ]) },
      { title: t('Category'), render: (p) => el('span', { class: 'badge', text: p.category }) },
      { title: t('Minutes'), class: 'num', render: (p) => String(p.default_duration_min) },
      { title: t('Tax'), class: 'num', render: (p) => p.tax_rate_bp
        ? `${(p.tax_rate_bp / 100).toFixed(2)}%` : '—' },
      { title: t('Price'), class: 'num', render: (p) =>
        el('span', { class: 'strong' }, money(p.default_price_cents)) },
      { title: '', class: 'num', render: (p) => (editable && p.active
        ? el('button', {
          class: 'btn btn-sm btn-danger', text: t('Retire'),
          onClick: (event) => {
            event.stopPropagation();
            confirmDialog({
              title: t('Retire {name}?', { name: p.name }),
              message: t('It stops appearing in new treatments and invoices. History is kept.'),
              confirmLabel: t('Retire'),
              danger: true,
              onConfirm: async () => {
                await api.retireProcedure(p.id);
                await refreshLookups();
                toast(t('Procedure retired'));
                await reload();
              },
            });
          },
        })
        : '') },
    ], procedures, {
      onRowClick: editable ? (p) => procedureDialog({ procedure: p, onSaved: reload }) : null,
      empty: t('No procedures yet — add your price list here.'),
    })),
  ]);
}

function procedureDialog({ procedure, onSaved }) {
  const editing = Boolean(procedure);
  const categories = [...new Set(state.procedures.map((p) => p.category))].sort();

  const form = el('form', {}, [
    el('div', { class: 'field-row' }, [
      field('Code', input('code', {
        required: true, value: procedure?.code || '', maxlength: 20, placeholder: t('FILL1'),
      })),
      field('Category', input('category', {
        value: procedure?.category || 'General', list: 'procedure-categories',
      })),
    ]),
    el('datalist', { id: 'procedure-categories' },
      categories.map((c) => el('option', { value: c }))),
    field('Name', input('name', { required: true, value: procedure?.name || '' })),
    el('div', { class: 'field-row-3' }, [
      field('Default price', input('default_price', {
        type: 'number', step: '0.01', min: '0', required: true,
        value: procedure ? (procedure.default_price_cents / 100).toFixed(2) : '0.00',
      })),
      field('Minutes', input('default_duration_min', {
        type: 'number', min: 5, max: 600, value: procedure?.default_duration_min || 30,
      })),
      field('Tax (bp)', input('tax_rate_bp', {
        type: 'number', min: 0, max: 10000, value: procedure?.tax_rate_bp || 0,
      })),
    ]),
    el('div', { class: 'check-line' }, [
      el('input', {
        type: 'checkbox', name: 'tooth_specific', id: 'tooth_specific',
        checked: procedure ? !!procedure.tooth_specific : false,
      }),
      el('label', { for: 'tooth_specific', text: t('Applies to a specific tooth') }),
    ]),
    editing
      ? el('div', { class: 'check-line mt' }, [
        el('input', { type: 'checkbox', name: 'active', id: 'active', checked: !!procedure.active }),
        el('label', { for: 'active', text: t('Active (offered to staff)') }),
      ])
      : null,
  ]);

  onSubmit(form, async (data) => {
    if (editing) await api.updateProcedure(procedure.id, data);
    else await api.createProcedure(data);
    await refreshLookups();
    closeModal();
    toast(editing ? 'Procedure updated' : 'Procedure added', 'success');
    if (onSaved) await onSaved();
  });

  modal({
    title: editing ? 'Edit procedure' : 'New procedure',
    body: form,
    footer: [
      el('button', { class: 'btn', text: t('Cancel'), onClick: () => closeModal() }),
      el('button', { class: 'btn btn-primary', text: t('Save'), onClick: () => form.requestSubmit() }),
    ],
  });
}

// ---------- Staff --------------------------------------------------------
async function usersTab(reload) {
  const { users } = await api.users({ include_inactive: 1 });
  const editable = can('users:write');

  return el('div', { class: 'stack' }, [
    el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [
        el('h2', { text: t('Staff accounts') }),
        editable
          ? el('button', {
            class: 'btn btn-primary btn-sm', text: t('+ Add user'),
            onClick: () => userDialog({ onSaved: reload }),
          })
          : null,
      ]),
      el('div', { class: 'card-body flush' }, table([
        { title: '', render: (u) => avatar(u.name, u.color, 28) },
        { title: t('Name'), render: (u) => el('div', {}, [
          el('div', { class: u.active ? 'strong' : 'faint' }, u.name),
          !u.active ? el('span', { class: 'badge', text: t('Disabled') }) : null,
        ]) },
        { title: t('Email'), render: (u) => el('span', { class: 'small' }, u.email) },
        { title: t('Role'), render: (u) => el('span', { class: 'badge badge-accent', text: u.role }) },
        { title: '', class: 'num', render: (u) => (editable
          ? el('button', {
            class: 'btn btn-sm', text: t('Reset password'),
            onClick: (event) => { event.stopPropagation(); resetPasswordDialog(u); },
          })
          : '') },
      ], users, {
        onRowClick: editable ? (u) => userDialog({ user: u, onSaved: reload }) : null,
      })),
    ]),
    el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [el('h2', { text: t('What each role can do') })]),
      el('div', { class: 'card-body flush' }, table([
        { title: t('Role'), render: (r) => el('span', { class: 'badge badge-accent', text: r.role }) },
        { title: t('Can do'), render: (r) => r.summary },
      ], [
        { role: 'admin', summary: 'Everything, including staff accounts and clinic settings.' },
        { role: 'dentist', summary: 'Patients, schedule, odontogram and treatments. Reads billing.' },
        { role: 'receptionist', summary: 'Patients, schedule, invoices and payments. No clinical edits.' },
        { role: 'accountant', summary: 'Invoices, payments, expenses and reports. Reads patients.' },
      ])),
    ]),
  ]);
}

function userDialog({ user, onSaved }) {
  const editing = Boolean(user);
  const form = el('form', {}, [
    el('div', { class: 'field-row' }, [
      field('Name', input('name', { required: true, value: user?.name || '' })),
      field('Email', input('email', { type: 'email', required: true, value: user?.email || '' })),
    ]),
    el('div', { class: 'field-row-3' }, [
      field('Role', select('role', [
        { value: 'admin', label: t('Administrator') },
        { value: 'dentist', label: t('Dentist') },
        { value: 'receptionist', label: t('Receptionist') },
        { value: 'accountant', label: t('Accountant') },
      ], user?.role || 'receptionist')),
      field('Calendar colour', input('color', { type: 'color', value: user?.color || '#2f7d8c' })),
      field('Phone', input('phone', { value: user?.phone || '' })),
    ]),
    editing
      ? el('div', { class: 'check-line' }, [
        el('input', { type: 'checkbox', name: 'active', id: 'user-active', checked: !!user.active }),
        el('label', { for: 'user-active', text: t('Account is active') }),
      ])
      : field('Password', input('password', { type: 'password', required: true, minlength: 8 }),
        'At least 8 characters.'),
  ]);

  onSubmit(form, async (data) => {
    if (editing) await api.updateUser(user.id, data);
    else await api.createUser(data);
    await refreshLookups();
    closeModal();
    toast(editing ? 'User updated' : 'User created', 'success');
    if (onSaved) await onSaved();
  });

  modal({
    title: editing ? 'Edit user' : 'New user',
    body: form,
    footer: [
      el('button', { class: 'btn', text: t('Cancel'), onClick: () => closeModal() }),
      el('button', { class: 'btn btn-primary', text: t('Save'), onClick: () => form.requestSubmit() }),
    ],
  });
}

function resetPasswordDialog(user) {
  const form = el('form', {}, [
    field('New password', input('new_password', { type: 'password', required: true, minlength: 8 }),
      `${user.name} will be signed out everywhere and must use this password next time.`),
  ]);
  onSubmit(form, async (data) => {
    await api.resetUserPassword(user.id, data);
    closeModal();
    toast(t('Password reset'), 'success');
  });
  modal({
    title: t('Reset password — {name}', { name: user.name }),
    body: form,
    footer: [
      el('button', { class: 'btn', text: t('Cancel'), onClick: () => closeModal() }),
      el('button', { class: 'btn btn-primary', text: t('Reset'), onClick: () => form.requestSubmit() }),
    ],
  });
}

// ---------- WhatsApp -----------------------------------------------------
async function messagesTab(reload) {
  const [{ settings: s }, { templates, settings: wa }] = await Promise.all([
    api.settings(), api.messageTemplates(),
  ]);
  const editable = can('settings:write');
  const canManage = can('messages:manage');

  const modeSelect = select('whatsapp_mode', [
    { value: 'link', label: t('Open WhatsApp and let staff press send (free)') },
    { value: 'cloud', label: t('Send automatically via WhatsApp Business API') },
  ], s.whatsapp_mode, { disabled: !editable });

  const cloudFields = el('div', {
    style: { display: s.whatsapp_mode === 'cloud' ? 'block' : 'none' },
  }, [
    el('div', { class: 'field-row' }, [
      field('Phone number ID', input('whatsapp_phone_number_id', {
        value: s.whatsapp_phone_number_id, disabled: !editable,
        placeholder: t('from Meta WhatsApp Manager'),
      })),
      field('Access token', input('whatsapp_token', {
        type: 'password', disabled: !editable,
        placeholder: wa.token_set ? '•••••••• (already set — leave blank to keep)' : 'paste token',
      }), wa.token_from_env
        ? 'Currently coming from the WHATSAPP_TOKEN environment variable.'
        : 'Stored in the database. For a shared machine, set WHATSAPP_TOKEN as an environment variable instead.'),
    ]),
    el('p', { class: 'small faint', text: t('The Business API needs a Meta Business account, a number registered to '
      + 'WhatsApp Business (it cannot also be used in the normal WhatsApp app), and ' + 'templates approved by Meta. Meta charges per conversation. Until that is set up, '
      + 'the app falls back to opening WhatsApp for you.') }),
  ]);
  modeSelect.addEventListener('change', () => {
    cloudFields.style.display = modeSelect.value === 'cloud' ? 'block' : 'none';
  });

  const form = el('form', {}, [
    el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [el('h2', { text: t('WhatsApp') })]),
      el('div', { class: 'card-body' }, [
        el('div', { class: 'field-row' }, [
          field('Country code', input('whatsapp_country_code', {
            value: s.whatsapp_country_code, disabled: !editable, placeholder: 'e.g. 964',
          }), 'Digits only, no +. Used to turn local numbers like 07xx into full international ones.'),
          field('Default language', select('whatsapp_default_language', [
            { value: 'ar', label: t('Arabic') },
            { value: 'en', label: t('English') },
          ], s.whatsapp_default_language, { disabled: !editable })),
        ]),
        field('How messages are sent', modeSelect),
        cloudFields,
      ]),
    ]),
    editable
      ? el('div', { class: 'row mt' }, [
        el('button', { class: 'btn btn-primary', type: 'submit', text: t('Save WhatsApp settings') }),
      ])
      : null,
  ]);

  onSubmit(form, async (data) => {
    // An empty token field means "keep the one already stored".
    if (!data.whatsapp_token) delete data.whatsapp_token;
    await api.saveSettings(data);
    await refreshLookups();
    toast(t('WhatsApp settings saved'), 'success');
    await reload();
  });

  const templateCard = el('div', { class: 'card mt' }, [
    el('div', { class: 'card-head' }, [
      el('h2', { text: t('Message templates ({n})', { n: templates.length }) }),
      canManage
        ? el('button', {
          class: 'btn btn-sm', text: t('+ New template'),
          onClick: () => templateDialog({ onSaved: reload }),
        })
        : null,
    ]),
    el('div', { class: 'card-body flush' }, table([
      { title: t('Template'), render: (item) => el('div', {}, [
        el('div', { class: item.active ? 'strong' : 'faint' }, item.name),
        el('span', { class: 'small faint mono' }, item.key),
      ]) },
      { title: t('For'), render: (item) => el('span', { class: 'badge', text: item.context }) },
      { title: t('Category'), render: (item) => el('span', { class: 'badge badge-accent', text: item.category }) },
      { title: t('Arabic preview'), render: (item) => el('div', {
        class: 'rtl small faint',
        style: { maxWidth: '340px', maxHeight: '3.4em', overflow: 'hidden' },
      }, item.body_ar.split('\n').slice(0, 2).join(' · ')) },
      { title: '', class: 'num', render: (item) => (item.active
        ? '' : el('span', { class: 'badge', text: t('Off') })) },
    ], templates, {
      onRowClick: canManage ? (item) => templateDialog({ template: item, onSaved: reload }) : null,
      empty: t('No templates yet.'),
    })),
  ]);

  return el('div', {}, [form, templateCard]);
}

function templateDialog({ template, onSaved }) {
  const editing = Boolean(template);

  const arabic = el('textarea', {
    name: 'body_ar', class: 'template-body rtl', required: true,
  }, template?.body_ar || '');
  const english = el('textarea', {
    name: 'body_en', class: 'template-body',
  }, template?.body_en || '');

  // Clicking a placeholder inserts it wherever the cursor is.
  const ALL_PLACEHOLDERS = [
    'patient_name', 'patient_first_name', 'clinic_name', 'clinic_phone',
    'date', 'time', 'dentist', 'procedure', 'procedure_line',
    'amount', 'method', 'balance', 'total', 'invoice_number', 'invoice_line', 'due_line',
  ];
  let lastFocused = arabic;
  for (const box of [arabic, english]) {
    box.addEventListener('focus', () => { lastFocused = box; });
  }
  const chips = el('div', { style: { marginTop: '6px' } },
    ALL_PLACEHOLDERS.map((name) => el('button', {
      type: 'button', class: 'placeholder-chip', text: `{{${name}}}`,
      onClick: () => {
        const token = `{{${name}}}`;
        const start = lastFocused.selectionStart ?? lastFocused.value.length;
        const end = lastFocused.selectionEnd ?? start;
        lastFocused.value = lastFocused.value.slice(0, start) + token + lastFocused.value.slice(end);
        lastFocused.focus();
        lastFocused.selectionStart = lastFocused.selectionEnd = start + token.length;
      },
    })));

  const form = el('form', {}, [
    el('div', { class: 'field-row' }, [
      field('Name', input('name', { required: true, value: template?.name || '' })),
      editing
        ? field('Key', input('key', { value: template.key, disabled: true }))
        : field('Key', input('key', { required: true, placeholder: 'recall_due' }),
          'Letters, numbers and underscores.'),
    ]),
    editing ? null : el('div', { class: 'field-row' }, [
      field('Category', select('category', [
        { value: 'appointment', label: t('Appointment') },
        { value: 'billing', label: t('Billing') },
        { value: 'general', label: t('General') },
      ], 'general')),
      field('Attaches to', select('context', [
        { value: 'patient', label: t('A patient') },
        { value: 'appointment', label: t('An appointment') },
        { value: 'invoice', label: t('An invoice') },
        { value: 'payment', label: t('A payment') },
      ], 'patient'), 'Decides which screens offer this template.'),
    ]),
    field('Arabic message', arabic),
    field('English message (optional)', english),
    el('div', {}, [
      el('label', { text: t('Insert a value'), style: { marginBottom: 0 } }),
      chips,
      el('div', { class: 'field-hint', text: t('A line containing only a placeholder disappears when that value is empty.') }),
    ]),
    field('Meta template name (optional)', input('cloud_name', {
      value: template?.cloud_name || '', placeholder: t('only for the Business API'),
    }), 'If you use the WhatsApp Business API, the name of the matching approved template.'),
    editing
      ? el('div', { class: 'check-line mt' }, [
        el('input', { type: 'checkbox', name: 'active', id: 'tpl-active', checked: !!template.active }),
        el('label', { for: 'tpl-active', text: t('Offered to staff') }),
      ])
      : null,
  ]);

  onSubmit(form, async (data) => {
    if (editing) await api.saveTemplate(template.key, data);
    else await api.createTemplate(data);
    closeModal();
    toast(editing ? 'Template saved' : 'Template created', 'success');
    if (onSaved) await onSaved();
  });

  modal({
    title: editing ? `Edit — ${template.name}` : 'New message template',
    body: form,
    width: 'wide',
    footer: [
      editing && !template.built_in
        ? el('button', {
          class: 'btn btn-danger', text: t('Delete'),
          onClick: async () => {
            await api.deleteTemplate(template.key);
            closeModal();
            toast(t('Template deleted'));
            if (onSaved) await onSaved();
          },
        })
        : null,
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn', text: t('Cancel'), onClick: () => closeModal() }),
      el('button', { class: 'btn btn-primary', text: t('Save'), onClick: () => form.requestSubmit() }),
    ],
  });
}

/**
 * Shows the addresses staff can use from a phone or another clinic computer.
 *
 * When there is nothing to show it says what it actually found, rather than
 * guessing at the cause — an earlier version blamed the user's Wi-Fi for what
 * was really a failed request.
 */
async function connectCard() {
  // A phone running its own database hosts nothing, so it has no address to
  // hand out — and asking for one only produces an error worth nobody's time.
  if (isLocalMode()) return el('span');

  let net = null;
  let failure = null;
  try {
    net = await api.network();
  } catch (err) {
    failure = err.message || 'The server did not answer.';
  }

  return el('div', { class: 'card mt' }, [
    el('div', { class: 'card-head' }, [
      el('h2', { text: t('Use this on a phone or tablet') }),
      el('button', {
        class: 'btn btn-sm right', type: 'button', text: t('Re-check'),
        onClick: async (event) => {
          const card = event.target.closest('.card');
          card.replaceWith(await connectCard());
        },
      }),
    ]),
    el('div', { class: 'card-body' }, connectBody(net, failure)),
  ]);
}

function connectBody(net, failure) {
  if (failure) {
    return [
      el('p', { class: 'alert-chip', text: `⚠ ${t('Could not ask the server for its address: {why}', { why: t(failure) })}` }),
      el('p', { class: 'small faint', text: t('Run "npm run address" in the Terminal to get it instead.') }),
    ];
  }

  if (!net.addresses.length) {
    return [
      el('p', { class: 'strong', text: t('No address other devices could use was found.') }),
      el('p', { class: 'small muted', text: t('This usually means the computer is not connected to Wi-Fi or Ethernet — '
        + 'or that it is connected through something this app cannot use, such as a VPN.') }),
      el('dl', { class: 'kv small' }, [
        el('dt', { text: t('Interfaces found') }),
        el('dd', { class: 'mono' }, net.interfaces_seen.join(', ') || 'none'),
        ...(net.rejected || []).flatMap((r) => [
          el('dt', { class: 'mono', text: r.interface }),
          el('dd', { class: 'faint' }, `${r.address || ''} — ${t('skipped: {why}', { why: t(r.why) })}`),
        ]),
      ]),
      el('p', { class: 'small faint mt', text: t('On this computer the app is always at ') + net.local + '. '
        + 'To check by hand on a Mac, run:  ipconfig getifaddr en0' }),
    ];
  }

  return [
    el('p', { class: 'small muted', text: t('On the same Wi-Fi as this computer, open one of these in the phone\u2019s browser, '
      + 'then use "Add to Home Screen" (iPhone) or "Install app" (Android) to get an app icon.') }),
    ...net.addresses.map((a) => el('div', { class: 'row', style: { marginBottom: '8px' } }, [
      el('code', { class: 'mono strong', style: { fontSize: '15px' } }, a.url),
      el('span', { class: 'badge', text: a.label }),
      a.kind === 'self-assigned'
        ? el('span', { class: 'alert-chip small',
          text: t('⚠ self-assigned — the router did not give this computer an address') })
        : null,
      el('button', {
        class: 'btn btn-sm right', type: 'button', text: t('Copy'),
        onClick: async () => {
          try {
            await navigator.clipboard.writeText(a.url);
            toast(t('Address copied'), 'success');
          } catch {
            toast(a.url);
          }
        },
      }),
    ])),
    el('p', { class: 'small faint mt', text: t('If an address stops working, the router gave this computer a new one. '
      + 'Come back here for the current one, or ask whoever manages the network ' + 'to reserve a fixed address for this machine.') }),
  ];
}

/** Says plainly where this device keeps its records, and offers a backup. */
async function storageCard() {
  const local = isLocalMode();
  const body = [
    el('p', {}, [
      el('span', { class: `mode-dot ${local ? 'local' : 'server'}`,
        style: { display: 'inline-block', marginRight: '7px' } }),
      el('span', { class: 'strong', text: describeMode() }),
    ]),
  ];

  if (local) {
    let status = null;
    try {
      const { localStatus } = await import('../local/client.js');
      status = await localStatus();
    } catch { /* the card simply shows less */ }

    body.push(el('p', { class: 'small muted', text: t('This device holds its own copy of the records and works with no Wi-Fi and '
      + 'no clinic computer. Records created here stay here until syncing is set up, ' + 'so another phone will not see them yet.') }));

    if (status) {
      body.push(el('dl', { class: 'kv small' }, [
        el('dt', { text: t('Patients') }), el('dd', { text: String(status.patients) }),
        el('dt', { text: t('Staff accounts') }), el('dd', { text: String(status.users) }),
        el('dt', { text: t('Database size') }),
        el('dd', { text: t('{n} KB', { n: (status.size / 1024).toFixed(0) }) }),
      ]));
    }

    body.push(el('p', { class: 'alert-chip', text: t('⚠ Back this up. If the device is lost or reset, records only here are gone.') }));
    body.push(el('p', { class: 'small muted', text: t('Save the file somewhere that is not this device — send it to yourself on '
      + 'WhatsApp or email, or copy it to a computer. A backup kept only on the '
      + 'phone goes when the phone does.') }));

    // Restoring replaces everything, so it is a file picker the person has to
    // choose a file in, plus a confirmation, rather than a single button.
    const picker = el('input', {
      type: 'file', accept: '.db,application/x-sqlite3,application/octet-stream',
      style: { display: 'none' },
      onChange: async (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        confirmDialog({
          title: t('Restore this backup?'),
          message: t('Everything on this device is replaced by "{name}". Anything '
            + 'recorded here since that file was saved is lost, and you will be '
            + 'signed out.', { name: file.name }),
          confirmLabel: t('Replace everything'),
          danger: true,
          onConfirm: async () => {
            try {
              const { importLocalDatabase } = await import('../local/client.js');
              const bytes = new Uint8Array(await file.arrayBuffer());
              const result = await importLocalDatabase(bytes);
              toast(t('Restored {n} patient(s). Please sign in again.',
                { n: result.patients }), 'success');
              setTimeout(() => window.location.reload(), 1200);
            } catch (err) {
              toast(err.message, 'error');
            }
          },
        });
      },
    });

    body.push(picker);
    body.push(el('div', { class: 'row mt' }, [
      el('button', {
        class: 'btn', type: 'button', text: t('↑ Restore a backup file'),
        onClick: () => picker.click(),
      }),
      el('button', {
        class: 'btn btn-primary', type: 'button', text: t('↓ Save a backup file'),
        onClick: async (event) => {
          const button = event.target;
          button.disabled = true;
          try {
            const { exportLocalDatabase } = await import('../local/client.js');
            const bytes = await exportLocalDatabase();
            const url = URL.createObjectURL(new Blob([bytes], { type: 'application/x-sqlite3' }));
            const link = document.createElement('a');
            link.href = url;
            link.download = `clinic-backup-${new Date().toISOString().slice(0, 10)}.db`;
            document.body.append(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 10000);
            toast(t('Backup saved'), 'success');
          } catch (err) {
            toast(err.message, 'error');
          } finally {
            button.disabled = false;
          }
        },
      }),
    ]));
  } else {
    body.push(el('p', { class: 'small muted', text: t('Records are kept on the clinic computer, and every device that connects to it '
      + 'sees the same ones. Back it up there with "npm run backup".') }));
  }

  return el('div', { class: 'card mt' }, [
    el('div', { class: 'card-head' }, [el('h2', { text: t('Where the records are kept') })]),
    el('div', { class: 'card-body' }, body),
  ]);
}

// ---------- Keeping devices in step ---------------------------------------

const tile = (label, value) => el('div', { class: 'card stat' }, [
  el('div', { class: 'stat-label', text: t(label) }),
  el('div', { class: 'stat-value', text: value }),
]);

/**
 * On a phone: whether this device is joined to a clinic server, and a way to
 * join one. Sync is what stops each phone becoming its own private clinic.
 */
async function syncCard() {
  if (!isLocalMode()) return el('span');

  let summary = null;
  try {
    const { localSyncSummary } = await import('../local/client.js');
    summary = await localSyncSummary();
  } catch {
    return el('span');
  }

  const body = [];
  const refresh = async (event) => {
    const card = event.target.closest('.card');
    card.replaceWith(await syncCard());
  };

  if (!summary.connected) {
    const address = input('sync_server', { placeholder: '192.168.1.42:4000' });
    const code = input('sync_code', {
      placeholder: t('ABC123'), maxlength: 8,
      style: { textTransform: 'uppercase', letterSpacing: '2px' },
    });
    const status = el('div', { class: 'small', style: { marginTop: '10px' } });

    body.push(
      el('p', { class: 'small muted', text: t('This device keeps its records to itself. Join it to a clinic server and '
        + 'everyone\u2019s records stay in step \u2014 you can still work with the ' + 'server switched off, and catch up later.') }),
      el('div', { class: 'field-row' }, [
        field('Clinic server address', address),
        field('Pairing code', code),
      ]),
      el('p', { class: 'field-hint', text: t('On the clinic computer: Settings \u2192 Devices \u2192 Add a device. '
        + 'It shows a six-character code that lasts fifteen minutes.') }),
      el('div', { class: 'row mt' }, [
        el('button', {
          class: 'btn btn-primary', type: 'button', text: t('Join this clinic'),
          onClick: async (event) => {
            const button = event.target;
            const url = address.value.trim();
            const pairing = code.value.trim().toUpperCase();
            if (!url) return toast(t('Enter the clinic server address'), 'error');
            if (!pairing) return toast(t('Enter the pairing code'), 'error');

            button.disabled = true;
            status.replaceChildren(el('span', { class: 'faint', text: t('Joining\u2026') }));
            try {
              const { localSyncRegister, localSync } = await import('../local/client.js');
              const joined = await localSyncRegister({
                serverUrl: url.startsWith('http') ? url : `http://${url}`,
                pairingCode: pairing,
                name: navigator.userAgent.includes('Android') ? 'Android phone' : 'This device',
              });
              status.replaceChildren(el('span', { class: 'faint',
                text: t('Joined. Bringing the records across\u2026') }));
              const result = await localSync();

              // The sign-in this device invented for itself is stood down when
              // it joins, and that is the one being used right now. Say so and
              // hand over deliberately, rather than letting the next tap drop
              // onto a sign-in screen with no explanation.
              if (joined.retired_setup_account) {
                startAgain(result.received);
                return;
              }
              toast(t('Joined — {n} records received', { n: result.received }), 'success');
              await refresh(event);
            } catch (err) {
              status.replaceChildren(el('span', { class: 'alert-chip', text: `\u26a0 ${t(err.message)}` }));
              button.disabled = false;
            }
          },
        }),
      ]),
      status,
    );
  } else {
    body.push(el('dl', { class: 'kv small' }, [
      el('dt', { text: t('Clinic server') }), el('dd', { class: 'mono' }, summary.server_url),
      el('dt', { text: t('This device') }),
      el('dd', {}, t('records it creates are numbered …-{code}-…', { code: summary.device_code })),
      el('dt', { text: t('Last synced') }),
      el('dd', {}, summary.last_synced_at ? fmtDateTime(summary.last_synced_at) : 'never'),
      el('dt', { text: t('Waiting to send') }),
      el('dd', {}, summary.pending ? `${summary.pending} change(s)` : 'nothing'),
    ]));

    if (summary.last_error) {
      body.push(el('p', { class: 'alert-chip', text: `⚠ ${t('Last attempt failed: {why}', { why: t(summary.last_error) })}` }));
    }
    if (summary.issues) {
      body.push(el('p', { class: 'alert-chip', text:
        `⚠ ${summary.issues} record(s) could not be merged and need a look.` }));
    }
    if (summary.renumbered) {
      body.push(el('p', { class: 'small muted', text:
        `${summary.renumbered} record(s) were given a new file or invoice number, `
        + 'because the clinic had already given that number to someone else. '
        + 'Nothing was lost \u2014 check anything already written on paper.' }));
    }
    if (summary.incomplete) {
      body.push(el('p', { class: 'small muted', text:
        `${summary.incomplete} record(s) arrived without the name of whoever `
        + 'entered them, because that account is not one this clinic has. The '
        + 'records themselves are complete.' }));
    }

    body.push(el('div', { class: 'row mt' }, [
      el('button', {
        class: 'btn btn-primary', type: 'button', text: t('Sync now'),
        onClick: async (event) => {
          const button = event.target;
          button.disabled = true;
          button.textContent = 'Syncing…';
          try {
            const { localSync } = await import('../local/client.js');
            const result = await localSync();
            toast(t('Sent {sent}, received {received}',
            { sent: result.sent, received: result.received }), 'success');
            await refresh(event);
          } catch (err) {
            toast(err.message, 'error');
            button.disabled = false;
            button.textContent = 'Sync now';
          }
        },
      }),
    ]));
  }

  return el('div', { class: 'card mt' }, [
    el('div', { class: 'card-head' }, [el('h2', { text: t('Keeping devices in step') })]),
    el('div', { class: 'card-body' }, body),
  ]);
}

/** On the clinic server: which devices are joined, and the shared ledger. */
async function syncTab(reload) {
  const { devices, server_seq: serverSeq, pending } = await api.syncDevices();

  return el('div', { class: 'stack' }, [
    el('div', { class: 'grid grid-3' }, [
      tile('Joined devices', String(devices.filter((d) => !d.revoked).length)),
      tile('Shared changes', String(serverSeq)),
      tile('Waiting here', String(pending)),
    ]),
    el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [
        el('h2', { text: t('Devices sharing these records') }),
        el('button', {
          class: 'btn btn-primary btn-sm', text: t('+ Add a device'),
          onClick: async (event) => {
            event.target.disabled = true;
            try {
              const pairing = await api.startPairing();
              showPairingCode(pairing, reload);
            } catch (err) {
              toast(err.message, 'error');
            } finally {
              event.target.disabled = false;
            }
          },
        }),
      ]),
      el('div', { class: 'card-body flush' }, table([
        { title: t('Device'), render: (d) => el('div', {}, [
          el('div', { class: d.revoked ? 'faint' : 'strong' }, d.name),
          d.paired
            ? el('span', { class: 'small faint mono' }, d.id)
            : el('span', { class: 'badge badge-warning' },
              `waiting \u2014 code ${d.pairing_code}`),
        ]) },
        { title: t('Numbers'), render: (d) =>
          el('span', { class: 'badge', text: `…-${d.code}-…` }) },
        { title: t('Joined'), class: 'nowrap', render: (d) => fmtDate(d.created_at) },
        { title: t('Last seen'), class: 'nowrap', render: (d) =>
          (d.last_seen_at ? fmtDateTime(d.last_seen_at) : 'never') },
        { title: '', class: 'num', render: (d) => (d.revoked
          ? el('span', { class: 'badge', text: t('Removed') })
          : el('button', {
            class: 'btn btn-sm btn-danger', text: t('Remove'),
            onClick: () => confirmDialog({
              title: t('Remove {name}?', { name: d.name }),
              message: t('It stops syncing immediately. Records it already shared stay, '
                + 'and anything it has not sent yet never arrives.'),
              confirmLabel: t('Remove device'),
              danger: true,
              onConfirm: async () => {
                await api.revokeSyncDevice(d.id);
                toast(t('Device removed'));
                await reload();
              },
            }),
          })) },
      ], devices, {
        empty: t('No other device has joined yet. On the phone, open '
          + 'Settings \u2192 Clinic and use "Join this clinic".'),
      })),
    ]),
    el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [el('h2', { text: t('How this works') })]),
      el('div', { class: 'card-body' }, [
        el('p', { class: 'small muted', text: t('Each device keeps a full copy of the records and can be used with this '
          + 'computer switched off. When they can reach each other they exchange ' + 'what changed, so everyone ends up with the same information.') }),
        el('p', { class: 'small muted', text: t('If the same record is edited in two places, the later edit wins. Separate '
          + 'records \u2014 two payments on one invoice, say \u2014 are both kept, and ' + 'totals are recalculated afterwards.') }),
        el('p', { class: 'small muted', text: t('Each device gets a letter of its own so the file and invoice numbers it '
          + 'creates can never clash with another device\u2019s.') }),
      ]),
    ]),
  ]);
}

/**
 * Said once, after joining: this device now works off the clinic's staff
 * accounts, so the setup sign-in it had been using is gone.
 */
function startAgain(received) {
  modal({
    title: t('Joined the clinic'),
    // However it is dismissed, the next thing to happen is a sign-in.
    onClose: () => window.location.reload(),
    body: el('div', {}, [
      el('p', {}, t('{n} record(s) came across. This device is now part of the clinic '
        + 'and will keep itself in step whenever it can reach the computer — '
        + 'including anything you add while it cannot.', { n: received })),
      el('p', { class: 'small muted', text: t('The temporary sign-in this device was using has been stood down. Sign in '
        + 'again with your own clinic email and password.') }),
    ]),
    footer: [
      el('button', {
        class: 'btn btn-primary', text: t('Sign in'),
        onClick: () => window.location.reload(),
      }),
    ],
  });
}

/** Shows the code to read out to whoever is holding the phone. */
function showPairingCode(pairing, onDone) {
  modal({
    title: t('Add a device'),
    body: el('div', { class: 'center' }, [
      el('p', { class: 'muted', text: t('On the phone: Settings \u2192 Clinic \u2192 Keeping devices in step. '
        + 'Enter this computer\u2019s address and the code below.') }),
      el('div', {
        class: 'mono strong',
        style: { fontSize: '38px', letterSpacing: '8px', margin: '20px 0', color: 'var(--accent)' },
        text: pairing.pairing_code,
      }),
      el('p', { class: 'small faint', text:
        `The code works once and lasts ${pairing.expires_in_minutes} minutes.` }),
    ]),
    footer: [
      el('button', {
        class: 'btn btn-primary', text: t('Done'),
        onClick: async () => { closeModal(); await onDone(); },
      }),
    ],
  });
}
