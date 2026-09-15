/**
 * Generate an ADMIN_PASSWORD_HASH value.
 *   pnpm --filter @souk/web hash-password 'your password'
 */
import { randomBytes, scryptSync } from 'node:crypto';

const password = process.argv[2];
if (!password) {
  console.error("Usage: pnpm --filter @souk/web hash-password 'votre mot de passe'");
  process.exit(1);
}
if (password.length < 12) {
  console.error('Mot de passe trop court : 12 caractères minimum.');
  process.exit(1);
}

const salt = randomBytes(16);
const key = scryptSync(password, salt, 64);
console.log(`ADMIN_PASSWORD_HASH="scrypt:${salt.toString('hex')}:${key.toString('hex')}"`);
console.log(`SESSION_SECRET="${randomBytes(32).toString('base64url')}"`);
