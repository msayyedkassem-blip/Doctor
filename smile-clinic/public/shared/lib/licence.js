/**
 * Licence keys: what one says, and how a clinic proves it is real.
 *
 * A key is a short binary record signed with ECDSA P-256. The public half is
 * compiled into the app; the private half never leaves the seller's machine, so
 * nobody can mint a key without it. P-256 rather than Ed25519 because every
 * browser and Android WebView in service has had it for a decade.
 *
 * What this can and cannot do is worth being honest about. The app ships as
 * readable JavaScript on the customer's own computer, so somebody determined
 * can edit the check out. What signing prevents is the ordinary failure: one
 * paying customer handing a working code to twenty others. That is the leak
 * that actually costs money, and a signature closes it.
 *
 * Runs unchanged on a server, in a phone, and in the minting tool.
 */
/** Payload layout, 16 bytes, fixed. Everything is big-endian. */
const MAGIC = 0x53;        // 'S'
const LAYOUT = 1;
export const PLANS = ['trial', 'monthly', 'yearly', 'lifetime'];
const EPOCH = Date.UTC(2020, 0, 1) / 86400000; // days since 1970 at 2020-01-01

// Crockford base32 without I, L, O, U: no character can be confused for another
// when a code is read aloud over the phone or copied off a screen.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const VALUES = new Map([...ALPHABET].map((c, i) => [c, i]));

export function encode32(bytes) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function decode32(text) {
  const clean = String(text).toUpperCase()
    .replace(/[\s-]/g, '')
    // The letters the alphabet leaves out are exactly the ones people
    // substitute by eye, so they are read as what they were meant to be.
    .replace(/O/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V');
  const out = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    if (!VALUES.has(char)) throw new Error('That code contains a character it should not.');
    value = (value << 5) | VALUES.get(char);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** Days since 2020-01-01, the form an expiry travels in. */
export const toDay = (iso) => Math.floor(Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`)
  / 86400000) - EPOCH;

export const fromDay = (day) =>
  new Date((day + EPOCH) * 86400000).toISOString().slice(0, 10);

export const today = () => new Date().toISOString().slice(0, 10);

/**
 * The 16 bytes that are signed.
 *
 * Deliberately small: every byte here is three more characters for somebody to
 * copy. The licensee's name is not in it — the serial is, and the seller keeps
 * the list of who holds which.
 */
export function packPayload({ plan, expires, devices, serial }) {
  const index = PLANS.indexOf(plan);
  if (index < 0) throw new Error(`Unknown plan: ${plan}`);
  if (!Number.isInteger(devices) || devices < 1 || devices > 255) {
    throw new Error('Devices must be a whole number from 1 to 255.');
  }
  if (!Number.isInteger(serial) || serial < 0 || serial > 0xffffffff) {
    throw new Error('Serial must be a whole number from 0 to 4294967295.');
  }
  const day = plan === 'lifetime' ? 0 : toDay(expires);
  if (plan !== 'lifetime' && (day < 0 || day > 0xffff)) {
    throw new Error('That expiry date is outside the range a key can carry.');
  }

  const bytes = new Uint8Array(16);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, MAGIC);
  view.setUint8(1, LAYOUT);
  view.setUint8(2, index);
  view.setUint8(3, devices);
  view.setUint16(4, day);
  view.setUint32(6, serial);
  // Bytes 10-15 stay zero: room to say more in a later layout without
  // changing the length of every key already sold.
  return bytes;
}

export function unpackPayload(bytes) {
  if (bytes.length !== 16) throw new Error('That key is the wrong length.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint8(0) !== MAGIC) throw new Error('That is not a licence key.');
  const layout = view.getUint8(1);
  if (layout !== LAYOUT) {
    throw new Error(`That key was made for a newer version of the app (layout ${layout}).`);
  }
  const plan = PLANS[view.getUint8(2)];
  if (!plan) throw new Error('That key names a plan this version does not know.');
  const day = view.getUint16(4);
  return {
    plan,
    devices: view.getUint8(3),
    expires: plan === 'lifetime' ? null : fromDay(day),
    serial: view.getUint32(6),
  };
}

/** Groups of five, which is how a person reads a code back to you. */
export const format = (key) => String(key).replace(/(.{5})(?=.)/g, '$1-');

/**
 * Turns a signed payload into the string a customer is given.
 * 16 bytes of payload + 64 of signature = 128 characters.
 */
export const composeKey = (payload, signature) =>
  format(encode32(new Uint8Array([...payload, ...signature])));

export function splitKey(key) {
  const bytes = decode32(key);
  if (bytes.length < 80) throw new Error('That key is too short to be complete.');
  return { payload: bytes.slice(0, 16), signature: bytes.slice(16, 80) };
}

// ---- verification ---------------------------------------------------------

let publicKeyPem = null;

/** The seller's public key, set once at startup. */
export function setLicencePublicKey(raw) {
  publicKeyPem = raw || null;
}

export const hasLicencePublicKey = () => Boolean(publicKeyPem);

/**
 * Checking a signature needs nothing platform-specific: Node 22 and every
 * browser the app runs in expose the same WebCrypto. The seam is kept only so
 * a test can watch what was asked.
 */
async function webcryptoVerify(publicKeyBase64, payload, signature) {
  const raw = fromBase64(publicKeyBase64);
  const key = await globalThis.crypto.subtle.importKey(
    'raw', raw, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'],
  );
  return globalThis.crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' }, key, signature, payload,
  );
}

function fromBase64(text) {
  const binary = typeof atob === 'function'
    ? atob(text)
    : Buffer.from(text, 'base64').toString('binary');
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

let verifier = webcryptoVerify;

/** Only a test should ever need to replace this. */
export function setLicenceVerifier(fn) {
  verifier = fn || webcryptoVerify;
}

/**
 * Reads a key and says what it grants, or why it is refused.
 *
 * Never throws for a bad key: a person mistyping a code should see a sentence,
 * not a stack trace.
 */
export async function readKey(key) {
  if (!key) return { valid: false, reason: 'No licence key.' };
  let parts;
  try {
    parts = splitKey(key);
  } catch (err) {
    return { valid: false, reason: err.message };
  }

  let payload;
  try {
    payload = unpackPayload(parts.payload);
  } catch (err) {
    return { valid: false, reason: err.message };
  }

  if (!verifier || !publicKeyPem) {
    return { valid: false, reason: 'This copy cannot check licence keys.' };
  }
  let ok = false;
  try {
    ok = await verifier(publicKeyPem, parts.payload, parts.signature);
  } catch {
    ok = false;
  }
  if (!ok) {
    return { valid: false, reason: 'That key is not genuine. Check it was typed correctly.' };
  }
  return { valid: true, ...payload };
}
