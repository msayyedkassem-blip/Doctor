/**
 * Teeth drawn as teeth.
 *
 * A dentist reads a chart by shape before they read it by colour: a molar is
 * not a canine, and an upper tooth is not a lower one. Squares in a row carry
 * none of that, so every tooth here is drawn from its FDI number — crown
 * profile by type, roots the right count, and the arch flipped so roots always
 * point away from the mouth.
 *
 * The pulp is drawn inside every tooth, not just treated ones. That is the
 * whole point of the request behind this file: once the nerve is visible, a
 * root canal can be *shown* — the chamber and canals filled with the colour of
 * the material that replaced the nerve — instead of being a word in a tooltip.
 *
 * Geometry is authored for an upper tooth in a 40×76 box: apex at the top,
 * biting edge at the bottom. Lower teeth are the same drawing flipped.
 */

/** Second FDI digit says what kind of tooth it is. */
export function toothType(number) {
  const position = Number(number) % 10;
  if (position <= 2) return 'incisor';
  if (position === 3) return 'canine';
  if (position <= 5) return 'premolar';
  return 'molar';
}

/** First FDI digit says which arch: 1 and 2 upper, 3 and 4 lower (5-8 are baby teeth). */
export function isUpper(number) {
  const quadrant = Math.floor(Number(number) / 10);
  return quadrant === 1 || quadrant === 2 || quadrant === 5 || quadrant === 6;
}

const W = 40;
const H = 64;

/**
 * Crown, roots and pulp for one kind of tooth.
 *
 * Roots run from the apex down to the neck; the crown hangs below it. The pulp
 * chamber sits in the crown with a canal up each root, which is what makes a
 * filled root canal legible at a glance.
 */
const SHAPES = {
  incisor: {
    // One blade, one root. `outline` is the whole tooth in a single path so
    // crown and root never show a seam where they meet.
    outline: 'M20 4 C 16 12, 14.5 22, 15.5 31 C 10 33.5, 8.5 39, 8.5 46 '
      + 'C 8.5 55, 12.5 61, 20 61 C 27.5 61, 31.5 55, 31.5 46 '
      + 'C 31.5 39, 30 33.5, 24.5 31 C 25.5 22, 24 12, 20 4 Z',
    // The crown alone, closed across the neck: a filling or a cap colours
    // this, never the root.
    crown: 'M15.5 31 C 10 33.5, 8.5 39, 8.5 46 C 8.5 55, 12.5 61, 20 61 '
      + 'C 27.5 61, 31.5 55, 31.5 46 C 31.5 39, 30 33.5, 24.5 31 Z',
    chamber: 'M17 35 C 15 37, 14.5 41, 15 46 C 15.2 48, 24.8 48, 25 46 '
      + 'C 25.5 41, 25 37, 23 35 Z',
    canals: ['M20 9 C 18.6 17, 18.2 27, 18.4 36 L 21.6 36 C 21.8 27, 21.4 17, 20 9 Z'],
  },
  canine: {
    // The longest root in the mouth, under a crown that comes to a point.
    outline: 'M20 2 C 15.5 11, 14 22, 15 32 C 9.5 34.5, 8 40, 8.5 47 '
      + 'C 9 56, 13.5 62.5, 20 63.5 C 26.5 62.5, 31 56, 31.5 47 '
      + 'C 32 40, 30.5 34.5, 25 32 C 26 22, 24.5 11, 20 2 Z',
    crown: 'M15 32 C 9.5 34.5, 8 40, 8.5 47 C 9 56, 13.5 62.5, 20 63.5 '
      + 'C 26.5 62.5, 31 56, 31.5 47 C 32 40, 30.5 34.5, 25 32 Z',
    chamber: 'M16.5 36 C 14.5 38, 14 42.5, 14.5 47.5 C 14.7 49.5, 25.3 49.5, 25.5 47.5 '
      + 'C 26 42.5, 25.5 38, 23.5 36 Z',
    canals: ['M20 8 C 18.6 17, 18.2 27, 18.4 37 L 21.6 37 C 21.8 27, 21.4 17, 20 8 Z'],
  },
  premolar: {
    // Two cusps, so the biting edge dips in the middle.
    outline: 'M20 5 C 16 13, 14.5 23, 15.5 31 C 8.5 33, 6.5 38.5, 6.5 46 '
      + 'C 6.5 53.5, 9.5 59, 13.5 59.5 C 16.3 60, 16.8 56.5, 20 56.5 '
      + 'C 23.2 56.5, 23.7 60, 26.5 59.5 C 30.5 59, 33.5 53.5, 33.5 46 '
      + 'C 33.5 38.5, 31.5 33, 24.5 31 C 25.5 23, 24 13, 20 5 Z',
    crown: 'M15.5 31 C 8.5 33, 6.5 38.5, 6.5 46 C 6.5 53.5, 9.5 59, 13.5 59.5 '
      + 'C 16.3 60, 16.8 56.5, 20 56.5 C 23.2 56.5, 23.7 60, 26.5 59.5 '
      + 'C 30.5 59, 33.5 53.5, 33.5 46 C 33.5 38.5, 31.5 33, 24.5 31 Z',
    chamber: 'M16 35 C 13.5 37.5, 12.8 42, 13.3 47 C 13.5 49, 26.5 49, 26.7 47 '
      + 'C 27.2 42, 26.5 37.5, 24 35 Z',
    canals: ['M20 10 C 18.6 18, 18.2 27, 18.4 36 L 21.6 36 C 21.8 27, 21.4 18, 20 10 Z'],
  },
  molar: {
    // Two roots that part at the furcation, under a broad grinding surface.
    outline: 'M11 4 C 7 13, 6.5 22, 8 30 C 4.5 32, 3 37.5, 3 45 '
      + 'C 3 53, 6 59, 10.5 59.5 C 13.5 60, 14 56.5, 17 56.5 '
      + 'C 19 56.5, 19.5 59, 20 59 C 20.5 59, 21 56.5, 23 56.5 '
      + 'C 26 56.5, 26.5 60, 29.5 59.5 C 34 59, 37 53, 37 45 '
      + 'C 37 37.5, 35.5 32, 32 30 C 33.5 22, 33 13, 29 4 '
      + 'C 25.5 13, 24.6 22, 24.5 29 C 22.5 28, 17.5 28, 15.5 29 '
      + 'C 15.4 22, 14.5 13, 11 4 Z',
    crown: 'M8 30 C 4.5 32, 3 37.5, 3 45 C 3 53, 6 59, 10.5 59.5 '
      + 'C 13.5 60, 14 56.5, 17 56.5 C 19 56.5, 19.5 59, 20 59 '
      + 'C 20.5 59, 21 56.5, 23 56.5 C 26 56.5, 26.5 60, 29.5 59.5 '
      + 'C 34 59, 37 53, 37 45 C 37 37.5, 35.5 32, 32 30 '
      + 'C 27 28.5, 13 28.5, 8 30 Z',
    chamber: 'M11.5 33 C 9 35.5, 8.3 40.5, 8.8 46 C 9 48.5, 31 48.5, 31.2 46 '
      + 'C 31.7 40.5, 31 35.5, 28.5 33 Z',
    canals: [
      'M11 8 C 9.8 16, 10 24, 11 33 L 14 33 C 13.6 24, 12.8 16, 11 8 Z',
      'M29 8 C 30.2 16, 30 24, 29 33 L 26 33 C 26.4 24, 27.2 16, 29 8 Z',
    ],
  },
};

/** Conditions where the nerve is gone, so the canals are drawn as filled. */
const TREATED_PULP = new Set(['root_canal']);

/** Conditions where there is no tooth left to draw a nerve inside. */
const NO_PULP = new Set(['missing', 'implant']);

const svg = (tag, attrs, children = []) => {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attrs || {})) {
    if (value !== null && value !== undefined) node.setAttribute(name, String(value));
  }
  for (const child of children) if (child) node.append(child);
  return node;
};

/**
 * One tooth, ready to drop into the chart.
 *
 * Every part is a separate element with a class, so which parts a condition
 * recolours is decided in the stylesheet rather than here.
 */
export function toothDrawing(number, condition = 'healthy', { surfaces = '' } = {}) {
  const kind = toothType(number);
  const shape = SHAPES[kind];
  const upper = isUpper(number);

  // The drawing is authored crown-down. A lower tooth is the same tooth the
  // other way up, which is exactly what a mirror about the middle gives.
  const flip = upper ? '' : `translate(0 ${H}) scale(1 -1)`;

  const parts = [];

  if (condition === 'implant') {
    // Not a tooth at all: a threaded post in the bone, carrying a crown.
    parts.push(
      svg('path', { class: 'tooth-implant', d: 'M20 8 L20 32 M14 13 H26 M14 19 H26 M14 25 H26 M14 31 H26' }),
      svg('path', { class: 'tooth-outline tooth-crown-only', d: shape.crown }),
    );
  } else {
    // Outline first for the shape, then the crown region on top so a filling
    // or a cap colours the crown without bleeding into the root.
    parts.push(svg('path', { class: 'tooth-outline', d: shape.outline }));
    parts.push(svg('path', { class: 'tooth-crown', d: shape.crown }));
  }

  if (!NO_PULP.has(condition)) {
    const treated = TREATED_PULP.has(condition);
    const pulpClass = treated ? 'tooth-pulp treated' : 'tooth-pulp';
    for (const d of shape.canals) parts.push(svg('path', { class: `${pulpClass} canal`, d }));
    parts.push(svg('path', { class: pulpClass, d: shape.chamber }));
  }

  if (condition === 'missing') {
    parts.push(svg('path', { class: 'tooth-cross', d: 'M8 20 L32 60 M32 20 L8 60' }));
  }
  if (condition === 'extraction_needed') {
    // Marked for extraction, not yet gone: the cross sits over a whole tooth.
    parts.push(svg('path', { class: 'tooth-cross pending', d: 'M10 24 L30 56 M30 24 L10 56' }));
  }

  const group = svg('g', { transform: flip || null }, parts);
  const root = svg('svg', {
    class: 'tooth-svg',
    viewBox: `0 0 ${W} ${H}`,
    'aria-hidden': 'true',
    focusable: 'false',
  }, [group]);

  if (!surfaces) return root;

  // Which faces of the tooth were worked on, written across the crown. Kept
  // outside the flipped group so it reads the same way up in both arches.
  const label = svg('text', {
    class: 'tooth-surfaces',
    x: W / 2,
    y: upper ? 62 : 22,
    'text-anchor': 'middle',
  });
  label.textContent = surfaces;
  root.append(label);
  return root;
}
