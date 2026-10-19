import { t } from '../i18n.js';
import { api } from '../api.js';
import {
  el, money, fmtDate, fmtTime, todayISO, statCard, table, emptyState, avatar,
  appointmentBadge, can, toast, state, methodLabel,
} from '../ui.js';
import { appointmentDialog } from './shared.js';

export default async function dashboard(ctx) {
  const day = todayISO();
  const data = await api.dashboard({ date: day });
  const k = data.kpis;

  ctx.setTitle(
    t(greeting(), { name: firstName(state.user.name) }),
    fmtDate(day, { weekday: true }),
    can('appointments:write')
      ? el('button', {
        class: 'btn btn-primary', text: t('+ New appointment'),
        onClick: () => appointmentDialog({ onSaved: ctx.rerender }),
      })
      : null,
  );

  const kpis = el('div', { class: 'grid grid-4' }, [
    statCard('Collected today', money(k.collected_today_cents),
      t('{amount} this month', { amount: money(k.collected_month_cents) }),
      k.collected_today_cents > 0 ? 'pos' : ''),
    statCard('Outstanding', money(k.outstanding_cents),
      t('{n} unpaid invoices', { n: k.unpaid_invoices }),
      k.outstanding_cents > 0 ? 'neg' : ''),
    statCard('Appointments today', String(k.appointments_today),
      t('{n} in the next 7 days', { n: k.appointments_week })),
    statCard('Active patients', String(k.patients_total),
      t('{n} planned treatments', { n: k.planned_treatments })),
  ]);

  const schedule = el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', { text: t("Today's schedule") }),
      el('a', { class: 'btn btn-sm', href: '#/calendar', text: t('Open schedule') }),
    ]),
    el('div', { class: 'card-body flush' },
      data.appointments.length
        ? table([
          { title: t('Time'), render: (a) => el('span', { class: 'mono nowrap' },
            `${fmtTime(a.starts_at)}–${fmtTime(a.ends_at)}`) },
          { title: t('Patient'), render: (a) => el('div', {}, [
            el('div', { class: 'strong nowrap' }, a.patient_name),
            a.patient_allergies
              ? el('span', { class: 'alert-chip small' }, `⚠ ${a.patient_allergies}`)
              : el('span', { class: 'small faint' }, a.patient_code),
          ]) },
          { title: t('Procedure'), render: (a) => a.procedure_name || a.reason || '—' },
          { title: t('With'), render: (a) => el('div', { class: 'row tight' }, [
            avatar(a.dentist_name, a.dentist_color, 22),
            el('span', { class: 'small' }, a.dentist_name),
          ]) },
          { title: t('Chair'), render: (a) => el('span', { class: 'small faint' }, a.operatory) },
          { title: t('Status'), render: (a) => appointmentBadge(a.status) },
          { title: '', class: 'num', render: (a) => statusActions(a, ctx) },
        ], data.appointments, {
          onRowClick: (a) => appointmentDialog({ appointment: a, onSaved: ctx.rerender }),
        })
        : emptyState('Nothing booked for today.', '▦')),
  ]);

  const cashflow = el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [el('h2', { text: t('Cash flow — last 30 days') })]),
    el('div', { class: 'card-body' }, [
      cashflowChart(data.revenue_series),
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
    ]),
  ]);

  const recent = el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', { text: t('Latest payments') }),
      can('invoices:read') ? el('a', { class: 'btn btn-sm', href: '#/billing', text: t('Billing') }) : null,
    ]),
    el('div', { class: 'card-body flush' },
      data.recent_payments.length
        ? table([
          { title: t('Patient'), render: (p) => p.patient_name },
          { title: t('Method'), render: (p) => el('span', { class: 'small faint' }, methodLabel(p.method)) },
          { title: t('Amount'), class: 'num', render: (p) => el('span', {
            class: p.direction === 'refund' ? 'strong' : 'strong',
            style: { color: p.direction === 'refund' ? 'var(--danger)' : 'var(--success)' },
          }, `${p.direction === 'refund' ? '−' : ''}${money(p.amount_cents)}`) },
        ], data.recent_payments)
        : emptyState('No payments recorded yet.', '❐')),
  ]);

  const month = el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [el('h2', { text: t('This month') })]),
    el('div', { class: 'card-body' }, [
      summaryRow('Collected', money(k.collected_month_cents), 'var(--success)'),
      summaryRow('Expenses', money(k.expenses_month_cents), 'var(--warning)'),
      el('div', { class: 'totals-row grand' }, [
        el('span', { text: t('Net') }),
        el('span', {
          style: { color: k.collected_month_cents - k.expenses_month_cents >= 0
            ? 'var(--success)' : 'var(--danger)' },
          text: money(k.collected_month_cents - k.expenses_month_cents),
        }),
      ]),
    ]),
  ]);

  return el('div', { class: 'stack' }, [
    kpis,
    el('div', { class: 'grid grid-main' }, [schedule, el('div', { class: 'stack' }, [month, recent])]),
    cashflow,
  ]);
}

function statusActions(appointment, ctx) {
  if (!can('appointments:write')) return '';
  const next = {
    scheduled: ['confirmed', 'Confirm'],
    confirmed: ['arrived', 'Arrived'],
    arrived: ['completed', 'Complete'],
  }[appointment.status];
  if (!next) return '';
  return el('button', {
    class: 'btn btn-sm',
    text: t(next[1]),
    onClick: async (event) => {
      event.stopPropagation();
      await api.setAppointmentStatus(appointment.id, { status: next[0] });
      toast(t('Marked {status}', { status: t(next[1]).toLowerCase() }), 'success');
      await ctx.rerender();
    },
  });
}

function summaryRow(label, value, color) {
  return el('div', { class: 'totals-row' }, [
    el('span', { class: 'muted', text: t(label) }),
    el('span', { class: 'strong', style: { color }, text: value }),
  ]);
}

/** Small inline SVG bar chart — no chart library, no network calls. */
function cashflowChart(series) {
  const width = 900;
  const height = 150;
  const pad = { top: 8, right: 8, bottom: 20, left: 8 };
  const max = Math.max(1, ...series.map((d) => Math.max(d.income_cents, d.expense_cents)));
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const slot = innerW / Math.max(1, series.length);
  const barW = Math.max(2, slot / 2 - 1.5);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', 'spark');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Daily money in and out over the last 30 days');

  const rect = (x, y, w, h, fill, label) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    node.setAttribute('x', x); node.setAttribute('y', y);
    node.setAttribute('width', w); node.setAttribute('height', Math.max(0, h));
    node.setAttribute('fill', fill); node.setAttribute('rx', 1.5);
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = label;
    node.append(title);
    return node;
  };

  series.forEach((point, index) => {
    const x = pad.left + index * slot;
    const incomeH = (point.income_cents / max) * innerH;
    const expenseH = (point.expense_cents / max) * innerH;
    svg.append(rect(x, pad.top + innerH - incomeH, barW, incomeH, 'var(--accent)',
      `${point.day}: ${money(point.income_cents)} in`));
    svg.append(rect(x + barW + 1.5, pad.top + innerH - expenseH, barW, expenseH, 'var(--warning)',
      `${point.day}: ${money(point.expense_cents)} out`));
  });

  const axis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  axis.setAttribute('x1', pad.left); axis.setAttribute('x2', width - pad.right);
  axis.setAttribute('y1', pad.top + innerH); axis.setAttribute('y2', pad.top + innerH);
  axis.setAttribute('stroke', 'var(--border-strong)');
  svg.append(axis);

  return el('div', {}, [
    svg,
    el('div', { class: 'row small faint', style: { justifyContent: 'space-between' } }, [
      el('span', { text: fmtDate(series[0]?.day, { withYear: false }) }),
      el('span', { text: t('peak {amount}', { amount: money(max) }) }),
      el('span', { text: fmtDate(series.at(-1)?.day, { withYear: false }) }),
    ]),
  ]);
}

/** "Dr. Amina Rahman" -> "Amina"; a title is not a name. */
function firstName(name) {
  return String(name || '').replace(/^(Dr|Mr|Mrs|Ms|Prof)\.?\s+/i, '').split(/\s+/)[0] || name;
}

// Whole sentences, not "Good " + a word: Arabic does not build a greeting the
// way English does, and the name does not always come last.
function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning, {name}';
  if (hour < 18) return 'Good afternoon, {name}';
  return 'Good evening, {name}';
}
