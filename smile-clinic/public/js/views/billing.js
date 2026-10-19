import { t } from '../i18n.js';
import { api } from '../api.js';
import {
  state, el, clear, money, cents, toAmount, fmtDate, table, can, modal,
  closeModal, field, input, select, onSubmit, toast, loading, invoiceBadge, todayISO,
  methodLabel,
} from '../ui.js';
import { patientPicker, paymentDialog, procedureOptions } from './shared.js';
import { whatsappButton } from './whatsapp.js';

const filters = { tab: 'invoices', q: '', status: '', unpaid: false };

export default async function billing(ctx) {
  const host = el('div');

  ctx.setTitle('Billing', 'Invoices, payments and outstanding balances',
    can('invoices:write')
      ? el('button', {
        class: 'btn btn-primary', text: t('+ New invoice'),
        onClick: () => invoiceDialog({ onSaved: () => load() }),
      })
      : null);

  const tabs = el('div', { class: 'tabs' }, [
    ['invoices', 'Invoices'],
    ['payments', 'Payments received'],
  ].map(([id, label]) => el('button', {
    class: `tab ${filters.tab === id ? 'active' : ''}`,
    text: label,
    onClick: (event) => {
      filters.tab = id;
      for (const node of tabs.children) node.classList.remove('active');
      event.target.classList.add('active');
      load();
    },
  })));

  async function load() {
    clear(host).append(loading());
    if (filters.tab === 'invoices') clear(host).append(await invoiceList(ctx, load));
    else clear(host).append(await paymentList(ctx, load));
  }

  await load();
  return el('div', {}, [tabs, host]);
}

async function invoiceList(ctx, reload) {
  const data = await api.invoices({
    q: filters.q, status: filters.status || undefined, unpaid: filters.unpaid ? 1 : 0,
  });

  const search = input('q', { placeholder: t('Search invoice number or patient…'), value: filters.q });
  let timer = null;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { filters.q = search.value.trim(); reload(); }, 250);
  });

  const statusFilter = select('status', [
    { value: '', label: t('All statuses') },
    { value: 'draft', label: t('Draft') },
    { value: 'issued', label: t('Unpaid') },
    { value: 'partial', label: t('Part paid') },
    { value: 'paid', label: t('Paid') },
    { value: 'void', label: t('Void') },
  ], filters.status, { style: { width: 'auto' } });
  statusFilter.addEventListener('change', () => { filters.status = statusFilter.value; reload(); });

  return el('div', { class: 'stack' }, [
    el('div', { class: 'grid grid-3' }, [
      statTile('Billed', money(data.totals.billed_cents)),
      statTile('Collected', money(data.totals.paid_cents), 'pos'),
      statTile('Outstanding', money(data.totals.outstanding_cents),
        data.totals.outstanding_cents > 0 ? 'neg' : ''),
    ]),
    el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [
        el('div', { class: 'search-input', style: { flex: 1, minWidth: '200px' } }, search),
        statusFilter,
        el('button', {
          class: `chip ${filters.unpaid ? 'active' : ''}`, text: t('Unpaid only'),
          onClick: (event) => {
            filters.unpaid = !filters.unpaid;
            event.target.classList.toggle('active', filters.unpaid);
            reload();
          },
        }),
      ]),
      el('div', { class: 'card-body flush' }, table([
        { title: t('Number'), render: (i) => el('span', { class: 'mono' }, i.number) },
        { title: t('Patient'), render: (i) => el('div', {}, [
          el('div', {}, i.patient_name),
          el('span', { class: 'small faint' }, i.patient_code),
        ]) },
        { title: t('Issued'), class: 'nowrap', render: (i) => fmtDate(i.issued_at) },
        { title: t('Status'), render: (i) => invoiceBadge(i.status) },
        { title: t('Total'), class: 'num', render: (i) => money(i.total_cents) },
        { title: t('Paid'), class: 'num', render: (i) => money(i.paid_cents) },
        { title: t('Due'), class: 'num', render: (i) => el('span', {
          class: 'strong',
          style: { color: i.status !== 'void' && i.total_cents - i.paid_cents > 0
            ? 'var(--danger)' : 'var(--text-faint)' },
        }, i.status === 'void' ? '—' : money(i.total_cents - i.paid_cents)) },
        { title: '', class: 'num', render: (i) => el('div', { class: 'row tight',
          style: { justifyContent: 'flex-end' } }, [
          i.status !== 'void'
            ? whatsappButton({
              patientId: i.patient_id, invoiceId: i.id, preferTemplate: 'invoice_issued',
            }, { label: t('Send') })
            : null,
          can('payments:write') && ['issued', 'partial'].includes(i.status)
            ? el('button', {
              class: 'btn btn-sm btn-primary', text: t('Pay'),
              onClick: (event) => {
                event.stopPropagation();
                paymentDialog({ invoice: i, onSaved: reload });
              },
            })
            : null,
        ]) },
      ], data.invoices, {
        onRowClick: (i) => invoiceDialog({ invoiceId: i.id, onSaved: reload }),
        empty: t('No invoices match these filters.'),
      })),
    ]),
  ]);
}

async function paymentList(ctx, reload) {
  const from = `${todayISO().slice(0, 7)}-01`;
  const data = await api.payments({ from, to: todayISO() });

  return el('div', { class: 'stack' }, [
    el('div', { class: 'grid grid-2' }, [
      statTile('Collected this month', money(data.total_cents), 'pos'),
      statTile('Receipts', String(data.payments.length)),
    ]),
    el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [
        el('h2', { text: t('Payments this month') }),
        can('reports:read')
          ? el('a', {
            class: 'btn btn-sm',
            href: api.exportUrl('payments', { from, to: todayISO() }),
            text: t('↓ CSV'),
          })
          : null,
      ]),
      el('div', { class: 'card-body flush' }, table([
        { title: t('Date'), class: 'nowrap', render: (p) => fmtDate(p.paid_at) },
        { title: t('Patient'), render: (p) => p.patient_name },
        { title: t('Invoice'), render: (p) => p.invoice_number
          ? el('span', { class: 'mono small' }, p.invoice_number)
          : el('span', { class: 'small faint' }, t('On account')) },
        { title: t('Method'), render: (p) => methodLabel(p.method) },
        { title: t('Taken by'), render: (p) => el('span', { class: 'small faint' }, p.created_by_name || '—') },
        { title: t('Amount'), class: 'num', render: (p) => el('span', {
          class: 'strong',
          style: { color: p.direction === 'refund' ? 'var(--danger)' : 'var(--success)' },
        }, `${p.direction === 'refund' ? '−' : ''}${money(p.amount_cents)}`) },
      ], data.payments, { empty: t('No payments recorded this month.') })),
    ]),
  ]);
}

const statTile = (label, value, tone) => el('div', { class: 'card stat' }, [
  el('div', { class: 'stat-label', text: t(label) }),
  el('div', { class: `stat-value ${tone || ''}`, text: value }),
]);

/**
 * One dialog for the whole invoice lifecycle: build a new one, review an
 * existing one, take payment, print it, or void it.
 */
export async function invoiceDialog({ invoiceId, patient, onSaved }) {
  if (invoiceId) return viewInvoice(invoiceId, onSaved);
  return buildInvoice(patient, onSaved);
}

async function viewInvoice(invoiceId, onSaved) {
  const { invoice, items, payments, settings } = await api.invoice(invoiceId);
  const due = invoice.total_cents - invoice.paid_cents;

  const body = el('div', { id: 'invoice-print' }, [
    el('div', { class: 'row', style: { marginBottom: '16px', alignItems: 'flex-start' } }, [
      el('div', {}, [
        el('h3', { text: settings.clinic_name }),
        el('div', { class: 'small faint' }, settings.clinic_address || ''),
        el('div', { class: 'small faint' },
          [settings.clinic_phone, settings.clinic_email].filter(Boolean).join(' · ')),
      ]),
      el('div', { class: 'right', style: { textAlign: 'right' } }, [
        el('div', { class: 'mono strong', style: { fontSize: '15px' } }, invoice.number),
        el('div', { class: 'small faint' }, t('Issued {date}', { date: fmtDate(invoice.issued_at) })),
        invoice.due_at ? el('div', { class: 'small faint' }, t('Due {date}', { date: fmtDate(invoice.due_at) })) : null,
        el('div', { style: { marginTop: '6px' } }, invoiceBadge(invoice.status)),
      ]),
    ]),
    el('div', { class: 'card', style: { padding: '11px 14px', marginBottom: '16px' } }, [
      el('div', { class: 'small faint', text: t('Billed to') }),
      el('div', { class: 'strong' }, invoice.patient_name),
      el('div', { class: 'small faint' },
        [invoice.patient_code, invoice.patient_phone, invoice.patient_address]
          .filter(Boolean).join(' · ')),
    ]),
    table([
      { title: t('Description'), render: (i) => el('div', {}, [
        el('div', {}, i.description),
        i.tooth ? el('span', { class: 'small faint' }, t('Tooth {n}', { n: i.tooth })) : null,
      ]) },
      { title: t('Qty'), class: 'num', render: (i) => String(i.quantity) },
      { title: t('Unit'), class: 'num', render: (i) => money(i.unit_price_cents) },
      { title: t('Discount'), class: 'num', render: (i) => i.discount_cents
        ? `−${money(i.discount_cents)}` : '—' },
      { title: t('Total'), class: 'num', render: (i) => el('span', { class: 'strong' },
        money(i.line_total_cents)) },
    ], items),
    el('div', { class: 'totals mt' }, [
      totalsRow('Subtotal', money(invoice.subtotal_cents)),
      invoice.discount_cents ? totalsRow('Invoice discount', `−${money(invoice.discount_cents)}`) : null,
      invoice.tax_cents ? totalsRow('Tax', money(invoice.tax_cents)) : null,
      el('div', { class: 'totals-row grand' }, [
        el('span', { text: t('Total') }), el('span', { text: money(invoice.total_cents) }),
      ]),
      totalsRow('Paid', money(invoice.paid_cents)),
      el('div', { class: 'totals-row', style: { fontWeight: 700,
        color: due > 0 ? 'var(--danger)' : 'var(--success)' } }, [
        el('span', { text: due > 0 ? 'Balance due' : 'Settled' }),
        el('span', { text: money(Math.max(0, due)) }),
      ]),
    ]),
    payments.length
      ? el('div', { class: 'mt' }, [
        el('h4', { class: 'muted', text: t('Payments'), style: { marginBottom: '6px' } }),
        table([
          { title: t('Date'), render: (p) => fmtDate(p.paid_at) },
          { title: t('Method'), render: (p) => methodLabel(p.method) },
          { title: t('Reference'), render: (p) => p.reference || '—' },
          { title: t('Amount'), class: 'num', render: (p) =>
            `${p.direction === 'refund' ? '−' : ''}${money(p.amount_cents)}` },
        ], payments),
      ])
      : null,
    invoice.notes ? el('p', { class: 'small faint mt', text: invoice.notes }) : null,
    invoice.void_reason
      ? el('p', { class: 'alert-chip mt', text: t('Voided: {reason}', { reason: invoice.void_reason }) })
      : null,
    el('p', { class: 'small faint mt', text: settings.invoice_terms || '' }),
  ]);

  const refresh = async () => { closeModal(); if (onSaved) await onSaved(); };

  modal({
    title: t('Invoice {number}', { number: invoice.number }),
    body,
    width: 'wide',
    footer: [
      el('button', { class: 'btn', text: t('🖶 Print'), onClick: () => window.print() }),
      invoice.status === 'draft' && can('invoices:write')
        ? el('button', {
          class: 'btn', text: t('Issue'),
          onClick: async () => { await api.issueInvoice(invoice.id); toast(t('Invoice issued'), 'success'); await refresh(); },
        })
        : null,
      can('invoices:void') && !['void', 'paid'].includes(invoice.status)
        ? el('button', {
          class: 'btn btn-danger', text: t('Void'),
          onClick: () => confirmVoid(invoice, refresh),
        })
        : null,
      el('div', { class: 'spacer' }),
      whatsappButton({
        patientId: invoice.patient_id, invoiceId: invoice.id,
        preferTemplate: due > 0 ? 'invoice_issued' : 'payment_receipt',
        onSent: onSaved,
      }, { label: t('WhatsApp'), small: false }),
      el('a', { class: 'btn', href: `#/patients/${invoice.patient_id}`,
        text: t('Patient file'), onClick: () => closeModal() }),
      can('payments:write') && due > 0 && !['void', 'draft'].includes(invoice.status)
        ? el('button', {
          class: 'btn btn-primary', text: t('Take {amount}', { amount: money(due) }),
          onClick: () => { closeModal(); paymentDialog({ invoice, onSaved }); },
        })
        : null,
    ],
  });
}

function confirmVoid(invoice, refresh) {
  const reason = input('reason', { required: true, placeholder: t('Why is this being voided?') });
  const form = el('form', {}, [field('Reason', reason)]);
  onSubmit(form, async (data) => {
    await api.voidInvoice(invoice.id, { reason: data.reason });
    toast(t('Invoice voided'));
    await refresh();
  });
  modal({
    title: t('Void {number}?', { number: invoice.number }),
    body: el('div', {}, [
      el('p', { text: t('The invoice keeps its number in the ledger but stops counting as owed. ' +
        'Any treatments on it become billable again.') }),
      form,
    ]),
    footer: [
      el('button', { class: 'btn', text: t('Keep invoice'), onClick: () => closeModal() }),
      el('button', { class: 'btn btn-danger', text: t('Void invoice'),
        onClick: () => form.requestSubmit() }),
    ],
  });
}

const totalsRow = (label, value) => el('div', { class: 'totals-row' }, [
  el('span', { class: 'muted', text: label }), el('span', { text: value }),
]);

/** Line-item editor for a brand new invoice. */
async function buildInvoice(patient, onSaved) {
  const lines = [];
  const linesBody = el('tbody');
  const totalsBox = el('div', { class: 'totals' });
  const discountInput = input('discount', { type: 'number', step: '0.01', min: '0', value: '0.00',
    style: { width: '110px' } });
  discountInput.addEventListener('input', recalc);

  function recalc() {
    const subtotal = lines.reduce((sum, line) => sum + lineTotal(line), 0);
    const discount = Math.min(cents(discountInput.value), subtotal);
    const base = subtotal - discount;
    const ratio = subtotal > 0 ? base / subtotal : 0;
    const tax = lines.reduce((sum, line) =>
      sum + Math.round((Math.round(lineTotal(line) * ratio) * line.tax_rate_bp) / 10000), 0);
    clear(totalsBox).append(
      totalsRow('Subtotal', money(subtotal)),
      discount ? totalsRow('Discount', `−${money(discount)}`) : null,
      tax ? totalsRow('Tax', money(tax)) : null,
      el('div', { class: 'totals-row grand' }, [
        el('span', { text: t('Total') }), el('span', { text: money(base + tax) }),
      ]),
    );
  }

  const lineTotal = (line) =>
    Math.max(0, cents(line.unit_price) * (Number(line.quantity) || 1) - cents(line.discount));

  function addLine(preset = {}) {
    const line = {
      procedure_id: preset.procedure_id || '',
      description: preset.description || '',
      quantity: 1,
      unit_price: preset.unit_price ?? '0.00',
      discount: '0.00',
      tooth: preset.tooth || '',
      tax_rate_bp: preset.tax_rate_bp ?? Number(state.settings.default_tax_rate_bp || 0),
    };
    lines.push(line);

    const procedure = select('', procedureOptions(), line.procedure_id, { style: { minWidth: '180px' } });
    const description = input('', { value: line.description, placeholder: t('Description') });
    const quantity = input('', { type: 'number', min: 1, value: 1, style: { width: '62px' } });
    const tooth = input('', { type: 'number', min: 11, max: 85, value: line.tooth,
      placeholder: '—', style: { width: '68px' } });
    const price = input('', { type: 'number', step: '0.01', min: '0', value: line.unit_price,
      style: { width: '100px' } });
    const discount = input('', { type: 'number', step: '0.01', min: '0', value: '0.00',
      style: { width: '100px' } });

    procedure.addEventListener('change', () => {
      const chosen = state.procedures.find((p) => String(p.id) === procedure.value);
      line.procedure_id = procedure.value;
      if (chosen) {
        line.tax_rate_bp = chosen.tax_rate_bp;
        description.value = chosen.name;
        price.value = toAmount(chosen.default_price_cents);
        line.description = description.value;
        line.unit_price = price.value;
      }
      recalc();
    });
    for (const [node, key] of [[description, 'description'], [quantity, 'quantity'],
      [price, 'unit_price'], [discount, 'discount'], [tooth, 'tooth']]) {
      node.addEventListener('input', () => { line[key] = node.value; recalc(); });
    }

    const tr = el('tr', {}, [
      el('td', {}, procedure),
      el('td', {}, description),
      el('td', {}, tooth),
      el('td', { class: 'num' }, quantity),
      el('td', { class: 'num' }, price),
      el('td', { class: 'num' }, discount),
      el('td', { class: 'num' }, el('button', {
        class: 'btn btn-sm btn-ghost', type: 'button', text: '✕',
        onClick: () => { lines.splice(lines.indexOf(line), 1); tr.remove(); recalc(); },
      })),
    ]);
    linesBody.append(tr);
    recalc();
  }

  const form = el('form', {}, [
    patient
      ? field('Patient', el('div', { class: 'card', style: { padding: '9px 12px' } }, [
        el('span', { class: 'strong' }, `${patient.first_name} ${patient.last_name}`),
        el('span', { class: 'small faint' }, ` · ${patient.code}`),
        el('input', { type: 'hidden', name: 'patient_id', value: patient.id }),
      ]))
      : field('Patient', patientPicker({ onPick: loadPending })),
    el('div', { class: 'field-row-3' }, [
      field('Issue date', input('issued_at', { type: 'date', value: todayISO(), required: true })),
      field('Due date', input('due_at', { type: 'date' })),
      field('Status', select('status', [
        { value: 'issued', label: t('Issue now') },
        { value: 'draft', label: t('Save as draft') },
      ], 'issued')),
    ]),
    el('div', { class: 'table-wrap invoice-lines' }, el('table', {}, [
      el('thead', {}, el('tr', {}, [
        el('th', { text: t('Procedure') }), el('th', { text: t('Description') }),
        el('th', { text: t('Tooth') }), el('th', { class: 'num', text: t('Qty') }),
        el('th', { class: 'num', text: t('Unit price') }), el('th', { class: 'num', text: t('Discount') }),
        el('th', {}),
      ])),
      linesBody,
    ])),
    el('div', { class: 'row mt' }, [
      el('button', { class: 'btn btn-sm', type: 'button', text: t('+ Add line'),
        onClick: () => addLine() }),
      el('div', { class: 'right row tight' }, [
        el('label', { text: t('Invoice discount'), style: { margin: 0 } }), discountInput,
      ]),
    ]),
    totalsBox,
    field('Notes', input('notes', { maxlength: 300 })),
  ]);

  /** Offer to pull the patient's completed-but-unbilled work into the invoice. */
  async function loadPending(chosen) {
    const { treatments } = await api.treatments({ patient_id: chosen.id, uninvoiced: 1 });
    const billable = treatments.filter((tr) => tr.status === 'completed');
    if (!billable.length) return;
    if (!confirm(`${billable.length} completed treatment(s) are not yet invoiced. Add them?`)) return;
    for (const t of billable) {
      addLine({
        procedure_id: t.procedure_id,
        description: t.tooth ? `${t.procedure_name} — tooth ${t.tooth}` : t.procedure_name,
        unit_price: toAmount(t.price_cents),
        tooth: t.tooth || '',
        tax_rate_bp: t.tax_rate_bp,
      });
      lines.at(-1).treatment_id = t.id;
      lines.at(-1).discount = toAmount(t.discount_cents);
    }
  }

  if (patient) await loadPending(patient);
  if (!lines.length) addLine();

  onSubmit(form, async (data) => {
    if (!data.patient_id) throw new Error('Please choose a patient');
    if (!lines.length) throw new Error('Add at least one line');
    const { invoice } = await api.createInvoice({
      patient_id: Number(data.patient_id),
      issued_at: data.issued_at,
      due_at: data.due_at || null,
      status: data.status,
      discount: Number(discountInput.value || 0),
      notes: data.notes,
      items: lines.map((line) => ({
        treatment_id: line.treatment_id,
        procedure_id: line.procedure_id ? Number(line.procedure_id) : null,
        description: line.description,
        tooth: line.tooth ? Number(line.tooth) : null,
        quantity: Number(line.quantity) || 1,
        unit_price: Number(line.unit_price) || 0,
        discount: Number(line.discount) || 0,
        tax_rate_bp: line.tax_rate_bp,
      })),
    });
    closeModal();
    toast(t('Invoice {number} created', { number: invoice.number }), 'success');
    if (onSaved) await onSaved();
  });

  modal({
    title: t('New invoice'),
    body: form,
    width: 'xwide',
    footer: [
      el('button', { class: 'btn', text: t('Cancel'), onClick: () => closeModal() }),
      el('button', { class: 'btn btn-primary', text: t('Create invoice'),
        onClick: () => form.requestSubmit() }),
    ],
  });
}
