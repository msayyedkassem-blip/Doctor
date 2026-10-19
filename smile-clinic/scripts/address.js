/**
 * Prints the addresses this machine can be reached on.
 *
 *   npm run address
 *
 * Useful when the app itself cannot tell you — it needs no browser, no login,
 * and does not require the server to be running.
 */
import { localAddresses } from '../server/lib/network.js';
import { config } from '../server/config.js';

const port = process.env.PORT || config.port;
const { addresses, rejected, interfacesSeen } = localAddresses(port);

console.log('');
console.log(`  On this computer:      http://localhost:${port}`);

if (addresses.length) {
  console.log('');
  console.log('  From a phone or another computer on the same network:');
  for (const a of addresses) {
    const note = a.kind === 'self-assigned'
      ? '  (self-assigned — this machine did not get an address from the router)'
      : a.kind === 'public' ? '  (public address)' : '';
    console.log(`      ${a.url.padEnd(28)} via ${a.label}${note}`);
  }
  console.log('');
  console.log('  Open that address in the phone’s browser, then use');
  console.log('  "Add to Home Screen" (iPhone) or "Install app" (Android).');
} else {
  console.log('');
  console.log('  No address other devices could use was found.');
  console.log(`  Network interfaces present: ${interfacesSeen.join(', ') || 'none'}`);
  if (rejected.length) {
    console.log('  Each was skipped because:');
    for (const r of rejected) console.log(`      ${r.interface} ${r.address || ''} — ${r.why}`);
  }
  console.log('');
  console.log('  Usually this means the computer is not on Wi-Fi or Ethernet.');
  console.log('  On a Mac you can check with:  ipconfig getifaddr en0');
}
console.log('');
