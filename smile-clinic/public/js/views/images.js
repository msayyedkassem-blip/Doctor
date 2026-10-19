/**
 * X-rays and photographs on a patient's file.
 *
 * Images are shrunk here, on the device that captured them, before they are
 * ever sent. A phone camera produces four megabytes; a periapical that a
 * dentist can read needs a fraction of that, and the difference is whether a
 * clinic's images ever finish syncing over its own Wi-Fi.
 *
 * Two sizes are kept: the picture itself, and a thumbnail small enough that a
 * grid of twenty arrives in the same response as the list.
 */
import { api } from '../api.js';
import {
  el, clear, modal, closeModal, field, input, select, toast, can, fmtDate, confirmDialog,
} from '../ui.js';
import { t } from '../i18n.js';

/** Long edge of the stored image. Plenty for a diagnosis, small enough to move. */
const MAX_EDGE = 1600;
const THUMB_EDGE = 320;
const QUALITY = 0.82;

const KINDS = [
  { value: 'xray', label: 'X-ray' },
  { value: 'photo', label: 'Photo' },
];

/**
 * Reads a file the user picked and returns it at two sizes.
 *
 * Everything happens in the browser: the original never leaves the device, so
 * a clinic on a slow connection is not uploading holiday-sized photographs.
 */
async function prepare(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('That file could not be read'));
    reader.readAsDataURL(file);
  });

  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That file is not an image'));
    img.src = dataUrl;
  });

  const draw = (edge) => {
    const scale = Math.min(1, edge / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const ctx = canvas.getContext('2d');
    // X-rays are mostly dark; a white ground behind a transparent PNG keeps
    // them from being painted onto black and losing their shadows.
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { canvas, url: canvas.toDataURL('image/jpeg', QUALITY) };
  };

  const full = draw(MAX_EDGE);
  const thumb = draw(THUMB_EDGE);
  return {
    data: full.url,
    thumb: thumb.url,
    mime: 'image/jpeg',
    width: full.canvas.width,
    height: full.canvas.height,
  };
}

const sizeLabel = (bytes) => (bytes > 900_000
  ? `${(bytes / 1_048_576).toFixed(1)} MB`
  : `${Math.max(1, Math.round(bytes / 1024))} KB`);

const src = (value) => (String(value || '').startsWith('data:')
  ? value : `data:image/jpeg;base64,${value}`);

/** The tab on a patient's file. */
export async function imagesTab(patient, rerender) {
  const { attachments } = await api.attachments(patient.id);
  const editable = can('clinical:write');

  const grid = el('div', { class: 'image-grid' }, attachments.map((item) => el('button', {
    class: 'image-card',
    type: 'button',
    onClick: () => viewer(attachments, item, rerender),
  }, [
    item.thumb
      ? el('img', { src: src(item.thumb), alt: item.caption || t('Clinical image'), loading: 'lazy' })
      : el('div', { class: 'image-missing', text: '🦷' }),
    el('div', { class: 'image-meta' }, [
      el('span', { class: `badge ${item.kind === 'xray' ? 'badge-info' : 'badge'}`,
        text: t(item.kind === 'xray' ? 'X-ray' : 'Photo') }),
      item.tooth ? el('span', { class: 'badge', text: t('Tooth {n}', { n: item.tooth }) }) : null,
      el('span', { class: 'small faint', text: fmtDate(item.taken_on || item.created_at) }),
    ]),
    item.caption ? el('div', { class: 'image-caption', text: item.caption }) : null,
  ])));

  return el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', { text: t('X-rays and photos') }),
      editable ? uploadButton(patient, rerender) : null,
    ]),
    el('div', { class: 'card-body' }, [
      attachments.length
        ? grid
        : el('div', { class: 'empty' }, [
          el('span', { class: 'empty-icon', text: '🖼' }),
          el('div', { text: t('No x-rays or photos yet.') }),
        ]),
    ]),
  ]);
}

function uploadButton(patient, rerender) {
  // A real file input, hidden: the button is only there to look like the rest
  // of the app. `capture` is left off on purpose so a phone offers both the
  // camera and the gallery rather than forcing the camera.
  const picker = el('input', {
    type: 'file',
    accept: 'image/*',
    multiple: true,
    style: { display: 'none' },
    onChange: async (event) => {
      const files = [...event.target.files];
      event.target.value = '';
      if (files.length) await addImages(patient, files, rerender);
    },
  });

  const button = el('button', {
    class: 'btn btn-primary btn-sm',
    text: t('+ Add image'),
    onClick: () => picker.click(),
  });
  return el('span', {}, [picker, button]);
}

async function addImages(patient, files, rerender) {
  const form = { kind: 'photo', caption: '', tooth: '' };
  const kindField = select('kind', KINDS.map((k) => ({ ...k, label: t(k.label) })), 'photo');
  const captionField = input('caption', { placeholder: t('e.g. periapical, upper right') });
  const toothField = input('tooth', { type: 'number', min: 11, max: 85,
    placeholder: t('FDI number, if it shows one tooth') });

  modal({
    title: files.length === 1 ? t('Add an image') : t('Add {n} images', { n: files.length }),
    body: el('div', {}, [
      el('p', { class: 'small muted', text: t('The image is made smaller on this device '
        + 'before it is saved, so it reaches the other devices quickly. The original on '
        + 'your phone or camera is not touched.') }),
      el('div', { class: 'field-row' }, [
        field('Type', kindField),
        field('Tooth', toothField),
      ]),
      field('Caption', captionField),
    ]),
    footer: [
      el('button', { class: 'btn', text: t('Cancel'), onClick: () => closeModal() }),
      el('button', {
        class: 'btn btn-primary',
        text: t('Save'),
        onClick: async (event) => {
          const button = event.target;
          button.disabled = true;
          button.textContent = t('Saving…');
          try {
            let saved = 0;
            for (const file of files) {
              const prepared = await prepare(file);
              await api.addAttachment(patient.id, {
                ...prepared,
                kind: kindField.value || form.kind,
                caption: captionField.value,
                tooth: toothField.value ? Number(toothField.value) : null,
              });
              saved += 1;
              button.textContent = t('Saving… {done} of {total}',
                { done: saved, total: files.length });
            }
            closeModal();
            toast(t('{n} image(s) saved', { n: saved }), 'success');
            await rerender();
          } catch (err) {
            button.disabled = false;
            button.textContent = t('Save');
            toast(t(err.message), 'error');
          }
        },
      }),
    ],
  });
}

/** Full-size view, with the arrows a dentist expects between images. */
function viewer(all, first, rerender) {
  let index = Math.max(0, all.findIndex((a) => a.id === first.id));
  const picture = el('div', { class: 'viewer-picture' });
  const caption = el('div', { class: 'viewer-caption' });

  const show = async () => {
    const item = all[index];
    clear(picture).append(el('div', { class: 'loading', text: t('Loading…') }));
    clear(caption).append(
      el('span', { class: 'strong', text: t(item.kind === 'xray' ? 'X-ray' : 'Photo') }),
      el('span', { class: 'faint', text: fmtDate(item.taken_on || item.created_at) }),
      item.tooth ? el('span', { class: 'badge', text: t('Tooth {n}', { n: item.tooth }) }) : null,
      item.caption ? el('span', {}, item.caption) : null,
      el('span', { class: 'faint small', text: sizeLabel(item.bytes) }),
      el('span', { class: 'faint small', text: `${item.width}×${item.height}` }),
    );
    try {
      const { attachment } = await api.attachment(item.id);
      clear(picture).append(el('img', { src: src(attachment.data), alt: item.caption || '' }));
    } catch (err) {
      clear(picture).append(el('p', { class: 'alert-chip', text: t(err.message) }));
    }
  };

  const step = (by) => {
    index = (index + by + all.length) % all.length;
    show();
  };

  modal({
    title: t('{current} of {total}', { current: index + 1, total: all.length }),
    width: 'xwide',
    body: el('div', { class: 'viewer' }, [picture, caption]),
    footer: [
      all.length > 1 ? el('button', { class: 'btn', text: t('Previous'),
        onClick: () => step(-1) }) : null,
      all.length > 1 ? el('button', { class: 'btn', text: t('Next'),
        onClick: () => step(1) }) : null,
      can('clinical:write')
        ? el('button', {
          class: 'btn btn-danger right',
          text: t('Delete'),
          onClick: () => confirmDialog({
            title: t('Delete this image?'),
            message: t('It is removed from this patient on every device.'),
            confirmLabel: t('Delete'),
            danger: true,
            onConfirm: async () => {
              await api.deleteAttachment(all[index].id);
              closeModal();
              toast(t('Image deleted'));
              await rerender();
            },
          }),
        })
        : null,
    ].filter(Boolean),
  });
  show();
}
