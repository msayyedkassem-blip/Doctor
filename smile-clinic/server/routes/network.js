/**
 * Reporting the machine's own network addresses only means something on a
 * server, so this route lives apart from the rest and is registered only by
 * the Node entry point. Inside a phone there is no such thing to report.
 */
import { json } from '../lib/http.js';
import { requireAuth } from '../lib/auth.js';
import { runtime } from '../lib/runtime.js';
import { localAddresses } from '../lib/network.js';

export default function register(router) {
  /**
   * The addresses other devices on the clinic's network can use. Reports what
   * was rejected too, so a machine with no usable address gets a real reason
   * rather than a guess.
   */
  router.get('/api/network', async (ctx) => {
    requireAuth(ctx.user);
    const port = ctx.req.headers.host?.split(':')[1] || String(runtime.port);
    const { addresses, rejected, interfacesSeen } = localAddresses(port);
    json(ctx.res, 200, {
      addresses,
      rejected,
      interfaces_seen: interfacesSeen,
      port,
      local: `http://localhost:${port}`,
      platform: process.platform,
    });
  });
}
