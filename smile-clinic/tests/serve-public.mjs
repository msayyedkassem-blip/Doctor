/**
 * Serves public/ on its own port and nothing else.
 *
 * It stands in for the phone: the app has to work when it is not coming from
 * the clinic server at all, which is exactly the situation inside the APK.
 *
 *   node tests/serve-public.mjs 4101
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PORT = Number(process.argv[2] || 4101);

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

http.createServer((req, res) => {
  const asked = req.url.split('?')[0];
  const file = path.join(ROOT, asked === '/' ? '/index.html' : asked);
  // Nothing outside public/, whatever the request says.
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('not found');
  }
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
  });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`the app, on its own origin: http://localhost:${PORT}`));
