/**
 * The main thread's link to the clinic server running inside this phone.
 *
 * It presents the same shape as `fetch` against a real server, so api.js can
 * talk to either without caring which. The session token stands in for the
 * cookie a real server would set.
 */
const TOKEN_KEY = 'clinic.local.token';

let worker = null;
let nextId = 1;
const pending = new Map();

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (event) => {
    const { id, ok, result, progress } = event.data || {};
    const waiting = pending.get(id);
    if (!waiting) return;

    // Progress is news about a request still running, not its answer.
    if (progress !== undefined) {
      if (waiting.onProgress) waiting.onProgress(progress);
      return;
    }

    pending.delete(id);
    waiting.resolve({ ok, result });
  };
  worker.onerror = (event) => {
    // A worker that failed to start can never answer; fail everything waiting
    // rather than leave the screen spinning forever.
    const message = event.message || 'The local database failed to start';
    for (const [, waiting] of pending) waiting.reject(new Error(message));
    pending.clear();
  };
  return worker;
}

function send(type, payload, onProgress) {
  const id = nextId;
  nextId += 1;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    ensureWorker().postMessage({ id, type, ...payload });
    // A first sync can move thousands of records, so it is given far longer
    // than an ordinary request.
    const limit = type === 'sync' ? 300000 : 30000;
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error('The local database did not answer in time'));
      }
    }, limit);
  });
}

export const token = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (value) => { try { localStorage.setItem(TOKEN_KEY, value); } catch { /* ignore */ } },
  clear: () => { try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } },
};

/** Runs a request against the in-phone server and returns a Response-alike. */
export async function localRequest(method, url, body) {
  const [path, query] = String(url).split('?');
  const { result } = await send('request', {
    request: { method, path, query: query || '', body, token: token.get() },
  });

  // A handler setting a session cookie is how sign-in and sign-out are
  // expressed; here that becomes the stored token.
  const cookie = result.headers?.['set-cookie'];
  if (cookie) {
    const match = /clinic_session=([^;]*)/.exec(cookie);
    if (match) {
      if (match[1]) token.set(match[1]);
      else token.clear();
    }
  }

  return {
    ok: result.status >= 200 && result.status < 300,
    status: result.status,
    headers: new Headers(result.headers || {}),
    text: async () => result.body,
    json: async () => (result.body ? JSON.parse(result.body) : null),
  };
}

export const localStatus = () => send('status', {}).then((r) => r.result);

/** Sends this device's changes and takes everyone else's. */
export const localSync = (onProgress) => send('sync', {}, onProgress).then((r) => {
  if (!r.ok) throw new Error(errorFrom(r));
  return r.result;
});

/** Pulls the message out of a worker failure, whatever shape it arrived in. */
function errorFrom(reply) {
  try { return JSON.parse(reply.result.body).error; }
  catch { return reply?.result?.error || 'The local database could not complete that'; }
}

export const localSyncSummary = () => send('sync-summary', {}).then((r) => r.result);

export const localSyncIssues = () => send('sync-issues', {}).then((r) => r.result);

export const localSyncRegister = (request) => send('sync-register', { request }).then((r) => {
  if (!r.ok) throw new Error(errorFrom(r));
  return r.result;
});

/** The whole database as bytes, for a backup the clinic can keep. */
export const exportLocalDatabase = () => send('export', {}).then((r) => r.result.bytes);
