/**
 * The store cupboard.
 *
 * Built around one question a clinic asks every week — what is running out —
 * so that is what the screen opens on, and what the shopping list prints.
 *
 * Counts are never typed over. Taking three boxes is a movement of minus
 * three with a reason, and the number follows. A stock figure somebody can
 * simply overwrite is one nobody believes by the end of the month.
 */
import { api } from '../api.js';
import {
  state, el, clear, money, cents, toAmount, table, can, modal, closeModal,
  field, input, select, onSubmit, toast, loading, fmtDate, fmtDateTime, confirmDialog,
} from '../ui.js';
import { t } from '../i18n.js';

const filters = { q: '', low: false, all: false };

const UNITS = ['piece', 'box', 'pack', 'bottle', 'tube', 'syringe', 'ml', 'g', 'pair'];

const REASONS = [
  { value: 'received', label: 'Received' },
  { value: 'used', label: 'Used' },
  { value: 'wasted', label: 'Wasted or broken' },
  { value: 'expired', label: 'Expired' },
  { value: 'counted', label: 'Counted on the shelf' },
];

const amount = (item) => `${Number(item.quantity).toLocaleString()} ${t(item.unit)}`;

export default async function stock(ctx) {
  const host = el('div');

  async function load() {
    clear(host).append(loading());
    const params = new URLSearchParams();
    if (filters.q) params.set('q', filters.q);
    if (filters.low) params.set('low', '1');
    if (filters.all) params.set('all', '1');
    const data = await api.stock(params.toString());
    clear(host).append(render(data, load, ctx));
  }

  ctx.setTitle('Stock', 'What the clinic keeps, and what is running out',
    can('stock:write')
      ? el('button', {
        class: 'btn btn-primary', text: t('+ Add item'),
        onClick: () => itemDialog({ onSaved: load }),
      })
      : null);

  await load();
  return host;
}

function render(data, reload, ctx) {
  const search = input('q', {
    type: 'search', value: filters.q, placeholder: t('Search by name, supplier or barcode…'),
    onInput: (event) => {
      filters.q = event.target.value;
      clearTimeout(render.timer);
      render.timer = setTimeout(reload, 250);
    },
  });

  const toggle = (key, label) => el('button', {
    type: 'button',
    class: `btn btn-sm ${filters[key] ? 'btn-primary' : ''}`,
    text: t(label),
    onClick: () => { filters[key] = !filters[key]; reload(); },
  });

  const editable = can('stock:write');

  return el('div', { class: 'stack' }, [
    el('div', { class: 'grid grid-3' }, [
      tile('Items kept', String(data.summary.total)),
      tile('Running out', String(data.summary.low), data.summary.low ? 'neg' : 'pos'),
      tile('Value on the shelf', money(data.summary.value_cents)),
    ]),

    el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [
        el('div', { class: 'search-input' }, [search]),
        el('div', { class: 'row' }, [
          toggle('low', 'Running out only'),
          toggle('all', 'Include retired'),
          data.summary.low
            ? el('button', {
              class: 'btn btn-sm', text: t('🖶 Shopping list'),
              onClick: () => shoppingList(),
            })
            : null,
        ]),
      ]),
      el('div', { class: 'card-body flush' }, table([
        { title: t('Item'), render: (item) => el('div', {}, [
          el('div', { class: item.active ? 'strong' : 'faint' }, item.name),
          el('span', { class: 'small faint' },
            [item.category, item.supplier].filter(Boolean).join(' · ')),
        ]) },
        { title: t('In stock'), class: 'num', render: (item) => el('span', {
          class: item.low ? 'strong' : '',
          style: { color: item.low ? 'var(--danger)' : null },
        }, amount(item)) },
        { title: t('Reorder at'), class: 'num', render: (item) =>
          (item.min_quantity ? `${item.min_quantity} ${t(item.unit)}` : '—') },
        { title: t('Unit cost'), class: 'num', render: (item) =>
          (item.unit_cost_cents ? money(item.unit_cost_cents) : '—') },
        { title: t('Expires'), class: 'nowrap', render: (item) =>
          (item.expires_on ? fmtDate(item.expires_on) : '—') },
        { title: '', class: 'num', render: (item) => (editable
          ? el('div', { class: 'row' }, [
            el('button', {
              class: 'btn btn-sm', text: t('Record use'),
              onClick: (event) => {
                event.stopPropagation();
                moveDialog(item, 'used', reload);
              },
            }),
            el('button', {
              class: 'btn btn-sm btn-primary', text: t('Received'),
              onClick: (event) => {
                event.stopPropagation();
                moveDialog(item, 'received', reload);
              },
            }),
          ])
          : '') },
      ], data.items, {
        onRowClick: (item) => itemHistory(item, reload),
        empty: filters.low
          ? t('Nothing is running out. ')
          : t('No items yet — add what the clinic keeps in its cupboard.'),
      })),
    ]),
  ]);
}

const tile = (label, value, tone) => el('div', { class: 'card stat' }, [
  el('div', { class: 'stat-label', text: t(label) }),
  el('div', { class: `stat-value ${tone || ''}`, text: value }),
]);

/** Add or edit what a thing is. The count is not editable here, on purpose. */
export function itemDialog({ item, onSaved }) {
  const form = el('form', {}, [
    field('Name', input('name', { value: item?.name || '', required: true })),
    el('div', { class: 'field-row' }, [
      field('Category', input('category', {
        value: item?.category || 'General', list: 'stock-categories',
      })),
      field('Unit', select('unit', UNITS.map((u) => ({ value: u, label: t(u) })),
        item?.unit || 'piece')),
    ]),
    el('div', { class: 'field-row' }, [
      item
        ? el('span')
        : field('How many now', input('quantity', { type: 'number', step: '0.001', min: 0,
          value: '0' }), 'The opening count, recorded as a movement'),
      field('Reorder at', input('min_quantity', {
        type: 'number', step: '0.001', min: 0, value: item?.min_quantity ?? 0,
      }), 'Below this it is listed as running out'),
    ]),
    el('div', { class: 'field-row' }, [
      field('Unit cost', input('unit_cost', {
        type: 'number', step: '0.01', min: 0,
        value: item ? toAmount(item.unit_cost_cents) : '',
      })),
      field('Expires', input('expires_on', { type: 'date', value: item?.expires_on || '' })),
    ]),
    el('div', { class: 'field-row' }, [
      field('Supplier', input('supplier', { value: item?.supplier || '' })),
      field('Barcode', input('barcode', { value: item?.barcode || '' })),
    ]),
    field('Notes', input('notes', { value: item?.notes || '' })),
  ]);

  onSubmit(form, async (values) => {
    const body = {
      ...values,
      unit_cost_cents: cents(values.unit_cost),
      min_quantity: Number(values.min_quantity || 0),
      quantity: Number(values.quantity || 0),
    };
    delete body.unit_cost;
    if (item) await api.updateStockItem(item.id, body);
    else await api.addStockItem(body);
    closeModal();
    toast(t(item ? 'Item saved' : 'Item added'), 'success');
    await onSaved();
  });

  modal({
    title: t(item ? 'Edit item' : 'Add an item'),
    width: 'wide',
    body: form,
    footer: [
      item && can('stock:write')
        ? el('button', {
          class: 'btn btn-danger', text: t('Retire'),
          onClick: () => confirmDialog({
            title: t('Retire {name}?', { name: item.name }),
            message: t('It stops appearing in the cupboard. What was used is kept.'),
            confirmLabel: t('Retire'),
            danger: true,
            onConfirm: async () => {
              await api.retireStockItem(item.id);
              closeModal();
              toast(t('Item retired'));
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

/** Deliveries and use, which is how the number ever changes. */
function moveDialog(item, reason, onSaved) {
  const reasonField = select('reason', REASONS.map((r) => ({ ...r, label: t(r.label) })), reason);
  const amountField = input('amount', { type: 'number', step: '0.001', min: 0, required: true });
  const noteField = input('note', { placeholder: t('optional') });

  const hint = el('p', { class: 'field-hint' });
  const describe = () => {
    hint.textContent = reasonField.value === 'counted'
      ? t('Enter what is actually on the shelf. In stock now: {amount}',
        { amount: amount(item) })
      : t('In stock now: {amount}', { amount: amount(item) });
  };
  reasonField.addEventListener('change', describe);
  describe();

  const form = el('form', {}, [
    field('What happened', reasonField),
    field('How many', amountField, ''),
    hint,
    field('Note', noteField),
  ]);

  onSubmit(form, async (values) => {
    await api.moveStock(item.id, {
      reason: values.reason,
      amount: Number(values.amount),
      note: values.note,
    });
    closeModal();
    toast(t('Stock updated'), 'success');
    await onSaved();
  });

  modal({
    title: item.name,
    body: form,
    footer: [
      el('button', { class: 'btn', text: t('Cancel'), onClick: () => closeModal() }),
      el('button', { class: 'btn btn-primary', text: t('Save'),
        onClick: () => form.requestSubmit() }),
    ],
  });
}

/** Every change to one item, so a number that looks wrong can be explained. */
async function itemHistory(item, reload) {
  const { item: current, moves } = await api.stockItem(item.id);
  modal({
    title: current.name,
    width: 'wide',
    body: el('div', { class: 'stack' }, [
      el('dl', { class: 'kv small' }, [
        el('dt', { text: t('In stock') }), el('dd', {}, amount(current)),
        el('dt', { text: t('Reorder at') }),
        el('dd', {}, current.min_quantity ? `${current.min_quantity} ${t(current.unit)}` : '—'),
        el('dt', { text: t('Supplier') }), el('dd', {}, current.supplier || '—'),
        el('dt', { text: t('Value') }),
        el('dd', {}, money(Math.round(current.quantity * current.unit_cost_cents))),
      ]),
      el('div', { class: 'card-body flush' }, table([
        { title: t('When'), class: 'nowrap', render: (m) => fmtDateTime(m.created_at) },
        { title: t('What happened'), render: (m) =>
          t(REASONS.find((r) => r.value === m.reason)?.label || m.reason) },
        { title: t('Change'), class: 'num', render: (m) => el('span', {
          class: 'strong',
          style: { color: m.change > 0 ? 'var(--success)' : 'var(--danger)' },
        }, `${m.change > 0 ? '+' : ''}${m.change}`) },
        { title: t('By'), render: (m) => m.by_name || '—' },
        { title: t('Note'), render: (m) => m.note || '—' },
      ], moves, { empty: t('Nothing recorded yet.') })),
    ]),
    footer: [
      can('stock:write')
        ? el('button', {
          class: 'btn', text: t('Edit item'),
          onClick: () => { closeModal(); itemDialog({ item: current, onSaved: reload }); },
        })
        : null,
      el('button', { class: 'btn btn-primary right', text: t('Close'),
        onClick: () => closeModal() }),
    ].filter(Boolean),
  });
}

/** What to buy, grouped the way the trip to the supplier actually goes. */
async function shoppingList() {
  const { items } = await api.shoppingList();
  const bySupplier = new Map();
  for (const item of items) {
    const key = item.supplier || t('No supplier set');
    if (!bySupplier.has(key)) bySupplier.set(key, []);
    bySupplier.get(key).push(item);
  }

  modal({
    title: t('Shopping list'),
    width: 'wide',
    body: el('div', { class: 'stack print-area' }, [
      el('p', { class: 'small muted no-print',
        text: t('Everything at or below its reorder level.') }),
      ...[...bySupplier].map(([supplier, group]) => el('div', { class: 'card' }, [
        el('div', { class: 'card-head' }, [el('h2', { text: supplier })]),
        el('div', { class: 'card-body flush' }, table([
          { title: t('Item'), render: (i) => i.name },
          { title: t('In stock'), class: 'num', render: (i) => `${i.quantity} ${t(i.unit)}` },
          { title: t('Buy at least'), class: 'num', render: (i) =>
            el('span', { class: 'strong' }, `${i.suggested} ${t(i.unit)}`) },
        ], group, { empty: t('Nothing') })),
      ])),
    ]),
    footer: [
      el('button', { class: 'btn btn-primary', text: t('🖶 Print'),
        onClick: () => window.print() }),
      el('button', { class: 'btn', text: t('Close'), onClick: () => closeModal() }),
    ],
  });
}
