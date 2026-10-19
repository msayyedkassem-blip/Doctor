import { t } from '../i18n.js';
import { api } from '../api.js';
import {
  state, el, clear, money, fmtDate, table, can, modal, closeModal, field, input, select,
  onSubmit, toast, loading, todayISO, startOfMonth, methodLabel, confirmDialog,
} from '../ui.js';

const filters = { from: startOfMonth(todayISO()), to: todayISO(), category: '' };

export default async function expenses(ctx) {
  const host = el('div');

  ctx.setTitle('Expenses', 'What the clinic spends, so profit is a real number',
    can('expenses:write')
      ? el('button', {
        class: 'btn btn-primary', text: t('+ Record expense'),
        onClick: () => expenseDialog({ onSaved: load }),
      })
      : null);

  const categories = (state.settings.expense_categories || 'Other')
    .split(',').map((c) => c.trim()).filter(Boolean);

  const fromInput = input('from', { type: 'date', value: filters.from, style: { width: 'auto' } });
  const toInput = input('to', { type: 'date', value: filters.to, style: { width: 'auto' } });
  const categoryFilter = select('category',
    [{ value: '', label: t('All categories') }, ...categories.map((c) => ({ value: c, label: c }))],
    filters.category, { style: { width: 'auto' } });

  for (const [node, key] of [[fromInput, 'from'], [toInput, 'to'], [categoryFilter, 'category']]) {
    node.addEventListener('change', () => { filters[key] = node.value; load(); });
  }

  async function load() {
    clear(host).append(loading());
    const data = await api.expenses(filters);
    const byCategory = new Map();
    for (const e of data.expenses) {
      byCategory.set(e.category, (byCategory.get(e.category) || 0) + e.amount_cents);
    }
    const ranked = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
    const max = ranked[0]?.[1] || 1;

    clear(host).append(el('div', { class: 'stack' }, [
      el('div', { class: 'grid grid-3' }, [
        tile('Total in range', money(data.total_cents), 'neg'),
        tile('Entries', String(data.expenses.length)),
        tile('Largest category', ranked[0] ? `${ranked[0][0]} · ${money(ranked[0][1])}` : '—'),
      ]),
      ranked.length
        ? el('div', { class: 'card' }, [
          el('div', { class: 'card-head' }, [el('h2', { text: t('By category') })]),
          el('div', { class: 'card-body' }, ranked.map(([category, amount]) =>
            el('div', { class: 'bar-row' }, [
              el('span', { class: 'bar-label', text: category }),
              el('span', { class: 'bar-track' },
                el('span', { class: 'bar-fill', style: {
                  width: `${(amount / max) * 100}%`, background: 'var(--warning)',
                } })),
              el('span', { class: 'bar-value', text: money(amount) }),
            ]))),
        ])
        : null,
      el('div', { class: 'card' }, [
        el('div', { class: 'card-head' }, [
          el('h2', { text: t('Expenses') }),
          can('reports:read')
            ? el('a', { class: 'btn btn-sm', text: t('↓ CSV'),
              href: api.exportUrl('expenses', { from: filters.from, to: filters.to }) })
            : null,
        ]),
        el('div', { class: 'card-body flush' }, table([
          { title: t('Date'), class: 'nowrap', render: (e) => fmtDate(e.spent_at) },
          { title: t('Category'), render: (e) => el('span', { class: 'badge', text: e.category }) },
          { title: t('Description'), render: (e) => el('div', {}, [
            el('div', {}, e.description),
            e.vendor ? el('span', { class: 'small faint' }, e.vendor) : null,
          ]) },
          { title: t('Method'), render: (e) => methodLabel(e.method) },
          { title: t('Reference'), render: (e) => el('span', { class: 'small faint' }, e.reference || '—') },
          { title: t('Amount'), class: 'num', render: (e) =>
            el('span', { class: 'strong' }, money(e.amount_cents)) },
          { title: '', class: 'num', render: (e) => (can('expenses:write')
            ? el('button', {
              class: 'btn btn-sm btn-danger', text: '✕',
              onClick: (event) => {
                event.stopPropagation();
                confirmDialog({
                  title: t('Delete this expense?'),
                  message: `${e.description} — ${money(e.amount_cents)}`,
                  confirmLabel: t('Delete'),
                  danger: true,
                  onConfirm: async () => {
                    await api.deleteExpense(e.id);
                    toast(t('Expense deleted'));
                    await load();
                  },
                });
              },
            })
            : '') },
        ], data.expenses, {
          onRowClick: can('expenses:write')
            ? (e) => expenseDialog({ expense: e, onSaved: load })
            : null,
          empty: t('No expenses in this period.'),
        })),
      ]),
    ]));
  }

  const toolbar = el('div', { class: 'row', style: { marginBottom: '14px' } }, [
    el('span', { class: 'small muted', text: t('From') }), fromInput,
    el('span', { class: 'small muted', text: t('to') }), toInput,
    categoryFilter,
  ]);

  await load();
  return el('div', {}, [toolbar, host]);
}

const tile = (label, value, tone) => el('div', { class: 'card stat' }, [
  el('div', { class: 'stat-label', text: t(label) }),
  el('div', { class: `stat-value ${tone || ''}`, text: value }),
]);

export function expenseDialog({ expense, onSaved }) {
  const editing = Boolean(expense);
  const categories = (state.settings.expense_categories || 'Other')
    .split(',').map((c) => c.trim()).filter(Boolean);

  const form = el('form', {}, [
    el('div', { class: 'field-row' }, [
      field('Category', select('category', categories.map((c) => ({ value: c, label: c })),
        expense?.category || categories[0])),
      field('Date', input('spent_at', {
        type: 'date', required: true, value: expense?.spent_at || todayISO(),
      })),
    ]),
    field('Description', input('description', {
      required: true, value: expense?.description || '', placeholder: t('What was bought'),
    })),
    el('div', { class: 'field-row-3' }, [
      field('Amount', input('amount', {
        type: 'number', step: '0.01', min: '0.01', required: true,
        value: expense ? (expense.amount_cents / 100).toFixed(2) : '',
      })),
      field('Paid by', select('method', [
        { value: 'cash', label: t('Cash') },
        { value: 'card', label: t('Card') },
        { value: 'transfer', label: t('Bank transfer') },
        { value: 'cheque', label: t('Cheque') },
        { value: 'online', label: t('Online') },
        { value: 'other', label: t('Other') },
      ], expense?.method || 'transfer')),
      field('Reference', input('reference', { value: expense?.reference || '' })),
    ]),
    field('Vendor', input('vendor', { value: expense?.vendor || '' })),
    field('Notes', input('notes', { value: expense?.notes || '', maxlength: 300 })),
  ]);

  onSubmit(form, async (data) => {
    const body = { ...data, amount: Number(data.amount) };
    if (editing) await api.updateExpense(expense.id, body);
    else await api.createExpense(body);
    closeModal();
    toast(editing ? 'Expense updated' : 'Expense recorded', 'success');
    if (onSaved) await onSaved();
  });

  modal({
    title: editing ? 'Edit expense' : 'Record expense',
    body: form,
    footer: [
      el('button', { class: 'btn', text: t('Cancel'), onClick: () => closeModal() }),
      el('button', { class: 'btn btn-primary', text: t('Save'), onClick: () => form.requestSubmit() }),
    ],
  });
}
