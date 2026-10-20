/**
 * Serving files from disk — the one piece of the HTTP layer that only makes
 * sense on a server. Inside the phone the app's files come from the app itself.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PUBLIC_DIR } from '../config.js';
import { notFound } from './errors.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

/** Serve a file from /public, falling back to index.html for SPA routes. */
export function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const full = path.join(PUBLIC_DIR, rel);
  // Guard against path traversal: the resolved path must stay inside /public.
  if (!full.startsWith(PUBLIC_DIR + path.sep) && full !== PUBLIC_DIR) {
    throw notFound('Not found');
  }
  let target = full;
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    // Only a route-looking request falls back to the app shell. A missing
    // script or wasm file must 404: serving it HTML instead produces a MIME
    // error that says nothing about the real problem.
    if (path.extname(rel)) throw notFound(`No such file: ${rel}`);
    target = path.join(PUBLIC_DIR, 'index.html');
    if (!fs.existsSync(target)) throw notFound('Not found');
  }
  const ext = path.extname(target).toLowerCase();
  const stat = fs.statSync(target);
  const etag = `W/"${stat.size}-${Number(stat.mtimeMs).toString(36)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag });
    res.end();
    return;
  }
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'ETag': etag,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
  });
  fs.createReadStream(target).pipe(res);
}
