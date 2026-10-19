import { t } from '../i18n.js';
import { api } from '../api.js';
import {
  el, clear, money, fmtDate, table, emptyState, loading, todayISO, startOfMonth, addDays,
  input, methodLabel,
} from '../ui.js';
import { whatsappButton } from './whatsapp.js';

const range = { from: startOfMonth(todayISO()), to: todayISO(), tab: 'financial' };

export default async function reports(ctx) {
  const host = el('div');

  ctx.setTitle('Reports', 'Where the money came from and where it went');

  const fromInput = input('from', { type: 'date', value: range.from, style: { width: 'auto' } });
  const toInput = input('to', { type: 'date', value: range.to, style: { width: 'auto' } });
  fromInput.addEventListener('change', () => { range.from = fromInput.value; load(); });
  toInput.addEventListener('change', () => { range.to = toInput.value; load(); });

  const preset = (label, from, to) => el('button', {
    class: 'chip', text: label,
    onClick: () => {
      range.from = from; range.to = to;
      fromInput.value = from; toInput.value = to;
      load();
    },
  });

  const today = todayISO();
  const lastMonthEnd = addDays(startOfMonth(today), -1);

  const toolbar = el('div', { class: 'row', style: { marginBottom: '14px' } }, [
    el('span', { class: 'small muted', text: t('From') }), fromInput,
    el('span', { class: 'small muted', text: t('to') }), toInput,
    el('div', { class: 'chips' }, [
      preset('This month', startOfMonth(today), today),
      preset('Last month', startOfMonth(lastMonthEnd), lastMonthEnd),
      preset('Last 90 days', addDays(today, -89), today),
      preset('This year', `${today.slice(0, 4)}-01-01`, today),
    ]),
  ]);

  const tabs = el('div', { class: 'tabs' }, [
    ['financial', 'Financial summary'],
    ['receivables', 'Who owes us'],
    ['schedule', 'Schedule performance'],
  ].map(([id, label]) => el('button', {
    class: `tab ${range.tab === id ? 'active' : ''}`,
    text: label,
    onClick: (event) => {
      range.tab = id;
      for (const node of tabs.children) node.classList.remove('active');
      event.target.classList.add('active');
      load();
    },
  })));

  async function load() {
    clear(host).append(loading());
    const render = {
      financial: financialReport,
      receivables: receivablesReport,
      schedule: scheduleReport,
    }[range.tab];
    clear(host).append(await render());
  }

  await load();
  return el('div', {}, [toolbar, tabs, host]);
}

async function financialReport() {
  const data = await api.financialReport({ from: range.from, to: range.to });
  const s = data.summary;

  return el('div', { class: 'stack' }, [
    el('div', { class: 'grid grid-4' }, [
      tile('Collected', money(s.collected_cents),
        t('{n} payments', { n: s.payments_count }), 'pos'),
      tile('Expenses', money(s.expenses_cents),
        t('{n} entries', { n: s.expenses_count }), 'neg'),
      tile('Net', money(s.net_cents), 'Collected minus expenses',
        s.net_cents >= 0 ? 'pos' : 'neg'),
      tile('Production', money(s.production_cents),
        t('{n} treatments completed', { n: s.treatments_count })),
    ]),
    el('div', { class: 'grid grid-2' }, [
      barCard('Income by payment method', data.by_method.map((m) => ({
        label: methodLabel(m.method), value: m.amount_cents, meta: `${m.count}`,
      })), 'var(--accent)'),
      barCard('Spending by category', data.by_expense_category.map((c) => ({
        label: c.category, value: c.amount_cents, meta: `${c.count}`,
      })), 'var(--warning)'),
    ]),
    el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [
        el('h2', { text: t('Daily money in and out') }),
        el('div', { class: 'row tight right' }, [
          exportLink('payments'), exportLink('expenses'), exportLink('invoices'),
        ]),
      ]),
      el('div', { class: 'card-body' }, chart(data.series)),
    ]),
    el('div', { class: 'grid grid-2' }, [
      el('div', { class: 'card' }, [
        el('div', { class: 'card-head' }, [el('h2', { text: t('Top procedures') })]),
        el('div', { class: 'card-body flush' }, table([
          { title: t('Procedure'), render: (p) => el('div', {}, [
            el('div', {}, p.name), el('span', { class: 'small faint' }, p.code),
          ]) },
          { title: t('Done'), class: 'num', render: (p) => String(p.count) },
          { title: t('Value'), class: 'num', render: (p) =>
            el('span', { class: 'strong' }, money(p.amount_cents)) },
        ], data.by_procedure, { empty: t('No completed treatments in this period.') })),
      ]),
      el('div', { class: 'card' }, [
        el('div', { class: 'card-head' }, [el('h2', { text: t('Production by practitioner') })]),
        el('div', { class: 'card-body flush' }, table([
          { title: t('Practitioner'), render: (d) => d.name },
          { title: t('Treatments'), class: 'num', render: (d) => String(d.treatments) },
          { title: t('Value'), class: 'num', render: (d) =>
            el('span', { class: 'strong' }, money(d.amount_cents)) },
        ], data.by_dentist, { empty: t('Nothing recorded in this period.') })),
      ]),
    ]),
    el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [el('h2', { text: t('Reconciliation') })]),
      el('div', { class: 'card-body' }, el('dl', { class: 'kv' }, [
        kv('Invoiced in period', money(s.billed_cents), `${s.invoices_count} invoices`),
        kv('Gross payments received', money(s.gross_collected_cents)),
        kv('Refunds issued', s.refunds_cents ? `−${money(s.refunds_cents)}` : money(0)),
        kv('Net collected', money(s.collected_cents)),
        kv('Expenses paid', `−${money(s.expenses_cents)}`),
        kv('Net cash movement', money(s.net_cents)),
      ].flat())),
    ]),
  ]);
}

async function receivablesReport() {
  const data = await api.receivables();
  const a = data.aging;

  return el('div', { class: 'stack' }, [
    el('div', { class: 'grid grid-4' }, [
      tile('0–30 days', money(a.current_cents)),
      tile('31–60 days', money(a.d31_60_cents)),
      tile('61–90 days', money(a.d61_90_cents), '', a.d61_90_cents > 0 ? 'neg' : ''),
      tile('Over 90 days', money(a.over_90_cents), '', a.over_90_cents > 0 ? 'neg' : ''),
    ]),
    el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [
        el('h2', { text: t('Outstanding invoices') }),
        el('span', { class: 'right strong', text: t('{amount} owed in total', { amount: money(data.total_cents) }) }),
      ]),
      el('div', { class: 'card-body flush' }, table([
        { title: t('Invoice'), render: (i) => el('span', { class: 'mono' }, i.number) },
        { title: t('Patient'), render: (i) => el('a', { href: `#/patients/${i.patient_id}` },
          i.patient_name) },
        { title: t('Phone'), render: (i) => el('span', { class: 'small faint' }, i.patient_phone || '—') },
        { title: t('Issued'), class: 'nowrap', render: (i) => fmtDate(i.issued_at) },
        { title: t('Age'), class: 'num', render: (i) => el('span', {
          class: 'badge ' + (i.days_outstanding > 90 ? 'badge-danger'
            : i.days_outstanding > 60 ? 'badge-warning' : ''),
        }, t('{n}d', { n: i.days_outstanding })) },
        { title: t('Total'), class: 'num', render: (i) => money(i.total_cents) },
        { title: t('Paid'), class: 'num', render: (i) => money(i.paid_cents) },
        { title: t('Owed'), class: 'num', render: (i) =>
          el('span', { class: 'strong', style: { color: 'var(--danger)' } }, money(i.balance_cents)) },
        { title: '', class: 'num', render: (i) => whatsappButton({
          patientId: i.patient_id, invoiceId: i.id, preferTemplate: 'balance_reminder',
        }, { label: t('Chase') }) || '' },
      ], data.invoices, { empty: t('Nothing outstanding — every invoice is settled.') })),
    ]),
  ]);
}

async function scheduleReport() {
  const data = await api.appointmentReport({ from: range.from, to: range.to });
  const t = data.totals;
  const rate = (value) => (t.total ? `${Math.round((value / t.total) * 100)}%` : '0%');

  return el('div', { class: 'stack' }, [
    el('div', { class: 'grid grid-4' }, [
      tile('Appointments', String(t.total)),
      tile('Completed', String(t.completed), rate(t.completed), 'pos'),
      tile('Cancelled', String(t.cancelled), rate(t.cancelled)),
      tile('No-shows', String(t.no_show), rate(t.no_show), t.no_show > 0 ? 'neg' : ''),
    ]),
    el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [
        el('h2', { text: t('By practitioner') }),
        exportLink('appointments'),
      ]),
      el('div', { class: 'card-body flush' }, table([
        { title: t('Practitioner'), render: (d) => el('div', { class: 'row tight' }, [
          el('span', { class: 'legend-swatch', style: { background: d.color } }),
          el('span', {}, d.name),
        ]) },
        { title: t('Booked'), class: 'num', render: (d) => String(d.total) },
        { title: t('Completed'), class: 'num', render: (d) => String(d.completed) },
        { title: t('Cancelled'), class: 'num', render: (d) => String(d.cancelled) },
        { title: t('No-shows'), class: 'num', render: (d) => String(d.no_show) },
        { title: t('No-show rate'), class: 'num', render: (d) => el('span', {
          class: 'badge ' + (d.total && d.no_show / d.total > 0.15 ? 'badge-danger' : ''),
        }, d.total ? `${Math.round((d.no_show / d.total) * 100)}%` : '—') },
      ], data.by_dentist, { empty: t('No appointments in this period.') })),
    ]),
  ]);
}

const tile = (label, value, meta, tone) => el('div', { class: 'card stat' }, [
  el('div', { class: 'stat-label', text: t(label) }),
  el('div', { class: `stat-value ${tone || ''}`, text: value }),
  meta ? el('div', { class: 'stat-meta', text: t(meta) }) : null,
]);

const kv = (label, value, meta) => [
  el('dt', { text: t(label) }),
  el('dd', {}, [
    el('span', { class: 'strong', text: value }),
    meta ? el('span', { class: 'small faint', text: ` ${meta}` }) : null,
  ]),
];

const exportLink = (kind) => el('a', {
  class: 'btn btn-sm',
  href: api.exportUrl(kind, { from: range.from, to: range.to }),
  text: `↓ ${t(kind)}`,
});

function barCard(title, rows, color) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [el('h2', { text: title })]),
    el('div', { class: 'card-body' }, rows.length
      ? rows.map((row) => el('div', { class: 'bar-row' }, [
        el('span', { class: 'bar-label', text: row.label }),
        el('span', { class: 'bar-track' },
          el('span', { class: 'bar-fill', style: {
            width: `${(Math.abs(row.value) / max) * 100}%`, background: color,
          } })),
        el('span', { class: 'bar-value', text: money(row.value) }),
      ]))
      : emptyState('Nothing in this period.')),
  ]);
}

/** Grouped bars: money in vs money out per day, drawn as inline SVG. */
function chart(series) {
  const width = 960;
  const height = 190;
  const pad = { top: 10, right: 10, bottom: 24, left: 10 };
  const max = Math.max(1, ...series.map((d) => Math.max(d.income_cents, d.expense_cents)));
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const slot = innerW / Math.max(1, series.length);
  const barW = Math.max(1.5, slot / 2 - 1);

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', 'spark');
  svg.style.height = '190px';
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Daily money in and money out');

  for (const fraction of [0.25, 0.5, 0.75, 1]) {
    const line = document.createElementNS(ns, 'line');
    const y = pad.top + innerH - innerH * fraction;
    line.setAttribute('x1', pad.left); line.setAttribute('x2', width - pad.right);
    line.setAttribute('y1', y); line.setAttribute('y2', y);
    line.setAttribute('stroke', 'var(--border)'); line.setAttribute('stroke-dasharray', '3 4');
    svg.append(line);
  }

  series.forEach((point, index) => {
    const x = pad.left + index * slot;
    for (const [value, offset, color, label] of [
      [point.income_cents, 0, 'var(--accent)', 'in'],
      [point.expense_cents, barW + 1, 'var(--warning)', 'out'],
    ]) {
      const h = (value / max) * innerH;
      const rect = document.createElementNS(ns, 'rect');
      rect.setAttribute('x', x + offset);
      rect.setAttribute('y', pad.top + innerH - h);
      rect.setAttribute('width', barW);
      rect.setAttribute('height', Math.max(0, h));
      rect.setAttribute('fill', color);
      rect.setAttribute('rx', 1.5);
      const title = document.createElementNS(ns, 'title');
      title.textContent = `${point.day}: ${money(value)} ${label}`;
      rect.append(title);
      svg.append(rect);
    }
  });

  const axis = document.createElementNS(ns, 'line');
  axis.setAttribute('x1', pad.left); axis.setAttribute('x2', width - pad.right);
  axis.setAttribute('y1', pad.top + innerH); axis.setAttribute('y2', pad.top + innerH);
  axis.setAttribute('stroke', 'var(--border-strong)');
  svg.append(axis);

  return el('div', {}, [
    svg,
    el('div', { class: 'row small faint', style: { justifyContent: 'space-between' } }, [
      el('span', { text: fmtDate(series[0]?.day) }),
      el('span', { text: t('peak {amount}', { amount: money(max) }) }),
      el('span', { text: fmtDate(series.at(-1)?.day) }),
    ]),
    el('div', { class: 'legend mt' }, [
      el('span', { class: 'legend-item' }, [
        el('span', { class: 'legend-swatch', style: { background: 'var(--accent)' } }),
        el('span', {}, t('Money in')),
      ]),
      el('span', { class: 'legend-item' }, [
        el('span', { class: 'legend-swatch', style: { background: 'var(--warning)' } }),
        el('span', {}, t('Money out')),
      ]),
    ]),
  ]);
}
