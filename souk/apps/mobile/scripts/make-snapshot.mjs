/**
 * Bakes the current catalogue into the app bundle.
 *
 *   node scripts/make-snapshot.mjs [http://localhost:3100]
 *
 * The snapshot is the last-resort data source in lib/api.ts: it is what a
 * freshly sideloaded APK shows before any server is reachable. Re-run it
 * before each build so the bundled fallback is not stale.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const base = (process.argv[2] ?? 'http://localhost:3100').replace(/\/+$/, '');
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'catalogue-snapshot.json');

try {
  const response = await fetch(`${base}/api/catalogue`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const catalogue = await response.json();
  writeFileSync(out, JSON.stringify(catalogue, null, 2));
  console.log(`Snapshot écrit : ${catalogue.products.length} produits, ${catalogue.categories.length} rayons`);
} catch (error) {
  console.error(`Impossible de joindre ${base} : ${error.message}`);
  process.exit(1);
}
