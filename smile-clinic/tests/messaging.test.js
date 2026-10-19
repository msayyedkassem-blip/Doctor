import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { render, placeholdersIn, normalisePhone, whatsappLink } from '../server/lib/messaging.js';

describe('template rendering', () => {
  test('placeholders are replaced', () => {
    assert.equal(render('Hello {{name}}', { name: 'Ada' }), 'Hello Ada');
    assert.equal(render('{{a}} and {{b}}', { a: '1', b: '2' }), '1 and 2');
  });

  test('placeholder matching ignores case and inner spaces', () => {
    assert.equal(render('{{ Name }}', { name: 'Ada' }), 'Ada');
    assert.equal(render('{{NAME}}', { name: 'Ada' }), 'Ada');
  });

  test('a line that is only an empty placeholder disappears', () => {
    assert.equal(render('A\n{{gone}}\nB', {}), 'A\nB');
    assert.equal(render('A\n{{here}}\nB', { here: 'X' }), 'A\nX\nB');
  });

  test('deliberate paragraph breaks survive', () => {
    assert.equal(render('A\n\nB', {}), 'A\n\nB');
  });

  test('a partly-filled line is kept, not dropped', () => {
    assert.equal(render('Total: {{total}}', {}), 'Total:');
  });

  test('leading and trailing blank lines are trimmed', () => {
    assert.equal(render('\n\nHi\n\n\n', {}), 'Hi');
  });

  test('unknown placeholders vanish rather than leaking braces', () => {
    assert.equal(render('Hi {{nope}}!', {}), 'Hi !');
  });

  test('Arabic renders and keeps its emoji', () => {
    const out = render('مرحباً {{name}} 🦷\n{{line}}\nشكراً', { name: 'أحمد' });
    assert.equal(out, 'مرحباً أحمد 🦷\nشكراً');
  });

  test('placeholders are listed for the editor', () => {
    assert.deepEqual(placeholdersIn('{{a}} {{b}} {{a}}'), ['a', 'b']);
    assert.deepEqual(placeholdersIn('no placeholders'), []);
  });

  test('values are never treated as templates themselves', () => {
    // A patient literally named "{{clinic_name}}" must not expand.
    assert.equal(render('Hi {{name}}', { name: '{{clinic_name}}', clinic_name: 'Secret' }),
      'Hi {{clinic_name}}');
  });
});

describe('phone numbers for WhatsApp', () => {
  test('international formats are accepted as-is', () => {
    assert.equal(normalisePhone('+964 770 123 4567').phone, '9647701234567');
    assert.equal(normalisePhone('00964 770 123 4567').phone, '9647701234567');
    assert.equal(normalisePhone('+20 100 123 4567').phone, '201001234567');
  });

  test('a national trunk zero is swapped for the country code', () => {
    assert.equal(normalisePhone('07701234567', '964').phone, '9647701234567');
    assert.equal(normalisePhone('0770 123 4567', '964').phone, '9647701234567');
  });

  test('a bare local number gets the country code prepended', () => {
    assert.equal(normalisePhone('7701234567', '964').phone, '9647701234567');
  });

  test('a number already carrying the country code is not doubled', () => {
    assert.equal(normalisePhone('9647701234567', '964').phone, '9647701234567');
  });

  test('Arabic-Indic digits are understood', () => {
    assert.equal(normalisePhone('٠٧٧٠١٢٣٤٥٦٧', '964').phone, '9647701234567');
    assert.equal(normalisePhone('۰۷۷۰۱۲۳۴۵۶۷', '964').phone, '9647701234567');
  });

  test('a local number with no country code is refused, never guessed', () => {
    const result = normalisePhone('07701234567', '');
    assert.equal(result.ok, false);
    assert.match(result.reason, /country code/);
  });

  test('missing and nonsense numbers are refused with a reason', () => {
    assert.equal(normalisePhone('', '964').ok, false);
    assert.match(normalisePhone('', '964').reason, /no phone number/);
    assert.equal(normalisePhone('123', '964').ok, false);
    assert.equal(normalisePhone('1'.repeat(20), '964').ok, false);
  });

  test('punctuation and spacing are ignored', () => {
    assert.equal(normalisePhone('+1 (555) 010-1234').phone, '15550101234');
  });
});

describe('whatsapp links', () => {
  test('the message is URL-encoded into the link', () => {
    const link = whatsappLink('9647701234567', 'مرحباً أحمد');
    assert.ok(link.startsWith('https://wa.me/9647701234567?text='));
    assert.equal(decodeURIComponent(link.split('text=')[1]), 'مرحباً أحمد');
  });

  test('newlines and ampersands survive the round trip', () => {
    const body = 'Line one\nLine two & three';
    const link = whatsappLink('15550101234', body);
    assert.equal(decodeURIComponent(link.split('text=')[1]), body);
  });
});
