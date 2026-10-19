import { t } from '../i18n.js';
import { api } from '../api.js';
import {
  el, clear, money, fmtDate, fmtTime, age, table, emptyState, can,
  avatar, appointmentBadge, invoiceBadge, treatmentBadge, toast, confirmDialog,
  methodLabel, TOOTH_CONDITIONS,
} from '../ui.js';
import { patientDialog } from './patients.js';
import {
  appointmentDialog, paymentDialog, treatmentDialog, toothDialog,
} from './shared.js';
import { invoiceDialog } from './billing.js';
import { whatsappButton } from './whatsapp.js';

const UPPER_RIGHT = [18, 17, 16, 15, 14, 13, 12, 11];
const UPPER_LEFT = [21, 22, 23, 24, 25, 26, 27, 28];
const LOWER_RIGHT = [48, 47, 46, 45, 44, 43, 42, 41];
const LOWER_LEFT = [31, 32, 33, 34, 35, 36, 37, 38];

let activeTab = 'overview';

export default async function patientView(ctx) {
  const patientId = Number(ctx.params[0]);
  const data = await api.patientSummary(patientId);
  const p = data.patient;
  const reload = () => ctx.rerender();

  ctx.setTitle(
    el('span', { class: 'row tight' }, [
      avatar(`${p.first_name} ${p.last_name}`, 'var(--accent)', 26),
      el('span', { text: `${p.first_name} ${p.last_name}` }),
      p.archived ? el('span', { class: 'badge', text: t('Archived') }) : null,
    ]),
    [
      el('span', { class: 'mono', text: p.code }),
      el('span', { text: p.dob ? ` · ${age(p.dob)} yrs · ${fmtDate(p.dob)}` : '' }),
      p.phone ? el('span', { text: ` · ${p.phone}` }) : null,
    ].filter(Boolean).reduce((host, node) => (host.append(node), host), el('span')),
    [
      el('a', { class: 'btn', href: '#/patients', text: t('← All patients') }),
      can('appointments:write')
        ? el('button', { class: 'btn', text: t('Book'), onClick: () =>
          appointmentDialog({ patient: p, onSaved: reload }) })
        : null,
      can('patients:write')
        ? el('button', { class: 'btn', text: t('Edit'), onClick: () =>
          patientDialog({ patient: p, onSaved: reload }) })
        : null,
      whatsappButton({ patientId: p.id, onSent: reload }, { label: t('WhatsApp'), small: false }),
      can('payments:write')
        ? el('button', { class: 'btn btn-primary', text: t('Take payment'), onClick: () =>
          paymentDialog({ patient: p, onSaved: reload }) })
        : null,
    ],
  );

  const TABS = [
    { id: 'overview', label: t('Overview') },
    { id: 'chart', label: t('Odontogram'), permission: 'clinical:read' },
    { id: 'treatments', label: t('Treatments ({n})', { n: data.treatments.length }) },
    { id: 'appointments', label: t('Visits ({n})', { n: data.appointments.length }) },
    { id: 'billing', label: t('Billing ({n})', { n: data.invoices.length }), permission: 'invoices:read' },
  ].filter((row) => !row.permission || can(row.permission));

  if (!TABS.some((row) => row.id === activeTab)) activeTab = 'overview';

  const body = el('div');
  const tabs = el('div', { class: 'tabs' }, TABS.map((tab) =>
    el('button', {
      class: `tab ${tab.id === activeTab ? 'active' : ''}`,
      text: tab.label,
      onClick: () => {
        activeTab = tab.id;
        for (const node of tabs.children) node.classList.remove('active');
        tabs.children[TABS.indexOf(tab)].classList.add('active');
        renderTab();
      },
    })));

  function renderTab() {
    clear(body);
    const render = {
      overview: () => overviewTab(data, ctx),
      chart: () => chartTab(data, ctx),
      treatments: () => treatmentsTab(data, ctx),
      appointments: () => appointmentsTab(data, ctx),
      billing: () => billingTab(data, ctx),
    }[activeTab];
    body.append(render());
  }
  renderTab();

  return el('div', {}, [alerts(p), tabs, body]);
}

function alerts(p) {
  const items = [];
  if (p.allergies) items.push(el('span', { class: 'alert-chip' }, `⚠ ${t('Allergies: {list}', { list: p.allergies })}`));
  if (p.balance_cents > 0) {
    items.push(el('span', { class: 'alert-chip', style: {
      background: 'var(--warning-soft)', color: 'var(--warning)',
    } }, t('Outstanding balance {amount}', { amount: money(p.balance_cents) })));
    const remind = whatsappButton(
      { patientId: p.id, preferTemplate: 'balance_reminder' }, { label: t('Remind on WhatsApp') },
    );
    if (remind) items.push(remind);
  }
  if (!items.length) return null;
  return el('div', { class: 'row', style: { marginBottom: '14px' } }, items);
}

// ---------- Overview -----------------------------------------------------
function overviewTab(data, ctx) {
  const p = data.patient;
  const upcoming = data.appointments
    .filter((a) => ['scheduled', 'confirmed', 'arrived'].includes(a.status))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  return el('div', { class: 'stack' }, [
    el('div', { class: 'grid grid-4' }, [
      stat('Outstanding', money(p.balance_cents), p.balance_cents > 0 ? 'neg' : ''),
      stat('Paid to date', money(data.stats.paid_cents), 'pos'),
      stat('Visits', String(data.stats.visits),
        data.stats.no_shows ? `${data.stats.no_shows} no-show` : ''),
      stat('Planned work', String(data.stats.planned_treatments)),
    ]),
    el('div', { class: 'grid grid-2' }, [
      el('div', { class: 'card' }, [
        el('div', { class: 'card-head' }, [el('h2', { text: t('Details') })]),
        el('div', { class: 'card-body' }, el('dl', { class: 'kv' }, [
          row('File number', el('span', { class: 'mono' }, p.code)),
          row('Date of birth', p.dob ? `${fmtDate(p.dob)} (${age(p.dob)} yrs)` : '—'),
          row('Gender', p.gender || '—'),
          row('Phone', p.phone || '—'),
          row('Email', p.email || '—'),
          row('Address', [p.address, p.city].filter(Boolean).join(', ') || '—'),
          row('ID number', p.national_id || '—'),
          row('Insurance', p.insurance_provider
            ? `${p.insurance_provider}${p.insurance_number ? ` · ${p.insurance_number}` : ''}`
            : '—'),
          row('Referred by', p.referral_source || '—'),
          row('Patient since', fmtDate(p.created_at)),
        ].flat())),
      ]),
      el('div', { class: 'stack' }, [
        el('div', { class: 'card' }, [
          el('div', { class: 'card-head' }, [el('h2', { text: t('Medical notes') })]),
          el('div', { class: 'card-body' }, [
            p.allergies
              ? el('div', { class: 'alert-chip', style: { marginBottom: '10px' } },
                `⚠ Allergies: ${p.allergies}`)
              : null,
            el('div', { class: p.medical_notes ? '' : 'faint' },
              p.medical_notes || 'No medical notes recorded.'),
          ]),
        ]),
        el('div', { class: 'card' }, [
          el('div', { class: 'card-head' }, [el('h2', { text: t('Upcoming visits') })]),
          el('div', { class: 'card-body flush' }, upcoming.length
            ? table([
              { title: t('When'), render: (a) => el('span', { class: 'nowrap' },
                `${fmtDate(a.starts_at, { withYear: false })} ${fmtTime(a.starts_at)}`) },
              { title: t('Procedure'), render: (a) => a.procedure_name || a.reason || '—' },
              { title: t('With'), render: (a) => a.dentist_name },
              { title: '', render: (a) => appointmentBadge(a.status) },
            ], upcoming, {
              onRowClick: (a) => appointmentDialog({ appointment: a, onSaved: ctx.rerender }),
            })
            : emptyState('No upcoming appointments.', '▦')),
        ]),
      ]),
    ]),
  ]);
}

const stat = (label, value, tone) => el('div', { class: 'card stat' }, [
  el('div', { class: 'stat-label', text: t(label) }),
  el('div', { class: `stat-value ${tone || ''}`, text: value }),
]);

const row = (label, value) => [
  el('dt', { text: t(label) }),
  el('dd', {}, value instanceof Node ? value : String(value)),
];

// ---------- Odontogram ---------------------------------------------------
function chartTab(data, ctx) {
  const byTooth = new Map(data.chart.map((row) => [row.tooth, row]));
  const editable = can('clinical:write');

  const quadrant = (teeth, flip) => el('div', { class: `quadrant ${flip ? 'flip' : ''}` },
    teeth.map((number) => {
      const entry = byTooth.get(number);
      const condition = entry?.condition || 'healthy';
      const label = TOOTH_CONDITIONS.find((c) => c.value === condition)?.label || condition;
      return el('button', {
        class: 'tooth',
        dataset: { condition },
        title: `Tooth ${number} — ${label}${entry?.surfaces ? ` (${entry.surfaces})` : ''}` +
          `${entry?.note ? `\n${entry.note}` : ''}`,
        onClick: editable
          ? () => toothDialog({
            patientId: data.patient.id, tooth: number, current: entry, onSaved: ctx.rerender,
          })
          : null,
      }, [
        el('div', { class: 'tooth-shape', text: entry?.surfaces || (condition === 'missing' ? '×' : '') }),
        el('div', { class: 'tooth-num', text: String(number) }),
      ]);
    }));

  const charted = data.chart.filter((row) => row.condition !== 'healthy');

  return el('div', { class: 'stack' }, [
    el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [
        el('h2', { text: t('Odontogram') }),
        el('span', { class: 'small faint',
          text: editable ? 'Click a tooth to record its condition' : 'Read-only' }),
      ]),
      el('div', { class: 'card-body' }, [
        el('div', { class: 'odontogram' }, [
          el('div', { class: 'arch' }, [quadrant(UPPER_RIGHT, false), quadrant(UPPER_LEFT, false)]),
          el('div', { class: 'arch' }, [quadrant(LOWER_RIGHT, false), quadrant(LOWER_LEFT, false)]),
        ]),
        el('div', { class: 'legend mt center', style: { justifyContent: 'center' } },
          TOOTH_CONDITIONS.filter((c) => c.value !== 'healthy').map((c) =>
            el('span', { class: 'legend-item' }, [
              el('span', {
                class: 'legend-swatch tooth-shape',
                dataset: { condition: c.value },
                style: { width: '11px', height: '11px', borderRadius: '3px', display: 'block' },
              }),
              el('span', {}, c.label),
            ]))),
      ]),
    ]),
    el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [el('h2', { text: t('Charted findings') })]),
      el('div', { class: 'card-body flush' }, charted.length
        ? table([
          { title: t('Tooth'), render: (row) => el('span', { class: 'mono strong' }, String(row.tooth)) },
          { title: t('Condition'), render: (row) =>
            TOOTH_CONDITIONS.find((c) => c.value === row.condition)?.label || row.condition },
          { title: t('Surfaces'), render: (row) => row.surfaces || '—' },
          { title: t('Note'), render: (row) => row.note || '—' },
          { title: t('Updated'), class: 'num', render: (row) =>
            el('span', { class: 'small faint' }, fmtDate(row.updated_at)) },
        ], charted.sort((a, b) => a.tooth - b.tooth))
        : emptyState('Nothing charted yet — click a tooth above to start.', '🦷')),
    ]),
  ]);
}

// ---------- Treatments ---------------------------------------------------
function treatmentsTab(data, ctx) {
  const editable = can('treatments:write');
  const pendingValue = data.treatments
    .filter((row) => row.status === 'completed' && !row.invoiced)
    .reduce((sum, t) => sum + (t.price_cents - t.discount_cents), 0);

  return el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', { text: t('Treatment plan and history') }),
      pendingValue > 0 && can('invoices:write')
        ? el('button', {
          class: 'btn btn-primary btn-sm',
          text: t('Invoice {amount} of completed work', { amount: money(pendingValue) }),
          onClick: async () => {
            const { invoice } = await api.invoicePending(data.patient.id);
            toast(t('Invoice {number} created', { number: invoice.number }), 'success');
            await ctx.rerender();
          },
        })
        : null,
      editable
        ? el('button', {
          class: 'btn btn-sm', text: t('+ Add treatment'),
          onClick: () => treatmentDialog({ patientId: data.patient.id, onSaved: ctx.rerender }),
        })
        : null,
    ]),
    el('div', { class: 'card-body flush' }, table([
      { title: t('Date'), class: 'nowrap', render: (row) =>
        fmtDate(row.completed_at || row.planned_at || row.created_at, { withYear: false }) },
      { title: t('Procedure'), render: (row) => el('div', {}, [
        el('div', { class: 'strong' }, row.procedure_name),
        el('span', { class: 'small faint' }, row.procedure_code),
      ]) },
      { title: t('Tooth'), render: (row) => row.tooth
        ? el('span', { class: 'mono' }, `${row.tooth}${row.surfaces ? ` ${row.surfaces}` : ''}`)
        : '—' },
      { title: t('By'), render: (row) => el('span', { class: 'small' }, row.dentist_name || '—') },
      { title: t('Status'), render: (row) => treatmentBadge(row.status) },
      { title: t('Billing'), render: (row) => row.invoiced
        ? el('span', { class: 'badge badge-success', text: t('Invoiced') })
        : el('span', { class: 'small faint' }, row.status === 'completed' ? 'Not invoiced' : '—') },
      { title: t('Fee'), class: 'num', render: (row) => el('span', { class: 'strong' },
        money(row.price_cents - row.discount_cents)) },
      { title: '', class: 'num', render: (row) => (editable && !row.invoiced
        ? el('button', {
          class: 'btn btn-sm', text: t('Edit'),
          onClick: () => treatmentDialog({
            patientId: data.patient.id, treatment: row, onSaved: ctx.rerender,
          }),
        })
        : '') },
    ], data.treatments, { empty: t('No treatments recorded yet.') })),
  ]);
}

// ---------- Visits -------------------------------------------------------
function appointmentsTab(data, ctx) {
  return el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', { text: t('Visit history') }),
      can('appointments:write')
        ? el('button', {
          class: 'btn btn-sm', text: t('+ Book appointment'),
          onClick: () => appointmentDialog({ patient: data.patient, onSaved: ctx.rerender }),
        })
        : null,
    ]),
    el('div', { class: 'card-body flush' }, table([
      { title: t('When'), class: 'nowrap', render: (a) =>
        `${fmtDate(a.starts_at)} · ${fmtTime(a.starts_at)}` },
      { title: t('Procedure'), render: (a) => a.procedure_name || a.reason || '—' },
      { title: t('With'), render: (a) => a.dentist_name },
      { title: t('Chair'), render: (a) => el('span', { class: 'small faint' }, a.operatory) },
      { title: t('Status'), render: (a) => appointmentBadge(a.status) },
      { title: t('Note'), render: (a) => el('span', { class: 'small faint' },
        a.cancel_reason || a.notes || '') },
    ], data.appointments, {
      onRowClick: (a) => appointmentDialog({ appointment: a, onSaved: ctx.rerender }),
      empty: t('No visits yet.'),
    })),
  ]);
}

// ---------- Billing ------------------------------------------------------
function billingTab(data, ctx) {
  return el('div', { class: 'stack' }, [
    el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [
        el('h2', { text: t('Invoices') }),
        can('invoices:write')
          ? el('button', {
            class: 'btn btn-sm', text: t('+ New invoice'),
            onClick: () => invoiceDialog({ patient: data.patient, onSaved: ctx.rerender }),
          })
          : null,
      ]),
      el('div', { class: 'card-body flush' }, table([
        { title: t('Number'), render: (i) => el('span', { class: 'mono' }, i.number) },
        { title: t('Issued'), class: 'nowrap', render: (i) => fmtDate(i.issued_at) },
        { title: t('Status'), render: (i) => invoiceBadge(i.status) },
        { title: t('Total'), class: 'num', render: (i) => money(i.total_cents) },
        { title: t('Paid'), class: 'num', render: (i) => money(i.paid_cents) },
        { title: t('Due'), class: 'num', render: (i) => el('span', {
          class: 'strong',
          style: { color: i.total_cents - i.paid_cents > 0 && i.status !== 'void'
            ? 'var(--danger)' : 'var(--text-faint)' },
        }, i.status === 'void' ? '—' : money(i.total_cents - i.paid_cents)) },
        { title: '', class: 'num', render: (i) => (i.status === 'void' ? '' : whatsappButton({
          patientId: data.patient.id, invoiceId: i.id, preferTemplate: 'invoice_issued',
        }, { label: t('Send') }) || '') },
      ], data.invoices, {
        onRowClick: (i) => invoiceDialog({ invoiceId: i.id, onSaved: ctx.rerender }),
        empty: t('No invoices for this patient.'),
      })),
    ]),
    el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [
        el('h2', { text: t('Payment history') }),
        can('payments:write')
          ? el('button', {
            class: 'btn btn-sm', text: t('+ Record payment'),
            onClick: () => paymentDialog({ patient: data.patient, onSaved: ctx.rerender }),
          })
          : null,
      ]),
      el('div', { class: 'card-body flush' }, table([
        { title: t('Date'), class: 'nowrap', render: (p) => fmtDate(p.paid_at) },
        { title: t('Invoice'), render: (p) => p.invoice_number
          ? el('span', { class: 'mono small' }, p.invoice_number)
          : el('span', { class: 'small faint' }, t('On account')) },
        { title: t('Method'), render: (p) => methodLabel(p.method) },
        { title: t('Reference'), render: (p) => el('span', { class: 'small faint' }, p.reference || '—') },
        { title: t('Taken by'), render: (p) => el('span', { class: 'small faint' }, p.created_by_name || '—') },
        { title: t('Amount'), class: 'num', render: (p) => el('span', {
          class: 'strong',
          style: { color: p.direction === 'refund' ? 'var(--danger)' : 'var(--success)' },
        }, `${p.direction === 'refund' ? '−' : ''}${money(p.amount_cents)}`) },
        { title: '', class: 'num', render: (p) => el('div', { class: 'row tight',
          style: { justifyContent: 'flex-end' } }, [
          p.direction === 'in' ? whatsappButton({
            patientId: data.patient.id, paymentId: p.id, preferTemplate: 'payment_receipt',
          }, { label: t('Receipt') }) : null,
          can('payments:delete')
          ? el('button', {
            class: 'btn btn-sm btn-danger', text: t('Delete'),
            onClick: () => confirmDialog({
              title: t('Delete this payment?'),
              message: `This removes ${money(p.amount_cents)} from the ledger. ` +
                'Use a refund instead if money was actually returned.',
              confirmLabel: t('Delete payment'),
              danger: true,
              onConfirm: async () => {
                await api.deletePayment(p.id);
                toast(t('Payment deleted'));
                await ctx.rerender();
              },
            }),
          })
          : null,
        ]) },
      ], data.payments, { empty: t('No payments recorded.') })),
    ]),
  ]);
}
