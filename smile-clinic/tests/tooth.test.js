/**
 * Which tooth gets drawn, and which way up.
 *
 * The shape is derived from the FDI number alone, so an off-by-one here means
 * a chart full of molars where the canines should be — wrong in a way that
 * looks fine until a dentist reads it.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

/** The module builds SVG nodes, so it needs just enough DOM to run in Node. */
function installDom() {
  const made = [];
  globalThis.document = {
    createElementNS(_ns, tag) {
      const node = {
        tag,
        attrs: {},
        children: [],
        textContent: '',
        style: {},
        setAttribute(name, value) { this.attrs[name] = value; },
        getAttribute(name) { return this.attrs[name] ?? null; },
        append(...kids) { this.children.push(...kids); },
      };
      made.push(node);
      return node;
    },
  };
  return made;
}

const flatten = (node, out = []) => {
  out.push(node);
  for (const child of node.children || []) flatten(child, out);
  return out;
};

const classesOf = (node) =>
  flatten(node).map((n) => n.attrs?.class).filter(Boolean);

let toothType; let isUpper; let toothDrawing;

before(async () => {
  installDom();
  ({ toothType, isUpper, toothDrawing } = await import('../public/js/views/tooth.js'));
});

after(() => { delete globalThis.document; });

describe('reading an FDI number', () => {
  test('the second digit says what kind of tooth it is', () => {
    for (const n of [11, 21, 31, 41, 12, 22, 32, 42]) {
      assert.equal(toothType(n), 'incisor', `${n} should be an incisor`);
    }
    for (const n of [13, 23, 33, 43]) assert.equal(toothType(n), 'canine');
    for (const n of [14, 15, 24, 25, 34, 35, 44, 45]) assert.equal(toothType(n), 'premolar');
    for (const n of [16, 17, 18, 26, 27, 28, 36, 37, 38, 46, 47, 48]) {
      assert.equal(toothType(n), 'molar', `${n} should be a molar`);
    }
  });

  test('the first digit says which jaw', () => {
    for (const n of [11, 18, 21, 28]) assert.equal(isUpper(n), true, `${n} is upper`);
    for (const n of [31, 38, 41, 48]) assert.equal(isUpper(n), false, `${n} is lower`);
    // Baby teeth: quadrants 5 and 6 upper, 7 and 8 lower.
    assert.equal(isUpper(55), true);
    assert.equal(isUpper(65), true);
    assert.equal(isUpper(75), false);
    assert.equal(isUpper(85), false);
  });
});

describe('drawing a tooth', () => {
  test('an upper tooth is drawn as authored, a lower one is flipped', () => {
    const upper = toothDrawing(16, 'healthy');
    const lower = toothDrawing(46, 'healthy');
    const groupOf = (n) => flatten(n).find((x) => x.tag === 'g');
    assert.ok(!groupOf(upper).attrs.transform,
      'upper teeth are drawn the way the paths are authored');
    assert.match(groupOf(lower).attrs.transform, /scale\(1 -1\)/,
      'lower teeth are the same drawing mirrored');
  });

  test('every tooth shows its nerve, so a treated one can differ', () => {
    const healthy = toothDrawing(16, 'healthy');
    assert.ok(classesOf(healthy).some((c) => c.includes('tooth-pulp')),
      'the pulp is drawn even when nothing has been done to it');
    assert.ok(!classesOf(healthy).some((c) => c.includes('treated')));
  });

  test('a root canal fills the chamber and every canal', () => {
    const treated = toothDrawing(16, 'root_canal');
    const filled = classesOf(treated).filter((c) => c.includes('treated'));
    // A molar has two canals plus the chamber: all three are filled, or the
    // drawing would show a half-treated tooth.
    assert.equal(filled.length, 3);
    const incisor = classesOf(toothDrawing(11, 'root_canal')).filter((c) => c.includes('treated'));
    assert.equal(incisor.length, 2, 'one canal plus the chamber');
  });

  test('a missing tooth has no nerve to draw', () => {
    for (const condition of ['missing', 'implant']) {
      const classes = classesOf(toothDrawing(16, condition));
      assert.ok(!classes.some((c) => c.includes('tooth-pulp')),
        `${condition} should not draw a pulp`);
    }
  });

  test('an implant is a post, not a root', () => {
    const classes = classesOf(toothDrawing(16, 'implant'));
    assert.ok(classes.some((c) => c.includes('tooth-implant')));
  });

  test('surfaces are written on the tooth when they are known', () => {
    const plain = flatten(toothDrawing(16, 'filled'));
    const marked = flatten(toothDrawing(16, 'filled', { surfaces: 'MOD' }));
    assert.ok(!plain.some((n) => n.tag === 'text'));
    const label = marked.find((n) => n.tag === 'text');
    assert.equal(label.textContent, 'MOD');
  });
});
