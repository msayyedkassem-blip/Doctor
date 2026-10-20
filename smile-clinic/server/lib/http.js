import { HttpError, badRequest, notFound } from './errors.js';

const MAX_BODY = 2 * 1024 * 1024; // 2 MB is plenty for JSON payloads


const encoder = new TextEncoder();

export function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    // TextEncoder rather than Buffer, so this file also runs inside a phone.
    'Content-Length': encoder.encode(body).length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

export function text(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(body);
}

export async function readBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return {};
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw badRequest('Request body too large');
    chunks.push(chunk);
  }
  if (!size) return {};
  const raw = new TextDecoder('utf-8').decode(concatChunks(chunks, size));
  const type = req.headers['content-type'] || '';
  if (type.includes('application/json')) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed === null || typeof parsed !== 'object') throw new Error('not an object');
      return parsed;
    } catch {
      throw badRequest('Request body must be valid JSON');
    }
  }
  if (type.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(raw));
  }
  throw badRequest('Unsupported content type');
}

/** Joins request chunks without Buffer, which a phone does not have. */
function concatChunks(chunks, size) {
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk), offset);
    offset += chunk.length;
  }
  return out;
}

export function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

/**
 * Tiny path router. Patterns look like 'GET /api/patients/:id'; the matched
 * segments arrive on ctx.params.
 */
export class Router {
  constructor() { this.routes = []; }

  add(method, pattern, handler, options = {}) {
    const keys = [];
    const regex = new RegExp(
      '^' + pattern.split('/').map((seg) => {
        if (seg.startsWith(':')) { keys.push(seg.slice(1)); return '([^/]+)'; }
        return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }).join('/') + '$',
    );
    this.routes.push({ method, regex, keys, handler, options });
    return this;
  }

  get(p, h, o) { return this.add('GET', p, h, o); }
  post(p, h, o) { return this.add('POST', p, h, o); }
  put(p, h, o) { return this.add('PUT', p, h, o); }
  patch(p, h, o) { return this.add('PATCH', p, h, o); }
  delete(p, h, o) { return this.add('DELETE', p, h, o); }

  match(method, pathname) {
    let pathExists = false;
    for (const route of this.routes) {
      const m = route.regex.exec(pathname);
      if (!m) continue;
      pathExists = true;
      if (route.method !== method) continue;
      const params = {};
      route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route, params };
    }
    if (pathExists) throw new HttpError(405, `${method} not allowed on this endpoint`);
    return null;
  }
}
