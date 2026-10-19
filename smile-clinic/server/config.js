import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { configureRuntime } from './lib/runtime.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(here, '..');
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const MIGRATIONS_DIR = path.join(here, 'migrations');

export const config = {
  port: Number(process.env.PORT || 4000),
  host: process.env.HOST || '0.0.0.0',
  dataDir: process.env.DATA_DIR || path.join(ROOT, 'data'),
  dbFile: process.env.DB_FILE || '',
  // Sessions live this long; every authenticated request slides the window.
  sessionDays: Number(process.env.SESSION_DAYS || 30),
  // Set to '1' behind an HTTPS reverse proxy so the cookie gets the Secure flag.
  secureCookies: process.env.SECURE_COOKIES === '1',
};

// Hand the shared code the few values it needs, without it importing anything
// that only exists on a server.
configureRuntime({
  sessionDays: config.sessionDays,
  secureCookies: config.secureCookies,
  port: config.port,
});

export function dbPath() {
  return config.dbFile || path.join(config.dataDir, 'clinic.db');
}
