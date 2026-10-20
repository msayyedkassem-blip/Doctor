/** The Node implementation of the crypto the app needs. */
import crypto from 'node:crypto';
import { setCryptoImpl } from './crypto.js';

export function installNodeCrypto() {
  setCryptoImpl({
    randomBytes: (n) => new Uint8Array(crypto.randomBytes(n)),

    toBase64: (bytes) => Buffer.from(bytes).toString('base64'),

    sha256: async (text) => new Uint8Array(
      crypto.createHash('sha256').update(text).digest(),
    ),

    pbkdf2: (password, salt, iterations, length) => new Promise((resolve, reject) => {
      crypto.pbkdf2(password, Buffer.from(salt), iterations, length, 'sha256',
        (err, key) => (err ? reject(err) : resolve(new Uint8Array(key))));
    }),

    // Only Node can check hashes written before the move to PBKDF2.
    scrypt: (password, salt, length, options) => new Promise((resolve, reject) => {
      crypto.scrypt(password, Buffer.from(salt), length, options,
        (err, key) => (err ? reject(err) : resolve(new Uint8Array(key))));
    }),
  });
}
