import os from 'node:os';

/** Interfaces that are never the address a phone should use. */
const VIRTUAL = /^(lo|utun|awdl|llw|bridge|docker|veth|vmnet|vboxnet|tun|tap|ap\d|anpi)/i;

/**
 * The same thing on Windows, where adapters have sentences for names.
 *
 * Windows machines routinely carry half a dozen adapters that answer to
 * nothing: WSL and Docker each add a vEthernet, VirtualBox and VMware add
 * their own networks, and all of them hand out 192.168.x addresses that look
 * perfectly reachable and are not. Offering one of those as "the address to
 * type into the phone" is the most common way the join fails.
 */
const VIRTUAL_WINDOWS =
  /(vethernet|hyper-v|virtualbox|vmware|vmnet|bluetooth|loopback|npcap|tap-windows|openvpn|zerotier|tailscale|wintun|wsl)/i;

/** RFC 1918 / RFC 3927 — the ranges a home or clinic router hands out. */
function classify(address) {
  if (/^10\./.test(address)) return 'lan';
  if (/^192\.168\./.test(address)) return 'lan';
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 'lan';
  if (/^169\.254\./.test(address)) return 'self-assigned';
  if (/^127\./.test(address)) return 'loopback';
  return 'public';
}

const FRIENDLY = {
  en0: 'Wi-Fi', en1: 'Ethernet', en2: 'Ethernet',
  eth0: 'Ethernet', eth1: 'Ethernet', wlan0: 'Wi-Fi', wlp2s0: 'Wi-Fi',
};

/**
 * Every address another device on the network could reach this machine on,
 * best candidate first.
 *
 * Also reports what was rejected and why: when nothing usable turns up, the
 * clinic needs to see the real reason, not a guess about their Wi-Fi.
 */
export function localAddresses(port) {
  const usable = [];
  const rejected = [];

  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      // `family` is the string 'IPv4' on modern Node and the number 4 on old
      // builds; accept both rather than silently matching neither.
      const isIPv4 = entry.family === 'IPv4' || entry.family === 4;
      const address = entry.address;

      if (!isIPv4) { rejected.push({ interface: name, address, why: 'IPv6' }); continue; }
      if (entry.internal) { rejected.push({ interface: name, address, why: 'loopback' }); continue; }

      const kind = classify(address);
      const virtual = VIRTUAL.test(name) || VIRTUAL_WINDOWS.test(name);
      if (virtual) { rejected.push({ interface: name, address, why: 'virtual interface' }); continue; }

      usable.push({
        interface: name,
        label: FRIENDLY[name] || name,
        address,
        kind,
        url: `http://${address}:${port}`,
      });
    }
  }

  // A normal LAN address first; a self-assigned 169.254 one is a last resort.
  const rank = { lan: 0, public: 1, 'self-assigned': 2, loopback: 3 };
  usable.sort((a, b) => (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9)
    || a.interface.localeCompare(b.interface));

  return { addresses: usable, rejected, interfacesSeen: Object.keys(os.networkInterfaces()) };
}
