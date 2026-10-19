import { t } from '../i18n.js';
import { api } from '../api.js';
import {
  state, el, fmtDate, fmtTime, todayISO, addDays, startOfWeek, can,
  appointmentBadge, toast, modal, closeModal,
} from '../ui.js';
import { appointmentDialog, minutesBetween } from './shared.js';
import { whatsappButton } from './whatsapp.js';

const view = {
  mode: localStorage.getItem('cal.mode') || 'week',
  date: todayISO(),
  dentistId: '',
};

const SLOT_MIN = 15;
const SLOT_PX = 30;

export default async function calendar(ctx) {
  const dayStart = timeToMinutes(state.settings.day_start || '08:00');
  const dayEnd = timeToMinutes(state.settings.day_end || '19:00');

  const days = view.mode === 'day'
    ? [view.date]
    : Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(view.date), i));

  const { appointments } = await api.appointments({
    from: days[0],
    to: days.at(-1),
    dentist_id: view.dentistId || undefined,
  });

  ctx.setTitle('Schedule', rangeLabel(days),
    can('appointments:write')
      ? el('button', {
        class: 'btn btn-primary', text: t('+ New appointment'),
        onClick: () => appointmentDialog({
          preset: { starts_at: `${view.date}T09:00` }, onSaved: ctx.rerender,
        }),
      })
      : null);

  const toolbar = el('div', { class: 'cal-toolbar' }, [
    el('button', { class: 'btn btn-sm', text: '‹', title: t('Previous'),
      onClick: () => { view.date = addDays(view.date, view.mode === 'day' ? -1 : -7); ctx.rerender(); } }),
    el('button', { class: 'btn btn-sm', text: t('Today'),
      onClick: () => { view.date = todayISO(); ctx.rerender(); } }),
    el('button', { class: 'btn btn-sm', text: '›', title: t('Next'),
      onClick: () => { view.date = addDays(view.date, view.mode === 'day' ? 1 : 7); ctx.rerender(); } }),
    el('span', { class: 'cal-date', text: rangeLabel(days) }),
    el('div', { class: 'spacer' }),
    el('div', { class: 'chips' }, [
      chip('Day', view.mode === 'day', () => { setMode('day'); ctx.rerender(); }),
      chip('Week', view.mode === 'week', () => { setMode('week'); ctx.rerender(); }),
    ]),
    (() => {
      const sel = el('select', { style: { width: 'auto' } }, [
        el('option', { value: '', text: t('All practitioners') }),
        ...state.users.filter((u) => ['dentist', 'admin'].includes(u.role))
          .map((u) => {
            const option = el('option', { value: u.id, text: u.name });
            if (String(u.id) === String(view.dentistId)) option.selected = true;
            return option;
          }),
      ]);
      sel.addEventListener('change', () => { view.dentistId = sel.value; ctx.rerender(); });
      return sel;
    })(),
    el('input', {
      type: 'date', value: view.date, style: { width: 'auto' },
      onChange: (event) => { view.date = event.target.value; ctx.rerender(); },
    }),
  ]);

  const grid = buildGrid(days, appointments, dayStart, dayEnd, ctx);

  const legend = el('div', { class: 'legend mt' },
    state.users.filter((u) => ['dentist', 'admin'].includes(u.role)).map((u) =>
      el('span', { class: 'legend-item' }, [
        el('span', { class: 'legend-swatch', style: { background: u.color } }),
        el('span', {}, u.name),
      ])));

  return el('div', {}, [toolbar, grid, legend]);
}

function setMode(mode) {
  view.mode = mode;
  localStorage.setItem('cal.mode', mode);
}

function chip(label, active, onClick) {
  return el('button', { class: `chip ${active ? 'active' : ''}`, text: label, onClick });
}

function buildGrid(days, appointments, dayStart, dayEnd, ctx) {
  const rows = Math.ceil((dayEnd - dayStart) / SLOT_MIN);
  const grid = el('div', {
    class: 'cal-grid',
    style: { gridTemplateColumns: `56px repeat(${days.length}, minmax(130px, 1fr))` },
  });

  grid.append(el('div', { class: 'cal-col-head cal-time-head' }));
  for (const day of days) {
    const isToday = day === todayISO();
    grid.append(el('div', { class: `cal-col-head ${isToday ? 'today' : ''}` }, [
      el('span', { text: fmtDate(day, { withYear: false, weekday: true }) }),
    ]));
  }

  const times = el('div', { class: 'cal-times' });
  for (let i = 0; i < rows; i += 1) {
    const minutes = dayStart + i * SLOT_MIN;
    times.append(el('div', { class: 'cal-time' },
      minutes % 60 === 0 ? minutesToTime(minutes) : ''));
  }
  grid.append(times);

  for (const day of days) {
    const column = el('div', { class: 'cal-col' });

    for (let i = 0; i < rows; i += 1) {
      const minutes = dayStart + i * SLOT_MIN;
      const slot = el('div', { class: `cal-slot ${minutes % 60 === 0 ? 'hour' : ''}` });
      if (can('appointments:write')) {
        slot.addEventListener('click', () => appointmentDialog({
          preset: {
            starts_at: `${day}T${minutesToTime(minutes)}`,
            dentist_id: view.dentistId || undefined,
          },
          onSaved: ctx.rerender,
        }));
      }
      column.append(slot);
    }

    const forDay = appointments.filter((a) => a.starts_at.slice(0, 10) === day);
    for (const [appointment, lane, lanes] of layout(forDay)) {
      column.append(eventNode(appointment, lane, lanes, dayStart, ctx));
    }

    if (day === todayISO()) {
      const now = new Date();
      const minutes = now.getHours() * 60 + now.getMinutes();
      if (minutes >= dayStart && minutes <= dayEnd) {
        column.append(el('div', {
          class: 'cal-now',
          style: { top: `${((minutes - dayStart) / SLOT_MIN) * SLOT_PX}px` },
        }));
      }
    }

    grid.append(column);
  }
  return grid;
}

/** Side-by-side placement for overlapping appointments. */
function layout(appointments) {
  const sorted = [...appointments].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const placed = [];
  for (const appointment of sorted) {
    const clashing = placed.filter(([other]) =>
      appointment.starts_at < other.ends_at && appointment.ends_at > other.starts_at);
    const usedLanes = new Set(clashing.map(([, lane]) => lane));
    let lane = 0;
    while (usedLanes.has(lane)) lane += 1;
    placed.push([appointment, lane, 1]);
    const group = [...clashing, placed.at(-1)];
    const width = Math.max(...group.map(([, l]) => l)) + 1;
    for (const entry of group) entry[2] = Math.max(entry[2], width);
  }
  return placed;
}

function eventNode(appointment, lane, lanes, dayStart, ctx) {
  const startMinutes = timeToMinutes(appointment.starts_at.slice(11, 16));
  const duration = Math.max(SLOT_MIN, minutesBetween(appointment.starts_at, appointment.ends_at));
  const top = ((startMinutes - dayStart) / SLOT_MIN) * SLOT_PX;
  const height = (duration / SLOT_MIN) * SLOT_PX - 2;
  const widthPct = 100 / lanes;

  const node = el('div', {
    class: `cal-event ${appointment.status}`,
    style: {
      top: `${top}px`,
      height: `${height}px`,
      left: `calc(${lane * widthPct}% + 3px)`,
      width: `calc(${widthPct}% - 6px)`,
      background: appointment.dentist_color || 'var(--accent)',
      borderLeftColor: 'rgba(255,255,255,.55)',
    },
    title: `${fmtTime(appointment.starts_at)}–${fmtTime(appointment.ends_at)} · ` +
      `${appointment.patient_name} · ${appointment.procedure_name || appointment.reason || ''} · ` +
      `${appointment.dentist_name} · ${appointment.operatory}`,
  }, [
    el('div', { class: 'ev-time', text: fmtTime(appointment.starts_at) }),
    el('div', { class: 'ev-name', text: appointment.patient_name }),
    height > 48
      ? el('div', { class: 'ev-proc', text: appointment.procedure_name || appointment.reason || '' })
      : null,
  ]);

  node.addEventListener('click', (event) => {
    event.stopPropagation();
    appointmentPopover(appointment, ctx);
  });
  return node;
}

function appointmentPopover(appointment, ctx) {
  const actions = [];
  const transitions = {
    scheduled: [['confirmed', 'Confirm'], ['cancelled', 'Cancel'], ['no_show', 'No show']],
    confirmed: [['arrived', 'Arrived'], ['cancelled', 'Cancel'], ['no_show', 'No show']],
    arrived: [['completed', 'Complete']],
    completed: [],
    cancelled: [['scheduled', 'Reinstate']],
    no_show: [['scheduled', 'Reinstate']],
  }[appointment.status] || [];

  if (can('appointments:write')) {
    for (const [status, label] of transitions) {
      actions.push(el('button', {
        class: `btn btn-sm ${status === 'cancelled' || status === 'no_show' ? 'btn-danger' : ''}`,
        text: label,
        onClick: async () => {
          const body = { status };
          if (status === 'cancelled') {
            body.cancel_reason = prompt('Why is this appointment being cancelled?') || '';
            if (!body.cancel_reason) return;
          }
          await api.setAppointmentStatus(appointment.id, body);
          toast(t('Marked {status}', { status: t(label).toLowerCase() }), 'success');
          closeModal();
          await ctx.rerender();
        },
      }));
    }
  }

  modal({
    title: appointment.patient_name,
    body: el('div', {}, [
      el('div', { class: 'row', style: { marginBottom: '14px' } }, [
        appointmentBadge(appointment.status),
        appointment.patient_allergies
          ? el('span', { class: 'alert-chip' }, `⚠ ${appointment.patient_allergies}`)
          : null,
      ]),
      el('dl', { class: 'kv' }, [
        el('dt', { text: t('When') }),
        el('dd', { text: `${fmtDate(appointment.starts_at)} · ` +
          `${fmtTime(appointment.starts_at)}–${fmtTime(appointment.ends_at)}` }),
        el('dt', { text: t('Practitioner') }), el('dd', { text: appointment.dentist_name }),
        el('dt', { text: t('Chair') }), el('dd', { text: appointment.operatory }),
        el('dt', { text: t('Procedure') }),
        el('dd', { text: appointment.procedure_name || appointment.reason || '—' }),
        el('dt', { text: t('File no.') }), el('dd', { class: 'mono', text: appointment.patient_code }),
        appointment.patient_phone ? el('dt', { text: t('Phone') }) : null,
        appointment.patient_phone ? el('dd', { text: appointment.patient_phone }) : null,
        appointment.notes ? el('dt', { text: t('Notes') }) : null,
        appointment.notes ? el('dd', { text: appointment.notes }) : null,
        appointment.cancel_reason ? el('dt', { text: t('Cancelled') }) : null,
        appointment.cancel_reason ? el('dd', { text: appointment.cancel_reason }) : null,
      ]),
      actions.length ? el('div', { class: 'row mt' }, actions) : null,
    ]),
    footer: [
      whatsappButton({
        patientId: appointment.patient_id,
        appointmentId: appointment.id,
        preferTemplate: appointment.status === 'no_show'
          ? 'appointment_missed' : 'appointment_reminder',
        onSent: ctx.rerender,
      }, { label: t('WhatsApp'), small: false }),
      el('a', { class: 'btn', href: `#/patients/${appointment.patient_id}`,
        text: t('Open patient file'), onClick: () => closeModal() }),
      el('div', { class: 'spacer' }),
      can('appointments:write')
        ? el('button', {
          class: 'btn btn-primary', text: t('Edit'),
          onClick: () => { closeModal(); appointmentDialog({ appointment, onSaved: ctx.rerender }); },
        })
        : null,
    ],
  });
}

function rangeLabel(days) {
  if (days.length === 1) return fmtDate(days[0], { weekday: true });
  return `${fmtDate(days[0], { withYear: false })} – ${fmtDate(days.at(-1))}`;
}

const timeToMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

const minutesToTime = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
