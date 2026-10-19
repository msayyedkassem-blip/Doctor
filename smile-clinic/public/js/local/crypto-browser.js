/** The browser's side of the crypto the shared code needs. */
import { setCryptoImpl } from '../../shared/lib/crypto.js';

export function installBrowserCrypto() {
  setCryptoImpl({
    randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),

    toBase64: (bytes, binary) => btoa(binary),

    sha256: async (text) => new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
    ),

    pbkdf2: async (password, salt, iterations, length) => {
      const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'],
      );
      const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, length * 8,
      );
      return new Uint8Array(bits);
    },

    // No scrypt here: a hash in the old format cannot be checked on a phone.
    // The server upgrades those to PBKDF2 the next time the user signs in.
    scrypt: null,
  });
}
