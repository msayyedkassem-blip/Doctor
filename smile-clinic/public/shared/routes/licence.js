/**
 * Seeing and entering the licence.
 *
 * The status endpoint is deliberately readable by anyone signed in: a
 * receptionist who cannot save a payment deserves to be told why, not left
 * guessing. Only an administrator can enter a key.
 */
import { json } from '../lib/http.js';
import { requirePermission } from '../lib/auth.js';
import { badRequest } from '../lib/errors.js';
import { str } from '../lib/validate.js';
import { logAction } from '../lib/audit.js';
import { readKey } from '../lib/licence.js';
import { licenceState, saveKey, storedKey, TRIAL_DAYS } from '../lib/licence-state.js';

export default function register(router) {
  router.get('/api/licence', async (ctx) => {
    const state = await licenceState();
    json(ctx.res, 200, {
      ...state,
      trial_days: TRIAL_DAYS,
      // Only the last few characters, enough to check which code is in use
      // when a customer has been sent more than one.
      key_tail: storedKey().slice(-5),
    });
  });

  router.post('/api/licence', async (ctx) => {
    requirePermission(ctx.user, 'settings:write');
    const key = str(ctx.body, 'key', { max: 400, required: true });

    const read = await readKey(key);
    if (!read.valid) throw badRequest(read.reason);

    // An expired code is refused at the door rather than saved and then
    // complained about, which would look like the app had taken the money.
    const state = await licenceState();
    if (read.expires && read.expires < (state.high_water || new Date().toISOString().slice(0, 10))) {
      throw badRequest(`That key expired on ${read.expires}.`);
    }

    saveKey(key);
    logAction(ctx.user, 'activate', 'licence', String(read.serial));
    json(ctx.res, 200, { ok: true, ...(await licenceState()) });
  });
}
