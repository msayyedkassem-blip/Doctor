import { t } from '../i18n.js';
/**
 * The WhatsApp composer and the daily reminder run.
 *
 * Link mode is the default because it needs no account, no approval and costs
 * nothing: the app renders the message and hands it to WhatsApp with the text
 * already typed, and a human presses send. The UI never claims a message was
 * delivered when all it did was open a link.
 */
import { api } from '../api.js';
import {
  state, el, clear, modal, closeModal, toast, field, select, input, table,
  emptyState, loading, can, fmtDate, fmtTime, todayISO, addDays,
} from '../ui.js';

const LANGUAGES = [
  { value: 'ar', label: t('العربية — Arabic') },
  { value: 'en', label: t('English') },
];

/**
 * Opens the composer for one patient. `context` carries whichever record the
 * message is about, so the right templates are offered and the placeholders
 * can be filled in.
 */
export async function whatsappDialog({
  patientId, appointmentId, invoiceId, paymentId, preferTemplate, onSent,
}) {
  const { templates, settings } = await api.messageTemplates();

  // Offer templates that match the record in hand, plus patient-level ones.
  const contexts = ['patient'];
  if (appointmentId) contexts.push('appointment');
  if (invoiceId) contexts.push('invoice');
  if (paymentId) contexts.push('payment');
  const usable = templates.filter((item) => item.active && contexts.includes(item.context));

  if (!usable.length) {
    return modal({
      title: t('No template fits'),
      body: el('p', { text: t('No active message template matches this record. ' +
        'An administrator can add one in Settings → Messages.') }),
      footer: [el('button', { class: 'btn', text: t('Close'), onClick: () => closeModal() })],
    });
  }

  const startKey = usable.find((item) => item.key === preferTemplate)?.key || usable[0].key;
  const language = state.settings.whatsapp_default_language === 'en' ? 'en' : 'ar';

  const templateSelect = select('template_key',
    usable.map((item) => ({ value: item.key, label: item.name })), startKey);
  const languageSelect = select('language', LANGUAGES, language);
  const preview = el('textarea', {
    name: 'body', rows: 12,
    style: { fontFamily: 'inherit', fontSize: '14px', lineHeight: '1.6' },
  });
  const status = el('div', { class: 'small', style: { marginTop: '8px' } });
  // In link mode the action is a real anchor, not a scripted window.open:
  // browsers block popups opened after an await, which on a phone fails
  // silently. A link the user actually clicks always opens.
  const cloudMode = settings.mode === 'cloud' && settings.cloud_ready;
  const sendButton = cloudMode
    ? el('button', { class: 'btn btn-primary', text: t('Send now') })
    : el('a', {
      class: 'btn btn-primary', target: '_blank', rel: 'noopener',
      text: t('Open WhatsApp'),
    });

  /** Keeps the link in step with whatever is currently in the preview box. */
  function syncLink() {
    if (cloudMode || !current?.phone_ok) return;
    sendButton.href =
      `https://wa.me/${current.phone}?text=${encodeURIComponent(preview.value)}`;
  }

  let current = null;
  let edited = false;
  preview.addEventListener('input', () => { edited = true; syncLink(); });

  async function refresh() {
    status.replaceChildren(el('span', { class: 'faint', text: t('Preparing…') }));
    try {
      current = await api.previewMessage({
        template_key: templateSelect.value,
        language: languageSelect.value,
        patient_id: patientId,
        appointment_id: appointmentId,
        invoice_id: invoiceId,
        payment_id: paymentId,
      });
    } catch (err) {
      status.replaceChildren(el('span', { style: { color: 'var(--danger)' }, text: err.message }));
      setEnabled(sendButton, false);
      return;
    }

    if (!edited) preview.value = current.body;
    // Arabic reads right-to-left; showing it any other way is unreadable.
    preview.dir = languageSelect.value === 'ar' ? 'rtl' : 'ltr';
    preview.style.textAlign = languageSelect.value === 'ar' ? 'right' : 'left';

    clear(status);
    if (current.phone_ok) {
      setEnabled(sendButton, true);
      syncLink();
      // DOM append() turns a null into the string "null"; el() filters it.
      status.append(el('span', {}, [
        el('span', { class: 'badge badge-success', text: t('✓ Ready') }),
        el('span', { class: 'faint', text: ` ${current.patient_name} · +${current.phone}` }),
        current.raw_phone && current.raw_phone.replace(/\D/g, '') !== current.phone
          ? el('span', { class: 'faint', text: ` ${t('(on file as {number})', { number: current.raw_phone })}` })
          : null,
      ]));
    } else {
      setEnabled(sendButton, false);
      status.append(el('span', {
        class: 'alert-chip', text: `⚠ ${t(current.phone_error)}`,
      }));
    }
  }

  templateSelect.addEventListener('change', () => { edited = false; refresh(); });
  languageSelect.addEventListener('change', () => { edited = false; refresh(); });

  const payload = () => ({
    template_key: templateSelect.value,
    language: languageSelect.value,
    patient_id: patientId,
    appointment_id: appointmentId,
    invoice_id: invoiceId,
    payment_id: paymentId,
    body: preview.value,
  });

  sendButton.addEventListener('click', async (event) => {
    if (sendButton.classList.contains('is-disabled')) {
      event.preventDefault();
      return;
    }

    if (cloudMode) {
      event.preventDefault();
      setEnabled(sendButton, false);
      try {
        await api.sendMessage({ ...payload(), mode: 'cloud' });
        toast(t('Message sent'), 'success');
        closeModal();
        if (onSent) await onSent();
      } catch (err) {
        toast(err.message, 'error');
        setEnabled(sendButton, true);
      }
      return;
    }

    // Let the browser follow the link; record the send alongside it. The new
    // tab keeps this page alive, so the request completes normally.
    api.sendMessage(payload())
      .then(async () => {
        closeModal();
        if (onSent) await onSent();
      })
      .catch((err) => toast(err.message, 'error'));
    toast(t('WhatsApp opened — press send there'), 'success');
  });

  // The assistant, when a clinic has turned it on: paste what the patient
  // sent and get a reply with the real appointment and balance already in it.
  const assistant = el('div', { class: 'assistant-box' });
  api.assistantStatus().then((state) => {
    if (!state.enabled) return;
    const heard = el('textarea', {
      name: 'patient_said', rows: 2,
      placeholder: t('Paste what the patient wrote, or say what this message is about'),
    });
    const draft = el('button', {
      class: 'btn btn-sm', type: 'button', text: t('✦ Draft a reply'),
      onClick: async () => {
        draft.disabled = true;
        const was = draft.textContent;
        draft.textContent = t('Writing…');
        try {
          const { draft: text } = await api.draftMessage({
            patient_id: patientId || null,
            message: heard.value,
            about: heard.value ? '' : t('a friendly message'),
          });
          preview.value = text;
          edited = true;
          syncLink();
          preview.dispatchEvent(new Event('input'));
        } catch (err) {
          toast(t(err.message), 'error');
        } finally {
          draft.disabled = false;
          draft.textContent = was;
        }
      },
    });
    assistant.append(
      field('Ask the assistant', heard),
      el('div', { class: 'row' }, [draft]),
      el('p', { class: 'field-hint', text: t('Read it before you send it. '
        + 'The patient\u2019s first name, their next appointment and what they owe are '
        + 'sent to write it.') }),
    );
  }).catch(() => {});

  const body = el('div', {}, [
    el('div', { class: 'field-row' }, [
      field('Message', templateSelect),
      field('Language', languageSelect),
    ]),
    field('Preview — edit before sending if you like', preview),
    assistant,
    status,
    settings.mode === 'cloud' && settings.cloud_ready
      ? el('p', { class: 'small faint mt',
        text: t('Sending automatically through the WhatsApp Business API.') })
      : el('p', { class: 'small faint mt',
        text: t('WhatsApp will open with this text ready — you press send there.') }),
  ]);

  modal({
    title: t('Send on WhatsApp'),
    body,
    width: 'wide',
    footer: [
      el('button', { class: 'btn', text: t('Cancel'), onClick: () => closeModal() }),
      sendButton,
    ],
  });

  await refresh();
}

/** A small button that opens the composer. Used across the app. */
export function whatsappButton(options, { label = 'WhatsApp', small = true } = {}) {
  if (!can('messages:write')) return null;
  return el('button', {
    class: `btn ${small ? 'btn-sm' : ''} btn-whatsapp`,
    title: t('Send this patient a WhatsApp message'),
    onClick: (event) => {
      event.stopPropagation();
      whatsappDialog(options).catch((err) => toast(err.message, 'error'));
    },
  }, [el('span', { class: 'wa-mark', text: '✆' }), el('span', { text: label })]);
}

/**
 * The daily reminder run: tomorrow's appointments, who has already been
 * reminded, and a one-tap send for each.
 */
export default async function reminders(ctx) {
  const host = el('div');
  let day = ctx.query?.date || addDays(todayISO(), 1);

  const dateInput = input('date', { type: 'date', value: day, style: { width: 'auto' } });
  dateInput.addEventListener('change', () => { day = dateInput.value; load(); });

  ctx.setTitle('Appointment reminders',
    'Send tomorrow’s patients a WhatsApp reminder',
    el('div', { class: 'row tight' }, [
      el('span', { class: 'small muted', text: t('For') }), dateInput,
    ]));

  async function load() {
    clear(host).append(loading());
    const data = await api.dueReminders({ date: day });
    const pending = data.appointments.filter((a) => !a.reminded && a.phone_ok);
    const done = data.appointments.filter((a) => a.reminded);
    const unreachable = data.appointments.filter((a) => !a.phone_ok);

    clear(host).append(el('div', { class: 'stack' }, [
      el('div', { class: 'grid grid-3' }, [
        tile('To remind', String(pending.length)),
        tile('Already reminded', String(done.length), 'pos'),
        tile('No usable number', String(unreachable.length), unreachable.length ? 'neg' : ''),
      ]),
      el('div', { class: 'card' }, [
        el('div', { class: 'card-head' }, [
          el('h2', { text: t('{date} — {n} appointments',
          { date: fmtDate(day, { weekday: true }), n: data.appointments.length }) }),
        ]),
        el('div', { class: 'card-body flush' }, table([
          { title: t('Time'), class: 'nowrap', render: (a) =>
            el('span', { class: 'mono' }, fmtTime(a.starts_at)) },
          { title: t('Patient'), render: (a) => el('div', {}, [
            el('a', { href: `#/patients/${a.patient_id}`, class: 'strong' }, a.patient_name),
            el('div', { class: 'small faint' }, a.phone || 'no phone on file'),
          ]) },
          { title: t('Procedure'), render: (a) => a.procedure_name || '—' },
          { title: t('With'), render: (a) => el('span', { class: 'small' }, a.dentist_name) },
          { title: t('Reminder'), render: (a) => (a.reminded
            ? el('span', { class: 'badge badge-success', text: t('✓ Sent') })
            : a.phone_ok
              ? el('span', { class: 'badge', text: t('Not sent') })
              : el('span', { class: 'alert-chip small', text: `⚠ ${a.phone_error}` })) },
          { title: '', class: 'num', render: (a) => (a.phone_ok
            ? whatsappButton({
              patientId: a.patient_id,
              appointmentId: a.appointment_id,
              preferTemplate: 'appointment_reminder',
              onSent: load,
            }, { label: a.reminded ? 'Send again' : 'Send' })
            : '') },
        ], data.appointments, {
          empty: t('No appointments booked for this day.'),
        })),
      ]),
      unreachable.length
        ? el('p', { class: 'small faint',
          text: t('Patients with no usable number need their phone corrected on their file, ' +
            'or the clinic country code set in Settings → Messages.') })
        : null,
    ]));
  }

  await load();
  return host;
}

/** Works for both a <button> and an <a>, which has no disabled attribute. */
function setEnabled(node, enabled) {
  node.classList.toggle('is-disabled', !enabled);
  if (node.tagName === 'BUTTON') node.disabled = !enabled;
  else if (!enabled) node.removeAttribute('href');
}

const tile = (label, value, tone) => el('div', { class: 'card stat' }, [
  el('div', { class: 'stat-label', text: t(label) }),
  el('div', { class: `stat-value ${tone || ''}`, text: value }),
]);
