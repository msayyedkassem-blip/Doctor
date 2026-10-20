/**
 * The cryptography the app needs, in a form both Node and a phone can provide.
 *
 * Password hashes must verify in both places: once records sync, a dentist has
 * to be able to sign in on their phone with no server in reach. WebCrypto
 * offers no scrypt, so PBKDF2-SHA256 is the algorithm both sides share.
 *
 * Everything here is async because WebCrypto is.
 */

let impl = null;

export function setCryptoImpl(next) {
  impl = next;
}

function crypto() {
  if (!impl) throw new Error('No crypto implementation installed.');
  return impl;
}

// OWASP's 2023 floor for PBKDF2-HMAC-SHA256.
const ITERATIONS = 210000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

const fromHex = (hex) => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
};

export function randomHex(bytes) {
  return toHex(crypto().randomBytes(bytes));
}

export function randomToken() {
  // base64url of 32 random bytes, as a URL- and cookie-safe session token.
  const bytes = crypto().randomBytes(32);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 = crypto().toBase64(bytes, binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(text) {
  return toHex(await crypto().sha256(text));
}

export async function hashPassword(password) {
  const salt = crypto().randomBytes(SALT_BYTES);
  const key = await crypto().pbkdf2(password, salt, ITERATIONS, KEY_BYTES);
  return `pbkdf2$${ITERATIONS}$${toHex(salt)}$${toHex(key)}`;
}

/**
 * Verifies a password against either hash format.
 *
 * `scrypt$...` hashes predate the move to PBKDF2 and can only be checked on
 * Node; on a phone they fail, which is why `needsRehash` exists — the server
 * quietly upgrades a hash the next time that user signs in.
 */
export async function verifyPassword(password, stored) {
  try {
    const parts = String(stored || '').split('$');
    if (parts[0] === 'pbkdf2') {
      const [, iterations, saltHex, keyHex] = parts;
      const expected = fromHex(keyHex);
      const actual = await crypto().pbkdf2(
        password, fromHex(saltHex), Number(iterations), expected.length,
      );
      return timingSafeEqual(expected, actual);
    }
    if (parts[0] === 'scrypt') {
      if (!crypto().scrypt) return false; // not available on a phone
      const [, N, r, p, saltHex, keyHex] = parts;
      const expected = fromHex(keyHex);
      const actual = await crypto().scrypt(password, fromHex(saltHex), expected.length, {
        N: Number(N), r: Number(r), p: Number(p),
      });
      return timingSafeEqual(expected, actual);
    }
    return false;
  } catch {
    return false;
  }
}

/** True when a stored hash is in the old format and should be replaced. */
export function needsRehash(stored) {
  return !String(stored || '').startsWith('pbkdf2$');
}

/** Constant-time comparison, so a wrong guess leaks nothing through timing. */
export function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}
