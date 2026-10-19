/**
 * Every string the app asks for a translation of, and which of them Arabic is
 * still missing.
 *
 *   npm run i18n:check          list what is untranslated
 *   npm run i18n:check -- --all print every key, translated or not
 *
 * Keys are the English text itself, so this is also how a reworded English
 * string is caught: its old translation simply stops being used.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCES = [
  ...walk(path.join(ROOT, 'public', 'js')),
].filter((f) => f.endsWith('.js') && !f.includes('/local/') && !f.includes('/shared/'));

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

// t('...') and t("..."), single-line only: a key split across lines is joined
// by the concatenation below before it reaches here.
// t('...'), plus the helpers that translate a positional argument themselves:
// writing t() at each of those call sites would bury the forms in noise.
const CALL = new RegExp(
  "(?:^|[^A-Za-z0-9_.$])"
  + "(?:t|field|emptyState|setTitle|statCard|statTile|tile|stat|row|kv)\\(\\s*"
  + "(['\"])((?:\\\\.|(?!\\1)[^\\\\])+)\\1", 'g');
// setTitle's second argument is a subtitle, also shown.
const SECOND = /setTitle\(\s*(['"])(?:\\.|(?!\1)[^\\])*\1\s*,\s*(['"])((?:\\.|(?!\2)[^\\])+)\2/g;
// field()'s third argument is the hint under the box, which field() translates.
const HINT = /\}\s*\)\s*,\s*(['"])((?:\\.|(?!\1)[^\\])+)\1\s*\)/g;

function unescapeJs(text) {
  return text
    .replace(/\\u\{([0-9a-fA-F]+)\}/g, (m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\n/g, '\n').replace(/\\t/g, '\t')
    .replace(/\\(['"\\])/g, '$1');
}

// Keys the app looks up by value rather than by writing them inside t():
// a greeting chosen by the hour, a footnote passed positionally to a tile.
const INDIRECT = [
  'Good morning, {name}', 'Good afternoon, {name}', 'Good evening, {name}',
  'Collected minus expenses',
  // Badge and next-step labels, held in maps keyed by the status they describe.
  'Scheduled', 'Confirmed', 'Arrived', 'Completed', 'Cancelled', 'No show',
  'Confirm', 'Complete',
  'Draft', 'Unpaid', 'Part paid', 'Paid', 'Void',
  'Planned', 'In progress',
  // Device names, derived from the browser's user-agent at display time.
  'iPhone', 'iPad', 'iPhone app', 'iPad app', 'Android phone', 'Android tablet',
  'Android phone app', 'Android tablet app', 'Mac', 'Windows PC',
  'Linux computer', 'Unknown device',
  // Plan names, held in a map keyed by what the licence says.
  'Monthly', 'Yearly', 'One-off purchase', 'Free trial',
  // Sentences the server sends back, translated by t(err.message) on arrival.
  'The free trial has ended. Enter a licence key in Settings to carry on adding '
    + 'records — everything already here stays readable.',
  'This copy is read-only until a licence key is entered in Settings. '
    + 'Everything already here stays readable.',
  'That key is not genuine. Check it was typed correctly.',
  'That key is too short to be complete.',
  'That key is the wrong length.',
  'That is not a licence key.',
  'That code contains a character it should not.',
  // Sentences the image routes send back.
  'That image is too large. Please take or choose a smaller one.',
  'Only JPEG, PNG and WebP images can be stored',
  'An image is either an x-ray or a photo',
  'That file is not an image', 'No image was sent', 'No such image',
  // Image kinds, picked by the row's own value.
  'X-ray', 'Photo',
  // Stock units and the sentences its routes send back.
  'piece', 'box', 'pack', 'bottle', 'tube', 'syringe', 'ml', 'g', 'pair',
  'There is not that much to take', 'That would not change anything',
  // Stock labels chosen from a map or a ternary at display time.
  'Running out only', 'Include retired', 'Add an item', 'Item added', 'Item saved',
  'Used', 'Wasted or broken', 'Expired', 'Counted on the shelf',
  // Medicine categories, forms and cautions, read from the clinic's own list.
  'Antibiotic', 'Pain relief', 'Swelling', 'Mouthwash', 'Topical', 'Antifungal',
  'Antiviral', 'Prevention', 'Other',
  'tablet', 'capsule', 'syrup', 'gel', 'mouthwash',
  'Edit medicine', 'Usual dose',
  'A prescription needs at least one medicine', 'No such medicine',
  'No such prescription',
  // Sentences the assistant sends back.
  'No assistant key is set. Add one in Settings.',
  'From console.anthropic.com. Kept on this computer and never shown again.',
  'Leave as it is unless you have a reason to change it',
  'Paste what the patient wrote, or say what the message should be about.',
  'Could not reach the assistant. Check this computer is online.',
  'That assistant key was not accepted.',
  'The assistant is busy. Try again in a moment.',
  'The assistant would not write that one. Please write it yourself.',
  'The assistant sent nothing back. Please write it yourself.',
  'The assistant is switched off. An administrator can turn it on in Settings.',
  'That is not a reason for a change', 'No such item',
];

const keys = new Set(INDIRECT);
for (const file of SOURCES) {
  // 'one ' + 'two' + 'three' is one key, written across lines to stay
  // readable. JavaScript joins it before t() ever sees it, so this must too —
  // and repeatedly, since each pass only joins one pair.
  let src = fs.readFileSync(file, 'utf8');
  const JOIN = /(['"])((?:\\.|(?!\1)[^\\])*)\1\s*\+\s*(['"])((?:\\.|(?!\3)[^\\])*)\3/g;
  for (let pass = 0; pass < 12; pass += 1) {
    const joined = src.replace(JOIN, (m, q1, a, q2, b) => `${q1}${a}${b}${q1}`);
    if (joined === src) break;
    src = joined;
  }
  // The key t() actually receives is the *decoded* string: '\u2014' in the
  // source is an em dash by the time it is looked up.
  for (const match of src.matchAll(CALL)) keys.add(unescapeJs(match[2]));
  for (const match of src.matchAll(SECOND)) keys.add(unescapeJs(match[3]));
  // The same shape catches a tone or toast kind passed in that position.
  const NOT_PROSE = new Set(['pos', 'neg', 'success', 'error', 'info', 'warning']);
  for (const match of src.matchAll(HINT)) {
    const key = unescapeJs(match[2]);
    if (!NOT_PROSE.has(key)) keys.add(key);
  }
}

const { AR } = await import(path.join(ROOT, 'public', 'i18n', 'ar.js'));
const sorted = [...keys].sort((a, b) => a.localeCompare(b));
const missing = sorted.filter((k) => !AR[k]);

if (process.argv.includes('--all')) {
  for (const key of sorted) console.log(`${AR[key] ? '  ' : '! '}${key}`);
} else {
  for (const key of missing) console.log(key);
}

const stale = Object.keys(AR).filter((k) => !keys.has(k));
console.error(`\n${sorted.length} keys, ${missing.length} without Arabic`
  + `, ${stale.length} translations no longer used`);
if (stale.length && process.argv.includes('--stale')) {
  for (const key of stale) console.error(`  unused: ${key}`);
}
process.exit(missing.length ? 1 : 0);
